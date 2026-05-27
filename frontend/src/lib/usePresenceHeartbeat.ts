import { useEffect } from 'react';
import { customApi } from './customApi';

/**
 * Periodically pings the backend /api/v1/presence/heartbeat endpoint so
 * the current user appears in the online users list even when the
 * WebSocket connection is unavailable or blocked by a proxy.
 *
 * Works across desktop and mobile. On mobile, browsers throttle timers
 * when the tab is backgrounded, so we also trigger a ping on visibility
 * change, window focus, pageshow, and user interaction events.
 */
export function usePresenceHeartbeat(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let lastPingAt = 0;
    const MIN_GAP_MS = 5000; // Throttle event-driven pings

    const ping = async (force: boolean = false) => {
      if (cancelled) return;
      const now = Date.now();
      if (!force && now - lastPingAt < MIN_GAP_MS) return;
      lastPingAt = now;
      try {
        await customApi('/api/v1/presence/heartbeat', 'POST');
      } catch {
        // Silently ignore — presence is best-effort
      }
    };

    // Fire immediately, then every 30s
    ping(true);
    const interval = setInterval(() => ping(true), 30000);

    // Ping whenever the user returns to the app (mobile friendly)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        ping();
      }
    };
    const onFocus = () => ping();
    const onPageShow = () => ping();
    // Light user-interaction triggers keep mobile users "fresh" even if
    // the timer is throttled by the browser.
    const onInteraction = () => ping();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('touchstart', onInteraction, { passive: true });
    window.addEventListener('click', onInteraction);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('touchstart', onInteraction);
      window.removeEventListener('click', onInteraction);
    };
  }, [enabled]);
}