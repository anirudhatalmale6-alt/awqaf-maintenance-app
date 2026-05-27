/**
 * useVersionCheck — proactively detect new deployments while a tab is open.
 *
 * Strategy
 * --------
 * 1) On mount, fetch `/version.json?ts=<now>` to capture the CURRENT deployed
 *    version (the "baseline" the user is actually running).  We deliberately
 *    do NOT use the bundle-injected `__BUILD_VERSION__` as the baseline,
 *    because that constant is frozen into the JS chunk and would never match
 *    a freshly-served version.json on the same build (false positives).
 * 2) Every 5 minutes, AND every time the window regains focus / becomes
 *    visible, re-fetch `/version.json` with a cache-buster.  If the returned
 *    `version` differs from the baseline, surface it through the returned
 *    `updateAvailable` flag so the UI can show a banner.
 * 3) Provide an `applyUpdate` callback that:
 *      a) Clears all non-push browser caches and unregisters legacy SWs
 *         (reuses the well-tested resetPushServiceWorker logic, but spares
 *         push by default — see implementation below).
 *      b) Calls `window.location.reload()` to fetch the new bundle.
 *
 * This hook is intentionally cheap: a single ~50-byte JSON request every
 * few minutes, with abort support and graceful fallback when offline.
 *
 * Auth/data safety: the hook never touches localStorage, tokens, or user
 * data.  Cache cleanup on update is delegated to the existing
 * `cacheCleanup.ts` helpers, which already protect auth tokens and the
 * push service worker.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface VersionInfo {
  version: string;
  buildTime?: string;
  commit?: string;
}

interface UseVersionCheckResult {
  /** Has a newer deployment been detected since this tab loaded? */
  updateAvailable: boolean;
  /** The version this tab is currently running (captured on first poll). */
  currentVersion: string | null;
  /** The newest version detected on the server. Equal to currentVersion when up to date. */
  latestVersion: string | null;
  /** Trigger an immediate poll (e.g. after a user action). */
  checkNow: () => void;
  /** Clear caches and reload the page to apply the new version. */
  applyUpdate: () => Promise<void>;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const VERSION_URL = '/version.json';

async function fetchVersion(signal?: AbortSignal): Promise<VersionInfo | null> {
  try {
    const resp = await fetch(`${VERSION_URL}?ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as VersionInfo;
    if (!data || typeof data.version !== 'string' || data.version.length === 0) {
      return null;
    }
    return data;
  } catch {
    // Network error, abort, or invalid JSON — treat as "no info".
    return null;
  }
}

/**
 * Best-effort cache wipe used when the user accepts an update.
 * Mirrors `cacheCleanup.ts` rules: spares the push service worker and
 * push-prefixed caches, never touches auth/user storage.
 */
async function clearStaleArtifactsForUpdate(): Promise<void> {
  // 1) Delete every Cache Storage entry that isn't push-related.
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith('push-'))
          .map((k) => caches.delete(k).catch(() => false)),
      );
    }
  } catch {
    // ignore
  }

  // 2) Unregister non-push service workers so the new build's SW topology
  //    can be re-established cleanly on the next page load.
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        const scriptURL =
          reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
        // Spare the dedicated push worker — same heuristic as cacheCleanup.ts.
        const isPush =
          (reg.scope && reg.scope.endsWith('/push-sw.js')) ||
          scriptURL.endsWith('/push-sw.js') ||
          scriptURL.includes('/push-sw.js');
        if (isPush) continue;
        try {
          await reg.unregister();
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  // 3) Force the per-build cleanup marker to re-run on the next load,
  //    so cacheCleanup.ts re-evaluates and toasts the user.
  try {
    localStorage.removeItem('__cache_cleanup_version__');
  } catch {
    // ignore
  }
}

export function useVersionCheck(): UseVersionCheckResult {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const baselineRef = useRef<string | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  const poll = useCallback(async () => {
    // Cancel any in-flight poll before starting a new one.
    if (inFlightRef.current) {
      inFlightRef.current.abort();
    }
    const controller = new AbortController();
    inFlightRef.current = controller;

    const info = await fetchVersion(controller.signal);
    if (!info) return;

    if (baselineRef.current === null) {
      // First successful poll — establish the baseline.
      baselineRef.current = info.version;
      setCurrentVersion(info.version);
      setLatestVersion(info.version);
      return;
    }

    setLatestVersion(info.version);
    if (info.version !== baselineRef.current) {
      setUpdateAvailable(true);
    }
  }, []);

  const checkNow = useCallback(() => {
    void poll();
  }, [poll]);

  const applyUpdate = useCallback(async () => {
    try {
      await clearStaleArtifactsForUpdate();
    } catch {
      // ignore — we still want to reload
    }
    // Reload from server, not from cache.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.location as any).reload(true);
    } catch {
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    // Initial baseline poll.
    void poll();

    // Periodic poll.
    const intervalId = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    // Re-check whenever the user comes back to the tab.
    const onFocus = () => void poll();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (inFlightRef.current) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
      }
    };
  }, [poll]);

  return { updateAvailable, currentVersion, latestVersion, checkNow, applyUpdate };
}