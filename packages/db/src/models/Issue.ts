import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const issueSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    posthogSessionId: { type: String, required: true, index: true },
    severity: {
      type: String,
      enum: ['red', 'yellow'],
      required: true,
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    timestampSec: { type: Number, required: true },
    status: {
      type: String,
      enum: ['detected', 'screening', 'queued', 'fixing', 'pr_open', 'merged', 'false_alarm'],
      default: 'detected',
      index: true,
    },
    foundAt: { type: Date, default: Date.now },
    llmReasoning: { type: String, default: '' },
    screeningReasoning: { type: String, default: '' },
    falseAlarmReason: { type: String, default: null },
    prNumber: { type: Number, default: null },
    prUrl: { type: String, default: null },
    detectedBy: { type: String, default: '' },
    screenedBy: { type: String, default: null },
    videoFrameUrls: { type: [String], default: [] },
    agentSessionId: { type: Schema.Types.ObjectId, ref: 'AgentSession', default: null },
  },
  { timestamps: true },
);

export type IssueDocument = InferSchemaType<typeof issueSchema> & mongoose.Document;

export const Issue = mongoose.model('Issue', issueSchema);
