export interface DashboardPRCard {
  issueId: string;
  sessionId: string;
  severity: 'red' | 'yellow';
  issueTitle: string;
  issueDescription: string;
  issueStatus: string;
  timestampSec: number;
  foundAt: string;
  screenshotUrl: string | null;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  prStatus: 'open' | 'merged' | 'closed';
  prAdditions: number;
  prDeletions: number;
  prFilesChanged: number;
  prHtmlUrl: string;
  prCreatedAt: string;
}

export interface DashboardResponse {
  cards: DashboardPRCard[];
  total: number;
}
