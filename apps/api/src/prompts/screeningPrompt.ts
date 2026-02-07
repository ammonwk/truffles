import type { DetectedIssue } from '@truffles/shared';

export function buildScreeningPrompt(
  issues: DetectedIssue[],
  suppressionPatterns: string[],
): string {
  return `You are a senior QA engineer screening detected UI issues to separate real problems from noise.

## Detected Issues
${issues.map((issue, i) => `
### Issue ${i + 1}
- Severity: ${issue.severity}
- Title: ${issue.title}
- Description: ${issue.description}
- Reasoning: ${issue.reasoning}
`).join('\n')}

## Known Suppression Patterns (false alarms to filter out)
${suppressionPatterns.length > 0 ? suppressionPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n') : 'None — this is the first screening pass.'}

For each issue, decide:
- "keep" = This is a real issue worth fixing. It affects users in production.
- "drop" = This is noise, a false positive, matches a suppression pattern, or is too minor to warrant an automated fix.

Respond with a JSON object with two arrays:

{
  "kept": [
    {
      "issueIndex": <0-based index from the issues list>,
      "screeningReasoning": "Why this should be kept and fixed"
    }
  ],
  "dropped": [
    {
      "issueIndex": <0-based index from the issues list>,
      "screeningReasoning": "Why this is being filtered out",
      "dropReason": "Brief reason (e.g., 'matches suppression pattern', 'dev-only artifact', 'cosmetic only')"
    }
  ]
}

Respond ONLY with the JSON object, no other text.`;
}
