import type { DetectedIssue, ScreeningResult } from '@truffles/shared';
import { SuppressionRule } from '@truffles/db';
import { analyzeText } from './openrouter.js';
import { buildScreeningPrompt } from '../prompts/screeningPrompt.js';

export async function screenIssues(
  issues: DetectedIssue[],
  model: string,
): Promise<ScreeningResult> {
  const startMs = Date.now();

  if (issues.length === 0) {
    return { kept: [], dropped: [], model, durationMs: 0 };
  }

  try {
    // Fetch all suppression patterns
    const rules = await SuppressionRule.find().lean();
    const patterns = rules.map((r) => r.pattern);

    const prompt = buildScreeningPrompt(issues, patterns);

    const { content } = await analyzeText(model, prompt, {
      temperature: 0.1,
      maxTokens: 4096,
      timeoutMs: 60_000,
    });

    const result = parseScreeningResult(content, issues);
    return { ...result, model, durationMs: Date.now() - startMs };
  } catch (err) {
    console.error('[screening] failed:', err);
    // On failure, keep all issues (fail open)
    return {
      kept: issues.map((issue) => ({
        ...issue,
        screeningReasoning: 'Screening failed — kept by default',
      })),
      dropped: [],
      model,
      durationMs: Date.now() - startMs,
    };
  }
}

function parseScreeningResult(
  content: string,
  originalIssues: DetectedIssue[],
): { kept: ScreeningResult['kept']; dropped: ScreeningResult['dropped'] } {
  try {
    // Extract JSON object from content
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Can't parse — keep all
      return {
        kept: originalIssues.map((issue) => ({
          ...issue,
          screeningReasoning: 'Could not parse screening response — kept by default',
        })),
        dropped: [],
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const kept: ScreeningResult['kept'] = [];
    const dropped: ScreeningResult['dropped'] = [];

    if (Array.isArray(parsed.kept)) {
      for (const item of parsed.kept) {
        const idx = Number(item.issueIndex);
        if (idx >= 0 && idx < originalIssues.length) {
          kept.push({
            ...originalIssues[idx],
            screeningReasoning: String(item.screeningReasoning || ''),
          });
        }
      }
    }

    if (Array.isArray(parsed.dropped)) {
      for (const item of parsed.dropped) {
        const idx = Number(item.issueIndex);
        if (idx >= 0 && idx < originalIssues.length) {
          dropped.push({
            ...originalIssues[idx],
            screeningReasoning: String(item.screeningReasoning || ''),
            dropReason: String(item.dropReason || 'Filtered by screening'),
          });
        }
      }
    }

    // Any issues not mentioned in either list get kept by default
    const mentionedIndices = new Set([
      ...kept.map((_, i) => i),
      ...dropped.map((_, i) => i),
    ]);

    // Re-check: find indices actually mentioned
    const keptIndices = new Set(
      (Array.isArray(parsed.kept) ? parsed.kept : []).map((item: { issueIndex: number }) => Number(item.issueIndex)),
    );
    const droppedIndices = new Set(
      (Array.isArray(parsed.dropped) ? parsed.dropped : []).map((item: { issueIndex: number }) => Number(item.issueIndex)),
    );

    for (let i = 0; i < originalIssues.length; i++) {
      if (!keptIndices.has(i) && !droppedIndices.has(i)) {
        kept.push({
          ...originalIssues[i],
          screeningReasoning: 'Not mentioned in screening — kept by default',
        });
      }
    }

    return { kept, dropped };
  } catch {
    console.warn('[screening] failed to parse screening result');
    return {
      kept: originalIssues.map((issue) => ({
        ...issue,
        screeningReasoning: 'Screening parse error — kept by default',
      })),
      dropped: [],
    };
  }
}
