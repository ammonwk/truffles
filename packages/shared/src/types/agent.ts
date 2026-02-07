import type { AgentPhase, Severity } from '../index';

// --- Request/Response types ---

export interface AgentStartRequest {
  issueId: string;
  issueTitle: string;
  issueDescription: string;
  severity: Severity;
  sessionContext?: {
    consoleErrors?: string[];
    networkFailures?: string[];
    userEmail?: string;
  };
}

export interface AgentStartResponse {
  agentSessionId: string;
  status: 'started' | 'queued';
  position?: number;
}

// --- DB document shape ---

export interface AgentOutputEntry {
  timestamp: string;
  phase: AgentPhase;
  content: string;
}

export interface AgentSessionDoc {
  _id: string;
  issueId: string;
  status: AgentPhase;
  worktreePath: string;
  branchName: string;
  startedAt: string;
  completedAt?: string;
  outputLog: AgentOutputEntry[];
  filesModified: string[];
  error?: string;
  prNumber?: number;
  prUrl?: string;
  falseAlarmReason?: string;
  costUsd?: number;
}

// --- WebSocket event types ---

export type AgentStreamEvent =
  | { type: 'agent:output'; agentId: string; phase: AgentPhase; content: string; timestamp: string }
  | { type: 'agent:phase_change'; agentId: string; phase: AgentPhase; timestamp: string }
  | { type: 'agent:complete'; agentId: string; result: 'done' | 'failed' | 'false_alarm'; prUrl?: string; error?: string; falseAlarmReason?: string }
  | { type: 'agent:started'; agentId: string; issueId: string }
  | { type: 'agent:stopped'; agentId: string; reason: string };

// --- Agent list response ---

export interface AgentListResponse {
  active: AgentSessionDoc[];
  queued: string[];
  stats: { maxConcurrent: number; activeCount: number; queuedCount: number };
}
