import { Router, type Request, type Response } from 'express';
import { Settings, Session, Issue, AgentSession, SuppressionRule } from '@truffles/db';
import { requireAdmin } from '../middleware/auth.js';
import type { AgentManager } from '../services/agentManager.js';

export function createSettingsRouter(agentManager: AgentManager): Router {
const settingsRouter = Router();

// GET /api/settings — read-only, no auth
settingsRouter.get('/api/settings', async (_req: Request, res: Response) => {
  try {
    const doc = await Settings.getOrCreate();

    res.json({
      _id: doc._id.toString(),
      maxConcurrentAgents: doc.maxConcurrentAgents,
      agentTimeoutMinutes: doc.agentTimeoutMinutes,
      pollingIntervalSec: doc.pollingIntervalSec,
      videoModelPrimary: doc.videoModelPrimary,
      videoModelSecondary: doc.videoModelSecondary,
      screeningModel: doc.screeningModel,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    });
  } catch (err) {
    console.error('[settings] get error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/settings — admin auth, partial update
settingsRouter.put('/api/settings', requireAdmin, async (req: Request, res: Response) => {
  try {
    const allowedFields = [
      'maxConcurrentAgents',
      'agentTimeoutMinutes',
      'pollingIntervalSec',
      'videoModelPrimary',
      'videoModelSecondary',
      'screeningModel',
    ];

    const update: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        update[field] = req.body[field];
      }
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    const doc = await Settings.getOrCreate();
    Object.assign(doc, update);
    await doc.save();

    // Push runtime updates to the running AgentManager
    if (update.maxConcurrentAgents !== undefined) {
      agentManager.setMaxConcurrent(Number(update.maxConcurrentAgents));
    }
    if (update.agentTimeoutMinutes !== undefined) {
      agentManager.setTimeoutMinutes(Number(update.agentTimeoutMinutes));
    }

    res.json({
      _id: doc._id.toString(),
      maxConcurrentAgents: doc.maxConcurrentAgents,
      agentTimeoutMinutes: doc.agentTimeoutMinutes,
      pollingIntervalSec: doc.pollingIntervalSec,
      videoModelPrimary: doc.videoModelPrimary,
      videoModelSecondary: doc.videoModelSecondary,
      screeningModel: doc.screeningModel,
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    });
  } catch (err) {
    console.error('[settings] update error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// POST /api/settings/clear-all — admin auth, delete all data
settingsRouter.post('/api/settings/clear-all', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [sessions, issues, agents, suppressions] = await Promise.all([
      Session.deleteMany({}),
      Issue.deleteMany({}),
      AgentSession.deleteMany({}),
      SuppressionRule.deleteMany({}),
    ]);

    // Reset settings to defaults
    await Settings.deleteMany({});

    console.log(
      `[settings] clear-all: ${sessions.deletedCount} sessions, ${issues.deletedCount} issues, ${agents.deletedCount} agents, ${suppressions.deletedCount} suppression rules`,
    );

    res.json({
      deleted: {
        sessions: sessions.deletedCount,
        issues: issues.deletedCount,
        agents: agents.deletedCount,
        suppressions: suppressions.deletedCount,
      },
    });
  } catch (err) {
    console.error('[settings] clear-all error:', err);
    res.status(500).json({ error: 'Failed to clear data' });
  }
});

// POST /api/settings/validate-password — returns { valid: boolean }
settingsRouter.post('/api/settings/validate-password', (req: Request, res: Response) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(500).json({ error: 'ADMIN_PASSWORD not configured' });
    return;
  }

  const { password } = req.body;
  res.json({ valid: password === adminPassword });
});

return settingsRouter;
}
