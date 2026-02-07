import type {
  PostHogSessionsResponse,
  PostHogSyncResult,
  SessionSummary,
  SessionDetail,
  ProcessSessionsResponse,
  IssueListResponse,
  IssueDetail,
  AgentListResponse,
  AgentSessionDoc,
  SettingsResponse,
  SettingsUpdateRequest,
  SuppressionRuleListResponse,
  SuppressionRuleDoc,
} from '@truffles/shared';

const API_BASE = import.meta.env.VITE_API_URL || '';

function getAdminPassword(): string {
  return sessionStorage.getItem('truffles-admin-password') || '';
}

function adminHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getAdminPassword()}`,
  };
}

// --- Identity (local network) ---

export async function fetchIdentity(): Promise<{ name: string | null; role: string | null }> {
  const res = await fetch(`/api/identify`);
  const data = await res.json();
  return data;
}

// --- Sessions (existing) ---

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

export async function triggerPostHogSync(): Promise<PostHogSyncResult> {
  const res = await fetch(`${API_BASE}/api/posthog/sync`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to sync PostHog sessions: ${res.status}`);
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

export async function reprocessSession(id: string): Promise<{ status: string; sessionId: string }> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/reprocess`, {
    method: 'POST',
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to reprocess session: ${res.status}`);
  }
  return res.json();
}

export async function cancelProcessing(id: string): Promise<{ status: string; sessionId: string }> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}/cancel`, {
    method: 'POST',
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to cancel processing: ${res.status}`);
  }
  return res.json();
}

// --- Issues ---

export async function fetchIssues(params?: {
  severity?: string;
  status?: string;
  sessionId?: string;
  limit?: number;
  offset?: number;
}): Promise<IssueListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.severity && params.severity !== 'all') searchParams.set('severity', params.severity);
  if (params?.status && params.status !== 'all') searchParams.set('status', params.status);
  if (params?.sessionId) searchParams.set('sessionId', params.sessionId);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const query = searchParams.toString();
  const res = await fetch(`${API_BASE}/api/issues${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch issues: ${res.status}`);
  return res.json();
}

export async function fetchIssueDetail(id: string): Promise<IssueDetail> {
  const res = await fetch(`${API_BASE}/api/issues/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch issue detail: ${res.status}`);
  return res.json();
}

export async function updateIssueStatus(id: string, status: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/issues/${id}/status`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to update issue status: ${res.status}`);
  }
}

export async function retryIssue(id: string): Promise<{ agentSessionId: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/issues/${id}/retry`, {
    method: 'POST',
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to retry issue: ${res.status}`);
  }
  return res.json();
}

export async function markFalseAlarm(id: string, reason?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/issues/${id}/false-alarm`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to mark false alarm: ${res.status}`);
  }
}

// --- Agents ---

export async function fetchAgentList(): Promise<AgentListResponse> {
  const res = await fetch(`${API_BASE}/api/agents`);
  if (!res.ok) throw new Error(`Failed to fetch agents: ${res.status}`);
  return res.json();
}

export async function fetchAgentDetail(id: string): Promise<AgentSessionDoc> {
  const res = await fetch(`${API_BASE}/api/agents/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch agent detail: ${res.status}`);
  return res.json();
}

export async function startAgent(request: {
  issueId: string;
  issueTitle: string;
  issueDescription: string;
  severity: string;
}): Promise<{ agentSessionId: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/agents/start`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to start agent: ${res.status}`);
  }
  return res.json();
}

export async function stopAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agents/${id}/stop`, {
    method: 'POST',
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to stop agent: ${res.status}`);
  }
}

// --- Settings ---

export async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${API_BASE}/api/settings`);
  if (!res.ok) throw new Error(`Failed to fetch settings: ${res.status}`);
  return res.json();
}

export async function updateSettings(settings: SettingsUpdateRequest): Promise<SettingsResponse> {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to update settings: ${res.status}`);
  }
  return res.json();
}

export async function validatePassword(password: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/settings/validate-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(`Failed to validate password: ${res.status}`);
  const data = await res.json();
  return data.valid;
}

// --- Suppressions ---

export async function fetchSuppressionRules(): Promise<SuppressionRuleListResponse> {
  const res = await fetch(`${API_BASE}/api/suppressions`);
  if (!res.ok) throw new Error(`Failed to fetch suppression rules: ${res.status}`);
  return res.json();
}

export async function addSuppressionRule(pattern: string, reason?: string): Promise<SuppressionRuleDoc> {
  const res = await fetch(`${API_BASE}/api/suppressions`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ pattern, source: 'manual', reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to add suppression rule: ${res.status}`);
  }
  return res.json();
}

export async function deleteSuppressionRule(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/suppressions/${id}`, {
    method: 'DELETE',
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to delete suppression rule: ${res.status}`);
  }
}

export async function resetSuppressionRules(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/suppressions/reset`, {
    method: 'POST',
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to reset suppression rules: ${res.status}`);
  }
}

// --- Admin ---

export async function clearAllData(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/settings/clear-all`, {
    method: 'POST',
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to clear data: ${res.status}`);
  }
}

// --- PRs ---

export interface PRDetail {
  id: number;
  title: string;
  branch: string;
  status: 'open' | 'merged' | 'closed';
  additions: number;
  deletions: number;
  filesChanged: number;
  body: string;
  issueId: string | null;
  issueTitle: string | null;
  issueDescription: string | null;
  sessionId: string | null;
  issueTimestampSec: number | null;
  agentReasoning: string;
  diff: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchPRDetail(prNumber: number): Promise<PRDetail> {
  const res = await fetch(`${API_BASE}/api/prs/${prNumber}`);
  if (!res.ok) throw new Error(`Failed to fetch PR: ${res.status}`);
  return res.json();
}
