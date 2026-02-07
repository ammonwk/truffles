import mongoose from 'mongoose';

export { mongoose };
export { Session } from './models/Session';
export type { SessionDocument } from './models/Session';
export { AgentSession } from './models/AgentSession';
export type { AgentSessionDocument } from './models/AgentSession';

export async function connectDB(uri: string): Promise<typeof mongoose> {
  return mongoose.connect(uri);
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
