/* First Aid Box Inspection - minimal, safe service worker.
 *
 * Design goals:
 *   - NEVER cache API responses or anything authenticated (always network).
 *   - App-shell offline support only: if a navigation fails, show /offline.
 *   - Cache-first for immutable static assets (/_next/static, icons).
 *
 * The "don't lose my inspection in weak signal" guarantee does NOT depend on
 * this file - it is handled by the localStorage draft utility, which works
 * even with no service worker at all.
 */
const VERSION = 'fais-v1';
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) =>
        cache.addAll([OFFLINE_URL, '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png']),
      )
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 3rd-party (e.g. Cloudinary)
  if (url.pathname.startsWith('/api/')) return; // never cache API

  // Navigations: network-first, fall back to the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Immutable static assets: cache-first.
  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(RUNTIME).then((cache) => cache.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
