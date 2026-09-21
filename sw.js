const CACHE_NAME = 'nps-collector-v1.6';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './envirocheck_checklists.json',
  './nps_locations.json',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/docx@8.2.2/build/index.umd.js'
];

// Install — cache the app shell.
// cache:'reload' bypasses the browser HTTP cache, otherwise a stale
// max-age copy of the JSON data gets baked into the new SW cache.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(URLS_TO_CACHE.map(u => new Request(u, { cache: 'reload' })))
    )
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network-first for HTML, cache-first for other assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isHTML = event.request.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('.json');

  if (isHTML) {
    event.respondWith(
      // cache:'no-cache' forces revalidation with the server (cheap 304 via
      // ETag) so the HTTP cache's max-age can't serve stale HTML/JSON.
      fetch(event.request, { cache: 'no-cache' })
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
