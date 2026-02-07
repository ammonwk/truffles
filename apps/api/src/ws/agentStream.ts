import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { AgentStreamEvent } from '@truffles/shared';

export function createAgentWSS(server: Server): {
  broadcast: (event: AgentStreamEvent) => void;
} {
  const wss = new WebSocketServer({ server, path: '/ws/agents' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  const broadcast = (event: AgentStreamEvent) => {
    const data = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  };

  return { broadcast };
}
