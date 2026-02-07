export interface SuppressionRuleDoc {
  _id: string;
  pattern: string;
  source: 'agent' | 'manual';
  reason?: string;
  issueId?: string;
  createdAt: string;
}

export interface CreateSuppressionRuleRequest {
  pattern: string;
  source?: 'agent' | 'manual';
  reason?: string;
  issueId?: string;
}

export interface SuppressionRuleListResponse {
  rules: SuppressionRuleDoc[];
  total: number;
}
