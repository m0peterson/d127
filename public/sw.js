// Оффлайн-кэш. Стратегия stale-while-revalidate: отдаём из кэша сразу и обновляем в фоне,
// поэтому правки в quotes.txt доезжают до пользователей без ручного повышения версии.
const CACHE = 'd127-v2';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/dice.js',
  'js/quotes.js',
  'js/settings.js',
  'js/llm.js',
  'data/quotes.txt',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      event.waitUntil(refresh);
      return cached || (await refresh) || (request.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }),
  );
});
