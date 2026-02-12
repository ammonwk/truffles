import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Issue, Session } from '@truffles/db';
import { requireAdmin } from '../middleware/auth.js';
import { getPresignedUrl, uploadBufferAndGetUrl } from '../services/s3.js';
import { extractFrames, downloadVideoFromS3 } from '../services/frameExtractor.js';
import { enrichPrWithScreenshot } from '../services/agentManager.js';

export const prsRouter = Router();

const GITHUB_REPO = process.env.GITHUB_REPO || 'plaibook-dev/ai-outbound-agent';

// GET /api/prs/:number — fetch PR detail from GitHub
prsRouter.get('/api/prs/:number', async (req: Request, res: Response) => {
  try {
    const prNumber = Number(req.params.number);
    if (!prNumber || isNaN(prNumber)) {
      res.status(400).json({ error: 'Invalid PR number' });
      return;
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
      return;
    }

    const headers = {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'truffles-api',
    };

    // Fetch PR metadata and diff in parallel
    const [prRes, diffRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${GITHUB_REPO}/pulls/${prNumber}`, { headers }),
      fetch(`https://api.github.com/repos/${GITHUB_REPO}/pulls/${prNumber}`, {
        headers: { ...headers, Accept: 'application/vnd.github.v3.diff' },
      }),
    ]);

    if (!prRes.ok) {
      res.status(prRes.status === 404 ? 404 : 502).json({
        error: prRes.status === 404 ? 'PR not found' : `GitHub API error: ${prRes.status}`,
      });
      return;
    }

    const prData = await prRes.json() as Record<string, unknown>;
    const diff = diffRes.ok ? await diffRes.text() : '';

    // Find linked issue by prNumber
    const linkedIssue = await Issue.findOne({ prNumber }).lean();

    res.json({
      id: prData.number,
      title: prData.title,
      branch: (prData.head as Record<string, unknown>)?.ref ?? '',
      status: (prData.merged as boolean) ? 'merged' : (prData.state as string) === 'open' ? 'open' : 'closed',
      additions: prData.additions ?? 0,
      deletions: prData.deletions ?? 0,
      filesChanged: prData.changed_files ?? 0,
      body: prData.body ?? '',
      issueId: linkedIssue?._id?.toString() ?? null,
      issueTitle: linkedIssue?.title ?? null,
      issueDescription: linkedIssue?.description ?? null,
      sessionId: linkedIssue?.sessionId?.toString() ?? null,
      issueTimestampSec: linkedIssue?.timestampSec ?? null,
      agentReasoning: linkedIssue?.llmReasoning ?? '',
      diff,
      htmlUrl: prData.html_url ?? '',
      createdAt: prData.created_at ?? '',
      updatedAt: prData.updated_at ?? '',
    });
  } catch (err) {
    console.error('[prs] detail error:', err);
    res.status(500).json({ error: 'Failed to fetch PR' });
  }
});

// POST /api/prs/backfill-screenshots — extract frames for existing PRs and update their bodies
prsRouter.post('/api/prs/backfill-screenshots', requireAdmin, async (_req: Request, res: Response) => {
  try {
    // Find issues that have a PR but no screenshot URLs
    const issues = await Issue.find({
      prNumber: { $ne: null },
      $or: [
        { videoFrameUrls: { $exists: false } },
        { videoFrameUrls: { $size: 0 } },
      ],
    }).lean();

    if (issues.length === 0) {
      res.json({ message: 'No PRs need backfilling', updated: 0 });
      return;
    }

    const results: Array<{ issueId: string; prNumber: number; status: string; error?: string }> = [];

    for (const issue of issues) {
      const prNumber = issue.prNumber as number;
      const issueId = issue._id.toString();

      try {
        // Find the session to get the video
        const session = await Session.findById(issue.sessionId).lean();
        if (!session?.videoUrl) {
          results.push({ issueId, prNumber, status: 'skipped', error: 'No video available' });
          continue;
        }

        // Download video and extract the frame at the issue's timestamp
        const tmpVideoPath = path.join(os.tmpdir(), `truffles-backfill-${Date.now()}.mp4`);
        try {
          const presignedUrl = await getPresignedUrl(session.videoUrl);
          await downloadVideoFromS3(presignedUrl, tmpVideoPath);

          // Extract frames the same way as video analysis (every 5s, max 20)
          const frames = await extractFrames(tmpVideoPath, 5, 20);

          // Find the best frame for this issue's timestamp
          const targetFrameIndex = Math.round((issue.timestampSec ?? 0) / 5);
          const frameIndex = Math.min(Math.max(targetFrameIndex, 0), frames.length - 1);

          if (frames.length === 0) {
            results.push({ issueId, prNumber, status: 'skipped', error: 'No frames extracted' });
            continue;
          }

          const frame = frames[frameIndex];
          const sessionId = issue.sessionId.toString();
          const s3Key = `sessions/${sessionId}/frames/frame-${String(frameIndex).padStart(4, '0')}.jpg`;

          const screenshotUrl = await uploadBufferAndGetUrl(s3Key, Buffer.from(frame.base64, 'base64'), 'image/jpeg');

          // Update Issue with the screenshot URL
          await Issue.findByIdAndUpdate(issueId, {
            videoFrameUrls: [screenshotUrl],
          });

          // Update the PR body on GitHub
          await enrichPrWithScreenshot(GITHUB_REPO, prNumber, screenshotUrl);

          results.push({ issueId, prNumber, status: 'updated' });
        } finally {
          if (fs.existsSync(tmpVideoPath)) {
            fs.unlinkSync(tmpVideoPath);
          }
        }
      } catch (err) {
        console.error(`[backfill] failed for issue ${issueId} / PR #${prNumber}:`, err);
        results.push({ issueId, prNumber, status: 'error', error: String(err) });
      }
    }

    const updated = results.filter((r) => r.status === 'updated').length;
    res.json({ message: `Backfilled ${updated}/${issues.length} PRs`, results });
  } catch (err) {
    console.error('[prs] backfill error:', err);
    res.status(500).json({ error: 'Backfill failed' });
  }
});
