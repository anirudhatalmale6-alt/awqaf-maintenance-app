// Dedicated Service Worker for Web Push notifications.
// Version: push-sw-2026-05-16-v2
//
// Why a SEPARATE worker (not /sw.js)?
// `/sw.js` in this project is intentionally a "kill-switch" worker that
// unregisters itself on activate and clears all caches to prevent stale
// content. We cannot reuse it for push (it would self-destroy).
// `push-sw.js` is registered with an explicit scope (/push-sw.js) only when
// the user opts in to push notifications. It does NOT intercept fetches —
// it ONLY listens for push events and notification clicks.

self.addEventListener('install', (event) => {
  // Activate the new SW immediately, replacing any waiting version.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Take control of all open pages without requiring a reload.
  event.waitUntil(self.clients.claim());
});

// Allow the page to force-activate a waiting worker via postMessage.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Receive a push from the server.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    try {
      data = { title: 'إشعار جديد', body: event.data ? event.data.text() : '' };
    } catch (_) {
      data = { title: 'إشعار جديد', body: '' };
    }
  }

  const title = data.title || 'إشعار جديد';
  const body = data.body || '';
  const url = data.url || '/';
  const reportId = data.report_id || null;
  const notifType = data.type || 'notification';

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    tag: reportId ? `report-${reportId}` : `notif-${Date.now()}`,
    renotify: true,
    requireInteraction: false,
    data: { url, report_id: reportId, type: notifType },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus / open the app when the user clicks the notification.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // If a tab is already open on this app, focus it and navigate.
      for (const client of allClients) {
        try {
          const u = new URL(client.url);
          const t = new URL(targetUrl, client.url);
          if (u.origin === t.origin) {
            await client.focus();
            try {
              await client.navigate(t.href);
            } catch (_) {
              /* navigate may fail cross-origin or for closed clients */
            }
            return;
          }
        } catch (_) {
          // ignore parsing errors
        }
      }
      // Otherwise open a new window.
      try {
        await self.clients.openWindow(targetUrl);
      } catch (_) {
        // ignore
      }
    })()
  );
});

// Optional: when subscription is invalidated by the browser, the page can
// re-subscribe on next visit. We don't try to recover here.
self.addEventListener('pushsubscriptionchange', () => {
  // No-op: the frontend re-subscribes on next app load.
});