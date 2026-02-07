import type { DetectedIssue } from '@truffles/shared';
import { analyzeText } from './openrouter.js';
import { buildSessionDataAnalysisPrompt } from '../prompts/sessionDataAnalysis.js';

export async function analyzeSessionData(
  consoleErrors: string[],
  networkFailures: string[],
  metadata: Record<string, unknown>,
  model: string,
): Promise<{ issues: DetectedIssue[]; model: string; durationMs: number }> {
  const startMs = Date.now();

  // Skip if no data to analyze
  if (consoleErrors.length === 0 && networkFailures.length === 0) {
    return { issues: [], model, durationMs: 0 };
  }

  try {
    const prompt = buildSessionDataAnalysisPrompt({
      consoleErrors,
      networkFailures,
      metadata,
    });

    const { content } = await analyzeText(model, prompt, {
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 60_000,
    });

    const issues = parseIssuesJson(content);
    return { issues, model, durationMs: Date.now() - startMs };
  } catch (err) {
    console.error('[session-data-analysis] failed:', err);
    return { issues: [], model, durationMs: Date.now() - startMs };
  }
}

function parseIssuesJson(content: string): DetectedIssue[] {
  try {
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
      }));
  } catch {
    console.warn('[session-data-analysis] failed to parse issues JSON');
    return [];
  }
}
