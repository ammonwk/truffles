export function buildSessionDataAnalysisPrompt(data: {
  consoleErrors: string[];
  networkFailures: string[];
  metadata: Record<string, unknown>;
}): string {
  return `You are an expert frontend developer analyzing session metadata from a web application.

Review the following data from a user session and identify any issues that indicate bugs, errors, or degraded experience.

## Console Errors
${data.consoleErrors.length > 0 ? data.consoleErrors.map((e, i) => `${i + 1}. ${e}`).join('\n') : 'None recorded'}

## Network Failures
${data.networkFailures.length > 0 ? data.networkFailures.map((f, i) => `${i + 1}. ${f}`).join('\n') : 'None recorded'}

## Session Metadata
${JSON.stringify(data.metadata, null, 2)}

For each issue found, determine severity:
- "red" = indicates a real bug that affects user experience (unhandled errors, failed API calls that break flows)
- "yellow" = warning-level issue (deprecation warnings, slow responses, minor console noise)

IMPORTANT: Write highly specific, detailed descriptions. Each description MUST include:
1. The specific error message, status code, or failure details (e.g., "TypeError: Cannot read property 'email' of undefined", "POST /api/contacts returned 500")
2. The likely component, page, or feature affected (e.g., "the contact creation form on /contacts/new", "the authentication flow")
3. The probable user-facing impact (e.g., "the form submission silently fails and the user sees no feedback", "the dashboard shows a blank white screen")
4. Any relevant context from the error stack, URL path, or request/response details

Be precise enough that another person could identify the exact same problem from your description alone. Avoid vague descriptions like "an error occurred" or "API call failed".

Respond with a JSON array. Each element must have exactly these fields:
{
  "severity": "red" | "yellow",
  "title": "Short descriptive title (max 80 chars)",
  "description": "Detailed, specific description including error details, affected component/page, user impact, and relevant context from the error data",
  "timestampSec": 0,
  "reasoning": "Why this matters for the user experience"
}

If no meaningful issues are found, respond with an empty array: []

Respond ONLY with the JSON array, no other text.`;
}
