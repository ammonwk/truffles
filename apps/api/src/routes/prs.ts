import { Router, type Request, type Response } from 'express';
import { Issue } from '@truffles/db';

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
