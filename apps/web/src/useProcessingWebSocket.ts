import { useCallback, useEffect, useRef, useState } from 'react';
import type { WsMessage, ProcessingPhase } from '@truffles/shared';

interface ProcessingState {
  status: 'processing' | 'complete' | 'error';
  phase?: ProcessingPhase;
  percent?: number;
  message?: string;
  error?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
}

interface UseProcessingWebSocketResult {
  processingState: Record<string, ProcessingState>;
  isConnected: boolean;
}

export function useProcessingWebSocket(): UseProcessingWebSocketResult {
  const [processingState, setProcessingState] = useState<Record<string, ProcessingState>>({});
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    // In dev, connect directly to API port since Vite proxy doesn't handle WS upgrades
    const isDev = import.meta.env.DEV;
    const wsUrl = isDev
      ? 'ws://localhost:4000/ws'
      : `wss://${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
      // Auto-reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;

        setProcessingState((prev) => {
          const next = { ...prev };

          switch (msg.type) {
            case 'processing:started':
              next[msg.sessionId] = {
                status: 'processing',
                phase: (msg.data as { phase?: ProcessingPhase }).phase ?? 'downloading',
                percent: 0,
                message: 'Starting',
              };
              break;

            case 'processing:progress': {
              const progressData = msg.data as {
                phase: ProcessingPhase;
                percent: number;
                message: string;
              };
              next[msg.sessionId] = {
                ...next[msg.sessionId],
                status: 'processing',
                phase: progressData.phase,
                percent: progressData.percent,
                message: progressData.message,
              };
              break;
            }

            case 'processing:complete': {
              const completeData = msg.data as {
                videoUrl?: string;
                thumbnailUrl?: string;
              };
              next[msg.sessionId] = {
                status: 'complete',
                percent: 100,
                message: 'Complete',
                videoUrl: completeData.videoUrl,
                thumbnailUrl: completeData.thumbnailUrl,
              };
              break;
            }

            case 'processing:error':
              next[msg.sessionId] = {
                status: 'error',
                error: (msg.data as { error?: string }).error ?? 'Unknown error',
                message: 'Failed',
              };
              break;
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

  return { processingState, isConnected };
}
