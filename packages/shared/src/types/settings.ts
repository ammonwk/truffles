export interface SettingsDoc {
  _id: string;
  maxConcurrentAgents: number;
  agentTimeoutMinutes: number;
  pollingIntervalSec: number;
  videoModelPrimary: string;
  videoModelSecondary: string;
  screeningModel: string;
  updatedAt: string;
}

export interface SettingsUpdateRequest {
  maxConcurrentAgents?: number;
  agentTimeoutMinutes?: number;
  pollingIntervalSec?: number;
  videoModelPrimary?: string;
  videoModelSecondary?: string;
  screeningModel?: string;
}

export interface SettingsResponse extends SettingsDoc {}
