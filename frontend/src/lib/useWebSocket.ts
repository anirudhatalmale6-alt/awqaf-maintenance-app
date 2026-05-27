/**
 * Real-time WebSocket hook for receiving notifications.
 *
 * Connects to the backend WebSocket endpoint and provides:
 * - Real-time notification events
 * - Automatic reconnection with exponential backoff
 * - Ping/pong keepalive
 * - Connection state tracking
 */

import { useEffect, useRef, useCallback, useState } from 'react';

export interface WSNotification {
  event: 'notification' | 'unread_update' | 'report_update' | 'connected' | 'ping' | 'pong';
  type?: string;
  message?: string;
  report_id?: number;
  count?: number;
  update_type?: string;
  data?: Record<string, unknown>;
  user_id?: string;
}

interface UseWebSocketOptions {
  onNotification?: (data: WSNotification) => void;
  onUnreadUpdate?: (count: number) => void;
  onReportUpdate?: (reportId: number, updateType: string, data?: Record<string, unknown>) => void;
  enabled?: boolean;
}

export function useWebSocket({
  onNotification,
  onUnreadUpdate,
  onReportUpdate,
  enabled = true,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const [isConnected, setIsConnected] = useState(false);

  // Store latest callbacks in refs to avoid reconnection on callback changes
  const onNotificationRef = useRef(onNotification);
  const onUnreadUpdateRef = useRef(onUnreadUpdate);
  const onReportUpdateRef = useRef(onReportUpdate);

  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    onUnreadUpdateRef.current = onUnreadUpdate;
  }, [onUnreadUpdate]);

  useEffect(() => {
    onReportUpdateRef.current = onReportUpdate;
  }, [onReportUpdate]);

  const getToken = useCallback((): string | null => {
    try {
      return localStorage.getItem('custom_token') || localStorage.getItem('token') || null;
    } catch {
      return null;
    }
  }, []);

  const getWsUrl = useCallback((): string | null => {
    const token = getToken();
    if (!token) return null;

    // Determine WebSocket URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    return `${protocol}//${host}/api/v1/ws/notifications?token=${encodeURIComponent(token)}`;
  }, [getToken]);

  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'cleanup');
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    // Clean up any existing connection
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'reconnecting');
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    const url = getWsUrl();
    if (!url) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;

        // Start ping interval (every 30 seconds)
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch {
              // ignore
            }
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data: WSNotification = JSON.parse(event.data);

          switch (data.event) {
            case 'notification':
              onNotificationRef.current?.(data);
              break;
            case 'unread_update':
              if (typeof data.count === 'number') {
                onUnreadUpdateRef.current?.(data.count);
              }
              break;
            case 'report_update':
              if (data.report_id && data.update_type) {
                onReportUpdateRef.current?.(data.report_id, data.update_type, data.data);
              }
              break;
            case 'ping':
              // Server ping, respond with pong
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
              }
              break;
            case 'pong':
            case 'connected':
              // Acknowledgment, no action needed
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Don't reconnect if intentionally closed or auth failed
        if (event.code === 1000 || event.code === 4001) return;

        // Exponential backoff reconnection: 2s, 4s, 8s, 16s, max 60s
        const delay = Math.min(2000 * Math.pow(2, reconnectAttemptsRef.current), 60000);
        reconnectAttemptsRef.current += 1;

        reconnectTimeoutRef.current = setTimeout(() => {
          if (enabled) {
            connect();
          }
        }, delay);
      };

      ws.onerror = () => {
        // Error will trigger onclose, which handles reconnection
      };
    } catch {
      // Failed to create WebSocket, schedule reconnection
      const delay = Math.min(2000 * Math.pow(2, reconnectAttemptsRef.current), 60000);
      reconnectAttemptsRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(() => {
        if (enabled) {
          connect();
        }
      }, delay);
    }
  }, [getWsUrl, enabled]);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    const token = getToken();
    if (!token) {
      cleanup();
      return;
    }

    connect();

    return () => {
      cleanup();
    };
  }, [enabled, connect, cleanup, getToken]);

  return { isConnected };
}