import { Router, type Request, type Response } from 'express';
import { Issue } from '@truffles/db';
import type { DashboardPRCard, DashboardResponse } from '@truffles/shared';
import { fetchWithRetry } from '../services/fetchWithRetry.js';
import { getPresignedUrl } from '../services/s3.js';

export const dashboardRouter = Router();

const GITHUB_REPO = process.env.GITHUB_REPO || 'plaibook-dev/ai-outbound-agent';

interface GitHubPR {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  html_url: string;
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
}

// GET /api/dashboard/prs — unified PR card list for the dashboard
dashboardRouter.get('/api/dashboard/prs', async (req: Request, res: Response) => {
  try {
    const { severity, prStatus } = req.query;

    // Find all issues that have a PR
    const issueFilter: Record<string, unknown> = { prNumber: { $ne: null } };
    if (severity && severity !== 'all') {
      issueFilter.severity = severity;
    }

    const issues = await Issue.find(issueFilter)
      .sort({ foundAt: -1 })
      .lean();

    if (issues.length === 0) {
      const response: DashboardResponse = { cards: [], total: 0 };
      res.json(response);
      return;
    }

    // Batch-fetch PR metadata from GitHub (one API call)
    const token = process.env.GITHUB_TOKEN;
    const prMap = new Map<number, GitHubPR>();

    if (token) {
      try {
        const ghRes = await fetchWithRetry(
          `https://api.github.com/repos/${GITHUB_REPO}/pulls?state=all&labels=truffles-autofix&per_page=100`,
          {
            headers: {
              Authorization: `token ${token}`,
              Accept: 'application/vnd.github.v3+json',
              'User-Agent': 'truffles-api',
            },
          },
        );

        if (ghRes.ok) {
          const prs = (await ghRes.json()) as GitHubPR[];
          for (const pr of prs) {
            prMap.set(pr.number, pr);
          }
        } else {
          console.warn(`[dashboard] GitHub API returned ${ghRes.status}, falling back to issue-only data`);
        }
      } catch (err) {
        console.warn('[dashboard] GitHub API call failed, falling back to issue-only data:', err);
      }
    }

    // Build cards by joining issues with PR metadata
    const cards: DashboardPRCard[] = [];

    for (const issue of issues) {
      const prNumber = issue.prNumber as number;
      const ghPR = prMap.get(prNumber);

      // Determine PR status
      let prStatusValue: 'open' | 'merged' | 'closed';
      if (ghPR) {
        prStatusValue = ghPR.merged_at ? 'merged' : ghPR.state === 'open' ? 'open' : 'closed';
      } else {
        // Infer from issue status
        prStatusValue = issue.status === 'merged' ? 'merged' : 'open';
      }

      // Apply prStatus filter
      if (prStatus && prStatus !== 'all' && prStatusValue !== prStatus) {
        continue;
      }

      // Resolve screenshot URL (presign S3 key if needed)
      let screenshotUrl: string | null = null;
      const frameUrls = issue.videoFrameUrls ?? [];
      if (frameUrls.length > 0) {
        const raw = frameUrls[0];
        // S3 keys start with "sessions/" — presign them; full URLs pass through
        if (raw.startsWith('http')) {
          screenshotUrl = raw;
        } else {
          try {
            screenshotUrl = await getPresignedUrl(raw);
          } catch {
            screenshotUrl = null;
          }
        }
      }

      cards.push({
        issueId: issue._id.toString(),
        sessionId: issue.sessionId.toString(),
        severity: issue.severity as 'red' | 'yellow',
        issueTitle: issue.title,
        issueDescription: issue.description,
        issueStatus: issue.status,
        timestampSec: issue.timestampSec,
        foundAt: issue.foundAt instanceof Date ? issue.foundAt.toISOString() : String(issue.foundAt),
        screenshotUrl,
        prNumber,
        prUrl: issue.prUrl ?? '',
        prTitle: ghPR?.title ?? issue.title,
        prStatus: prStatusValue,
        prAdditions: ghPR?.additions ?? 0,
        prDeletions: ghPR?.deletions ?? 0,
        prFilesChanged: ghPR?.changed_files ?? 0,
        prHtmlUrl: ghPR?.html_url ?? issue.prUrl ?? '',
        prCreatedAt: ghPR?.created_at ?? (issue.foundAt instanceof Date ? issue.foundAt.toISOString() : String(issue.foundAt)),
      });
    }

    // Sort by prCreatedAt descending (newest first)
    cards.sort((a, b) => new Date(b.prCreatedAt).getTime() - new Date(a.prCreatedAt).getTime());

    const response: DashboardResponse = { cards, total: cards.length };
    res.json(response);
  } catch (err) {
    console.error('[dashboard] error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});
