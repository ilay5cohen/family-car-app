/**
 * Service worker for the Family Car PWA.
 *
 * Deliberately conservative:
 *  - The API is NEVER cached. Showing a stale "the car is free" would be worse
 *    than showing nothing - two people would take it at once.
 *  - Static assets use cache-first, so the shell opens instantly offline.
 *  - Navigations use network-first with a cached shell fallback.
 *
 * There is no Web Push here on purpose. Per PRD section 2 and 7, notifications
 * go through WhatsApp, because iOS PWA push is unreliable for this use case.
 */

const VERSION = 'v1';
const SHELL_CACHE = `car-shell-${VERSION}`;
const ASSET_CACHE = `car-assets-${VERSION}`;

const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll rejects the whole install if any single file 404s.
      .then((cache) => Promise.allSettled(SHELL_FILES.map((file) => cache.add(file))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache or serve stale API data.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() =>
          caches.match('/index.html').then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // Hashed build assets and icons: cache first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

// Lets a new build take over without the user force-quitting the app.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
