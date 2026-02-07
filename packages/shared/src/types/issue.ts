import type { IssueStatus, Severity } from '../index';

export interface IssueDoc {
  _id: string;
  sessionId: string;
  posthogSessionId: string;
  severity: Severity;
  title: string;
  description: string;
  timestampSec: number;
  status: IssueStatus;
  foundAt: string;
  llmReasoning: string;
  screeningReasoning: string;
  falseAlarmReason?: string;
  prNumber?: number;
  prUrl?: string;
  detectedBy: string;
  screenedBy?: string;
  videoFrameUrls?: string[];
  agentSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueSummary {
  _id: string;
  sessionId: string;
  severity: Severity;
  title: string;
  description: string;
  timestampSec: number;
  status: IssueStatus;
  foundAt: string;
  prNumber?: number;
  prUrl?: string;
}

export interface IssueDetail extends IssueDoc {
  sessionEmail?: string;
}

export interface IssueListResponse {
  issues: IssueSummary[];
  total: number;
}

export interface CreateIssueRequest {
  sessionId: string;
  posthogSessionId: string;
  severity: Severity;
  title: string;
  description: string;
  timestampSec: number;
  llmReasoning: string;
  detectedBy: string;
  videoFrameUrls?: string[];
}

export interface UpdateIssueStatusRequest {
  status: IssueStatus;
}
