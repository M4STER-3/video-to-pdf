const CACHE_PREFIX = `video-to-pdf:${self.registration.scope}:`;
const CACHE = `${CACHE_PREFIX}v1`;
const FILES = ['./', './index.html', './styles.css', './app.js', './video-analyzer.js', './pdf-generator.js', './lib/image-pdf.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const APP_URLS = new Set(FILES.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...APP_URLS])));
  // No skipWaiting: an already open session keeps its matching code version.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  url.search = ''; url.hash = '';
  if (!APP_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(url.href) || fetch(event.request);
  })());
});
