import { PostHogSessionCache } from '@truffles/db';
import type { PostHogSyncResult } from '@truffles/shared';
import { gunzipSync, strFromU8, strToU8 } from 'fflate';
import { fetchWithRetry } from './fetchWithRetry.js';

interface PostHogRecordingResult {
  id: string;
  distinct_id: string;
  person?: {
    properties?: Record<string, unknown>;
  };
  start_time: string;
  end_time: string;
  recording_duration: number;
  active_seconds: number;
  click_count: number;
  keypress_count: number;
  mouse_activity_count: number;
}

interface PostHogListResponse {
  results: PostHogRecordingResult[];
  has_next: boolean;
  next?: string;
}

function getPostHogConfig() {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const host = process.env.POSTHOG_HOST || 'https://us.posthog.com';
  if (!apiKey || !projectId) {
    throw new Error('POSTHOG_API_KEY and POSTHOG_PROJECT_ID must be set');
  }
  return { apiKey, projectId, host };
}

// Debounce flag — skip if a sync is already in progress
let syncInProgress = false;

export async function syncPostHogSessions(): Promise<PostHogSyncResult> {
  if (syncInProgress) {
    console.log('[posthog-sync] Sync already in progress, skipping');
    return { newSessions: 0, totalFetched: 0 };
  }

  syncInProgress = true;
  try {
    const { apiKey, projectId, host } = getPostHogConfig();

    const PAGE_SIZE = 100;
    const MAX_TOTAL = 500;
    let totalFetched = 0;
    let offset = 0;
    let hasMore = true;
    const allResults: PostHogRecordingResult[] = [];

    // Filter out localhost sessions
    const properties = JSON.stringify([
      {
        type: 'event',
        key: '$host',
        value: ['localhost', 'localhost:3000', 'localhost:5173', '127.0.0.1'],
        operator: 'is_not',
      },
    ]);

    while (hasMore && totalFetched < MAX_TOTAL) {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      params.set('properties', properties);

      const url = `${host}/api/environments/${projectId}/session_recordings?${params.toString()}`;
      const response = await fetchWithRetry(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`PostHog API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as PostHogListResponse;
      allResults.push(...data.results);
      totalFetched += data.results.length;
      offset += data.results.length;
      hasMore = data.has_next;
    }

    if (allResults.length === 0) {
      console.log('[posthog-sync] No sessions fetched from PostHog');
      return { newSessions: 0, totalFetched: 0 };
    }

    // Bulk upsert into cache
    const ops = allResults.map((r) => ({
      updateOne: {
        filter: { posthogSessionId: r.id },
        update: {
          $set: {
            posthogSessionId: r.id,
            distinctId: r.distinct_id,
            userEmail: (r.person?.properties?.email as string) ?? '',
            startTime: new Date(r.start_time),
            endTime: new Date(r.end_time),
            durationSec: Math.round(r.recording_duration),
            activeSeconds: Math.round(r.active_seconds),
            eventCount: r.click_count + r.keypress_count + r.mouse_activity_count,
          },
        },
        upsert: true,
      },
    }));

    const bulkResult = await PostHogSessionCache.bulkWrite(ops);
    const newSessions = bulkResult.upsertedCount;

    console.log(
      `[posthog-sync] Fetched ${totalFetched} sessions, ${newSessions} new, ${bulkResult.modifiedCount} updated`,
    );

    return { newSessions, totalFetched };
  } finally {
    syncInProgress = false;
  }
}

interface PostHogSnapshotResponse {
  sources: Array<{
    source: string;
    blob_key?: string | number;
  }>;
}

export interface RRWebEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

export async function getSessionSnapshots(
  sessionId: string,
): Promise<RRWebEvent[]> {
  const { apiKey, projectId, host } = getPostHogConfig();

  // First, get the snapshot sources (PostHog v2 uses /api/environments/ path)
  const sourcesUrl = `${host}/api/environments/${projectId}/session_recordings/${sessionId}/snapshots`;
  const sourcesResponse = await fetchWithRetry(sourcesUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!sourcesResponse.ok) {
    const text = await sourcesResponse.text();
    throw new Error(`PostHog snapshots API error ${sourcesResponse.status}: ${text}`);
  }

  const sourcesData = (await sourcesResponse.json()) as PostHogSnapshotResponse;
  console.log(`[posthog] Snapshot sources for ${sessionId}:`, JSON.stringify(sourcesData.sources));

  // Fetch each blob source
  const allEvents: RRWebEvent[] = [];

  for (const source of sourcesData.sources) {
    if (source.blob_key === undefined || source.blob_key === null) continue;

    const key = encodeURIComponent(String(source.blob_key));
    const blobUrl = `${sourcesUrl}?source=${encodeURIComponent(source.source)}&start_blob_key=${key}&end_blob_key=${key}`;
    console.log(`[posthog] Fetching blob: ${blobUrl}`);
    const blobResponse = await fetchWithRetry(blobUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!blobResponse.ok) {
      const errorText = await blobResponse.text().catch(() => '');
      console.warn(`Failed to fetch blob ${source.blob_key}: ${blobResponse.status} ${errorText}`);
      continue;
    }

    const text = await blobResponse.text();
    const events = convertPostHogSnapshotsToRRWeb(text);
    allEvents.push(...events);
  }

  if (allEvents.length === 0) {
    throw new Error('No valid rrweb events found in PostHog snapshot data');
  }

  // Sort by timestamp
  allEvents.sort((a, b) => a.timestamp - b.timestamp);

  // Validate: first event should be FullSnapshot (type 2) or Meta (type 4)
  // Discard orphaned incremental snapshots at the start
  const firstValidIndex = allEvents.findIndex((e) => e.type === 2 || e.type === 4);
  if (firstValidIndex > 0) {
    console.warn(`[posthog] Discarding ${firstValidIndex} orphaned events before first FullSnapshot/Meta`);
    allEvents.splice(0, firstValidIndex);
  } else if (firstValidIndex === -1) {
    console.warn('[posthog] No FullSnapshot or Meta event found; events may not replay correctly');
  }

  return allEvents;
}

// rrweb event types used for decompression routing
const EventType = { FullSnapshot: 2, IncrementalSnapshot: 3 } as const;
const IncrementalSource = { Mutation: 0, StyleSheetRule: 12 } as const;

/**
 * Decompress a PostHog partially-compressed rrweb event.
 * PostHog's client (posthog-js) gzip-compresses individual fields within
 * FullSnapshot and Mutation events using fflate. Compressed events are
 * marked with a `cv` (compression version) property.
 */
function decompressEvent(ev: RRWebEvent): RRWebEvent {
  const raw = ev as any;
  if (!raw.cv) return ev; // not compressed

  if (raw.cv !== '2024-10') {
    console.warn(`[posthog] Unknown compression version: ${raw.cv}`);
    return ev;
  }

  try {
    if (raw.type === EventType.FullSnapshot && typeof raw.data === 'string') {
      return { ...raw, data: unzipField(raw.data) };
    }

    if (raw.type === EventType.IncrementalSnapshot && raw.data && typeof raw.data === 'object') {
      if (raw.data.source === IncrementalSource.Mutation && 'texts' in raw.data) {
        return {
          ...raw,
          data: {
            ...raw.data,
            adds: unzipField(raw.data.adds),
            removes: unzipField(raw.data.removes),
            texts: unzipField(raw.data.texts),
            attributes: unzipField(raw.data.attributes),
          },
        };
      }
      if (raw.data.source === IncrementalSource.StyleSheetRule) {
        return {
          ...raw,
          data: {
            ...raw.data,
            adds: raw.data.adds ? unzipField(raw.data.adds) : undefined,
            removes: raw.data.removes ? unzipField(raw.data.removes) : undefined,
          },
        };
      }
    }
  } catch (err) {
    console.warn(`[posthog] Failed to decompress event (type=${raw.type}):`, err);
  }

  return ev;
}

function unzipField(compressed: unknown): unknown {
  if (compressed === undefined || compressed === null) return compressed;
  if (typeof compressed !== 'string') return compressed; // already decompressed
  return JSON.parse(strFromU8(gunzipSync(strToU8(compressed, true))));
}

export function convertPostHogSnapshotsToRRWeb(data: string): RRWebEvent[] {
  const events: RRWebEvent[] = [];
  const lines = data.split('\n').filter((line) => line.trim());

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);

      // PostHog stores events as { window_id, data: rrwebEvent } or [windowId, rrwebEvent]
      let rrwebEvent: RRWebEvent | null = null;

      if (Array.isArray(parsed)) {
        // [windowId, rrwebEvent] format
        rrwebEvent = parsed[1] as RRWebEvent;
      } else if (parsed.data && typeof parsed.data === 'object' && 'type' in parsed.data) {
        // { window_id, data: rrwebEvent } format
        rrwebEvent = parsed.data as RRWebEvent;
      } else if (typeof parsed.type === 'number' && typeof parsed.timestamp === 'number') {
        // Direct rrweb event
        rrwebEvent = parsed as RRWebEvent;
      }

      if (rrwebEvent && typeof rrwebEvent.type === 'number' && typeof rrwebEvent.timestamp === 'number') {
        events.push(decompressEvent(rrwebEvent));
      } else {
        console.warn('Skipping malformed rrweb event line');
      }
    } catch {
      console.warn('Skipping unparseable snapshot line');
    }
  }

  return events;
}

interface PostHogSessionMeta {
  person?: {
    properties?: Record<string, unknown>;
  };
}

export async function getSessionMetadata(sessionId: string): Promise<{
  userEmail: string;
  userId: string;
  metadata: Record<string, unknown>;
}> {
  const { apiKey, projectId, host } = getPostHogConfig();
  const url = `${host}/api/environments/${projectId}/session_recordings/${sessionId}`;
  const response = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PostHog session metadata API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as PostHogSessionMeta & Record<string, unknown>;

  const personProps = data.person?.properties ?? {};
  const userEmail = (personProps.email as string) ?? '';
  const userId = (personProps.distinct_id as string) ?? (data.distinct_id as string) ?? '';

  return {
    userEmail,
    userId,
    metadata: {
      browser: personProps.$browser ?? '',
      os: personProps.$os ?? '',
      device: personProps.$device_type ?? '',
      viewport: personProps.$screen_width
        ? `${personProps.$screen_width}x${personProps.$screen_height}`
        : '',
    },
  };
}

/**
 * Extract console errors from rrweb events.
 * PostHog records console output via the rrweb console plugin (type 6, plugin "rrweb/console@1").
 */
export function extractConsoleErrors(events: RRWebEvent[]): string[] {
  const errors: string[] = [];

  for (const event of events) {
    if (event.type !== 6) continue;

    const data = event.data as {
      plugin?: string;
      payload?: {
        level?: string;
        payload?: unknown[];
        trace?: string[];
      };
    };

    if (data.plugin !== 'rrweb/console@1') continue;
    if (data.payload?.level !== 'error') continue;

    const parts = data.payload.payload ?? [];
    const message = parts
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join(' ')
      .trim();

    if (message) {
      errors.push(message);
    }
  }

  return dedupeStrings(errors);
}

/**
 * Extract network failures from rrweb events.
 * PostHog captures these as:
 *   - Custom events (type 5) with tag "performanceObserver" containing resource entries
 *   - Plugin events (type 6) with plugin "posthog/network@1"
 */
export function extractNetworkFailures(events: RRWebEvent[]): string[] {
  const failures: string[] = [];

  for (const event of events) {
    if (event.type === 5) {
      // Custom event: performanceObserver resource entries
      const data = event.data as {
        tag?: string;
        payload?: {
          entryType?: string;
          name?: string;
          responseStatus?: number;
          transferSize?: number;
          duration?: number;
          method?: string;
        } | Array<{
          entryType?: string;
          name?: string;
          responseStatus?: number;
          transferSize?: number;
          duration?: number;
          method?: string;
        }>;
      };

      if (data.tag !== 'performanceObserver') continue;

      const entries = Array.isArray(data.payload) ? data.payload : data.payload ? [data.payload] : [];
      for (const entry of entries) {
        if (entry.entryType !== 'resource') continue;
        const status = entry.responseStatus ?? 0;
        // status 0 = network error (CORS, DNS, connection refused), >= 400 = HTTP error
        if (status === 0 || status >= 400) {
          const method = entry.method ?? 'GET';
          const label = status === 0
            ? `${method} ${entry.name} [network error]`
            : `${method} ${entry.name} [${status}]`;
          failures.push(label);
        }
      }
    } else if (event.type === 6) {
      // Plugin event: posthog/network@1
      const data = event.data as {
        plugin?: string;
        payload?: {
          requests?: Array<{
            url?: string;
            method?: string;
            status?: number;
            responseStatus?: number;
          }>;
        };
      };

      if (data.plugin !== 'posthog/network@1') continue;

      const requests = data.payload?.requests ?? [];
      for (const req of requests) {
        const status = req.status ?? req.responseStatus ?? 0;
        if (status === 0 || status >= 400) {
          const method = req.method ?? 'GET';
          const label = status === 0
            ? `${method} ${req.url} [network error]`
            : `${method} ${req.url} [${status}]`;
          failures.push(label);
        }
      }
    }
  }

  return dedupeStrings(failures);
}

function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}
