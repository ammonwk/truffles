import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const postHogSessionCacheSchema = new Schema(
  {
    posthogSessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    distinctId: { type: String, default: '' },
    userEmail: { type: String, default: '' },
    startTime: { type: Date, required: true, index: -1 },
    endTime: { type: Date, required: true },
    durationSec: { type: Number, default: 0 },
    activeSeconds: { type: Number, default: 0 },
    eventCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type PostHogSessionCacheDocument =
  InferSchemaType<typeof postHogSessionCacheSchema> & mongoose.Document;

export const PostHogSessionCache = mongoose.model(
  'PostHogSessionCache',
  postHogSessionCacheSchema,
);
