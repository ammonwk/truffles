import { Router, type Request, type Response } from 'express';
import { SuppressionRule } from '@truffles/db';
import { requireAdmin } from '../middleware/auth.js';

export const suppressionsRouter = Router();

// GET /api/suppressions — list all, no auth
suppressionsRouter.get('/api/suppressions', async (_req: Request, res: Response) => {
  try {
    const rules = await SuppressionRule.find().sort({ createdAt: -1 }).lean();

    res.json({
      rules: rules.map((rule) => ({
        _id: rule._id.toString(),
        pattern: rule.pattern,
        source: rule.source,
        reason: rule.reason ?? undefined,
        issueId: rule.issueId?.toString() ?? undefined,
        createdAt: rule.createdAt instanceof Date ? rule.createdAt.toISOString() : rule.createdAt,
      })),
      total: rules.length,
    });
  } catch (err) {
    console.error('[suppressions] list error:', err);
    res.status(500).json({ error: 'Failed to list suppression rules' });
  }
});

// POST /api/suppressions — admin auth, add manual rule
suppressionsRouter.post('/api/suppressions', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { pattern, source, reason, issueId } = req.body;

    if (!pattern || typeof pattern !== 'string' || !pattern.trim()) {
      res.status(400).json({ error: 'pattern is required' });
      return;
    }

    const rule = await SuppressionRule.create({
      pattern: pattern.trim(),
      source: source || 'manual',
      reason: reason || null,
      issueId: issueId || null,
    });

    res.status(201).json({
      _id: rule._id.toString(),
      pattern: rule.pattern,
      source: rule.source,
      reason: rule.reason ?? undefined,
      issueId: rule.issueId?.toString() ?? undefined,
      createdAt: rule.createdAt instanceof Date ? rule.createdAt.toISOString() : rule.createdAt,
    });
  } catch (err) {
    console.error('[suppressions] create error:', err);
    res.status(500).json({ error: 'Failed to create suppression rule' });
  }
});

// DELETE /api/suppressions/:id — admin auth
suppressionsRouter.delete('/api/suppressions/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await SuppressionRule.findByIdAndDelete(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Suppression rule not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    console.error('[suppressions] delete error:', err);
    res.status(500).json({ error: 'Failed to delete suppression rule' });
  }
});

// POST /api/suppressions/reset — admin auth, delete all
suppressionsRouter.post('/api/suppressions/reset', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await SuppressionRule.deleteMany({});
    res.json({ deleted: result.deletedCount });
  } catch (err) {
    console.error('[suppressions] reset error:', err);
    res.status(500).json({ error: 'Failed to reset suppression rules' });
  }
});
