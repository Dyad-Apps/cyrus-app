import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface BrainMessage {
  id: string;
  type: 'sent' | 'received' | 'system' | 'permission';
  text: string;
  timestamp: number;
  subtype?: 'compacting' | 'tool' | 'connection';
  session?: string;
}

interface UseBrainOptions {
  host: string;
  port: number;
}

const STORAGE_KEY = 'cyrus_session_messages';
const MAX_STORED = 200;
const GLOBAL = '_global';

// Configure notification behavior (show even when app is foregrounded)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function requestNotificationPermissions() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    await Notifications.requestPermissionsAsync();
  }
}

async function firePermissionNotification(text: string) {
  // Only notify when app is backgrounded
  if (AppState.currentState === 'active') return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Cyrus — Permission Required',
      body: text,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: null, // immediate
  });
}

export function useBrain({ host, port }: UseBrainOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionMessages, setSessionMessages] = useState<Record<string, BrainMessage[]>>({});
  const [sessions, setSessions] = useState<string[]>([]);
  const [activeSession, setActiveSession] = useState<string>('');
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [thinking, setThinking] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pingTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;

  // Load persisted messages on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try { setSessionMessages(JSON.parse(raw)); } catch {}
      }
    });
  }, []);

  const addMessage = useCallback((msg: Omit<BrainMessage, 'id' | 'timestamp' | 'session'>, session?: string) => {
    const target = session || GLOBAL;
    const newMsg: BrainMessage = {
      ...msg,
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      timestamp: Date.now(),
      session: target,
    };
    setSessionMessages(prev => {
      const bucket = prev[target] || [];
      const next = { ...prev, [target]: [...bucket, newMsg].slice(-MAX_STORED) };
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
    requestNotificationPermissions();
    const url = `ws://${host}:${port}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return; // stale socket
        setStatus('connected');
        addMessage({ type: 'system', text: `Connected to Brain at ${host}:${port}` });
        // Request session list in case the server's push arrived before onmessage was ready
        ws.send(JSON.stringify({ type: 'get_sessions' }));
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
          const proj = data.project || '';

          if (data.type === 'sessions') {
            setSessions(data.sessions || []);
            if (data.active) {
              setActiveSession(data.active);
            }
          } else if (data.type === 'speak') {
            setThinking(false);
            setCompacting(false);
            addMessage({ type: 'received', text: data.text }, proj);
          } else if (data.type === 'prompt') {
            addMessage({ type: 'sent', text: data.text }, proj);
          } else if (data.type === 'permission') {
            setThinking(false);
            const permSession = proj || activeSessionRef.current;
            addMessage({ type: 'permission', text: data.text }, permSession);
            // Auto-switch to the session with the permission prompt
            if (permSession) setSelectedSession(permSession);
            firePermissionNotification(data.text);
          } else if (data.type === 'thinking') {
            setThinking(true);
          } else if (data.type === 'tool') {
            const label = data.command
              ? `${data.tool}: ${data.command.slice(0, 80)}`
              : data.tool;
            addMessage({ type: 'system', text: `Running: ${label}`, subtype: 'tool' }, proj);
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
            }, proj);
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

  const switchSession = useCallback((session: string) => {
    setSelectedSession(session);
    // Tell the brain to switch active project so routing matches
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'switch_session', session }));
    }
  }, []);

  // Visible messages: only the selected session (global shown when no session selected)
  const visibleMessages = useMemo(() => {
    if (!selectedSession) return sessionMessages[GLOBAL] || [];
    return sessionMessages[selectedSession] || [];
  }, [sessionMessages, selectedSession]);

  // Auto-select first session when sessions arrive and none selected
  useEffect(() => {
    if (!selectedSession && sessions.length > 0) {
      setSelectedSession(activeSession || sessions[0]);
    }
  }, [sessions, activeSession, selectedSession]);

  useEffect(() => {
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  return {
    status, thinking, compacting, connect, disconnect, send, addMessage,
    sessions, activeSession, selectedSession, switchSession,
    visibleMessages,
  };
}
