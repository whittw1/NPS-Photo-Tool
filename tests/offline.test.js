'use strict';
// Offline-export regression tests for the web app: service worker, host config,
// the bundled libraries and the messages around them. `npm test` runs them in
// Chromium and WebKit (Chrome and Safari on an iPad are both WebKit);
// `ENGINES=webkit npm test` runs one engine. Needs the playwright dev dependency
// and its browsers (`npx playwright install chromium webkit`). In CI (or with
// --strict) a scenario that cannot run counts as a failure, not a skip.
//
// Each scenario serves snapshots of the app under that snapshot's own
// staticwebapp.config.json (routes, headers, rewrites, fallback, case-sensitive
// names like Azure), drives a persistent browser profile ("relaunch" closes and
// reopens it, as when the app is reopened), and cuts the network by refusing
// connections. Before every offline launch the browser's own HTTP cache is
// cleared, so what loads offline is what the service worker kept. Snapshots:
//   current    the working tree (the files in web-files.txt)
//   baselines  earlier releases from git history: the one before this, and the
//              newest release for each other set of library file names
//   next       current with the version bumped (a later release)
//   renamed    next with JSZip under a new file name (a library upgrade)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const pw = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nps-offline-test-'));
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',').map(e => e.trim()).filter(Boolean);
const STRICT = !!process.env.CI || process.argv.includes('--strict');
const POOL = Math.max(1, +process.env.POOL || 3);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} };
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// ---- snapshots ----
const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 256 << 20 });
const versionOf = sw => (String(sw).match(/const CACHE_NAME = 'nps-collector-v([\d.]+)'/) || [])[1];
// The file list the build uses: web-files.txt, a * matching within one folder.
function webFiles(dir) {
  const out = [];
  for (const pattern of fs.readFileSync(path.join(dir, 'web-files.txt'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))) {
    const d = path.dirname(pattern), base = path.basename(pattern);
    const re = new RegExp('^' + base.replace(/[.+?^$()|[\]\\{}]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
    const hits = fs.readdirSync(path.join(dir, d)).filter(f => re.test(f)).map(f => path.join(d, f).replace(/^\.\//, ''));
    if (!hits.length) throw new Error('web-files.txt: nothing matches ' + pattern);
    out.push(...hits);
  }
  return out;
}
function copyTree(from, to) {
  for (const f of webFiles(from).concat(['staticwebapp.config.json', 'web-files.txt', 'vendor/README.md'])) {
    fs.mkdirSync(path.join(to, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
  return to;
}
function archive(ref, to) {
  fs.mkdirSync(to, { recursive: true });
  const tar = to + '.tar';
  fs.writeFileSync(tar, git('archive', ref));
  execFileSync('tar', ['-xf', tar, '-C', to]);
  return to;
}
function edit(dir, file, from, to) {
  const p = path.join(dir, file), s = fs.readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`${file}: "${from}" not found`);
  fs.writeFileSync(p, s.split(from).join(to));
}
// The library URLs a release's page loads, from its <script> tags.
const libsOf = html => [...String(html).matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
function buildSnapshots() {
  const cur = versionOf(fs.readFileSync(path.join(ROOT, 'sw.js')));
  const S = { current: { name: 'current', dir: copyTree(ROOT, path.join(TMP, 'current')), version: cur } };
  S.current.libs = libsOf(fs.readFileSync(path.join(S.current.dir, 'index.html')));
  // Releases in git history, newest first: one per CACHE_NAME.
  const seen = new Set([cur]), releases = [];
  for (const h of git('log', '--format=%H', '--', 'sw.js').toString().trim().split('\n').filter(Boolean)) {
    const v = versionOf(git('show', `${h}:sw.js`));
    if (!v || seen.has(v)) continue;
    seen.add(v);
    releases.push({ ref: h, version: v, libs: libsOf(git('show', `${h}:index.html`)) });
  }
  // The release before this one, and the newest release for each other set of
  // same-origin library names (CDN-era releases can't be served offline here).
  const key = r => r.libs.join('|'), picked = [];
  if (releases[0]) picked.push(releases[0]);
  const keys = new Set([key(S.current), releases[0] && key(releases[0])]);
  for (const r of releases) if (!keys.has(key(r)) && r.libs.every(u => u.startsWith('vendor/'))) { keys.add(key(r)); picked.push(r); }
  S.baselines = picked.map(r => ({ name: 'v' + r.version + '(' + r.ref.slice(0, 7) + ')', dir: archive(r.ref, path.join(TMP, 'rel-' + r.version)), version: r.version, libs: r.libs }));
  // A later release, and one that upgrades JSZip under a new name as vendor/README says.
  const next = String(Number(cur.split('.')[0]) + 90) + '.0';
  S.next = { name: 'next', dir: copyTree(ROOT, path.join(TMP, 'next')), version: next };
  edit(S.next.dir, 'sw.js', `'nps-collector-v${cur}'`, `'nps-collector-v${next}'`);
  edit(S.next.dir, 'index.html', `const APP_VERSION = '${cur}';`, `const APP_VERSION = '${next}';`);
  S.next.libs = S.current.libs;
  const ren = copyTree(S.next.dir, path.join(TMP, 'renamed'));
  const lib = fs.readdirSync(path.join(ren, 'vendor')).find(f => /^jszip-.*\.js$/.test(f));
  const renamed = lib.replace(/\.min\.js$|\.js$/, '-upgraded$&');
  fs.renameSync(path.join(ren, 'vendor', lib), path.join(ren, 'vendor', renamed));
  edit(ren, 'index.html', `src="vendor/${lib}"`, `src="vendor/${renamed}"`);
  edit(ren, 'sw.js', `'./vendor/${lib}'`, `'./vendor/${renamed}'`);
  // vendor/README step 3: a rewrite that served an old name from this file follows it.
  if (fs.readFileSync(path.join(ren, 'staticwebapp.config.json'), 'utf8').includes(`"/vendor/${lib}"`)) edit(ren, 'staticwebapp.config.json', `"/vendor/${lib}"`, `"/vendor/${renamed}"`);
  S.renamed = { name: 'renamed', dir: ren, version: next, renamedLib: '/vendor/' + renamed };
  S.renamed.libs = libsOf(fs.readFileSync(path.join(ren, 'index.html')));
  return S;
}

// ---- a small Static Web App: routes, rewrites, fallback, global headers ----
const glob = g => new RegExp('^' + g.replace(/[.+?^$()|[\]\\]/g, '\\$&').replace(/\{([^}]*)\}/g, (_, a) => '(?:' + a.split(',').join('|') + ')').replace(/\*/g, '.*') + '$');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain' };
// Azure's file names are case-sensitive; the Mac's disk is not.
function resolveExact(root, rel) {
  let dir = root;
  for (const part of rel.split('/').filter(Boolean)) {
    let names; try { names = fs.readdirSync(dir); } catch (e) { return null; }
    if (!names.includes(part)) return null;
    dir = path.join(dir, part);
  }
  return fs.statSync(dir).isFile() ? dir : null;
}
const site = snap => ({ ...snap, cfg: JSON.parse(fs.readFileSync(path.join(snap.dir, 'staticwebapp.config.json'), 'utf8')), etag: `"${snap.version}"` });
function serve(st, req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/vendor/')) st.vendorHits.push(p);
  const dropped = (p === '/sw.js' && st.blockSw) || (st.drop && st.drop(req, p));
  // 503 fails a request at once; anything else truthy resets the connection
  // (WebKit may retry a reset page load, so page requests are failed with 503).
  if (dropped === 503) { res.writeHead(503, { 'cache-control': 'no-store' }); res.end(); return; }
  if (dropped) { req.socket.destroy(); return; }
  const cfg = st.site.cfg;
  const route = (cfg.routes || []).find(r => glob(r.route).test(p));
  if (route && route.rewrite) p = route.rewrite;
  if (p === '/') p = '/index.html';
  let file = resolveExact(st.site.dir, p), headers = Object.assign({}, cfg.globalHeaders, route && route.headers);
  if (!file) {
    const fb = cfg.navigationFallback;
    if (!fb || (fb.exclude || []).some(x => glob(x).test(p))) { res.writeHead(404, Object.assign({ 'content-type': 'text/html' }, cfg.globalHeaders)); res.end('Not found'); return; }
    file = resolveExact(st.site.dir, fb.rewrite); headers = Object.assign({}, cfg.globalHeaders);
  }
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (!h['cache-control']) h['cache-control'] = 'public, must-revalidate, max-age=30';
  if (!h['content-type']) h['content-type'] = TYPES[path.extname(file)] || 'application/octet-stream';
  h.etag = st.site.etag;
  if (req.headers['if-none-match'] === st.site.etag) { res.writeHead(304, h); res.end(); return; }
  const body = fs.readFileSync(file);
  res.writeHead(200, Object.assign(h, { 'content-length': body.length }));
  res.end(body);
}
// "Offline" stops the server listening, so every connection is refused at once,
// as with no signal; a dropped download resets one connection.
function startServer() {
  const st = { site: null, blockSw: false, drop: null, vendorHits: [] };
  const server = http.createServer((req, res) => serve(st, req, res));
  const sockets = new Set();
  server.on('connection', c => { sockets.add(c); c.on('close', () => sockets.delete(c)); });
  return new Promise(r => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const srv = { st, base: `http://127.0.0.1:${port}`, offline: false };
    srv.setOffline = on => new Promise(done => {
      if (on === srv.offline) return done();
      srv.offline = on;
      if (on) { server.close(() => done()); sockets.forEach(c => c.destroy()); }
      else server.listen(port, '127.0.0.1', done);
    });
    r(srv);
  }));
}
// Requests the service worker makes itself (its install) carry sw.js as referrer.
const fromWorker = req => /\/sw\.js$/.test(req.headers.referer || '');

// ---- one browser profile per scenario ----
async function session(engine, srv) {
  const dir = fs.mkdtempSync(path.join(TMP, engine + '-profile-'));
  let ctx = null, page = null;
  const s = {
    dir,
    dialogs: [],
    async launch() {
      if (ctx) await ctx.close();
      ctx = await pw[engine].launchPersistentContext(dir, { serviceWorkers: 'allow' });
      page = ctx.pages()[0] || await ctx.newPage();
      page.on('dialog', d => { s.dialogs.push(d.message()); d.accept(); });
      return s;
    },
    async open(p = '/index.html') { await page.goto(srv.base + p, { waitUntil: 'load', timeout: 60000 }); return s; },
    page: () => page,
    async close() { if (ctx) { const c = ctx; ctx = null; await c.close(); } },
    // Empty the browser's HTTP cache, so only the service worker can serve offline.
    async clearHttpCache() {
      if (engine === 'chromium' && ctx) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.clearBrowserCache'); await cdp.detach(); }
      await s.close();
      // WebKit's HTTP cache: NetworkCache on macOS, WebKitCache on Linux (CI).
      // CacheStorage, the service worker's own cache, stays.
      const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) {
        const full = path.join(d, e.name);
        if (/^(NetworkCache|WebKitCache)$/.test(e.name)) fs.rmSync(full, { recursive: true, force: true });
        else if (depth < 3) walk(full, depth + 1);
      } };
      walk(dir, 0);
    },
    libs: () => page.evaluate(() => ({ JSZip: typeof JSZip, ExcelJS: typeof ExcelJS, docx: typeof docx, app: APP_VERSION, bar: document.getElementById('appVersion').textContent })),
    cache: name => page.evaluate(async n => (await caches.has(n)) ? (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname) : null, name),
    cacheNames: () => page.evaluate(() => caches.keys()),
    settled: () => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active && r.active.state === 'activated' && !r.installing && !r.waiting); }),
    hashOf: (name, p) => page.evaluate(async ([n, p]) => { const r = await (await caches.open(n)).match(p); if (!r) return null; const d = await crypto.subtle.digest('SHA-256', await r.arrayBuffer()); return 'sha256-' + btoa(String.fromCharCode(...new Uint8Array(d))); }, [name, p]),
  };
  return s;
}
async function until(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch (e) { /* page busy */ } await sleep(200); }
  throw new Error('timed out waiting for ' + what);
}
const cacheName = snap => 'nps-collector-v' + snap.version;
const vendorPaths = snap => snap.libs.map(u => '/' + u);
const sha = file => 'sha256-' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('base64');
async function install(s, srv, snap) {
  srv.st.site = site(snap);
  await (await s.launch()).open();
  await until(s.settled, 60000, 'the service worker to activate');
  await until(async () => { const c = (await s.cache(cacheName(snap))) || []; return c.includes('/index.html') && vendorPaths(snap).every(v => c.includes(v)); }, 90000, 'the page and libraries in ' + cacheName(snap));
}
async function goOffline(s, srv) {
  await s.clearHttpCache();
  await srv.setOffline(true);
  await (await s.launch()).open();
}
// The libraries may arrive a moment after load (the page loads missing ones itself).
async function libsLoaded(s) {
  try { await s.page().waitForFunction(() => typeof JSZip !== 'undefined' && typeof ExcelJS !== 'undefined' && typeof docx !== 'undefined', null, { timeout: 15000 }); }
  catch (e) { throw new Error('libraries missing offline: ' + JSON.stringify(await s.libs())); }
}

// A finding with a photo, then the ZIP export and the Word Report, both captured
// in the page. Picks the first region, park, question and priority, so a data
// rebuild can't break it.
const step = (page, fn, what) => page.waitForFunction(fn, null, { timeout: 90000 }).catch(e => { throw new Error('offline export: ' + what + ' — ' + e.message.split('\n')[0]); });
async function exportWorks(page) {
  await step(page, () => typeof forestData !== 'undefined' && Object.keys(forestData).length > 0 && tgLoaded, 'park and question data never loaded');
  const firstValue = sel => page.evaluate(sel => [...document.querySelector(sel).options].find(o => o.value).value, sel);
  await page.selectOption('#regionSelect', await firstValue('#regionSelect'));
  await step(page, () => [...document.querySelector('#forestSelect').options].some(o => o.value), 'no parks in the first region');
  await page.selectOption('#forestSelect', await firstValue('#forestSelect'));
  await page.fill('#tgSearch', 'oil');
  await page.waitForSelector('#tgResults .tg-item');
  await page.click('#tgResults .tg-item');
  await page.fill('#entryDetails', 'offline test');
  await page.click('.score-btn');
  const jpg = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; c.getContext('2d').fillRect(0, 0, 640, 480); return c.toDataURL('image/jpeg', 0.8).split(',')[1]; }), 'base64');
  await page.setInputFiles('#file_p_main', { name: 'x.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await step(page, () => currentPhotos.p_main && currentPhotos.p_main.unsaved === false, 'the photo was never stored');
  await page.click('#saveBtn');
  await step(page, () => savedEntries.length >= 1, 'the entry was never saved');
  const r = await page.evaluate(async () => {
    const got = {}; window.shareOrDownload = async (blob, name) => { got[name] = blob; return true; };
    exportDateMode = 'all';
    await runExport();
    await generateWordReport();
    const zipName = Object.keys(got).find(n => n.endsWith('.zip'));
    const inZip = zipName ? Object.keys((await JSZip.loadAsync(got[zipName])).files) : [];
    return { inZip, word: Object.keys(got).some(n => n.endsWith('.docx')), toast: document.getElementById('toast').textContent };
  });
  const ok = r.inZip.some(n => n.endsWith('.xlsx')) && r.inZip.some(n => n.endsWith('.csv')) && r.inZip.some(n => n.endsWith('.jpg')) && r.word;
  if (!ok) throw new Error('offline export incomplete: ' + JSON.stringify(r));
}
async function offlineCheck(s, srv, want) {
  await goOffline(s, srv);
  if (want) { const l = await s.libs(); if (l.app !== want.version) throw new Error(`offline the app is v${l.app}, not v${want.version}`); }
  await libsLoaded(s);
  await exportWorks(s.page());
}

// ---- scenarios with a service worker ----
const SCENARIOS = {
  // A fresh install works with no signal.
  async fresh(s, srv, S) {
    await install(s, srv, S.current);
    await offlineCheck(s, srv, S.current);
  },
  // Every library download fails during the first open: the bar says so, and
  // once the signal is back the page loads them itself, without a reload.
  async 'dropped-downloads'(s, srv, S) {
    srv.st.drop = (req, p) => p.startsWith('/vendor/') && (fromWorker(req) || 503);
    srv.st.site = site(S.current);
    await (await s.launch()).open();
    await until(s.settled, 60000, 'the service worker to activate');
    const l = await s.libs();
    if (l.JSZip !== 'undefined' || !/export library missing/.test(l.bar)) throw new Error('expected the libraries missing and flagged: ' + JSON.stringify(l));
    srv.st.drop = null;
    await s.page().evaluate(() => window.dispatchEvent(new Event('online')));
    await libsLoaded(s);
    await until(async () => { const c = (await s.cache(cacheName(S.current))) || []; return vendorPaths(S.current).every(v => c.includes(v)); }, 30000, 'the worker to store the libraries the page loaded');
    await until(async () => !/missing/.test((await s.libs()).bar), 10000, 'the bar to clear');
    await offlineCheck(s, srv, S.current);
  },
  // An upgrade copies the libraries it already holds (no downloads), checked by hash.
  async 'upgrade-reuses-libraries'(s, srv, S) {
    await install(s, srv, S.current);
    srv.st.site = site(S.next); srv.st.vendorHits = [];
    srv.st.drop = (req, p) => p.startsWith('/vendor/');
    await (await s.launch()).open();
    await until(async () => { const k = await s.cacheNames(); return k.length === 1 && k[0] === cacheName(S.next); }, 60000, 'the upgrade to replace the old cache');
    for (const v of vendorPaths(S.next)) if (await s.hashOf(cacheName(S.next), v) !== sha(path.join(S.next.dir, v))) throw new Error(v + ' missing or wrong in the new cache');
    if (srv.st.vendorHits.length) throw new Error('library downloads during the upgrade: ' + srv.st.vendorHits.join(', '));
    srv.st.drop = null;
    await offlineCheck(s, srv, S.next);
  },
  // A damaged library in the old cache is not carried into the new release.
  async 'upgrade-heals-bad-copy'(s, srv, S) {
    await install(s, srv, S.current);
    const bad = vendorPaths(S.current)[0];
    await s.page().evaluate(async ([n, p]) => (await caches.open(n)).put(p, new Response('/* damaged */', { headers: { 'content-type': 'text/javascript' } })), [cacheName(S.current), bad]);
    srv.st.site = site(S.next);
    await (await s.launch()).open();
    await until(async () => { const k = await s.cacheNames(); return k.length === 1 && k[0] === cacheName(S.next); }, 60000, 'the upgrade to replace the old cache');
    if (await s.hashOf(cacheName(S.next), bad) !== sha(path.join(S.next.dir, bad))) throw new Error('the damaged ' + bad + ' was kept');
    await offlineCheck(s, srv, S.next);
  },
  // An upgrade that renames a library stores the new file and reuses the others.
  async 'upgrade-renamed-library'(s, srv, S) {
    await install(s, srv, S.current);
    srv.st.site = site(S.renamed);
    await (await s.launch()).open();
    await until(async () => { const k = await s.cacheNames(); return k.length === 1 && k[0] === cacheName(S.renamed); }, 60000, 'the upgrade to replace the old cache');
    const c = await s.cache(cacheName(S.renamed));
    for (const v of vendorPaths(S.renamed)) if (!c.includes(v)) throw new Error(v + ' missing from the new cache');
    await offlineCheck(s, srv, S.renamed);
  },
  // The libraries are installed before the 4 MB file: a first install whose own
  // downloads are cut from nps_locations.json on still keeps them.
  async 'install-order'(s, srv, S) {
    let cut = false;
    srv.st.drop = (req, p) => {
      if (req.headers['sec-fetch-dest'] === 'script' && p.startsWith('/vendor/')) return 503;   // nothing in the browser's own cache
      if (fromWorker(req) && p === '/nps_locations.json') cut = true;
      return cut && fromWorker(req);
    };
    srv.st.site = site(S.current);
    await (await s.launch()).open();
    await until(s.settled, 60000, 'the service worker to activate');
    await until(async () => { const c = (await s.cache(cacheName(S.current))) || []; return vendorPaths(S.current).every(v => c.includes(v)); }, 30000, 'the libraries in the cache although the install was cut at nps_locations.json');
  },
  // After an update cut short (the old cache is kept), offline shows this
  // release, and the next online open finishes the update.
  async 'cut-update-precedence'(s, srv, S) {
    await install(s, srv, S.current);
    let navDropped = false;
    srv.st.site = site(S.next);
    srv.st.drop = (req, p) => {
      if (!navDropped && req.headers['sec-fetch-mode'] === 'navigate') { navDropped = true; return true; }   // the old worker serves its cached page
      return fromWorker(req) && p === '/nps_locations.json';
    };
    await (await s.launch()).open();
    await until(async () => (await s.cacheNames()).length === 2 && await s.settled() && ((await s.cache(cacheName(S.next))) || []).includes('/index.html'), 60000, 'the cut-short update');
    srv.st.drop = null;
    await offlineCheck(s, srv, S.next);
    await srv.setOffline(false);
    await (await s.launch()).open();
    await until(async () => { const k = await s.cacheNames(); return k.length === 1 && k[0] === cacheName(S.next); }, 30000, 'the next online open to retire the old cache');
  },
  // A later release that renames a library, served by this release's worker
  // before its own installs: this worker stores the new file name too.
  async 'future-rename-before-install'(s, srv, S) {
    await install(s, srv, S.current);
    srv.st.site = site(S.renamed); srv.st.blockSw = true;
    await (await s.launch()).open();
    await until(async () => ((await s.cache(cacheName(S.current))) || []).includes(S.renamed.renamedLib), 20000, 'this worker to store ' + S.renamed.renamedLib);
    await offlineCheck(s, srv, S.renamed);
  },
};
// Updating from each baseline release: cut short, and never installed.
function baselineScenarios(S) {
  const out = {};
  for (const b of S.baselines) {
    out['from-' + b.name + '-cut-short'] = async (s, srv) => {
      await install(s, srv, b);
      srv.st.site = site(S.current);
      srv.st.drop = (req, p) => fromWorker(req) && p === '/nps_locations.json';
      await (await s.launch()).open();
      await until(async () => { const c = (await s.cache(cacheName(S.current))) || []; return (await s.settled()) && vendorPaths(S.current).every(v => c.includes(v)); }, 60000, 'the new install to store the libraries');
      srv.st.drop = null;
      await offlineCheck(s, srv, S.current);
    };
    out['from-' + b.name + '-never-installed'] = async (s, srv) => {
      await install(s, srv, b);
      srv.st.site = site(S.current); srv.st.blockSw = true;
      await (await s.launch()).open();
      await until(async () => { for (const k of await s.cacheNames()) { const t = await s.page().evaluate(async k => { const m = await (await caches.open(k)).match('/index.html'); return m ? m.text() : ''; }, k); if (t.includes(`const APP_VERSION = '${S.current.version}'`)) return true; } return false; }, 20000, 'the old worker to keep the new page');
      await offlineCheck(s, srv, S.current);
    };
  }
  return out;
}

// ---- checks without a browser ----
async function staticChecks(S) {
  const errs = [];
  // The service worker's hashes are the files' hashes, and its list is the page's.
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const listed = Object.fromEntries([...sw.matchAll(/'\.\/(vendor\/[^']+)': '(sha256-[^']+)'/g)].map(m => [m[1], m[2]]));
  for (const [f, h] of Object.entries(listed)) if (!fs.existsSync(path.join(ROOT, f)) || sha(path.join(ROOT, f)) !== h) errs.push(`sw.js hash for ${f} does not match the file`);
  const tags = S.current.libs;
  if (tags.slice().sort().join() !== Object.keys(listed).sort().join()) errs.push(`index.html loads ${tags.join(', ')} but sw.js lists ${Object.keys(listed).join(', ')}`);
  // Every same-origin library name any release has used is still served, with a
  // current library's bytes, and only the versioned .js files are immutable.
  const srv = await startServer(); srv.st.site = site(S.current);
  const get = p => new Promise((r, j) => http.get(srv.base + p, res => { const b = []; res.on('data', d => b.push(d)); res.on('end', () => r({ status: res.statusCode, type: res.headers['content-type'], cc: res.headers['cache-control'], body: Buffer.concat(b) })); }).on('error', j));
  try {
    const current = new Set(fs.readdirSync(path.join(ROOT, 'vendor')).filter(f => f.endsWith('.js')).map(f => sha(path.join(ROOT, 'vendor', f))));
    const everUsed = new Set(tags.filter(u => u.startsWith('vendor/')).map(u => '/' + u));
    for (const h of git('log', '--format=%H', '--', 'index.html').toString().trim().split('\n').filter(Boolean)) for (const u of libsOf(git('show', `${h}:index.html`))) if (u.startsWith('vendor/')) everUsed.add('/' + u);
    const legacy = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/data-legacy="([^"]+)"/g)].map(m => '/' + m[1]);
    for (const u of new Set([...everUsed, ...legacy])) {
      const r = await get(u);
      const h = 'sha256-' + crypto.createHash('sha256').update(r.body).digest('base64');
      if (r.status !== 200 || !/javascript/.test(r.type || '') || !current.has(h)) errs.push(`${u} (used by an earlier release) is not served as a current library: ${r.status} ${r.type}`);
    }
    for (const u of vendorPaths(S.current)) { const r = await get(u); if (!/immutable/.test(r.cc || '')) errs.push(u + ' is not served as immutable'); }
    for (const u of ['/vendor/README.md', '/vendor/LICENSE-docx.txt']) { const r = await get(u); if (r.status !== 200 || /immutable/.test(r.cc || '')) errs.push(u + ' is missing or served as immutable (its name carries no version)'); }
    { const u = vendorPaths(S.current)[0]; const r = await get(u.replace(/\.js$/, '.JS')); if (r.status !== 404) errs.push('a wrong-case library name is served (Azure would 404)'); }
  } finally { await srv.setOffline(true); }
  if (errs.length) throw new Error(errs.join('; '));
}

// ---- the messages, the bars, the toasts, without a service worker ----
async function messages(engine, srv, S) {
  srv.st.site = site(S.current);
  const b = await pw[engine].launch();
  const errs = [];
  const open = async (width, cut, decline) => {
    const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width, height: 1000 } });
    const page = await ctx.newPage(); const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); (decline && d.type() === 'confirm') ? d.dismiss() : d.accept(); });
    if (cut) await ctx.route(u => new URL(u).pathname.startsWith('/vendor/' + cut), r => r.abort());
    await page.goto(srv.base + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof tgLoaded !== 'undefined' && tgLoaded, null, { timeout: 30000 });
    return { ctx, page, dialogs };
  };
  const toastOf = page => page.evaluate(() => { const t = document.getElementById('toast'), r = t.getBoundingClientRect(); return { text: t.textContent, cls: t.className, fits: r.left >= 0 && r.right <= innerWidth }; });
  const barFits = page => page.evaluate(() => [...document.querySelectorAll('#bottomActions button')].filter(b => b.offsetParent).every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  const note = () => savedEntries.push({ id: 'test', timestamp: new Date().toISOString(), photos: {}, score: NOTE, details: 'a note' });
  try {
    for (const cut of ['jszip', 'exceljs', 'docx']) {
      const { ctx, page, dialogs } = await open(320, cut);
      const r = await page.evaluate(async ([cut, noteSrc]) => {
        const toast = () => document.getElementById('toast').textContent;
        const res = { bar: document.getElementById('appVersion').textContent };
        (new Function(noteSrc))(); exportDateMode = 'all';
        window.__got = {}; window.shareOrDownload = async (blob, name) => { window.__got[name] = blob; return true; };
        if (cut !== 'docx') { await runExport(); res.export = toast(); }
        if (cut === 'exceljs') { await handlePriorFile({ target: { files: [new File(['x'], 'p.xlsx')] } }); res.prior = toast(); }
        if (cut === 'jszip') { await handleTankFile({ target: { files: [new File(['x'], 't.docx')] } }); res.tank = toast(); }
        if (cut === 'docx') {
          await generateWordReport(); res.word = toast();
          await runExport(); res.export = toast();
          const zipName = Object.keys(window.__got).find(n => n.endsWith('.zip'));
          res.inZip = zipName ? Object.keys((await JSZip.loadAsync(window.__got[zipName])).files) : [];
        }
        // "updating…" with a library missing: the warning shows, and the bar still fits.
        await caches.open('nps-collector-v0.1'); _versionTries = 0; paintVersion();
        await new Promise(r => setTimeout(r, 300)); res.barUpdating = document.getElementById('appVersion').textContent;
        return res;
      }, [cut, `(${note.toString()})()`]);
      r.barFits = await barFits(page);
      await page.evaluate(() => caches.delete('nps-collector-v0.1'));
      const want = (k, re) => { if (!re.test(r[k] || '')) errs.push(`${cut}/${k}: ${JSON.stringify(r[k])}`); };
      want('bar', /export library missing/); want('barUpdating', /export library missing/);
      if (!r.barFits) errs.push(cut + ': the bottom-bar buttons run off a 320 px screen');
      if (cut !== 'docx') want('export', /^Export library didn’t load — connect to the internet, then try again/);
      if (cut === 'jszip') want('tank', /^Import library didn’t load/);
      if (cut === 'exceljs') want('prior', /^Excel library didn’t load/);
      if (cut === 'docx') {
        want('word', /^Word library didn’t load/);
        if (!dialogs.some(d => /will NOT include the Notes document/.test(d))) errs.push('docx: no confirmation before exporting without the Word files: ' + JSON.stringify(dialogs));
        if (!(r.inZip || []).includes('MISSING_WORD_FILES.txt')) errs.push('docx: the ZIP does not say the Word files are missing: ' + JSON.stringify(r.inZip));
        want('export', /without the Notes document/);
      }
      await ctx.close();
    }
    // Declining the confirmation ships nothing.
    {
      const { ctx, page } = await open(744, 'docx', true);
      const r = await page.evaluate(async noteSrc => {
        (new Function(noteSrc))(); exportDateMode = 'all';
        let sent = 0; window.shareOrDownload = async () => { sent++; return true; };
        await runExport(); return { sent, toast: document.getElementById('toast').textContent };
      }, `(${note.toString()})()`);
      if (r.sent || !/cancelled/.test(r.toast)) errs.push('declining the Word-files confirmation still exported: ' + JSON.stringify(r));
      await ctx.close();
    }
    // A Word document that fails to build is asked about the same way.
    {
      const { ctx, page, dialogs } = await open(744);
      const r = await page.evaluate(async noteSrc => {
        window.buildNotesDocx = async () => { throw new Error('boom'); };
        (new Function(noteSrc))(); exportDateMode = 'all';
        const got = {}; window.shareOrDownload = async (blob, name) => { got[name] = blob; return true; };
        await runExport();
        const zipName = Object.keys(got).find(n => n.endsWith('.zip'));
        return { inZip: zipName ? Object.keys((await JSZip.loadAsync(got[zipName])).files) : [], toast: document.getElementById('toast').textContent };
      }, `(${note.toString()})()`);
      if (!dialogs.some(d => /could not be built/.test(d)) || !r.inZip.includes('MISSING_WORD_FILES.txt')) errs.push('a failed Notes document was not asked about or recorded: ' + JSON.stringify({ dialogs, r }));
      await ctx.close();
    }
    // A library that failed at load arrives once the signal is back, without a reload.
    {
      const { ctx, page } = await open(744, 'jszip');
      await ctx.unrouteAll({ behavior: 'ignoreErrors' });
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      try { await page.waitForFunction(() => typeof JSZip !== 'undefined' && !/missing/.test(document.getElementById('appVersion').textContent), null, { timeout: 10000 }); }
      catch (e) { errs.push('the page did not load the missing library when the signal came back'); }
      await ctx.close();
    }
    // Toasts: they fit, stay up long enough (capped), a warning fades in its own
    // colour, an older timer never hides a newer toast, and a routine reminder
    // waits its turn.
    {
      const { ctx, page } = await open(744);
      await page.evaluate(m => showToast(m, true), 'Exported 40 entries, 120 photos — without the Notes document and the LOC site forms');
      if (!(await toastOf(page)).fits) errs.push('the longest toast runs off a 744 px screen');
      await sleep(3200);
      if (!(await toastOf(page)).cls.includes('show')) errs.push('a long toast was gone after 3 s');
      await page.evaluate(() => { showToast('first'); setTimeout(() => showToast('⚠ second, and long enough to need more than two and a half seconds on screen', true), 1500); });
      await sleep(3000);
      if (!(await toastOf(page)).cls.includes('show')) errs.push("an earlier toast's timer hid a newer one");
      const delays = await page.evaluate(() => { const seen = []; const orig = window.setTimeout; window.setTimeout = (f, ms) => { seen.push(ms); return orig(f, ms); }; showToast('x'.repeat(2000)); window.setTimeout = orig; return seen; });
      if (Math.max(...delays) > 10000) errs.push('a very long toast stays up more than 10 s: ' + delays);
      await page.evaluate(() => { showToast('⚠ the important one', true); showToast('⚠ Storage 80% full — export soon', true, true); });
      if ((await toastOf(page)).text !== '⚠ the important one') errs.push('a routine reminder replaced a warning on screen');
      const hidden = await page.evaluate(() => new Promise(r => { const t = document.getElementById('toast'); t.addEventListener('transitionstart', () => r(t.className), { once: true }); setTimeout(() => r('no fade: ' + t.className), 11000); }));
      if (!/toast-warn/.test(hidden) || /show/.test(hidden)) errs.push('a warning does not fade out in its own colour: ' + hidden);
      await page.waitForFunction(() => /Storage 80%/.test(document.getElementById('toast').textContent) && document.getElementById('toast').classList.contains('show'), null, { timeout: 5000 })
        .catch(() => errs.push('the waiting storage reminder never showed'));
      const ios = await page.evaluate(() => { window.Capacitor = { isNativePlatform: () => true }; const a = libraryAdvice(); delete window.Capacitor; return a; });
      if (ios !== 'update the app') errs.push('iOS advice: ' + ios);
      await ctx.close();
    }
    // The header fits every iPad width, portrait and landscape, and phones: no
    // sideways scroll, every button on screen, and the title never under them.
    for (const w of [320, 375, 744, 768, 820, 834, 1024, 1133, 1180, 1194]) {
      const { ctx, page } = await open(w);
      const r = await page.evaluate(() => {
        const vis = e => e.offsetParent && e.getBoundingClientRect().width > 0;
        const btns = [...document.querySelectorAll('.header-actions > button, .header-actions .overflow-btn')].filter(vis).map(b => b.getBoundingClientRect());
        const title = [...document.querySelectorAll('.header > div:first-child > *')].filter(vis).map(e => e.getBoundingClientRect());
        const actions = document.querySelector('.header-actions').getBoundingClientRect();
        const titleRight = Math.max(...title.map(t => t.right)), titleBottom = Math.max(...title.map(t => t.bottom));
        return { over: document.documentElement.scrollWidth - innerWidth, offscreen: btns.filter(b => b.left < 0 || b.right > innerWidth).length,
          overlap: titleRight > actions.left + 1 && titleBottom > actions.top + 1 };
      });
      if (r.over > 0) errs.push(`at ${w} px the page scrolls sideways by ${r.over} px`);
      if (r.offscreen) errs.push(`at ${w} px ${r.offscreen} header button(s) are off screen`);
      if (r.overlap) errs.push(`at ${w} px the header title runs under its buttons`);
      await ctx.close();
    }
  } finally { await b.close(); }
  if (errs.length) throw new Error(errs.join('; '));
}

// ---- run ----
async function pool(items, n, fn) {
  const q = items.slice(); const workers = [];
  for (let i = 0; i < n; i++) workers.push((async () => { while (q.length) await fn(q.shift()); })());
  await Promise.all(workers);
}
(async () => {
  let S;
  try { S = buildSnapshots(); } catch (e) { console.log('FAIL  snapshots — ' + e.message); cleanup(); process.exit(1); }
  console.log(`current v${S.current.version}; baselines: ${S.baselines.map(b => b.name).join(', ') || 'none (a shallow clone?)'}`);
  let failed = 0, skipped = 0;
  const report = (status, engine, name, note) => {
    if (status === 'FAIL') failed++;
    if (status === 'SKIP') skipped++;
    console.log(`${status}  ${engine}  ${name}${note ? ' — ' + note : ''}`);
  };
  try { await staticChecks(S); report('PASS', '-', 'static-checks'); } catch (e) { report('FAIL', '-', 'static-checks', e.message); }
  if (!S.baselines.length) report(STRICT ? 'FAIL' : 'SKIP', '-', 'update-from-earlier-releases', 'no earlier release in git history (a shallow clone needs fetch-depth: 0)');
  const all = Object.entries(Object.assign({}, SCENARIOS, baselineScenarios(S))).concat([['messages', null]]);
  await Promise.all(ENGINES.map(engine => pool(all, POOL, async ([name, fn]) => {
    if (!pw[engine]) { report('FAIL', engine, name, 'no such engine'); return; }
    let srv = null, s = null;
    try {
      srv = await startServer();
      if (fn) { s = await session(engine, srv); await fn(s, srv, S); }
      else await messages(engine, srv, S);
      report('PASS', engine, name);
    } catch (e) {
      report('FAIL', engine, name, e.message.split('\n')[0]);
    } finally {
      if (s) { await s.close().catch(() => {}); fs.rmSync(s.dir, { recursive: true, force: true }); }
      if (srv) await srv.setOffline(true).catch(() => {});
    }
  })));
  cleanup();
  console.log(failed ? `${failed} failed` : skipped ? `all that ran passed (${skipped} skipped)` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); cleanup(); process.exit(1); });
