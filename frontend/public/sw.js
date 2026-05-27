// Legacy Service Worker — KILL-SWITCH ONLY.
//
// Why this exists:
// Older deployments may have registered `/sw.js` with caching behavior. We
// keep this file alive so any browser still holding that old registration
// wakes up, deletes ALL caches, and unregisters itself — guaranteeing users
// always get the freshest deployed code.
//
// IMPORTANT: This worker MUST NOT intercept fetches and MUST NOT touch the
// dedicated push notification worker (`/push-sw.js`).

const SW_VERSION = 'kill-switch-2026-05-16-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1) Delete every cache we can see.
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((k) => {
            try {
              return caches.delete(k);
            } catch (_) {
              return Promise.resolve(false);
            }
          }),
        );
      } catch (_) {
        // ignore
      }
      // 2) Take control of any current clients...
      try {
        await self.clients.claim();
      } catch (_) {
        // ignore
      }
      // 3) ...then unregister ourselves so we never run again.
      try {
        await self.registration.unregister();
      } catch (_) {
        // ignore
      }
      // 4) Reload all controlled clients so they pick up the fresh assets.
      try {
        const allClients = await self.clients.matchAll({ type: 'window' });
        for (const client of allClients) {
          try {
            client.postMessage({ type: 'SW_KILLED', version: SW_VERSION });
          } catch (_) {
            // ignore
          }
        }
      } catch (_) {
        // ignore
      }
    })(),
  );
});

// Do NOT intercept fetches — let the browser go straight to the network.