import { useEffect, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface BrainMessage {
  id: string;
  type: 'sent' | 'received' | 'system' | 'permission';
  text: string;
  timestamp: number;
  subtype?: 'compacting' | 'tool' | 'connection';
}

interface UseBrainOptions {
  host: string;
  port: number;
}

const STORAGE_KEY = 'cyrus_messages';
const MAX_STORED = 200;

export function useBrain({ host, port }: UseBrainOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const pingTimer = useRef<ReturnType<typeof setInterval>>();

  // Load persisted messages on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try { setMessages(JSON.parse(raw)); } catch {}
      }
    });
  }, []);

  const addMessage = useCallback((msg: Omit<BrainMessage, 'id' | 'timestamp'>) => {
    const newMsg: BrainMessage = {
      ...msg,
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      timestamp: Date.now(),
    };
    setMessages(prev => {
      const next = [...prev, newMsg].slice(-MAX_STORED);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const connect = useCallback(() => {
    const cur = wsRef.current;
    if (cur && (cur.readyState === WebSocket.OPEN || cur.readyState === WebSocket.CONNECTING)) return;

    // Clean up any previous socket
    if (cur) {
      cur.onopen = cur.onclose = cur.onerror = cur.onmessage = null;
      cur.close();
      wsRef.current = null;
    }
    clearTimeout(reconnectTimer.current);

    setStatus('connecting');
    const url = `ws://${host}:${port}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return; // stale socket
        setStatus('connected');
        addMessage({ type: 'system', text: `Connected to Brain at ${host}:${port}` });
        // Keepalive ping every 15s
        clearInterval(pingTimer.current);
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'speak') {
            setThinking(false);
            setCompacting(false);
            addMessage({ type: 'received', text: data.text });
          } else if (data.type === 'prompt') {
            addMessage({ type: 'sent', text: data.text });
          } else if (data.type === 'permission') {
            setThinking(false);
            addMessage({ type: 'permission', text: data.text });
          } else if (data.type === 'thinking') {
            setThinking(true);
          } else if (data.type === 'tool') {
            const project = data.project ? `[${data.project}] ` : '';
            const label = data.command
              ? `${project}${data.tool}: ${data.command.slice(0, 80)}`
              : `${project}${data.tool}`;
            addMessage({ type: 'system', text: `Running: ${label}`, subtype: 'tool' });
          } else if (data.type === 'status') {
            const isCompacting = data.status === 'compacting';
            if (isCompacting) {
              setCompacting(true);
            } else {
              setCompacting(false);
            }
            addMessage({
              type: 'system',
              text: data.text || JSON.stringify(data),
              subtype: isCompacting ? 'compacting' : undefined,
            });
          }
        } catch {
          addMessage({ type: 'received', text: String(event.data) });
        }
      };

      ws.onerror = (err) => {
        console.log('[useBrain] ws error', err);
      };

      ws.onclose = (ev) => {
        console.log('[useBrain] ws closed', ev.code, ev.reason);
        clearInterval(pingTimer.current);
        if (wsRef.current !== ws) return; // stale socket
        wsRef.current = null;
        setStatus('disconnected');
        setThinking(false);
        reconnectTimer.current = setTimeout(connect, 3000);
      };
    } catch {
      setStatus('disconnected');
      reconnectTimer.current = setTimeout(connect, 3000);
    }
  }, [host, port, addMessage]);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    clearInterval(pingTimer.current);
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('disconnected');
  }, []);

  const send = useCallback((text: string, autoWake = true) => {
    if (!text.trim()) return;
    const trimmed = text.trim();
    const utterance = autoWake && !trimmed.toLowerCase().startsWith('cyrus')
      ? `Cyrus ${trimmed}`
      : trimmed;
    const msg = JSON.stringify({ type: 'utterance', text: utterance });
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    } else {
      addMessage({ type: 'system', text: 'Not connected to Brain' });
    }
  }, [addMessage]);

  useEffect(() => {
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  return { status, messages, thinking, compacting, connect, disconnect, send, addMessage };
}
