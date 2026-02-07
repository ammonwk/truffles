import type { Severity } from '../index';

export interface DetectedIssue {
  severity: Severity;
  title: string;
  description: string;
  timestampSec: number;
  reasoning: string;
  frameIndex?: number;
}

export interface VideoAnalysisResult {
  issues: DetectedIssue[];
  model: string;
  durationMs: number;
}

export interface ScreeningResult {
  kept: Array<DetectedIssue & { screeningReasoning: string }>;
  dropped: Array<DetectedIssue & { screeningReasoning: string; dropReason: string }>;
  model: string;
  durationMs: number;
}
