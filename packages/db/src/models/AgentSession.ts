import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const agentSessionSchema = new Schema(
  {
    issueId: { type: Schema.Types.ObjectId, required: true, index: true },
    status: {
      type: String,
      enum: [
        'queued',
        'starting',
        'verifying',
        'planning',
        'coding',
        'reviewing',
        'done',
        'failed',
        'false_alarm',
      ],
      default: 'queued',
    },
    worktreePath: { type: String, default: '' },
    branchName: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    outputLog: [
      {
        timestamp: { type: Date, default: Date.now },
        phase: { type: String },
        content: { type: String },
      },
    ],
    filesModified: { type: [String], default: [] },
    error: { type: String, default: null },
    prNumber: { type: Number, default: null },
    prUrl: { type: String, default: null },
    falseAlarmReason: { type: String, default: null },
    costUsd: { type: Number, default: null },
  },
  { timestamps: true },
);

export type AgentSessionDocument = InferSchemaType<
  typeof agentSessionSchema
> &
  mongoose.Document;

export const AgentSession = mongoose.model(
  'AgentSession',
  agentSessionSchema,
);
