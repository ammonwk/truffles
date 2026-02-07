import { Router } from 'express';
import type { AgentManager } from '../services/agentManager';
import { requireAdmin } from '../middleware/auth';
import type { AgentStartRequest } from '@truffles/shared';

export function createAgentRouter(manager: AgentManager): Router {
  const router = Router();

  // Start a new agent — mutating, requires admin
  router.post('/start', requireAdmin, async (req, res) => {
    try {
      const body = req.body as AgentStartRequest;

      if (!body.issueId || !body.issueTitle || !body.issueDescription || !body.severity) {
        res.status(400).json({ error: 'Missing required fields: issueId, issueTitle, issueDescription, severity' });
        return;
      }

      const result = await manager.startAgent(body);
      res.json(result);
    } catch (err) {
      console.error('[agents] start error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // List active agents and queue — read-only, no auth
  router.get('/', async (_req, res) => {
    try {
      const status = await manager.getStatus();
      res.json(status);
    } catch (err) {
      console.error('[agents] list error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // Get specific agent session — read-only, no auth
  router.get('/:id', async (req, res) => {
    try {
      const id = req.params.id as string;
      const session = await manager.getSession(id);
      if (!session) {
        res.status(404).json({ error: 'Agent session not found' });
        return;
      }
      res.json(session);
    } catch (err) {
      console.error('[agents] get error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // Stop an agent — mutating, requires admin
  router.post('/:id/stop', requireAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;
      const stopped = await manager.stopAgent(id);
      if (!stopped) {
        res.status(404).json({ error: 'Agent not found or not active' });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[agents] stop error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
