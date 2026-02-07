import { Router } from 'express';
import { listPostHogSessions } from '../services/posthog';

export const posthogRouter = Router();

posthogRouter.get('/api/posthog/sessions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;

    const result = await listPostHogSessions({ limit, offset, dateFrom, dateTo });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('PostHog sessions error:', message);
    res.status(500).json({ error: message });
  }
});
