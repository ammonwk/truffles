import { Router, type Request, type Response } from 'express';
import { Issue, Session, SuppressionRule } from '@truffles/db';
import { requireAdmin } from '../middleware/auth.js';
import type { AgentManager } from '../services/agentManager.js';
import type { Severity } from '@truffles/shared';

export function createIssuesRouter(agentManager: AgentManager): Router {
  const issuesRouter = Router();

// GET /api/issues — list with filters
issuesRouter.get('/api/issues', async (req: Request, res: Response) => {
  try {
    const {
      severity,
      status,
      sessionId,
      limit = '50',
      offset = '0',
    } = req.query;

    const filter: Record<string, unknown> = {};
    if (severity && severity !== 'all') filter.severity = severity;
    if (status && status !== 'all') filter.status = status;
    if (sessionId) filter.sessionId = sessionId;

    const limitNum = Math.min(Number(limit) || 50, 200);
    const offsetNum = Number(offset) || 0;

    const [issues, total] = await Promise.all([
      Issue.find(filter)
        .sort({ severity: 1, foundAt: -1 })
        .skip(offsetNum)
        .limit(limitNum)
        .lean(),
      Issue.countDocuments(filter),
    ]);

    res.json({
      issues: issues.map((issue) => ({
        _id: issue._id.toString(),
        sessionId: issue.sessionId?.toString() ?? '',
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        timestampSec: issue.timestampSec,
        status: issue.status,
        foundAt: issue.foundAt instanceof Date ? issue.foundAt.toISOString() : issue.foundAt,
        prNumber: issue.prNumber ?? undefined,
        prUrl: issue.prUrl ?? undefined,
      })),
      total,
    });
  } catch (err) {
    console.error('[issues] list error:', err);
    res.status(500).json({ error: 'Failed to list issues' });
  }
});

// GET /api/issues/:id — detail with full reasoning
issuesRouter.get('/api/issues/:id', async (req: Request, res: Response) => {
  try {
    const doc = await Issue.findById(req.params.id).lean();
    if (!doc) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    // Look up session email
    let sessionEmail: string | undefined;
    if (doc.sessionId) {
      const session = await Session.findById(doc.sessionId).lean();
      sessionEmail = session?.userEmail ?? undefined;
    }

    res.json({
      _id: doc._id.toString(),
      sessionId: doc.sessionId?.toString() ?? '',
      posthogSessionId: doc.posthogSessionId,
      severity: doc.severity,
      title: doc.title,
      description: doc.description,
      timestampSec: doc.timestampSec,
      status: doc.status,
      foundAt: doc.foundAt instanceof Date ? doc.foundAt.toISOString() : doc.foundAt,
      llmReasoning: doc.llmReasoning ?? '',
      screeningReasoning: doc.screeningReasoning ?? '',
      falseAlarmReason: doc.falseAlarmReason ?? undefined,
      prNumber: doc.prNumber ?? undefined,
      prUrl: doc.prUrl ?? undefined,
      detectedBy: doc.detectedBy ?? '',
      screenedBy: doc.screenedBy ?? undefined,
      videoFrameUrls: doc.videoFrameUrls ?? [],
      agentSessionId: doc.agentSessionId?.toString() ?? undefined,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
      sessionEmail,
    });
  } catch (err) {
    console.error('[issues] detail error:', err);
    res.status(500).json({ error: 'Failed to fetch issue' });
  }
});

// PUT /api/issues/:id/status — admin auth, update status
issuesRouter.put('/api/issues/:id/status', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    const validStatuses = ['detected', 'screening', 'queued', 'fixing', 'pr_open', 'merged', 'false_alarm'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    const doc = await Issue.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true },
    ).lean();

    if (!doc) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    res.json({ _id: doc._id.toString(), status: doc.status });
  } catch (err) {
    console.error('[issues] update status error:', err);
    res.status(500).json({ error: 'Failed to update issue status' });
  }
});

// POST /api/issues/:id/false-alarm — admin auth, mark false alarm + auto-create suppression rule
issuesRouter.post('/api/issues/:id/false-alarm', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    const doc = await Issue.findByIdAndUpdate(
      req.params.id,
      {
        status: 'false_alarm',
        falseAlarmReason: reason || 'Manually marked as false alarm',
      },
      { new: true },
    ).lean();

    if (!doc) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    // Auto-create suppression rule
    const rule = await SuppressionRule.create({
      pattern: `${doc.title}: ${reason || doc.description}`,
      source: 'manual',
      reason: reason || 'Manually marked as false alarm',
      issueId: doc._id,
    });

    res.json({
      issue: { _id: doc._id.toString(), status: doc.status },
      suppressionRule: { _id: rule._id.toString(), pattern: rule.pattern },
    });
  } catch (err) {
    console.error('[issues] false alarm error:', err);
    res.status(500).json({ error: 'Failed to mark as false alarm' });
  }
});

// POST /api/issues/:id/retry — admin auth, retry agent for this issue
issuesRouter.post('/api/issues/:id/retry', requireAdmin, async (req: Request, res: Response) => {
  try {
    const doc = await Issue.findById(req.params.id).lean();
    if (!doc) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    // Gather session context (console errors, network failures) if available
    let sessionContext: { consoleErrors?: string[]; networkFailures?: string[]; userEmail?: string } | undefined;
    if (doc.sessionId) {
      const session = await Session.findById(doc.sessionId).lean();
      if (session) {
        sessionContext = {
          consoleErrors: (session as Record<string, unknown>).consoleErrors as string[] | undefined,
          networkFailures: (session as Record<string, unknown>).networkFailures as string[] | undefined,
          userEmail: session.userEmail ?? undefined,
        };
      }
    }

    const result = await agentManager.startAgent({
      issueId: doc._id.toString(),
      issueTitle: doc.title,
      issueDescription: doc.description,
      severity: doc.severity as Severity,
      sessionContext,
    });

    // Update issue status to queued (agentSessionId will be set by agentManager on completion)
    await Issue.findByIdAndUpdate(req.params.id, { status: 'queued' });

    res.json(result);
  } catch (err) {
    console.error('[issues] retry error:', err);
    res.status(500).json({ error: String(err) });
  }
});

  return issuesRouter;
}
