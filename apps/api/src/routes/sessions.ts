import { Router } from 'express';
import { Session } from '@truffles/db';
import { requireAdmin } from '../middleware/auth.js';
import { getPresignedUrl } from '../services/s3.js';
import type { ProcessingManager } from '../services/processingManager.js';
import type {
  SessionSummary,
  SessionDetail,
  ProcessSessionsRequest,
} from '@truffles/shared';

export function createSessionsRouter(processingManager: ProcessingManager): Router {
  const router = Router();

  router.get('/api/sessions', async (_req, res) => {
    try {
      const docs = await Session.find()
        .sort({ createdAt: -1 })
        .lean();

      const sessions: SessionSummary[] = await Promise.all(
        docs.map(async (doc) => {
          let videoUrl: string | null = null;
          let thumbnailUrl: string | null = null;

          if (doc.videoUrl) {
            try {
              videoUrl = await getPresignedUrl(doc.videoUrl);
            } catch { /* ignore */ }
          }
          if (doc.thumbnailUrl) {
            try {
              thumbnailUrl = await getPresignedUrl(doc.thumbnailUrl);
            } catch { /* ignore */ }
          }

          return {
            id: doc._id.toString(),
            posthogSessionId: doc.posthogSessionId,
            userEmail: doc.userEmail,
            startTime: (doc.startTime as Date).toISOString(),
            durationSec: doc.duration,
            status: doc.status as SessionSummary['status'],
            videoUrl,
            thumbnailUrl,
            issueCount: doc.issueCount,
            createdAt: (doc.createdAt as Date).toISOString(),
          };
        }),
      );

      res.json(sessions);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Sessions list error:', message);
      res.status(500).json({ error: message });
    }
  });

  router.get('/api/sessions/:id', async (req, res) => {
    try {
      const id = req.params.id as string;

      // Try by MongoDB _id first, then by posthogSessionId
      let doc = null;
      if (/^[0-9a-fA-F]{24}$/.test(id)) {
        doc = await Session.findById(id).lean();
      }
      if (!doc) {
        doc = await Session.findOne({ posthogSessionId: id }).lean();
      }

      if (!doc) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      let videoUrl: string | null = null;
      let thumbnailUrl: string | null = null;

      if (doc.videoUrl) {
        try {
          videoUrl = await getPresignedUrl(doc.videoUrl);
        } catch { /* ignore */ }
      }
      if (doc.thumbnailUrl) {
        try {
          thumbnailUrl = await getPresignedUrl(doc.thumbnailUrl);
        } catch { /* ignore */ }
      }

      const detail: SessionDetail = {
        id: doc._id.toString(),
        posthogSessionId: doc.posthogSessionId,
        userEmail: doc.userEmail,
        startTime: (doc.startTime as Date).toISOString(),
        durationSec: doc.duration,
        status: doc.status as SessionDetail['status'],
        videoUrl,
        thumbnailUrl,
        issueCount: doc.issueCount,
        createdAt: (doc.createdAt as Date).toISOString(),
        metadata: (doc.metadata as Record<string, unknown>) ?? {},
        consoleErrors: doc.consoleErrors ?? [],
        networkFailures: doc.networkFailures ?? [],
        errorMessage: doc.errorMessage ?? null,
      };

      res.json(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Session detail error:', message);
      res.status(500).json({ error: message });
    }
  });

  router.post('/api/sessions/process', requireAdmin, async (req, res) => {
    try {
      const { sessionIds } = req.body as ProcessSessionsRequest;

      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        res.status(400).json({ error: 'sessionIds array required' });
        return;
      }

      const result = await processingManager.enqueue(sessionIds);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Process sessions error:', message);
      res.status(500).json({ error: message });
    }
  });

  router.post('/api/sessions/:id/reprocess', requireAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;

      // Look up by MongoDB _id or posthogSessionId
      let doc = null;
      if (/^[0-9a-fA-F]{24}$/.test(id)) {
        doc = await Session.findById(id).lean();
      }
      if (!doc) {
        doc = await Session.findOne({ posthogSessionId: id }).lean();
      }

      if (!doc) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      await processingManager.reprocess(doc.posthogSessionId);
      res.json({ status: 'queued', sessionId: doc.posthogSessionId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Reprocess session error:', message);
      res.status(400).json({ error: message });
    }
  });

  router.post('/api/sessions/:id/cancel', requireAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;

      let doc = null;
      if (/^[0-9a-fA-F]{24}$/.test(id)) {
        doc = await Session.findById(id).lean();
      }
      if (!doc) {
        doc = await Session.findOne({ posthogSessionId: id }).lean();
      }

      if (!doc) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      await processingManager.cancel(doc.posthogSessionId);
      res.json({ status: 'cancelled', sessionId: doc.posthogSessionId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Cancel processing error:', message);
      res.status(400).json({ error: message });
    }
  });

  return router;
}
