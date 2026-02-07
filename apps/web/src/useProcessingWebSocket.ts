import { useCallback, useEffect, useRef, useState } from 'react';
import type { WsMessage, ProcessingPhase } from '@truffles/shared';
import { addToast } from './toastState';

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
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/ws`;

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
              addToast('Session video rendered', 'success');
              break;
            }

            case 'processing:error': {
              const errorMsg = (msg.data as { error?: string }).error ?? 'Unknown error';
              next[msg.sessionId] = {
                status: 'error',
                error: errorMsg,
                message: 'Failed',
              };
              addToast(`Processing failed: ${errorMsg}`, 'error');
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

  return { processingState, isConnected };
}
