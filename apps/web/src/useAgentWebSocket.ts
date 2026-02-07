import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentStreamEvent, AgentPhase, OutputCategory } from '@truffles/shared';
import { addToast } from './toastState';

interface AgentState {
  status: 'running' | 'done' | 'failed' | 'false_alarm';
  phase: AgentPhase;
  outputLines: Array<{ timestamp: string; phase: AgentPhase; content: string; category: OutputCategory }>;
  streamingText: string;
  prUrl?: string;
  error?: string;
  falseAlarmReason?: string;
}

interface UseAgentWebSocketResult {
  agentState: Record<string, AgentState>;
  isConnected: boolean;
}

export function useAgentWebSocket(): UseAgentWebSocketResult {
  const [agentState, setAgentState] = useState<Record<string, AgentState>>({});
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/ws/agents`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as AgentStreamEvent;

        setAgentState((prev) => {
          const next = { ...prev };

          switch (msg.type) {
            case 'agent:started': {
              next[msg.agentId] = {
                status: 'running',
                phase: 'starting',
                outputLines: [],
                streamingText: '',
              };
              break;
            }

            case 'agent:output': {
              const existing = next[msg.agentId] ?? {
                status: 'running' as const,
                phase: msg.phase,
                outputLines: [],
                streamingText: '',
              };
              const category = msg.category ?? 'assistant';
              next[msg.agentId] = {
                ...existing,
                phase: msg.phase,
                streamingText: '',
                outputLines: [
                  ...existing.outputLines,
                  { timestamp: msg.timestamp, phase: msg.phase, content: msg.content, category },
                ],
              };
              break;
            }

            case 'agent:text_delta': {
              const existing = next[msg.agentId];
              if (existing) {
                next[msg.agentId] = {
                  ...existing,
                  streamingText: existing.streamingText + msg.delta,
                };
              }
              break;
            }

            case 'agent:phase_change': {
              const existing = next[msg.agentId];
              if (existing) {
                next[msg.agentId] = { ...existing, phase: msg.phase };
              }
              break;
            }

            case 'agent:complete': {
              const existing = next[msg.agentId];
              next[msg.agentId] = {
                ...(existing ?? { phase: 'done' as AgentPhase, outputLines: [] }),
                status: msg.result === 'done' ? 'done' : msg.result === 'false_alarm' ? 'false_alarm' : 'failed',
                prUrl: msg.prUrl,
                error: msg.error,
                falseAlarmReason: msg.falseAlarmReason,
              };

              // Fire toast notification
              if (msg.result === 'done' && msg.prUrl) {
                const prNum = msg.prUrl.split('/').pop();
                addToast(`PR #${prNum} opened`, 'success');
              } else if (msg.result === 'done') {
                addToast('Agent completed successfully', 'success');
              } else if (msg.result === 'false_alarm') {
                addToast(`False alarm: ${msg.falseAlarmReason ?? 'no matching code found'}`, 'info');
              } else {
                addToast(`Agent failed: ${msg.error ?? 'unknown error'}`, 'error');
              }

              break;
            }

            case 'agent:stopped': {
              const existing = next[msg.agentId];
              if (existing) {
                next[msg.agentId] = { ...existing, status: 'failed', error: msg.reason };
              }
              break;
            }
          }

          return next;
        });
      } catch {
        // Ignore unparseable messages
      }
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { agentState, isConnected };
}
