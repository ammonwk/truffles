import { query } from '@anthropic-ai/claude-agent-sdk';

export interface AgentRunResult {
  success: boolean;
  falseAlarm: boolean;
  falseAlarmReason?: string;
  prUrl?: string;
  prNumber?: number;
  costUsd?: number;
  filesModified: string[];
  error?: string;
}

type OnEvent = (event: {
  type: 'output' | 'phase' | 'tool' | 'files_modified';
  phase?: string;
  content?: string;
  tool?: string;
  files?: string[];
}) => void;

export async function runAgent(opts: {
  worktreePath: string;
  branchName: string;
  repoClonePath: string;
  issueTitle: string;
  issueDescription: string;
  severity: string;
  sessionContext?: { consoleErrors?: string[]; networkFailures?: string[]; userEmail?: string };
  githubRepo: string;
  abortController: AbortController;
  onEvent: OnEvent;
}): Promise<AgentRunResult> {
  const prompt = buildPrompt(opts);
  const filesModified = new Set<string>();
  let falseAlarm = false;
  let falseAlarmReason: string | undefined;
  let prUrl: string | undefined;
  let prNumber: number | undefined;
  let costUsd: number | undefined;
  let currentPhase = 'starting';

  // Try with sandbox first, fall back to no sandbox if it fails
  let sandboxConfig: { enabled: boolean } | undefined = { enabled: true };

  const runWithConfig = async (sandbox: { enabled: boolean } | undefined): Promise<void> => {
    const sdkQuery = query({
      prompt,
      options: {
        cwd: opts.worktreePath,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 30,
        model: 'sonnet',
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `You are an automated bug-fixing agent for ${opts.githubRepo}. Follow the task instructions exactly. Be concise.`,
        },
        sandbox,
        additionalDirectories: [opts.repoClonePath + '/.git'],
        abortController: opts.abortController,
        env: {
          GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
          GIT_AUTHOR_NAME: 'Truffles Bot',
          GIT_AUTHOR_EMAIL: 'truffles@autofix.bot',
          GIT_COMMITTER_NAME: 'Truffles Bot',
          GIT_COMMITTER_EMAIL: 'truffles@autofix.bot',
        },
      },
    });

    for await (const message of sdkQuery) {
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if ('text' in block && typeof block.text === 'string') {
            const text = block.text;
            opts.onEvent({ type: 'output', phase: currentPhase, content: text });

            // Detect phase markers from agent output
            const phaseMatch = text.match(/TRUFFLES_PHASE:(\w+)/);
            if (phaseMatch && ['verifying', 'planning', 'coding', 'reviewing'].includes(phaseMatch[1])) {
              currentPhase = phaseMatch[1];
              opts.onEvent({ type: 'phase', phase: currentPhase });
            }

            // Detect false alarm
            if (text.includes('TRUFFLES_FALSE_ALARM:')) {
              falseAlarm = true;
              falseAlarmReason = text.split('TRUFFLES_FALSE_ALARM:')[1]?.trim();
            }

            // Detect PR URL in output
            const prMatch = text.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
            if (prMatch) {
              prUrl = prMatch[0];
              prNumber = parseInt(prMatch[1], 10);
            }
          }

          // Track tool usage for file modification tracking
          if ('name' in block && typeof block.name === 'string' && block.input) {
            const toolName = block.name;
            const input = block.input as Record<string, unknown>;
            if ((toolName === 'Edit' || toolName === 'Write') && typeof input.file_path === 'string') {
              filesModified.add(input.file_path);
              opts.onEvent({ type: 'files_modified', files: [...filesModified] });
            }
            opts.onEvent({ type: 'tool', tool: toolName, content: `Using ${toolName}...` });
          }
        }
      }

      if (message.type === 'result') {
        costUsd = message.total_cost_usd;
      }
    }
  };

  try {
    try {
      await runWithConfig(sandboxConfig);
    } catch (sandboxErr) {
      // If sandbox fails (missing bwrap, permission errors), retry without it
      const errMsg = String(sandboxErr);
      if (errMsg.includes('bwrap') || errMsg.includes('sandbox') || errMsg.includes('bubblewrap')) {
        console.warn('[agent] sandbox failed, retrying without sandbox:', errMsg);
        sandboxConfig = undefined;
        await runWithConfig(sandboxConfig);
      } else {
        throw sandboxErr;
      }
    }
  } catch (err: unknown) {
    if (opts.abortController.signal.aborted) {
      return { success: false, falseAlarm: false, filesModified: [...filesModified], error: 'Agent was stopped' };
    }
    return { success: false, falseAlarm: false, filesModified: [...filesModified], error: String(err) };
  }

  return {
    success: !falseAlarm,
    falseAlarm,
    falseAlarmReason,
    prUrl,
    prNumber,
    costUsd,
    filesModified: [...filesModified],
  };
}

function buildPrompt(opts: {
  issueTitle: string;
  issueDescription: string;
  severity: string;
  sessionContext?: { consoleErrors?: string[]; networkFailures?: string[]; userEmail?: string };
  githubRepo: string;
  branchName: string;
}): string {
  return `
You are fixing a UI issue in the ${opts.githubRepo} codebase.

## Issue
- **Title:** ${opts.issueTitle}
- **Severity:** ${opts.severity}
- **Description:** ${opts.issueDescription}

## Session Context
${opts.sessionContext?.consoleErrors?.length
    ? `Console errors: ${opts.sessionContext.consoleErrors.join('; ')}`
    : 'No console errors.'}
${opts.sessionContext?.networkFailures?.length
    ? `Network failures: ${opts.sessionContext.networkFailures.join('; ')}`
    : 'No network failures.'}

## Instructions
1. Output TRUFFLES_PHASE:verifying — then search the codebase for code related to this issue.
2. If you CANNOT find related code, output TRUFFLES_FALSE_ALARM: <your reasoning> and stop. Do NOT guess.
3. Output TRUFFLES_PHASE:planning — describe your fix approach briefly.
4. Output TRUFFLES_PHASE:coding — make the minimal code changes needed.
5. Run any available lint/typecheck commands. Fix issues if found.
6. Output TRUFFLES_PHASE:reviewing — review your own changes for correctness.
7. Commit changes, push the branch, and create a PR:
   - Set remote URL: git remote set-url origin https://x-access-token:\${GITHUB_TOKEN}@github.com/${opts.githubRepo}.git
   - git add the changed files
   - git commit -m "[Truffles] Fix: ${opts.issueTitle}"
   - git push -u origin ${opts.branchName}
   - gh pr create --title "[Truffles] Fix: ${opts.issueTitle}" --body "Automated fix by Truffles. Issue: ${opts.issueDescription}" --label truffles-autofix

CRITICAL: If you cannot find code related to this issue, report TRUFFLES_FALSE_ALARM. Do NOT make speculative changes.
`.trim();
}
