/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/triple-slash-reference */

/**
 * Torny service worker.
 *
 * Built with `vite-plugin-pwa` in `injectManifest` mode so we get Workbox
 * precaching for the shell AND can layer on push-notification handlers the
 * default generated SW can't do.
 *
 * What lives here:
 *  - Workbox precache of the built shell (injected at build time).
 *  - A NetworkFirst runtime handler for /api/* so the app works offline
 *    with the last-seen data.
 *  - `push` event → shows a Notification with the payload we sent from
 *    the backend (title/body/url/tag).
 *  - `notificationclick` event → focuses an existing open window on the
 *    target URL or opens a new one.
 *
 * Works on Android Chrome, desktop Firefox/Edge, and iOS 16.4+ (only when
 * the PWA is installed to the Home Screen — Apple's rule, not ours).
 */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { NetworkFirst } from 'workbox-strategies';
import { registerRoute } from 'workbox-routing';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Runtime caching: API requests use NetworkFirst so fresh data wins but the
// last successful response stays available offline.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24,
      }),
    ],
  }),
);

/* ─────────────── Push notifications ────────────────────────────── */

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

self.addEventListener('push', (event) => {
  const data = event.data;
  let payload: PushPayload = {
    title: 'Torny',
    body: '¡Novedad en el torneo!',
  };
  if (data) {
    try {
      payload = { ...payload, ...(data.json() as PushPayload) };
    } catch {
      payload.body = data.text() || payload.body;
    }
  }

  const url = payload.url || '/';
  const options: NotificationOptions = {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag, // collapses repeat notifications for the same match
    data: { ...(payload.data || {}), url },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data as { url?: string } | null)?.url || '/';

  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Reuse an existing tab on the same origin if there is one.
      for (const client of clientsArr) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            await client.focus();
            if ('navigate' in client) {
              await (client as WindowClient).navigate(targetUrl);
            }
            return;
          }
        } catch {
          // ignore bad URLs
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});

// Immediately activate new SW on install — avoids the "refresh twice" gotcha.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
