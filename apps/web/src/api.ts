import type {
  PostHogSessionsResponse,
  SessionSummary,
  SessionDetail,
  ProcessSessionsResponse,
} from '@truffles/shared';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export async function fetchPostHogSessions(params?: {
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<PostHogSessionsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  if (params?.dateFrom) searchParams.set('dateFrom', params.dateFrom);
  if (params?.dateTo) searchParams.set('dateTo', params.dateTo);

  const query = searchParams.toString();
  const url = `${API_BASE}/api/posthog/sessions${query ? `?${query}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PostHog sessions: ${res.status}`);
  return res.json();
}

export async function fetchProcessedSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${API_BASE}/api/sessions`);
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
  return res.json();
}

export async function fetchSessionDetail(id: string): Promise<SessionDetail> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch session detail: ${res.status}`);
  return res.json();
}

export async function processSelectedSessions(
  sessionIds: string[],
  adminPassword: string,
): Promise<ProcessSessionsResponse> {
  const res = await fetch(`${API_BASE}/api/sessions/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminPassword}`,
    },
    body: JSON.stringify({ sessionIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to process sessions: ${res.status}`);
  }
  return res.json();
}
