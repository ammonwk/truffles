import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const settingsSchema = new Schema(
  {
    maxConcurrentAgents: { type: Number, default: 5 },
    agentTimeoutMinutes: { type: Number, default: 15 },
    pollingIntervalSec: { type: Number, default: 60 },
    videoModelPrimary: { type: String, default: 'moonshotai/kimi-k2.5' },
    videoModelSecondary: { type: String, default: 'google/gemini-3-pro-preview' },
    screeningModel: { type: String, default: 'anthropic/claude-opus-4.6' },
  },
  { timestamps: true },
);

// Singleton pattern: always use getOrCreate()
settingsSchema.statics.getOrCreate = async function () {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({});
  }
  return doc;
};

export type SettingsDocument = InferSchemaType<typeof settingsSchema> & mongoose.Document;

export interface SettingsModel extends mongoose.Model<SettingsDocument> {
  getOrCreate(): Promise<SettingsDocument>;
}

export const Settings = mongoose.model<SettingsDocument, SettingsModel>('Settings', settingsSchema);
