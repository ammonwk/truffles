import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const sessionSchema = new Schema(
  {
    posthogSessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: { type: String, default: '' },
    userEmail: { type: String, default: '' },
    startTime: { type: Date, required: true },
    duration: { type: Number, default: 0 },
    videoUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    rrwebEventsUrl: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    consoleErrors: { type: [String], default: [] },
    networkFailures: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['pending', 'rendering', 'analyzing', 'complete', 'error'],
      default: 'pending',
    },
    errorMessage: { type: String, default: null },
    issueCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type SessionDocument = InferSchemaType<typeof sessionSchema> &
  mongoose.Document;

export const Session = mongoose.model('Session', sessionSchema);
