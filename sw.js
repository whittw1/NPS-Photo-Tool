// Service worker for the NPS Audit Photo Collector.
// Keep the number in step with APP_VERSION in index.html (shown in the bottom bar).
const CACHE_NAME = 'nps-collector-v3.6';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './envirocheck_checklists.json',
  './nps_locations.json',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/docx@8.2.2/build/index.umd.js'
];
// Without these three the app cannot run offline at all.
const ESSENTIAL = ['./index.html', './envirocheck_checklists.json', './nps_locations.json'];
// The location file is 4 MB: judged by its first characters instead of parsed.
const HEAD_ONLY = /nps_locations\.json$/;

// Does this answer really come from our own server? A park or hotel wifi portal
// answers 200 with its login page, which must never become the app or its data.
// The response passed in is consumed, so hand over a clone.
async function isGenuine(request, response) {
  try {
    if (!response || !response.ok || response.redirected || response.type === 'opaque') return false;
    const url = new URL(request.url);
    const path = url.pathname;
    const type = (response.headers && response.headers.get('content-type') || '').toLowerCase();
    if (path.endsWith('.json')) {
      if (type && type.indexOf('json') < 0) return false;            // a portal answers HTML
      if (HEAD_ONLY.test(path)) {
        const head = (await readHead(response, 64)).replace(/^﻿/, '').trim();
        return /^[[{]/.test(head);
      }
      JSON.parse(await response.text());                             // every other data file in full
      return true;
    }
    if (path.endsWith('.js') || path.endsWith('.css')) {
      // A portal's login page must not be stored as a library either: it says
      // HTML in the type, or reads as HTML.
      if (type && (type.indexOf('html') >= 0 || type.indexOf('xml') >= 0)) return false;
      const lib = (await response.text()).trim();
      return !!lib && !/^<(!doctype|html|\?xml)/i.test(lib);
    }
    const body = await response.text();
    return /NPS Photo Collector/.test(body);                         // our page, not a login form
  } catch (e) {
    return false;
  }
}

// The first bytes of a body, so a large file is never pulled into memory. Reads
// a few chunks in case the first one is empty or only a byte-order mark.
async function readHead(res, n) {
  try {
    if (!res.body || !res.body.getReader) return (await res.text()).slice(0, n);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let out = '';
    for (let i = 0; i < 8 && out.trim().length < 4; i++) {
      const chunk = await reader.read();
      if (chunk.value) out += dec.decode(chunk.value, { stream: true });
      if (chunk.done) break;
    }
    try { reader.cancel(); } catch (e) {}
    return out.slice(0, n);
  } catch (e) {
    return '';
  }
}

// Install — cache the app shell, one file at a time so a single failure cannot
// abandon the whole install, and never store an answer that is not ours.
// cache:'reload' bypasses the browser HTTP cache, otherwise a stale max-age
// copy of the JSON data gets baked into the new cache.
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const u of URLS_TO_CACHE) {
      try {
        const request = new Request(u, { cache: 'reload' });
        const response = await fetch(request);
        if (await isGenuine(request, response.clone())) await cache.put(request, response);
      } catch (e) { /* try the rest; activate decides whether this install is usable */ }
    }
  })());
  self.skipWaiting();
});

// Activate — clean up old caches only once this one holds what the app needs.
// Installed behind a wifi portal, the previous version stays and keeps working.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const have = await Promise.all(ESSENTIAL.map(u => cache.match(u)));
    if (have.every(Boolean)) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    }
    await self.clients.claim();
  })());
});

// Refresh the stored copy from a genuine answer. Both clones are taken before
// any await: once the page starts reading the response it can no longer be
// cloned. Only the app's own paths are refreshed, so a mistyped deep link that
// the host answers with the app does not get a cache entry of its own.
async function cacheIfGenuine(request, response) {
  let probe, copy;
  try {
    const path = new URL(request.url).pathname;
    if (!(path === '/' || path.endsWith('/index.html') || path.endsWith('.json'))) return;
    probe = response.clone();
    copy = response.clone();
  } catch (e) { return; }
  try {
    if (!await isGenuine(request, probe)) return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, copy);
  } catch (e) { /* leave the stored copy alone */ }
}

// Fetch — network-first for the page and the data, cache-first for other assets.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isHTML = event.request.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('.json');

  if (isHTML) {
    event.respondWith((async () => {
      try {
        // cache:'no-cache' forces revalidation with the server (cheap 304 via
        // ETag) so the HTTP cache's max-age can't serve stale HTML/JSON.
        const response = await fetch(event.request, { cache: 'no-cache' });
        // waitUntil keeps the worker alive until the copy is written.
        event.waitUntil(cacheIfGenuine(event.request, response));
        return response;
      } catch (e) {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return Response.error();     // never the app in place of a data file
      }
    })());
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
