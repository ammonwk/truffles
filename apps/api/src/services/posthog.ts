import { Session } from '@truffles/db';
import type { PostHogSessionSummary, PostHogSessionsResponse } from '@truffles/shared';

interface ListOptions {
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
}

interface PostHogRecordingResult {
  id: string;
  distinct_id: string;
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

export async function listPostHogSessions(
  options: ListOptions = {},
): Promise<PostHogSessionsResponse> {
  const { apiKey, projectId, host } = getPostHogConfig();
  const { limit = 20, offset = 0, dateFrom, dateTo } = options;

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);

  const url = `${host}/api/projects/${projectId}/session_recordings?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PostHog API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as PostHogListResponse;

  const sessionIds = data.results.map((r) => r.id);
  const existing = await Session.find(
    { posthogSessionId: { $in: sessionIds } },
    { posthogSessionId: 1 },
  ).lean();
  const processedSet = new Set(existing.map((e) => e.posthogSessionId));

  const sessions: PostHogSessionSummary[] = data.results.map((r) => ({
    id: r.id,
    distinctId: r.distinct_id,
    startTime: r.start_time,
    endTime: r.end_time,
    durationSec: Math.round(r.recording_duration),
    activeSeconds: Math.round(r.active_seconds),
    eventCount: r.click_count + r.keypress_count + r.mouse_activity_count,
    alreadyProcessed: processedSet.has(r.id),
  }));

  return {
    sessions,
    hasMore: data.has_next,
    nextCursor: data.next ?? null,
  };
}

interface PostHogSnapshotResponse {
  sources: Array<{
    source: string;
    blob_key?: string;
  }>;
}

interface RRWebEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

export async function getSessionSnapshots(
  sessionId: string,
): Promise<RRWebEvent[]> {
  const { apiKey, projectId, host } = getPostHogConfig();

  // First, get the snapshot sources
  const sourcesUrl = `${host}/api/projects/${projectId}/session_recordings/${sessionId}/snapshots`;
  const sourcesResponse = await fetch(sourcesUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!sourcesResponse.ok) {
    const text = await sourcesResponse.text();
    throw new Error(`PostHog snapshots API error ${sourcesResponse.status}: ${text}`);
  }

  const sourcesData = (await sourcesResponse.json()) as PostHogSnapshotResponse;

  // Fetch each blob source
  const allEvents: RRWebEvent[] = [];

  for (const source of sourcesData.sources) {
    if (!source.blob_key) continue;

    const blobUrl = `${sourcesUrl}?source=blob&blob_key=${source.blob_key}`;
    const blobResponse = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!blobResponse.ok) {
      console.warn(`Failed to fetch blob ${source.blob_key}: ${blobResponse.status}`);
      continue;
    }

    const text = await blobResponse.text();
    const events = convertPostHogSnapshotsToRRWeb(text);
    allEvents.push(...events);
  }

  // Sort by timestamp
  allEvents.sort((a, b) => a.timestamp - b.timestamp);

  return allEvents;
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
        events.push(rrwebEvent);
      } else {
        console.warn('Skipping malformed rrweb event line');
      }
    } catch {
      console.warn('Skipping unparseable snapshot line');
    }
  }

  if (events.length === 0) {
    throw new Error('No valid rrweb events found in PostHog snapshot data');
  }

  // Validate: first event should be FullSnapshot (type 2) or Meta (type 4)
  // Discard orphaned incremental snapshots at the start
  const firstValidIndex = events.findIndex((e) => e.type === 2 || e.type === 4);
  if (firstValidIndex > 0) {
    console.warn(`Discarding ${firstValidIndex} orphaned events before first FullSnapshot/Meta`);
    events.splice(0, firstValidIndex);
  } else if (firstValidIndex === -1) {
    console.warn('No FullSnapshot or Meta event found; events may not replay correctly');
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
  consoleErrors: string[];
  networkFailures: string[];
}> {
  const { apiKey, projectId, host } = getPostHogConfig();
  const url = `${host}/api/projects/${projectId}/session_recordings/${sessionId}`;
  const response = await fetch(url, {
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
    consoleErrors: [],
    networkFailures: [],
  };
}
