import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class WorktreeManager {
  constructor(
    private repoClonePath: string,
    private worktreeBasePath: string,
    private defaultBranch: string = process.env.REPO_DEFAULT_BRANCH || 'staging',
  ) {}

  async createWorktree(issueId: string): Promise<{ worktreePath: string; branchName: string }> {
    await mkdir(this.worktreeBasePath, { recursive: true });

    // Fetch latest default branch
    try {
      await this.git('fetch', 'origin', this.defaultBranch);
    } catch (err) {
      console.warn(`[worktree] failed to fetch origin ${this.defaultBranch}, continuing with local:`, err);
    }

    const shortId = issueId.slice(-8);
    const branchName = `truffles/fix-${shortId}`;
    const worktreePath = `${this.worktreeBasePath}/wt-${shortId}-${Date.now()}`;

    // Clean up stale worktree/branch from a previous run of this issue
    await this.cleanupBranch(branchName);

    await this.git('worktree', 'add', '-b', branchName, worktreePath, `origin/${this.defaultBranch}`);

    console.log(`[worktree] created: ${worktreePath} on branch ${branchName}`);
    return { worktreePath, branchName };
  }

  async removeWorktree(worktreePath: string, branchName?: string): Promise<void> {
    try {
      await this.git('worktree', 'remove', '--force', worktreePath);
    } catch (err) {
      console.warn('[worktree] git worktree remove failed, cleaning up manually:', err);
    }

    try {
      await rm(worktreePath, { recursive: true, force: true });
    } catch {
      // already gone
    }

    try {
      await this.git('worktree', 'prune');
    } catch {
      // non-critical
    }

    // Delete the branch so retries can recreate it cleanly
    if (branchName) {
      try {
        await this.git('branch', '-D', branchName);
      } catch {
        // branch may already be gone
      }
    }
  }

  /** Remove any existing worktree and local branch for a given branch name. */
  private async cleanupBranch(branchName: string): Promise<void> {
    // Find if this branch is checked out in an existing worktree
    try {
      const listOutput = await this.git('worktree', 'list', '--porcelain');
      let currentWorktree = '';
      for (const line of listOutput.split('\n')) {
        if (line.startsWith('worktree ')) {
          currentWorktree = line.slice('worktree '.length);
        }
        if (line.startsWith('branch ') && line.endsWith(`/${branchName}`)) {
          // This worktree has our branch checked out — remove it
          if (currentWorktree && currentWorktree !== this.repoClonePath) {
            console.log(`[worktree] removing stale worktree for branch ${branchName}: ${currentWorktree}`);
            try {
              await this.git('worktree', 'remove', '--force', currentWorktree);
            } catch {
              await rm(currentWorktree, { recursive: true, force: true }).catch(() => {});
            }
          }
          break;
        }
      }
    } catch {
      // worktree list can fail if no worktrees exist yet
    }

    try {
      await this.git('worktree', 'prune');
    } catch {
      // non-critical
    }

    // Delete the local branch
    try {
      await this.git('branch', '-D', branchName);
      console.log(`[worktree] deleted stale branch ${branchName}`);
    } catch {
      // branch doesn't exist — that's fine
    }
  }

  async cleanupOrphaned(maxAgeMs = 2 * 60 * 60 * 1000): Promise<number> {
    let removed = 0;
    try {
      const entries = await readdir(this.worktreeBasePath);
      const now = Date.now();

      for (const entry of entries) {
        if (!entry.startsWith('wt-')) continue;
        const fullPath = `${this.worktreeBasePath}/${entry}`;
        try {
          const info = await stat(fullPath);
          if (now - info.mtimeMs > maxAgeMs) {
            await this.removeWorktree(fullPath);
            removed++;
            console.log(`[worktree] cleaned up orphaned: ${entry}`);
          }
        } catch {
          // entry may have been removed concurrently
        }
      }

      await this.git('worktree', 'prune').catch(() => {});
    } catch {
      // base path may not exist yet
    }
    return removed;
  }

  async cleanupAll(): Promise<void> {
    try {
      await this.git('worktree', 'prune');
    } catch {
      // non-critical
    }

    try {
      // Remove all wt-* directories
      const entries = await readdir(this.worktreeBasePath);
      for (const entry of entries) {
        if (entry.startsWith('wt-')) {
          await rm(`${this.worktreeBasePath}/${entry}`, { recursive: true, force: true });
        }
      }
    } catch {
      // base path may not exist yet
    }
  }

  private async git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', this.repoClonePath, ...args], {
      timeout: 30_000,
    });
    return stdout.trim();
  }
}
