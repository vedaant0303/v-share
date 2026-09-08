// DropFile Service Worker
const CACHE_NAME = 'dropfile-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Always fetch fresh network requests for file transfers and dynamic routes
  if (event.request.method === 'POST' || event.request.url.includes('/api/') || event.request.url.includes('/mobile-share')) {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
