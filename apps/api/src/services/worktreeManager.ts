import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class WorktreeManager {
  constructor(
    private repoClonePath: string,
    private worktreeBasePath: string,
  ) {}

  async createWorktree(issueId: string): Promise<{ worktreePath: string; branchName: string }> {
    await mkdir(this.worktreeBasePath, { recursive: true });

    // Fetch latest main
    try {
      await this.git('fetch', 'origin', 'main');
    } catch (err) {
      console.warn('[worktree] failed to fetch origin main, continuing with local:', err);
    }

    const shortId = issueId.slice(-8);
    const branchName = `truffles/fix-${shortId}`;
    const worktreePath = `${this.worktreeBasePath}/wt-${shortId}-${Date.now()}`;

    await this.git('worktree', 'add', '-b', branchName, worktreePath, 'origin/main');

    console.log(`[worktree] created: ${worktreePath} on branch ${branchName}`);
    return { worktreePath, branchName };
  }

  async removeWorktree(worktreePath: string): Promise<void> {
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
  }

  async cleanupAll(): Promise<void> {
    try {
      await this.git('worktree', 'prune');
    } catch {
      // non-critical
    }

    try {
      // Remove all wt-* directories
      const { readdir } = await import('node:fs/promises');
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
