/**
 * cacheCleanup — one-shot client-side cleanup of stale browser caches and
 * legacy service workers.
 *
 * Runs ONCE per build version (tracked in localStorage under the key
 * `__cache_cleanup_version__`). On each new build (different `BUILD_VERSION`
 * injected by Vite), it:
 *   1) Unregisters every Service Worker registration EXCEPT the dedicated
 *      `/push-sw.js` push notification worker.
 *   2) Deletes every Cache Storage entry whose name does NOT start with
 *      `push-` (so we never wipe push-related caches if any).
 *   3) Removes a small allow-list of known stale localStorage / sessionStorage
 *      cache keys (NEVER touches auth tokens, user info, or settings).
 *   4) Logs a compact summary to console as `[cache-clear] ...` and shows a
 *      lightweight toast confirming the upgrade.
 *
 * The cleanup is best-effort: every step is wrapped in try/catch so a single
 * failure never blocks the rest, and the function never throws.
 */
import { toast } from 'sonner';

// Vite injects this from vite.config.ts (see `define` block).
declare const __BUILD_VERSION__: string;
declare const __BUILD_TIMESTAMP__: string;

const CLEANUP_VERSION_KEY = '__cache_cleanup_version__';
const PUSH_SW_PATH = '/push-sw.js';
const PUSH_SW_SCOPE_PATH = '/push-sw.js';
const PUSH_CACHE_PREFIX = 'push-';

// localStorage / sessionStorage keys that are KNOWN to hold transient cache
// data. We only delete keys matching these patterns. Auth tokens (`token`,
// `custom_token`), user info, and settings are explicitly NOT touched.
const STALE_LS_PATTERNS: RegExp[] = [
  /^vite[-_]/i,
  /^cache[-_]/i,
  /^__cache/i,
  /^sw[-_]cache/i,
  /^workbox/i,
];

const PROTECTED_LS_KEYS = new Set([
  'token',
  'custom_token',
  'user',
  'auth',
  'authToken',
  'refreshToken',
  CLEANUP_VERSION_KEY, // never delete our own version marker
]);

function safeLog(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.info('[cache-clear]', ...args);
}

function safeWarn(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.warn('[cache-clear]', ...args);
}

/**
 * Returns true if a Service Worker registration is the dedicated push worker
 * and should be SPARED from unregistration.
 *
 * Robust against absolute URLs, query strings, hashes, or trailing slashes:
 *   - Checks the registration scope (most reliable identifier).
 *   - Falls back to parsing the script URL and inspecting its pathname.
 *   - Includes a string-contains fallback for environments where URL parsing
 *     fails (e.g. opaque blob URLs).
 */
function isPushWorker(reg: ServiceWorkerRegistration): boolean {
  try {
    // 1) Scope is the most reliable identifier — push-sw is registered with
    //    an explicit scope ending in `/push-sw.js`.
    if (reg.scope) {
      try {
        const scopePath = new URL(reg.scope).pathname;
        if (scopePath.endsWith(PUSH_SW_SCOPE_PATH)) return true;
      } catch {
        if (reg.scope.includes('/push-sw.js')) return true;
      }
    }
    // 2) Inspect any active/installing/waiting worker's script URL pathname.
    const candidates = [
      reg.active?.scriptURL,
      reg.installing?.scriptURL,
      reg.waiting?.scriptURL,
    ].filter((u): u is string => Boolean(u));
    for (const url of candidates) {
      try {
        const p = new URL(url).pathname;
        if (p.endsWith(PUSH_SW_PATH)) return true;
      } catch {
        if (url.includes('/push-sw.js')) return true;
      }
    }
  } catch (e) {
    safeWarn('isPushWorker check failed:', e);
  }
  return false;
}

async function unregisterStaleServiceWorkers(): Promise<number> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 0;
  let removed = 0;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    safeLog('found', regs.length, 'existing SW registration(s)');
    for (const reg of regs) {
      const scriptURL =
        reg.active?.scriptURL ||
        reg.installing?.scriptURL ||
        reg.waiting?.scriptURL ||
        '(unknown)';
      if (isPushWorker(reg)) {
        safeLog('SPARING push-sw at scope', reg.scope, 'script', scriptURL);
        continue;
      }
      try {
        const ok = await reg.unregister();
        if (ok) {
          removed += 1;
          safeLog('unregistered', scriptURL);
        }
      } catch (e) {
        safeWarn('failed to unregister', scriptURL, e);
      }
    }
  } catch (e) {
    safeWarn('getRegistrations failed', e);
  }
  return removed;
}

async function deleteStaleCaches(): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  let removed = 0;
  try {
    const keys = await caches.keys();
    for (const key of keys) {
      if (key.startsWith(PUSH_CACHE_PREFIX)) continue;
      try {
        const ok = await caches.delete(key);
        if (ok) removed += 1;
      } catch (e) {
        safeWarn('failed to delete cache', key, e);
      }
    }
  } catch (e) {
    safeWarn('caches.keys failed', e);
  }
  return removed;
}

function clearStaleStorageKeys(storage: Storage | null): number {
  if (!storage) return 0;
  let removed = 0;
  try {
    const allKeys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k) allKeys.push(k);
    }
    for (const k of allKeys) {
      if (PROTECTED_LS_KEYS.has(k)) continue;
      const isStale = STALE_LS_PATTERNS.some((re) => re.test(k));
      if (!isStale) continue;
      try {
        storage.removeItem(k);
        removed += 1;
      } catch (e) {
        safeWarn('failed to remove storage key', k, e);
      }
    }
  } catch (e) {
    safeWarn('storage scan failed', e);
  }
  return removed;
}

/**
 * Run the cleanup once per build version. Subsequent calls in the same
 * build are no-ops. Returns when cleanup is fully complete (so callers can
 * `await` before doing dependent work, like registering /push-sw.js).
 */
export async function runCacheCleanup(): Promise<void> {
  if (typeof window === 'undefined') return;

  const buildVersion =
    typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev';
  const buildTimestamp =
    typeof __BUILD_TIMESTAMP__ === 'string' ? __BUILD_TIMESTAMP__ : '';

  let lastCleaned: string | null = null;
  try {
    lastCleaned = localStorage.getItem(CLEANUP_VERSION_KEY);
  } catch {
    // private mode — proceed anyway
  }

  if (lastCleaned === buildVersion) {
    safeLog('already cleaned for build', buildVersion, '— skipping');
    return;
  }

  safeLog('running cleanup for build', buildVersion, buildTimestamp || '(no timestamp)');

  const [swRemoved, cacheRemoved] = await Promise.all([
    unregisterStaleServiceWorkers(),
    deleteStaleCaches(),
  ]);

  const lsRemoved = clearStaleStorageKeys(
    typeof localStorage !== 'undefined' ? localStorage : null,
  );
  const ssRemoved = clearStaleStorageKeys(
    typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  );

  try {
    localStorage.setItem(CLEANUP_VERSION_KEY, buildVersion);
  } catch {
    // ignore
  }

  safeLog(
    `removed ${cacheRemoved} caches, ${swRemoved} service workers, ` +
      `${lsRemoved} localStorage keys, ${ssRemoved} sessionStorage keys`,
  );

  // Show a friendly toast only if we actually cleaned something AND this
  // isn't the very first visit (i.e., the user had a previous version).
  // This avoids a confusing toast on a brand-new browser.
  if (
    lastCleaned !== null &&
    (cacheRemoved > 0 || swRemoved > 0 || lsRemoved > 0 || ssRemoved > 0)
  ) {
    try {
      // Defer slightly so the toast container is mounted by then.
      window.setTimeout(() => {
        toast.success('تم تحديث التطبيق إلى أحدث إصدار', {
          description: 'تم مسح النسخ القديمة من الذاكرة المؤقتة.',
          duration: 4000,
        });
      }, 1500);
    } catch {
      // ignore — toast may not be mounted yet
    }
  }
}

/**
 * Hard-reset of all push notification state on this browser. Use as an
 * "إعادة تعيين خدمة الإشعارات" recovery option for users stuck in a bad
 * state (e.g. SW controller never activates). Caller is expected to reload
 * the page after this resolves so a fresh registration can happen.
 */
export async function resetPushServiceWorker(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        try {
          await reg.unregister();
        } catch (e) {
          safeWarn('reset: failed to unregister', e);
        }
      }
    }
  } catch (e) {
    safeWarn('reset: getRegistrations failed', e);
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    }
  } catch (e) {
    safeWarn('reset: caches.keys failed', e);
  }
  // Force the cleanup marker to be re-evaluated on next load.
  try {
    localStorage.removeItem(CLEANUP_VERSION_KEY);
  } catch {
    // ignore
  }
  safeLog('push service worker fully reset');
}