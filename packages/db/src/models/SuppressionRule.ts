import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const suppressionRuleSchema = new Schema(
  {
    pattern: { type: String, required: true },
    source: {
      type: String,
      enum: ['agent', 'manual'],
      default: 'manual',
    },
    reason: { type: String, default: null },
    issueId: { type: Schema.Types.ObjectId, ref: 'Issue', default: null },
  },
  { timestamps: true },
);

export type SuppressionRuleDocument = InferSchemaType<typeof suppressionRuleSchema> & mongoose.Document;

export const SuppressionRule = mongoose.model('SuppressionRule', suppressionRuleSchema);
