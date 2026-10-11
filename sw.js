/**
 * Network-first for everything on this origin, including data/*.json.
 * A successful response replaces the cache, so JSON is never stuck forever.
 * Offline reads use the last response that actually loaded.
 */

const CACHE = 'zizi-v1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/logic.js',
  './js/github.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './data/diet.json',
  './data/training.json',
  './data/weighins.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const path = new URL(request.url).pathname;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      try {
        await cache.put(path, fresh.clone());
      } catch {
        /* ignore quota or unsupported-response failures */
      }
    }
    return fresh;
  } catch (error) {
    const cached = await cache.match(path);
    if (cached) return cached;
    throw error;
  }
}
