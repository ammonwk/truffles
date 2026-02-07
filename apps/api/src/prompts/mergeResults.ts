import type { DetectedIssue, IssueStatus } from '@truffles/shared';
import { analyzeText } from '../services/openrouter.js';

const DEDUP_MODEL = 'anthropic/claude-opus-4.6';

export interface ExistingIssue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  severity: string;
}

export interface DedupDecision {
  newIndex: number;
  action: 'keep' | 'drop';
  reason: string;
  matchedExistingId?: string;
  matchedExistingStatus?: string;
  matchedNewIndex?: number;
}

export interface MergeResult {
  unique: Array<DetectedIssue & { source: string }>;
  dropped: Array<{
    issue: DetectedIssue & { source: string };
    reason: string;
    matchedExistingId?: string;
    matchedExistingStatus?: string;
  }>;
  model: string;
  durationMs: number;
}

function buildDedupPrompt(
  newIssues: Array<DetectedIssue & { source: string }>,
  existingIssues: ExistingIssue[],
): string {
  const newIssuesList = newIssues
    .map(
      (issue, idx) =>
        `  [NEW-${idx}] severity=${issue.severity} | title="${issue.title}" | description="${issue.description}" | source=${issue.source}`,
    )
    .join('\n');

  const existingIssuesList =
    existingIssues.length > 0
      ? existingIssues
          .map(
            (issue) =>
              `  [EXISTING-${issue.id}] status=${issue.status} | severity=${issue.severity} | title="${issue.title}" | description="${issue.description}"`,
          )
          .join('\n')
      : '  (none)';

  return `You are a deduplication engine for a UI bug detection system. Your job is to determine which newly detected issues are genuinely unique and which are duplicates.

An issue is a DUPLICATE if it describes the same underlying problem as another issue, even if the wording is different. Two issues are the same problem if they refer to the same component/element, the same type of failure, and the same user impact. Minor differences in wording, timestamp, or severity do NOT make them different issues.

## Newly Detected Issues (from this analysis run)
${newIssuesList}

## Existing Issues Already in the Database
${existingIssuesList}

## Rules
1. If a new issue matches ANOTHER new issue in this batch, keep whichever has the more detailed description and drop the other. Reference the kept issue's index.
2. If a new issue matches an existing issue with status "false_alarm", DROP it — it was already reviewed and dismissed. Reference the existing issue ID.
3. If a new issue matches an existing issue with status "fixing", "pr_open", "queued", or "merged", DROP it — it is already being addressed. Reference the existing issue ID.
4. If a new issue matches an existing issue with status "detected" or "screening", DROP it — it is already known. Reference the existing issue ID.
5. If a new issue is genuinely novel (no match among new or existing issues), KEEP it.

## Response Format
Respond ONLY with a JSON object, no other text:
{
  "decisions": [
    {
      "newIndex": <0-based index of the new issue>,
      "action": "keep" | "drop",
      "reason": "Brief explanation of why this is kept or dropped",
      "matchedExistingId": "<ID of matched existing issue, if applicable, omit if N/A>",
      "matchedExistingStatus": "<status of matched existing issue, if applicable, omit if N/A>",
      "matchedNewIndex": <index of the other new issue this duplicates, if applicable, omit if N/A>
    }
  ]
}

You MUST include exactly one decision for every new issue (indices 0 through ${newIssues.length - 1}).`;
}

function parseDedupResponse(
  content: string,
  newIssues: Array<DetectedIssue & { source: string }>,
): DedupDecision[] {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('[dedup] could not find JSON in LLM response, keeping all issues');
    return newIssues.map((_, idx) => ({
      newIndex: idx,
      action: 'keep' as const,
      reason: 'Dedup parse failed — kept by default',
    }));
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(parsed.decisions)) {
      console.warn('[dedup] response missing decisions array, keeping all issues');
      return newIssues.map((_, idx) => ({
        newIndex: idx,
        action: 'keep' as const,
        reason: 'Dedup parse failed — kept by default',
      }));
    }

    const decisions: DedupDecision[] = [];
    const seenIndices = new Set<number>();

    for (const item of parsed.decisions) {
      const idx = Number(item.newIndex);
      if (idx >= 0 && idx < newIssues.length && !seenIndices.has(idx)) {
        seenIndices.add(idx);
        decisions.push({
          newIndex: idx,
          action: item.action === 'drop' ? 'drop' : 'keep',
          reason: String(item.reason || ''),
          matchedExistingId: item.matchedExistingId ? String(item.matchedExistingId) : undefined,
          matchedExistingStatus: item.matchedExistingStatus ? String(item.matchedExistingStatus) : undefined,
          matchedNewIndex: item.matchedNewIndex != null ? Number(item.matchedNewIndex) : undefined,
        });
      }
    }

    // Any issues not mentioned get kept by default
    for (let i = 0; i < newIssues.length; i++) {
      if (!seenIndices.has(i)) {
        decisions.push({
          newIndex: i,
          action: 'keep',
          reason: 'Not mentioned in dedup response — kept by default',
        });
      }
    }

    return decisions;
  } catch (err) {
    console.warn('[dedup] failed to parse dedup JSON:', err);
    return newIssues.map((_, idx) => ({
      newIndex: idx,
      action: 'keep' as const,
      reason: 'Dedup parse error — kept by default',
    }));
  }
}

function sortIssues(
  issues: Array<DetectedIssue & { source: string }>,
): Array<DetectedIssue & { source: string }> {
  return issues.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'red' ? -1 : 1;
    }
    return a.timestampSec - b.timestampSec;
  });
}

export async function mergeAnalysisResults(
  videoIssues: Array<DetectedIssue & { source: string }>,
  dataIssues: Array<DetectedIssue & { source: string }>,
  existingIssues: ExistingIssue[] = [],
): Promise<MergeResult> {
  const startMs = Date.now();
  const allNewIssues = [...videoIssues, ...dataIssues];

  // If there are no new issues, return early
  if (allNewIssues.length === 0) {
    return {
      unique: [],
      dropped: [],
      model: DEDUP_MODEL,
      durationMs: Date.now() - startMs,
    };
  }

  // If there's only one new issue and no existing issues, skip the LLM call
  if (allNewIssues.length === 1 && existingIssues.length === 0) {
    return {
      unique: sortIssues(allNewIssues),
      dropped: [],
      model: DEDUP_MODEL,
      durationMs: Date.now() - startMs,
    };
  }

  try {
    const prompt = buildDedupPrompt(allNewIssues, existingIssues);

    const { content } = await analyzeText(DEDUP_MODEL, prompt, {
      temperature: 0.1,
      maxTokens: 4096,
      timeoutMs: 60_000,
    });

    const decisions = parseDedupResponse(content, allNewIssues);

    const unique: Array<DetectedIssue & { source: string }> = [];
    const dropped: MergeResult['dropped'] = [];

    for (const decision of decisions) {
      const issue = allNewIssues[decision.newIndex];
      if (decision.action === 'keep') {
        unique.push(issue);
      } else {
        dropped.push({
          issue,
          reason: decision.reason,
          matchedExistingId: decision.matchedExistingId,
          matchedExistingStatus: decision.matchedExistingStatus,
        });
      }
    }

    console.log(
      `[dedup] LLM dedup: ${unique.length} unique, ${dropped.length} dropped` +
        (dropped.length > 0
          ? ` (${dropped.map((d) => `"${d.issue.title}" -> ${d.reason}`).join('; ')})`
          : ''),
    );

    return {
      unique: sortIssues(unique),
      dropped,
      model: DEDUP_MODEL,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    // Fail open: if the LLM call fails, treat all issues as unique
    console.error('[dedup] LLM dedup failed, keeping all issues:', err);
    return {
      unique: sortIssues(allNewIssues),
      dropped: [],
      model: DEDUP_MODEL,
      durationMs: Date.now() - startMs,
    };
  }
}
