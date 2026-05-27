import { useEffect } from 'react';
import { getAPIBaseURL } from '@/lib/config';

/**
 * Frontend keep-alive ping.
 *
 * Pings the backend `/api/v1/health/ping` endpoint at a regular interval to
 * prevent the backend worker from cold-starting after idle periods. This
 * dramatically reduces the 20–30 second "first request after idle" delays
 * observed across data-loading pages.
 *
 * - Does NOT depend on auth (the endpoint is public, no DB access).
 * - Pauses pinging when the tab is hidden to save bandwidth/battery, and
 *   immediately fires a ping when the tab becomes visible again.
 * - Fires one ping immediately on mount to warm the backend on first load.
 */
const PING_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes — under most idle thresholds

export function useKeepAlive(): void {
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const ping = async () => {
      if (cancelled) return;
      try {
        const base = getAPIBaseURL();
        await fetch(`${base}/api/v1/health/ping`, {
          method: 'GET',
          credentials: 'omit',
          cache: 'no-store',
        });
      } catch {
        /* ignore — keep-alive is best-effort */
      }
    };

    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(ping, PING_INTERVAL_MS);
    };

    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        ping();
        start();
      } else {
        stop();
      }
    };

    // Warm the backend immediately on mount, then schedule.
    ping();
    start();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);
}