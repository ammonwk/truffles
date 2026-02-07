import { AgentSession, Issue } from '@truffles/db';
import type { AgentPhase, OutputCategory } from '@truffles/shared';
import type {
  AgentStartRequest,
  AgentStartResponse,
  AgentStreamEvent,
  AgentListResponse,
  AgentSessionDoc,
} from '@truffles/shared';
import { WorktreeManager } from './worktreeManager.js';
import { runAgent } from './claudeAgent.js';

interface ActiveAgent {
  abortController: AbortController;
  worktreePath: string;
  timeout: NodeJS.Timeout;
}

interface QueuedItem {
  sessionId: string;
  request: AgentStartRequest;
}

export class AgentManager {
  private queue: QueuedItem[] = [];
  private active = new Map<string, ActiveAgent>();
  private maxConcurrent: number;
  private timeoutMinutes: number;
  private broadcast: (event: AgentStreamEvent) => void;
  private worktreeManager: WorktreeManager;
  private repoClonePath: string;
  private githubRepo: string;

  // Output batching: collect log entries in memory, flush every 2s
  private pendingLogs = new Map<string, Array<{ timestamp: Date; phase: string; content: string; category?: OutputCategory }>>();
  private flushInterval: NodeJS.Timeout;

  // Delta coalescing: accumulate text_delta fragments per agent, flush every 50ms
  private deltaBuffers = new Map<string, { text: string; timer: NodeJS.Timeout | null }>();

  constructor(config: {
    maxConcurrent: number;
    timeoutMinutes: number;
    broadcast: (event: AgentStreamEvent) => void;
    repoClonePath: string;
    worktreeBasePath: string;
    githubRepo: string;
  }) {
    this.maxConcurrent = config.maxConcurrent;
    this.timeoutMinutes = config.timeoutMinutes;
    this.broadcast = config.broadcast;
    this.repoClonePath = config.repoClonePath;
    this.githubRepo = config.githubRepo;
    this.worktreeManager = new WorktreeManager(config.repoClonePath, config.worktreeBasePath);

    // Flush pending output logs every 2 seconds
    this.flushInterval = setInterval(() => this.flushLogs(), 2000);
  }

  async startAgent(request: AgentStartRequest): Promise<AgentStartResponse> {
    if (!this.repoClonePath || !this.worktreeManager) {
      throw new Error('Agent runner not configured — set REPO_CLONE_PATH and WORKTREE_BASE_PATH in .env');
    }

    const session = await AgentSession.create({
      issueId: request.issueId,
      status: 'queued',
    });

    const sessionId = session._id.toString();

    if (this.active.size < this.maxConcurrent) {
      // Launch immediately
      this.launchAgent(sessionId, request).catch((err) => {
        console.error(`[agent-manager] launch failed for ${sessionId}:`, err);
      });
      return { agentSessionId: sessionId, status: 'started' };
    }

    // Queue it
    this.queue.push({ sessionId, request });
    return {
      agentSessionId: sessionId,
      status: 'queued',
      position: this.queue.length,
    };
  }

  private async launchAgent(sessionId: string, request: AgentStartRequest): Promise<void> {
    // Update status to starting
    await AgentSession.findByIdAndUpdate(sessionId, { status: 'starting' });

    let worktreePath = '';
    let branchName = '';

    try {
      const wt = await this.worktreeManager.createWorktree(request.issueId);
      worktreePath = wt.worktreePath;
      branchName = wt.branchName;

      await AgentSession.findByIdAndUpdate(sessionId, { worktreePath, branchName });
    } catch (err) {
      console.error(`[agent-manager] worktree creation failed for ${sessionId}:`, err);
      await AgentSession.findByIdAndUpdate(sessionId, {
        status: 'failed',
        error: `Worktree creation failed: ${err}`,
        completedAt: new Date(),
      });
      this.broadcast({
        type: 'agent:complete',
        agentId: sessionId,
        result: 'failed',
        error: `Worktree creation failed: ${err}`,
      });
      this.processQueue();
      return;
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      console.warn(`[agent-manager] agent ${sessionId} timed out after ${this.timeoutMinutes}m`);
      abortController.abort();
    }, this.timeoutMinutes * 60 * 1000);

    this.active.set(sessionId, { abortController, worktreePath, timeout });

    this.broadcast({
      type: 'agent:started',
      agentId: sessionId,
      issueId: request.issueId,
    });

    try {
      const result = await runAgent({
        worktreePath,
        branchName,
        repoClonePath: this.repoClonePath,
        issueTitle: request.issueTitle,
        issueDescription: request.issueDescription,
        severity: request.severity,
        sessionContext: request.sessionContext,
        githubRepo: this.githubRepo,
        abortController,
        onEvent: (event) => {
          const now = new Date().toISOString();

          // Route text_delta events through coalescing buffer (NOT stored in DB)
          if (event.type === 'text_delta' && event.delta) {
            this.emitDelta(sessionId, event.delta);
            return;
          }

          // Broadcast to WS immediately for real-time streaming
          if (event.type === 'output' || event.type === 'tool') {
            const category = event.category ?? 'assistant';
            this.broadcast({
              type: 'agent:output',
              agentId: sessionId,
              phase: (event.phase ?? 'starting') as AgentPhase,
              content: event.content ?? '',
              timestamp: now,
              category,
            });

            // Batch log entries for DB
            if (!this.pendingLogs.has(sessionId)) {
              this.pendingLogs.set(sessionId, []);
            }
            this.pendingLogs.get(sessionId)!.push({
              timestamp: new Date(),
              phase: event.phase ?? 'starting',
              content: event.content ?? '',
              category,
            });
          }

          if (event.type === 'phase' && event.phase) {
            this.broadcast({
              type: 'agent:phase_change',
              agentId: sessionId,
              phase: event.phase as AgentPhase,
              timestamp: now,
            });

            // Flush logs on phase change for consistency
            this.flushLogsForSession(sessionId);

            // Update DB status
            AgentSession.findByIdAndUpdate(sessionId, { status: event.phase }).catch(() => {});
          }

          if (event.type === 'files_modified' && event.files) {
            AgentSession.findByIdAndUpdate(sessionId, { filesModified: event.files }).catch(() => {});
          }
        },
      });

      // Flush any remaining logs
      await this.flushLogsForSession(sessionId);

      // Determine final status
      let finalStatus: AgentPhase = 'done';
      let resultType: 'done' | 'failed' | 'false_alarm' = 'done';

      if (result.falseAlarm) {
        finalStatus = 'false_alarm';
        resultType = 'false_alarm';
      } else if (!result.success) {
        finalStatus = 'failed';
        resultType = 'failed';
      }

      await AgentSession.findByIdAndUpdate(sessionId, {
        status: finalStatus,
        completedAt: new Date(),
        prNumber: result.prNumber,
        prUrl: result.prUrl,
        falseAlarmReason: result.falseAlarmReason,
        costUsd: result.costUsd,
        filesModified: result.filesModified,
        error: result.error,
      });

      // Update the linked Issue with PR info
      if (result.prUrl && result.prNumber) {
        const agentDoc = await AgentSession.findById(sessionId).lean();
        if (agentDoc?.issueId) {
          await Issue.findByIdAndUpdate(agentDoc.issueId, {
            status: 'pr_open',
            prNumber: result.prNumber,
            prUrl: result.prUrl,
            agentSessionId: sessionId,
          });
        }
      }

      // Update the linked Issue for false alarms
      if (result.falseAlarm) {
        const agentDoc = await AgentSession.findById(sessionId).lean();
        if (agentDoc?.issueId) {
          await Issue.findByIdAndUpdate(agentDoc.issueId, {
            status: 'false_alarm',
            falseAlarmReason: result.falseAlarmReason || 'Agent reported false alarm',
            agentSessionId: sessionId,
          });
        }
      }

      this.broadcast({
        type: 'agent:complete',
        agentId: sessionId,
        result: resultType,
        prUrl: result.prUrl,
        error: result.error,
        falseAlarmReason: result.falseAlarmReason,
      });
    } catch (err) {
      await this.flushLogsForSession(sessionId);

      await AgentSession.findByIdAndUpdate(sessionId, {
        status: 'failed',
        completedAt: new Date(),
        error: String(err),
      });

      this.broadcast({
        type: 'agent:complete',
        agentId: sessionId,
        result: 'failed',
        error: String(err),
      });
    } finally {
      clearTimeout(timeout);
      this.active.delete(sessionId);
      this.pendingLogs.delete(sessionId);
      this.flushDeltaBuffer(sessionId);

      // Cleanup worktree
      this.worktreeManager.removeWorktree(worktreePath).catch((err) => {
        console.warn(`[agent-manager] worktree cleanup failed for ${sessionId}:`, err);
      });

      this.processQueue();
    }
  }

  private processQueue(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.launchAgent(item.sessionId, item.request).catch((err) => {
        console.error(`[agent-manager] queued launch failed for ${item.sessionId}:`, err);
      });
    }
  }

  async stopAgent(sessionId: string): Promise<boolean> {
    const entry = this.active.get(sessionId);
    if (!entry) {
      return false;
    }

    entry.abortController.abort();
    clearTimeout(entry.timeout);

    // Cleanup worktree
    await this.worktreeManager.removeWorktree(entry.worktreePath).catch(() => {});

    await AgentSession.findByIdAndUpdate(sessionId, {
      status: 'failed',
      completedAt: new Date(),
      error: 'Manually stopped',
    });

    this.active.delete(sessionId);
    this.pendingLogs.delete(sessionId);
    this.flushDeltaBuffer(sessionId);

    this.broadcast({
      type: 'agent:stopped',
      agentId: sessionId,
      reason: 'Manually stopped by admin',
    });

    this.processQueue();
    return true;
  }

  setMaxConcurrent(value: number): void {
    this.maxConcurrent = value;
    console.log(`[agent-manager] maxConcurrent updated to ${value}`);
    // Drain the queue in case the new limit allows more agents to start
    this.processQueue();
  }

  setTimeoutMinutes(value: number): void {
    this.timeoutMinutes = value;
    console.log(`[agent-manager] timeoutMinutes updated to ${value}`);
  }

  async getStatus(): Promise<AgentListResponse> {
    const activeIds = [...this.active.keys()];
    const activeDocs = activeIds.length > 0
      ? await AgentSession.find({ _id: { $in: activeIds } }).lean()
      : [];

    return {
      active: activeDocs.map((doc) => ({
        _id: doc._id.toString(),
        issueId: doc.issueId.toString(),
        status: doc.status as AgentPhase,
        worktreePath: doc.worktreePath ?? '',
        branchName: doc.branchName ?? '',
        startedAt: doc.startedAt?.toISOString() ?? new Date().toISOString(),
        completedAt: doc.completedAt?.toISOString(),
        outputLog: (doc.outputLog ?? []).map((e) => ({
          timestamp: e.timestamp?.toISOString() ?? new Date().toISOString(),
          phase: (e.phase ?? 'starting') as AgentPhase,
          content: e.content ?? '',
          category: (e.category as OutputCategory | undefined) ?? 'assistant',
        })),
        filesModified: doc.filesModified ?? [],
        error: doc.error ?? undefined,
        prNumber: doc.prNumber ?? undefined,
        prUrl: doc.prUrl ?? undefined,
        falseAlarmReason: doc.falseAlarmReason ?? undefined,
        costUsd: doc.costUsd ?? undefined,
      })),
      queued: this.queue.map((q) => q.request.issueId),
      stats: {
        maxConcurrent: this.maxConcurrent,
        activeCount: this.active.size,
        queuedCount: this.queue.length,
      },
    };
  }

  async getSession(id: string): Promise<AgentSessionDoc | null> {
    const doc = await AgentSession.findById(id).lean();
    if (!doc) return null;

    return {
      _id: doc._id.toString(),
      issueId: doc.issueId.toString(),
      status: doc.status as AgentPhase,
      worktreePath: doc.worktreePath ?? '',
      branchName: doc.branchName ?? '',
      startedAt: doc.startedAt?.toISOString() ?? new Date().toISOString(),
      completedAt: doc.completedAt?.toISOString(),
      outputLog: (doc.outputLog ?? []).map((e) => ({
        timestamp: e.timestamp?.toISOString() ?? new Date().toISOString(),
        phase: (e.phase ?? 'starting') as AgentPhase,
        content: e.content ?? '',
        category: (e.category as OutputCategory | undefined) ?? 'assistant',
      })),
      filesModified: doc.filesModified ?? [],
      error: doc.error ?? undefined,
      prNumber: doc.prNumber ?? undefined,
      prUrl: doc.prUrl ?? undefined,
      falseAlarmReason: doc.falseAlarmReason ?? undefined,
      costUsd: doc.costUsd ?? undefined,
    };
  }

  async shutdown(): Promise<void> {
    clearInterval(this.flushInterval);

    // Abort all active agents
    for (const [sessionId, entry] of this.active) {
      entry.abortController.abort();
      clearTimeout(entry.timeout);
      await AgentSession.findByIdAndUpdate(sessionId, {
        status: 'failed',
        completedAt: new Date(),
        error: 'Server shutdown',
      }).catch(() => {});
    }
    this.active.clear();
    this.queue = [];

    // Cleanup all worktrees
    await this.worktreeManager.cleanupAll();
  }

  private emitDelta(sessionId: string, delta: string): void {
    let buf = this.deltaBuffers.get(sessionId);
    if (!buf) {
      buf = { text: '', timer: null };
      this.deltaBuffers.set(sessionId, buf);
    }
    buf.text += delta;

    if (!buf.timer) {
      buf.timer = setTimeout(() => {
        const current = this.deltaBuffers.get(sessionId);
        if (current && current.text) {
          this.broadcast({
            type: 'agent:text_delta',
            agentId: sessionId,
            delta: current.text,
            timestamp: new Date().toISOString(),
          });
          current.text = '';
        }
        if (current) {
          current.timer = null;
        }
      }, 50);
    }
  }

  private flushDeltaBuffer(sessionId: string): void {
    const buf = this.deltaBuffers.get(sessionId);
    if (buf) {
      if (buf.timer) clearTimeout(buf.timer);
      if (buf.text) {
        this.broadcast({
          type: 'agent:text_delta',
          agentId: sessionId,
          delta: buf.text,
          timestamp: new Date().toISOString(),
        });
      }
      this.deltaBuffers.delete(sessionId);
    }
  }

  private async flushLogs(): Promise<void> {
    for (const sessionId of this.pendingLogs.keys()) {
      await this.flushLogsForSession(sessionId);
    }
  }

  private async flushLogsForSession(sessionId: string): Promise<void> {
    const entries = this.pendingLogs.get(sessionId);
    if (!entries || entries.length === 0) return;

    const toFlush = entries.splice(0, entries.length);

    try {
      await AgentSession.findByIdAndUpdate(sessionId, {
        $push: { outputLog: { $each: toFlush } },
      });
    } catch (err) {
      console.warn(`[agent-manager] failed to flush logs for ${sessionId}:`, err);
    }
  }
}
