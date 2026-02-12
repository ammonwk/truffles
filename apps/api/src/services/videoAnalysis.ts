import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { DetectedIssue, VideoAnalysisResult } from '@truffles/shared';
import { analyzeVideoFrames } from './openrouter.js';
import { extractFrames, downloadVideoFromS3 } from './frameExtractor.js';
import { getPresignedUrl, uploadBufferAndGetUrl } from './s3.js';
import { buildVideoAnalysisPrompt } from '../prompts/videoAnalysis.js';

export interface VideoAnalysisWithFrames {
  primary: VideoAnalysisResult;
  secondary: VideoAnalysisResult;
  frameUrls: Map<number, string>;
}

export async function analyzeSessionVideo(
  videoS3Key: string,
  sessionDurationSec: number,
  models: { primary: string; secondary: string },
  sessionId: string,
): Promise<VideoAnalysisWithFrames> {
  // Download video to temp
  const tmpVideoPath = path.join(os.tmpdir(), `truffles-video-${Date.now()}.mp4`);

  try {
    const presignedUrl = await getPresignedUrl(videoS3Key);
    await downloadVideoFromS3(presignedUrl, tmpVideoPath);

    // Extract frames (every 5 seconds, max 20 frames)
    const frames = await extractFrames(tmpVideoPath, 5, 20);

    if (frames.length === 0) {
      return {
        primary: { issues: [], model: models.primary, durationMs: 0 },
        secondary: { issues: [], model: models.secondary, durationMs: 0 },
        frameUrls: new Map(),
      };
    }

    const prompt = buildVideoAnalysisPrompt(sessionDurationSec, frames.length);
    const framePayloads = frames.map((f) => ({ base64: f.base64, mimeType: f.mimeType }));

    // Run both models in parallel
    const [primaryResult, secondaryResult] = await Promise.all([
      runVideoModel(models.primary, framePayloads, prompt),
      runVideoModel(models.secondary, framePayloads, prompt),
    ]);

    // Collect all frameIndex values referenced by detected issues
    const referencedFrameIndices = new Set<number>();
    for (const issue of [...primaryResult.issues, ...secondaryResult.issues]) {
      if (issue.frameIndex != null && issue.frameIndex >= 0 && issue.frameIndex < frames.length) {
        referencedFrameIndices.add(issue.frameIndex);
      }
    }

    // Upload only the referenced frames to S3 with public-read
    const frameUrls = new Map<number, string>();
    for (const idx of referencedFrameIndices) {
      const frame = frames[idx];
      const key = `sessions/${sessionId}/frames/frame-${String(idx).padStart(4, '0')}.jpg`;
      try {
        const url = await uploadBufferAndGetUrl(key, Buffer.from(frame.base64, 'base64'), 'image/jpeg');
        frameUrls.set(idx, url);
      } catch (err) {
        console.warn(`[video-analysis] failed to upload frame ${idx} to S3:`, err);
      }
    }

    return {
      primary: { ...primaryResult, model: models.primary },
      secondary: { ...secondaryResult, model: models.secondary },
      frameUrls,
    };
  } finally {
    if (fs.existsSync(tmpVideoPath)) {
      fs.unlinkSync(tmpVideoPath);
    }
  }
}

async function runVideoModel(
  model: string,
  frames: Array<{ base64: string; mimeType: string }>,
  prompt: string,
): Promise<VideoAnalysisResult> {
  const startMs = Date.now();

  try {
    const { content } = await analyzeVideoFrames(model, frames, prompt, {
      temperature: 0.2,
      maxTokens: 8192,
      timeoutMs: 180_000,
    });

    const issues = parseIssuesJson(content);
    return { issues, model, durationMs: Date.now() - startMs };
  } catch (err) {
    console.error(`[video-analysis] model ${model} failed:`, err);
    return { issues: [], model, durationMs: Date.now() - startMs };
  }
}

function parseIssuesJson(content: string): DetectedIssue[] {
  try {
    // Extract JSON array from content (may have markdown wrapping)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: Record<string, unknown>) =>
          item.severity && item.title && item.description,
      )
      .map((item: Record<string, unknown>) => ({
        severity: item.severity === 'red' ? 'red' as const : 'yellow' as const,
        title: String(item.title).slice(0, 200),
        description: String(item.description),
        timestampSec: Number(item.timestampSec) || 0,
        reasoning: String(item.reasoning || ''),
        frameIndex: item.frameIndex != null ? Number(item.frameIndex) : undefined,
      }));
  } catch {
    console.warn('[video-analysis] failed to parse issues JSON');
    return [];
  }
}
