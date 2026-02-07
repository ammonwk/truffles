import 'dotenv/config';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, type WebSocket } from 'ws';
import { connectDB } from '@truffles/db';
import { APP_VERSION } from '@truffles/shared';
import type { HealthResponse, WsMessage } from '@truffles/shared';
import { posthogRouter } from './routes/posthog.js';
import { createSessionsRouter } from './routes/sessions.js';
import { ProcessingManager } from './services/processingManager.js';
import { createAgentWSS } from './ws/agentStream.js';
import { AgentManager } from './services/agentManager.js';
import { createAgentRouter } from './routes/agents.js';
import { createIssuesRouter } from './routes/issues.js';
import { createSettingsRouter } from './routes/settings.js';
import { suppressionsRouter } from './routes/suppressions.js';
import { prsRouter } from './routes/prs.js';
import { AnalysisManager } from './services/analysisManager.js';
import { WorktreeManager } from './services/worktreeManager.js';
import { shutdownBrowser } from './services/rrvideo.js';
import { syncPostHogSessions } from './services/posthog.js';
import { AgentSession, Settings } from '@truffles/db';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.set('trust proxy', true);
app.use(express.json());

app.get('/api/health', (_req, res) => {
  const response: HealthResponse = {
    status: 'ok',
    service: 'truffles-api',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
  };
  res.json(response);
});

// --- Network identity (local self-hosting only) ---
const networkDevices: Record<string, { name: string; role: 'judge' | 'attendee' }> = {
  // 192.168.210.0/23 (Wi-Fi)
  '192.168.210.25': { name: 'Zachary', role: 'judge' },
  '192.168.210.117': { name: 'Cambree', role: 'judge' },
  '192.168.211.134': { name: 'Pearl', role: 'judge' },
  '192.168.211.30': { name: 'Jacob', role: 'judge' },
  '192.168.210.4': { name: 'Jordon', role: 'attendee' },
  '192.168.210.12': { name: 'Hayden', role: 'attendee' },
  '192.168.210.22': { name: 'Cheyne', role: 'attendee' },
  '192.168.210.75': { name: 'Anurup', role: 'attendee' },
  '192.168.210.93': { name: 'Brett', role: 'attendee' },
  '192.168.210.150': { name: 'David', role: 'attendee' },
  '192.168.210.162': { name: 'Garrett', role: 'attendee' },
  '192.168.210.164': { name: 'Peter', role: 'attendee' },
  '192.168.210.166': { name: 'Doyoung', role: 'attendee' },
  '192.168.210.170': { name: 'James', role: 'attendee' },
  '192.168.210.193': { name: 'Josh', role: 'attendee' },
  '192.168.210.211': { name: 'Joao', role: 'attendee' },
  '192.168.210.222': { name: 'Kade', role: 'attendee' },
  '192.168.210.239': { name: 'Kevin', role: 'attendee' },
  '192.168.210.247': { name: 'David', role: 'attendee' },
  '192.168.211.13': { name: 'Daniel', role: 'attendee' },
  '192.168.211.29': { name: 'Calahan', role: 'attendee' },
  '192.168.211.40': { name: 'Trevor', role: 'attendee' },
  '192.168.211.51': { name: 'Tyler', role: 'attendee' },
  '192.168.211.56': { name: 'Minh', role: 'attendee' },
  '192.168.211.57': { name: 'Luke', role: 'attendee' },
  '192.168.211.72': { name: 'Austin', role: 'attendee' },
  '192.168.211.90': { name: 'Chandler', role: 'attendee' },
  '192.168.211.98': { name: 'Granite', role: 'attendee' },
  '192.168.211.132': { name: 'Meghna', role: 'attendee' },
  '192.168.211.186': { name: 'Isaac', role: 'attendee' },
  '192.168.211.201': { name: 'Vision', role: 'attendee' },
  '192.168.211.210': { name: 'Tanner', role: 'attendee' },
  '192.168.211.234': { name: 'Kunj', role: 'attendee' },
  '192.168.211.238': { name: 'Dakota', role: 'attendee' },
  // Self (server)
  '192.168.211.22': { name: 'Ammon', role: 'attendee' },
  '127.0.0.1': { name: 'Ammon', role: 'attendee' },
  '::1': { name: 'Ammon', role: 'attendee' },
  // 10.10.128.0/21 (Ethernet)
  '10.10.128.216': { name: 'Dennis', role: 'judge' },
  '10.10.128.194': { name: 'Thomas', role: 'attendee' },
  '10.10.128.195': { name: 'Sam', role: 'attendee' },
  '10.10.128.198': { name: 'Jacob', role: 'attendee' },
  '10.10.128.199': { name: 'Tweag', role: 'attendee' },
  '10.10.128.202': { name: 'Michael', role: 'attendee' },
  '10.10.128.209': { name: 'Jason', role: 'attendee' },
  '10.10.128.214': { name: 'Josh', role: 'attendee' },
  '10.10.128.218': { name: 'Kevin', role: 'attendee' },
  '10.10.128.222': { name: 'gsdr', role: 'attendee' },
  '10.10.128.223': { name: 'Jacob', role: 'attendee' },
  '10.10.128.225': { name: 'Jake', role: 'attendee' },
  '10.10.128.228': { name: 'Jeremiah', role: 'attendee' },
  '10.10.128.229': { name: 'Luke', role: 'attendee' },
  '10.10.128.234': { name: 'Jeremy', role: 'attendee' },
  '10.10.128.240': { name: 'Huey', role: 'attendee' },
  '10.10.129.201': { name: 'Seth', role: 'attendee' },
  '10.10.131.48': { name: 'Jason', role: 'attendee' },
  '10.10.131.87': { name: 'Sterling', role: 'attendee' },
  '10.10.133.224': { name: 'Redo', role: 'attendee' },
  '10.10.134.131': { name: 'Jake', role: 'attendee' },
  '10.10.135.226': { name: 'Daniel', role: 'attendee' },
};

app.get('/api/identify', (req, res) => {
  const raw = req.ip ?? '';
  const ip = raw.replace(/^::ffff:/, '');
  const device = networkDevices[ip];
  res.json({ ip, name: device?.name ?? null, role: device?.role ?? null });
});

async function start() {
  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/truffles';
  try {
    await connectDB(mongoUri);
    console.log('[truffles-api] Connected to MongoDB');

    // Fire-and-forget: populate PostHog session cache on startup
    syncPostHogSessions().catch((err) => {
      console.error('[truffles-api] Startup PostHog sync failed:', err);
    });
  } catch (err) {
    console.error('[truffles-api] MongoDB connection failed:', err);
    process.exit(1);
  }

  // Create HTTP server for Express + WebSocket
  const server = createServer(app);

  // WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  const broadcast = (message: WsMessage) => {
    const payload = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  };

  // Initialize processing manager
  const processingManager = new ProcessingManager(broadcast);

  // Register routes
  app.use(posthogRouter);
  app.use(createSessionsRouter(processingManager));
  app.use(suppressionsRouter);
  app.use(prsRouter);

  // Agent WebSocket server (separate path: /ws/agents)
  const { broadcast: agentBroadcast } = createAgentWSS(server);

  // Agent manager — requires REPO_CLONE_PATH and WORKTREE_BASE_PATH to be set
  const repoClonePath = process.env.REPO_CLONE_PATH;
  const worktreeBasePath = process.env.WORKTREE_BASE_PATH;
  if (!repoClonePath || !worktreeBasePath) {
    console.warn(
      '[truffles-api] REPO_CLONE_PATH and/or WORKTREE_BASE_PATH not set — agent runner disabled. ' +
      'Set these in .env to enable agent functionality.',
    );
  }

  // Read persisted settings from DB, fall back to env vars / defaults
  const dbSettings = await Settings.getOrCreate();
  const agentManager = new AgentManager({
    maxConcurrent: dbSettings.maxConcurrentAgents ?? (Number(process.env.MAX_CONCURRENT_AGENTS) || 5),
    timeoutMinutes: dbSettings.agentTimeoutMinutes ?? (Number(process.env.AGENT_TIMEOUT_MINUTES) || 15),
    broadcast: agentBroadcast,
    repoClonePath: repoClonePath ?? '',
    worktreeBasePath: worktreeBasePath ?? '',
    githubRepo: process.env.GITHUB_REPO || 'plaibook-dev/ai-outbound-agent',
  });

  app.use(createSettingsRouter(agentManager));
  app.use('/api/agents', createAgentRouter(agentManager));
  app.use(createIssuesRouter(agentManager));

  // Analysis pipeline
  const analysisManager = new AnalysisManager();
  analysisManager.setAgentManager(agentManager);

  // Wire processing → analysis pipeline
  processingManager.setOnSessionComplete((posthogSessionId) => {
    analysisManager.analyzeSession(posthogSessionId).catch((err) => {
      console.error(`[truffles-api] analysis pipeline failed for ${posthogSessionId}:`, err);
    });
  });

  // Recover stuck sessions
  await processingManager.recoverStuckSessions();

  // Cleanup cron: orphaned worktrees + old output logs (every 30 min)
  const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
  const WORKTREE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
  const LOG_TRIM_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  const cleanupTimer = setInterval(async () => {
    try {
      // Clean orphaned worktrees
      if (worktreeBasePath && repoClonePath) {
        const wm = new WorktreeManager(repoClonePath, worktreeBasePath);
        const removed = await wm.cleanupOrphaned(WORKTREE_MAX_AGE_MS);
        if (removed > 0) {
          console.log(`[cleanup] removed ${removed} orphaned worktrees`);
        }
      }

      // Trim outputLog from agent sessions completed more than 7 days ago
      const cutoff = new Date(Date.now() - LOG_TRIM_AGE_MS);
      const trimResult = await AgentSession.updateMany(
        {
          completedAt: { $lt: cutoff },
          'outputLog.0': { $exists: true },
        },
        { $set: { outputLog: [] } },
      );
      if (trimResult.modifiedCount > 0) {
        console.log(`[cleanup] trimmed outputLog from ${trimResult.modifiedCount} old agent sessions`);
      }
    } catch (err) {
      console.error('[cleanup] error during periodic cleanup:', err);
    }
  }, CLEANUP_INTERVAL_MS);

  // Serve built web frontend (self-hosting mode)
  const webDist = resolve(__dirname, '../../web/dist');
  app.use(express.static(webDist));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });

  server.listen(PORT, () => {
    console.log(`[truffles-api] listening on port ${PORT}`);
    console.log(`[truffles-api] serving web from ${webDist}`);
  });

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      console.log(`[truffles-api] ${sig} received, shutting down...`);
      clearInterval(cleanupTimer);
      await agentManager.shutdown();
      await shutdownBrowser();
      server.close();
      process.exit(0);
    });
  }
}

start().catch((err) => {
  console.error('[truffles-api] Failed to start:', err);
  process.exit(1);
});
