import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { runCacheCleanup } from './lib/cacheCleanup';

// Suppress benign "ResizeObserver loop completed with undelivered notifications" warnings.
// This is a known browser quirk that fires when UI libraries (Radix, Recharts, etc.)
// resize elements during render. It does not indicate an actual bug and does not
// affect functionality, but it can surface in error overlays and console.
const RESIZE_OBSERVER_ERR_MESSAGES = [
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
];

function isResizeObserverError(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return RESIZE_OBSERVER_ERR_MESSAGES.some((m) => message.includes(m));
}

// Register in CAPTURE phase so we intercept the event before Vite's overlay
// and any other listeners. Also register in bubble phase as a safety net.
function handleErrorEvent(event: ErrorEvent) {
  if (isResizeObserverError(event.message) || isResizeObserverError(event.error?.message)) {
    event.stopImmediatePropagation();
    event.stopPropagation();
    event.preventDefault();
    return false;
  }
  return undefined;
}
window.addEventListener('error', handleErrorEvent, true);
window.addEventListener('error', handleErrorEvent, false);

function handleRejectionEvent(event: PromiseRejectionEvent) {
  const reason = event.reason;
  const msg = typeof reason === 'string' ? reason : reason?.message;
  if (isResizeObserverError(msg)) {
    event.stopImmediatePropagation();
    event.stopPropagation();
    event.preventDefault();
  }
}
window.addEventListener('unhandledrejection', handleRejectionEvent, true);
window.addEventListener('unhandledrejection', handleRejectionEvent, false);

// Patch ResizeObserver itself to wrap callbacks with requestAnimationFrame,
// which breaks the notification loop at its source in most cases.
if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
  const OriginalResizeObserver = window.ResizeObserver;
  class PatchedResizeObserver extends OriginalResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      const wrapped: ResizeObserverCallback = (entries, observer) => {
        window.requestAnimationFrame(() => {
          try {
            callback(entries, observer);
          } catch (err) {
            const msg = (err as Error)?.message;
            if (!isResizeObserverError(msg)) throw err;
          }
        });
      };
      super(wrapped);
    }
  }
  window.ResizeObserver = PatchedResizeObserver as unknown as typeof ResizeObserver;
}

// Also silence it at the console layer so it doesn't spam logs in dev.
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (isResizeObserverError(typeof first === 'string' ? first : (first as Error)?.message)) {
    return;
  }
  originalConsoleError(...args);
};

// Run the per-build cache cleanup, THEN register the dedicated push SW.
// We MUST await the cleanup before registering /push-sw.js — otherwise the
// two run in parallel and the cleanup may unregister a brand-new push SW
// that hasn't yet been recognized by the spare-list.
//
// `runCacheCleanup` is idempotent (skips if already run for this build) and
// never touches /push-sw.js (spared by both scope path AND script URL
// pathname checks) nor auth/user data. See src/lib/cacheCleanup.ts.
async function bootstrapServiceWorkers() {
  try {
    await runCacheCleanup();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[cache-clear] cleanup threw:', err);
  }

  if (!('serviceWorker' in navigator)) return;

  // Listen for controller changes globally so we can see when push-sw becomes
  // the active controller (the diagnostic the user has been waiting on).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // eslint-disable-next-line no-console
    console.info(
      '[push] controllerchange — controller now:',
      navigator.serviceWorker.controller?.scriptURL || '(none)',
    );
  });

  try {
    const reg = await navigator.serviceWorker.register('/push-sw.js', {
      scope: '/push-sw.js',
    });
    // eslint-disable-next-line no-console
    console.info('[push] push-sw registered at scope:', reg.scope);
    // If a previous version is waiting, tell it to take over immediately.
    if (reg.waiting) {
      try {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      } catch {
        /* ignore */
      }
    }
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // eslint-disable-next-line no-console
        console.info('[push] push-sw state →', sw.state);
      });
    });
    // Best-effort: wait until the SW is active so the controller is ready
    // for users opening the Profile page right after first load.
    try {
      await navigator.serviceWorker.ready;
      // eslint-disable-next-line no-console
      console.info(
        '[push] navigator.serviceWorker.ready resolved. controller:',
        navigator.serviceWorker.controller?.scriptURL || '(none)',
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[push] serviceWorker.ready rejected:', e);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[push] push-sw registration failed:', err);
  }
}

void bootstrapServiceWorkers();

// Render the app immediately - no async config loading needed
// The web SDK handles API routing automatically in production
createRoot(document.getElementById('root')!).render(<App />);