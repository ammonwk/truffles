export type Severity = 'red' | 'yellow';

export type IssueStatus =
  | 'detected'
  | 'screening'
  | 'queued'
  | 'fixing'
  | 'pr_open'
  | 'merged'
  | 'false_alarm';

export type AgentPhase =
  | 'queued'
  | 'starting'
  | 'verifying'
  | 'planning'
  | 'coding'
  | 'reviewing'
  | 'done'
  | 'failed'
  | 'false_alarm';

export type SessionStatus = 'pending' | 'rendering' | 'analyzing' | 'complete' | 'error';

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
  version: string;
}

export interface PostHogSessionSummary {
  id: string;
  distinctId: string;
  userEmail: string;
  startTime: string;
  endTime: string;
  durationSec: number;
  activeSeconds: number;
  eventCount: number;
  alreadyProcessed: boolean;
}

export interface PostHogSessionsResponse {
  sessions: PostHogSessionSummary[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ProcessSessionsRequest {
  sessionIds: string[];
}

export interface ProcessSessionsResponse {
  queued: string[];
  skipped: string[];
  errors: Array<{ sessionId: string; reason: string }>;
}

export interface SessionSummary {
  id: string;
  posthogSessionId: string;
  userEmail: string;
  startTime: string;
  durationSec: number;
  status: SessionStatus;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  issueCount: number;
  createdAt: string;
}

export interface SessionDetail extends SessionSummary {
  metadata: Record<string, unknown>;
  consoleErrors: string[];
  networkFailures: string[];
  errorMessage: string | null;
}

export type WsMessageType =
  | 'processing:started'
  | 'processing:progress'
  | 'processing:complete'
  | 'processing:error';

export interface WsMessage {
  type: WsMessageType;
  sessionId: string;
  data: WsProcessingProgress | Record<string, unknown>;
}

export type ProcessingPhase = 'downloading' | 'converting' | 'rendering' | 'uploading';

export interface WsProcessingProgress {
  phase: ProcessingPhase;
  percent: number;
  message: string;
}

export interface PostHogSyncResult {
  newSessions: number;
  totalFetched: number;
}

export const APP_VERSION = '0.1.0';

export * from './types/agent';
export * from './types/issue';
export * from './types/settings';
export * from './types/suppression';
export * from './types/analysis';
