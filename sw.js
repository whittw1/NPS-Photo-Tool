// Keep the number in step with APP_VERSION in index.html (shown in the bottom bar).
const CACHE_NAME = 'nps-collector-v3.1';
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

// Only a genuine answer from our own server replaces the offline copy. A park
// or hotel wifi portal answers 200 with its own login page, which would
// otherwise be cached as the app and served offline for ever.
async function cacheIfGenuine(request, response) {
  try {
    if (!response || !response.ok || response.redirected || response.type === 'opaque') return;
    const url = new URL(request.url);
    const type = (response.headers && response.headers.get('content-type') || '').toLowerCase();
    if (url.pathname.endsWith('.json')) {
      if (type && type.indexOf('json') < 0) return;             // a portal answers HTML
      const len = Number(response.headers && response.headers.get('content-length'));
      if (len && len > 1500000) {
        // Only the 4 MB location file takes this path: its first characters
        // decide, so it is not parsed on every launch.
        const head = (await readHead(response.clone(), 64)).replace(/^\uFEFF/, '').trim();
        if (!/^[[{]/.test(head)) return;
      } else {
        JSON.parse(await response.clone().text());              // small files are checked in full
      }
    } else {
      const body = await response.clone().text();
      if (!/NPS Photo Collector/.test(body)) return;                 // not our page
    }
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (e) { /* leave the cached copy alone */ }
}

// Only the first bytes of a body, so a large file is never pulled into memory.
async function readHead(res, n) {
  try {
    if (!res.body || !res.body.getReader) return (await res.text()).slice(0, n);
    const reader = res.body.getReader();
    const { value } = await reader.read();
    try { reader.cancel(); } catch (e) {}
    return new TextDecoder().decode((value || new Uint8Array()).subarray(0, n));
  } catch (e) { return ''; }
}

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
        .then(response => { cacheIfGenuine(event.request, response); return response; })
        .catch(() => caches.match(event.request).then(c => c || caches.match('./index.html')).then(c => c || Response.error()))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
