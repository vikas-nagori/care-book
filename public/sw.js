// Care-Book service worker.
//
// It exists so the app installs and launches as a standalone PWA. It deliberately has no fetch
// handler: the previous "network-first" handler re-issued every page, RSC and asset request through
// the worker yet never stored anything, so its offline fallback (caches.match) always came back
// empty. All it added was a worker hop on every request — and on iOS, where the worker is suspended
// aggressively, a cold worker start before navigations and data loads. Without a fetch handler the
// browser goes straight to the network (and its HTTP cache), which is exactly what the old handler
// ended up doing, minus the overhead. Saves and API calls were already exempt; now everything is.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
