// Service worker for the NPS Audit Photo Collector.
// Keep the number in step with APP_VERSION in index.html (shown in the bottom bar).
const CACHE_NAME = 'nps-collector-v4.11';
// The export libraries, each with the SHA-256 of its exact bytes. A file name
// always means these bytes, and a copy is stored or reused only when it
// matches, so a damaged or stale copy is replaced rather than kept. `npm test`
// checks these hashes against vendor/ (upgrade steps: vendor/README.md).
const LIBRARIES = {
  './vendor/jszip-3.10.1.min.js': 'sha256-rMfkFFWoB2W1/Zx+4bgHim0WC7vKRVrq6FTeZclH1Z4=',
  './vendor/exceljs-4.4.0.min.js': 'sha256-fknaaFiOJQ27i7oZDSyqirN4fMAoS9odiy+AXE33Qsk=',
  './vendor/docx-8.2.2.umd.js': 'sha256-L8p4PXqv5Tf0dxxe9qmlkrMZkbUJ7aMS+D2Z3Bz7S3o='
};
// The libraries come before the 4 MB location file: a signal lost late in the
// install then costs the data file, which the next online open refreshes, and
// not the export.
const URLS_TO_CACHE = [
  './index.html',
  './manifest.json',
  './envirocheck_checklists.json',
  ...Object.keys(LIBRARIES),
  './nps_locations.json'
];
// Without these three the app cannot run offline at all.
const ESSENTIAL = ['./index.html', './envirocheck_checklists.json', './nps_locations.json'];
// The location file is 4 MB: judged by its first characters instead of parsed.
const HEAD_ONLY = /nps_locations\.json$/;
const pathOf = u => new URL(u, self.location.href).pathname;
const LIBRARY_HASH = Object.fromEntries(Object.entries(LIBRARIES).map(([u, h]) => [pathOf(u), h]));
const ESSENTIAL_PATHS = ESSENTIAL.map(pathOf);
const VENDOR_PATH = pathOf('./vendor/');

// Does this answer really come from our own server? A park or hotel wifi portal
// answers 200 with its login page, which must never become the app or its data.
// The response passed in is consumed, so hand over a clone.
async function isGenuine(request, response) {
  try {
    if (!response || !response.ok || response.redirected || response.type === 'opaque') return false;
    const url = new URL(request.url);
    const path = url.pathname;
    const type = (response.headers && response.headers.get('content-type') || '').toLowerCase();
    // A library this release knows must be its exact file.
    if (LIBRARY_HASH[path]) return (await sha256(response)) === LIBRARY_HASH[path];
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
      // A library from another release: a portal's login page must not be
      // stored as one either. It says HTML in the type, or reads as HTML.
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

async function sha256(response) {
  const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  return 'sha256-' + btoa(String.fromCharCode(...new Uint8Array(digest)));
}

// The first characters of a body, without parsing the rest. The copy is read
// to the end rather than cancelled part-way: it is a clone of the response
// being stored, and a cancelled clone could fail that store (seen in WebKit).
async function readHead(res, n) {
  try {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, n * 4))).slice(0, n);
  } catch (e) {
    return '';
  }
}

// Install — cache the app shell, one file at a time so a single failure cannot
// abandon the whole install, and never store an answer that is not ours.
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const u of URLS_TO_CACHE) {
      try {
        if (LIBRARIES[u]) { await installLibrary(cache, u); continue; }
        // cache:'no-cache' revalidates with the server (a cheap 304 when nothing
        // changed), so a stale max-age copy of the data is never baked into the
        // new cache.
        const request = new Request(u, { cache: 'no-cache' });
        const response = await fetch(request);
        if (await isGenuine(request, response.clone())) await cache.put(request, response);
      } catch (e) { /* try the rest; activate decides whether this install is usable */ }
    }
  })());
  self.skipWaiting();
});

// A library comes from an older cache when that copy is intact; otherwise from
// the browser's own copy (the page has usually just loaded it, and the host
// serves the versioned files as immutable), and only then from the network.
// Whatever is stored matches the library's hash.
async function installLibrary(cache, u) {
  try {
    const held = await caches.match(u);
    if (held && await storeIfIntact(cache, u, held)) return;
  } catch (e) { /* an unreadable copy: download instead */ }
  for (const mode of ['default', 'reload']) {
    const response = await fetch(new Request(u, { cache: mode }));
    if (response.ok && await storeIfIntact(cache, u, response)) return;
  }
}
// Stores the library only if its bytes match the hash, as a fresh response made
// from those bytes: nothing stored shares a body with the older cache that is
// about to be deleted, or with a stream still being read elsewhere.
async function storeIfIntact(cache, u, response) {
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  if ('sha256-' + btoa(String.fromCharCode(...new Uint8Array(digest))) !== LIBRARIES[u]) return false;
  await cache.put(u, new Response(bytes, { headers: { 'content-type': response.headers.get('content-type') || 'text/javascript' } }));
  return true;
}

// Activate — clean up old caches only once this one holds what the app needs.
// Installed behind a wifi portal, the previous version stays and keeps working.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await retireOldCaches();
    await self.clients.claim();
  })());
});

// Older releases' caches go once this one holds everything in ESSENTIAL. That
// is checked at activation and again whenever one of those files is stored, so
// an update cut short by a lost signal finishes on the next online open instead
// of leaving the older cache in place until the release after. A newer
// release's cache is never touched.
async function retireOldCaches() {
  const cache = await caches.open(CACHE_NAME);
  const have = await Promise.all(ESSENTIAL.map(u => cache.match(u)));
  if (!have.every(Boolean)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter(olderRelease).map(k => caches.delete(k)));
}
const CACHE_PREFIX = CACHE_NAME.replace(/[\d.]+$/, '');   // 'nps-collector-v'
function olderRelease(key) {
  if (key === CACHE_NAME) return false;
  if (!key.startsWith(CACHE_PREFIX) || !/^[\d.]+$/.test(key.slice(CACHE_PREFIX.length))) return true;   // not this app's (another app on localhost while developing)
  const a = key.slice(CACHE_PREFIX.length).split('.').map(Number), b = CACHE_NAME.slice(CACHE_PREFIX.length).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d < 0; }
  return false;
}

// This release's copy first. After an update cut short, an older release's
// cache is still there, and its page must not shadow this release's.
async function fromCache(request) {
  const own = await (await caches.open(CACHE_NAME)).match(request);
  return own || caches.match(request);
}

// Refresh the stored copy from a genuine answer. Both clones are taken before
// any await: once the page starts reading the response it can no longer be
// cloned. Only the app's own paths are refreshed, so a mistyped deep link that
// the host answers with the app does not get a cache entry of its own.
async function cacheIfGenuine(request, response) {
  let probe, copy, path;
  try {
    path = new URL(request.url).pathname;
    if (!(path === '/' || path.endsWith('/index.html') || path.endsWith('.json') || isLibrary(path))) return;
    probe = response.clone();
    copy = response.clone();
  } catch (e) { return; }
  try {
    if (!await isGenuine(request, probe)) return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, copy);
    if (ESSENTIAL_PATHS.includes(path)) await retireOldCaches();
  } catch (e) { /* leave the stored copy alone */ }
}

// Any library under vendor/, not only this release's: a page from a newer
// release, served by this worker before its own worker installs, asks for file
// names this worker's list does not have, and v4.7's page asks for older ones.
function isLibrary(path) {
  return path.startsWith(VENDOR_PATH) && path.endsWith('.js');
}

// Fetch — network-first for the page and the data, cache-first for other assets.
self.addEventListener('fetch', event => {
  // Uploads and sign-in calls go straight to the network: only GETs are cached.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Nothing from another site is cached (the SharePoint upload session is the only one).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.auth/') || url.pathname.startsWith('/api/')) return;
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
        const cached = await fromCache(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const shell = await fromCache('./index.html');
          if (shell) return shell;
        }
        return Response.error();     // never the app in place of a data file
      }
    })());
  } else {
    event.respondWith((async () => {
      const own = await (await caches.open(CACHE_NAME)).match(event.request);
      if (own) return own;
      // A library missing from this release's cache is fetched and stored the
      // first time the page asks for it, so one online open completes the
      // offline copy; an older release's copy is only the fallback offline.
      if (isLibrary(url.pathname)) {
        try {
          const response = await fetch(event.request);
          event.waitUntil(cacheIfGenuine(event.request, response));
          return response;
        } catch (e) {
          const older = await caches.match(event.request);
          if (older) return older;
          throw e;
        }
      }
      const cached = await caches.match(event.request);
      return cached || fetch(event.request);
    })());
  }
});
