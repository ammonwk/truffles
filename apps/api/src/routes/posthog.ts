import { Router } from 'express';
import { Session, PostHogSessionCache } from '@truffles/db';
import type { PostHogSessionSummary, PostHogSessionsResponse } from '@truffles/shared';
import { syncPostHogSessions } from '../services/posthog.js';

export const posthogRouter = Router();

posthogRouter.get('/api/posthog/sessions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    // Read from MongoDB cache, sorted by startTime desc
    const cached = await PostHogSessionCache.find()
      .sort({ startTime: -1 })
      .skip(offset)
      .limit(limit + 1) // fetch one extra to determine hasMore
      .lean();

    const hasMore = cached.length > limit;
    const page = hasMore ? cached.slice(0, limit) : cached;

    // Compute alreadyProcessed by joining against Session collection
    const sessionIds = page.map((c) => c.posthogSessionId);
    const existing = await Session.find(
      { posthogSessionId: { $in: sessionIds } },
      { posthogSessionId: 1 },
    ).lean();
    const processedSet = new Set(existing.map((e) => e.posthogSessionId));

    const sessions: PostHogSessionSummary[] = page.map((c) => ({
      id: c.posthogSessionId,
      distinctId: c.distinctId,
      userEmail: c.userEmail,
      startTime: c.startTime.toISOString(),
      endTime: c.endTime.toISOString(),
      durationSec: c.durationSec,
      activeSeconds: c.activeSeconds,
      eventCount: c.eventCount,
      alreadyProcessed: processedSet.has(c.posthogSessionId),
    }));

    const result: PostHogSessionsResponse = {
      sessions,
      hasMore,
      nextCursor: null,
    };

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('PostHog sessions cache error:', message);
    res.status(500).json({ error: message });
  }
});

posthogRouter.post('/api/posthog/sync', async (_req, res) => {
  try {
    const result = await syncPostHogSessions();
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('PostHog sync error:', message);
    res.status(500).json({ error: message });
  }
});
