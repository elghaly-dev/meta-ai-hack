// sw.js — app-shell cache only for Plain Privacy.
// The service worker caches the app shell (page, scripts, manifest, icons).
// It never caches the model weights: those stay in WebLLM's own Cache Storage.
// Cache-first for same-origin GET; cross-origin requests pass through to the
// network and are never stored. Old caches are deleted on activate.

const CACHE = 'plain-privacy-v1';
const SHELL = [
  './',
  'index.html',
  'app.mjs',
  'pipeline.mjs',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
    )
  );
});
