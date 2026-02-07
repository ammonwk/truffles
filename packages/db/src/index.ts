import mongoose from 'mongoose';

export { mongoose };
export { Session } from './models/Session';
export type { SessionDocument } from './models/Session';
export { AgentSession } from './models/AgentSession';
export type { AgentSessionDocument } from './models/AgentSession';
export { Issue } from './models/Issue';
export type { IssueDocument } from './models/Issue';
export { SuppressionRule } from './models/SuppressionRule';
export type { SuppressionRuleDocument } from './models/SuppressionRule';
export { Settings } from './models/Settings';
export type { SettingsDocument, SettingsModel } from './models/Settings';
export { PostHogSessionCache } from './models/PostHogSessionCache';
export type { PostHogSessionCacheDocument } from './models/PostHogSessionCache';

export async function connectDB(uri: string): Promise<typeof mongoose> {
  return mongoose.connect(uri);
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
