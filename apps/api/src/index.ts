import 'dotenv/config';
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, type WebSocket } from 'ws';
import { connectDB } from '@truffles/db';
import { APP_VERSION } from '@truffles/shared';
import type { HealthResponse, WsMessage } from '@truffles/shared';
import { posthogRouter } from './routes/posthog';
import { createSessionsRouter } from './routes/sessions';
import { ProcessingManager } from './services/processingManager';
import { createAgentWSS } from './ws/agentStream';
import { AgentManager } from './services/agentManager';
import { createAgentRouter } from './routes/agents';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
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

async function start() {
  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/truffles';
  try {
    await connectDB(mongoUri);
    console.log('[truffles-api] Connected to MongoDB');
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

  // Agent WebSocket server (separate path: /ws/agents)
  const { broadcast: agentBroadcast } = createAgentWSS(server);

  // Agent manager
  const agentManager = new AgentManager({
    maxConcurrent: Number(process.env.MAX_CONCURRENT_AGENTS) || 5,
    timeoutMinutes: Number(process.env.AGENT_TIMEOUT_MINUTES) || 15,
    broadcast: agentBroadcast,
    repoClonePath: process.env.REPO_CLONE_PATH || '/home/ubuntu/ai-outbound-agent',
    worktreeBasePath: process.env.WORKTREE_BASE_PATH || '/home/ubuntu/worktrees',
    githubRepo: process.env.GITHUB_REPO || 'plaibook-dev/ai-outbound-agent',
  });

  app.use('/api/agents', createAgentRouter(agentManager));

  // Recover stuck sessions
  await processingManager.recoverStuckSessions();

  server.listen(PORT, () => {
    console.log(`[truffles-api] listening on port ${PORT}`);
  });

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      console.log(`[truffles-api] ${sig} received, shutting down...`);
      await agentManager.shutdown();
      server.close();
      process.exit(0);
    });
  }
}

start().catch((err) => {
  console.error('[truffles-api] Failed to start:', err);
  process.exit(1);
});
