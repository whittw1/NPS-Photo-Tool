'use strict';
// Offline-export regression tests for the web app: service worker, host config
// and the bundled libraries. Run `npm test` (both engines) or
// `ENGINES=webkit npm test`. Needs the playwright dev dependency and its
// browsers (`npx playwright install chromium webkit`); Chrome and Safari on an
// iPad both run WebKit.
//
// Each scenario serves snapshots of the app under the Static Web App's rules
// from that snapshot's staticwebapp.config.json (route headers, rewrites, the
// navigation fallback), drives a persistent browser profile ("relaunch" closes
// and reopens it, like reopening the app) and cuts the network by resetting
// connections. Snapshots:
//   current   the working tree
//   previous  the latest commit whose sw.js has a different CACHE_NAME
//   next      the working tree with the version bumped (a later release)
//   renamed   next with JSZip under a new file name (a library upgrade)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { execFileSync } = require('child_process');
const pw = require('playwright');

const ROOT = path.join(__dirname, '..');
const FILES = ['index.html', 'sw.js', 'manifest.json', 'envirocheck_checklists.json', 'nps_locations.json', 'staticwebapp.config.json'];
const SHELL = 5;   // cached besides the libraries: '/', index.html, manifest.json and the two data files
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nps-offline-test-'));
const ENGINES = (process.env.ENGINES || 'chromium,webkit').split(',');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- snapshots ----
const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 64 << 20 });
const versionOf = sw => (String(sw).match(/const CACHE_NAME = 'nps-collector-v([\d.]+)'/) || [])[1];
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(from, f), path.join(to, f));
  fs.cpSync(path.join(from, 'vendor'), path.join(to, 'vendor'), { recursive: true });
  return to;
}
function edit(dir, file, from, to) {
  const p = path.join(dir, file), s = fs.readFileSync(p, 'utf8');
  if (!s.includes(from)) throw new Error(`${file}: "${from}" not found`);
  fs.writeFileSync(p, s.split(from).join(to));
}
function bump(dir, from, to) {
  edit(dir, 'sw.js', `'nps-collector-v${from}'`, `'nps-collector-v${to}'`);
  edit(dir, 'index.html', `const APP_VERSION = '${from}';`, `const APP_VERSION = '${to}';`);
}
function buildSnapshots() {
  const cur = versionOf(fs.readFileSync(path.join(ROOT, 'sw.js')));
  const snaps = { current: { dir: copyTree(ROOT, path.join(TMP, 'current')), version: cur } };
  let prevRef = null, prevVer = null;
  for (const h of git('log', '--format=%H', '--', 'sw.js').toString().trim().split('\n')) {
    const v = versionOf(git('show', `${h}:sw.js`));
    if (v && v !== cur) { prevRef = h; prevVer = v; break; }
  }
  if (prevRef) {
    const dir = path.join(TMP, 'previous'); fs.mkdirSync(dir);
    const tar = path.join(TMP, 'previous.tar');
    fs.writeFileSync(tar, git('archive', prevRef, ...FILES, 'vendor'));
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    snaps.previous = { dir, version: prevVer, ref: prevRef.slice(0, 7) };
  }
  const next = String(Number(cur.split('.')[0]) + 90) + '.0';
  snaps.next = { dir: copyTree(ROOT, path.join(TMP, 'next')), version: next };
  bump(snaps.next.dir, cur, next);
  const ren = copyTree(snaps.next.dir, path.join(TMP, 'renamed'));
  const lib = fs.readdirSync(path.join(ren, 'vendor')).find(f => /^jszip-.*\.js$/.test(f));
  const renamed = lib.replace(/\.min\.js$|\.js$/, '-upgraded$&');
  fs.renameSync(path.join(ren, 'vendor', lib), path.join(ren, 'vendor', renamed));
  edit(ren, 'index.html', `vendor/${lib}`, `vendor/${renamed}`);
  edit(ren, 'sw.js', `./vendor/${lib}`, `./vendor/${renamed}`);
  snaps.renamed = { dir: ren, version: next, renamedLib: '/vendor/' + renamed };
  return snaps;
}

// ---- a small Static Web App: routes, rewrites, fallback, global headers ----
const glob = g => new RegExp('^' + g.replace(/[.+?^$()|[\]\\]/g, '\\$&').replace(/\{([^}]*)\}/g, (_, a) => '(?:' + a.split(',').join('|') + ')').replace(/\*/g, '.*') + '$');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain' };
function site(snap) {
  const cfg = JSON.parse(fs.readFileSync(path.join(snap.dir, 'staticwebapp.config.json'), 'utf8'));
  return { ...snap, cfg, etag: `"${snap.version}"` };
}
// "Offline" stops the server listening, so every connection is refused at once,
// as with no signal; a dropped download resets one connection mid-install.
function startServer() {
  const st = { site: null, blockSw: false, drop: null, vendorHits: 0 };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith('/vendor/')) st.vendorHits++;
    if ((p === '/sw.js' && st.blockSw) || (st.drop && st.drop(req, p))) { req.socket.destroy(); return; }
    const cfg = st.site.cfg;
    const route = (cfg.routes || []).find(r => glob(r.route).test(p));
    if (route && route.rewrite) p = route.rewrite;
    if (p === '/') p = '/index.html';
    let file = path.join(st.site.dir, p), status = 200, headers = Object.assign({}, cfg.globalHeaders, route && route.headers);
    if (!file.startsWith(st.site.dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const fb = cfg.navigationFallback;
      if (!fb || (fb.exclude || []).some(x => glob(x).test(p))) { res.writeHead(404, Object.assign({ 'content-type': 'text/html' }, cfg.globalHeaders)); res.end('Not found'); return; }
      file = path.join(st.site.dir, fb.rewrite); headers = Object.assign({}, cfg.globalHeaders);
    }
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (!lower['cache-control']) lower['cache-control'] = 'public, must-revalidate, max-age=30';
    if (!lower['content-type']) lower['content-type'] = TYPES[path.extname(file)] || 'application/octet-stream';
    lower.etag = st.site.etag;
    if (req.headers['if-none-match'] === st.site.etag) { res.writeHead(304, lower); res.end(); return; }
    const body = fs.readFileSync(file);
    res.writeHead(status, Object.assign(lower, { 'content-length': body.length }));
    res.end(body);
  });
  const sockets = new Set();
  server.on('connection', c => { sockets.add(c); c.on('close', () => sockets.delete(c)); });
  return new Promise(r => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const srv = { st, server, base: `http://127.0.0.1:${port}`, offline: false };
    srv.setOffline = on => new Promise(done => {
      if (on === srv.offline) return done();
      srv.offline = on;
      if (on) { server.close(() => done()); sockets.forEach(c => c.destroy()); }
      else server.listen(port, '127.0.0.1', done);
    });
    r(srv);
  }));
}
const installFetch = test => (req, p) => req.headers.pragma === 'no-cache' && test(p);   // cache:'reload'

// ---- one browser profile per scenario ----
async function session(engine, srv) {
  const dir = fs.mkdtempSync(path.join(TMP, engine + '-profile-'));
  let ctx = null, page = null;
  const s = {
    async launch() {
      if (ctx) await ctx.close();
      ctx = await pw[engine].launchPersistentContext(dir, { serviceWorkers: 'allow' });
      page = ctx.pages()[0] || await ctx.newPage();
      page.on('dialog', d => d.accept());
      return s;
    },
    async open(p = '/index.html') { await page.goto(srv.base + p, { waitUntil: 'load', timeout: 60000 }); return s; },
    page: () => page,
    close: () => ctx && ctx.close(),
    libs: () => page.evaluate(() => ({ JSZip: typeof JSZip, ExcelJS: typeof ExcelJS, docx: typeof docx, app: APP_VERSION, bar: document.getElementById('appVersion').textContent })),
    cache: name => page.evaluate(async n => (await caches.has(n)) ? (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname) : null, name),
    cacheNames: () => page.evaluate(() => caches.keys()),
    settled: () => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active && r.active.state === 'activated' && !r.installing && !r.waiting); }),
  };
  return s;
}
async function until(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch (e) { /* page busy */ } await sleep(300); }
  throw new Error('timed out waiting for ' + what);
}
const cacheName = snap => 'nps-collector-v' + snap.version;
const LIBS = s => fs.readdirSync(path.join(s.dir, 'vendor')).filter(f => f.endsWith('.js')).map(f => '/vendor/' + f);
async function install(s, srv, snap, want) {
  srv.st.site = site(snap);
  await (await s.launch()).open();
  await until(s.settled, 45000, 'the service worker to activate');
  await until(async () => ((await s.cache(cacheName(snap))) || []).length >= want, 90000, `${want} files in ${cacheName(snap)}`);
}
function libsLoaded(l) { if (l.JSZip === 'undefined' || l.ExcelJS === 'undefined' || l.docx === 'undefined') throw new Error('libraries missing offline: ' + JSON.stringify(l)); }

// A finding with a photo, then the ZIP export and the Word Report, both captured in the page.
// Generous waits: the 4 MB location file parses slowly when both engines run at once.
const step = (page, fn, what) => page.waitForFunction(fn, null, { timeout: 90000 }).catch(e => { throw new Error('offline export: ' + what + ' — ' + e.message.split('\n')[0]); });
async function exportWorks(page) {
  await step(page, () => typeof forestData !== 'undefined' && Object.keys(forestData).length > 400 && tgLoaded, 'park and question data never loaded');
  await page.selectOption('#regionSelect', 'NER — Northeast');
  await page.selectOption('#forestSelect', 'Acadia National Park');
  await page.fill('#tgSearch', 'used oil label');
  await page.waitForSelector('#tgResults .tg-item');
  await page.click('#tgResults .tg-item');
  await page.fill('#entryDetails', 'offline test');
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
async function offlineCheck(s, srv) {
  await srv.setOffline(true);
  await (await s.launch()).open();
  libsLoaded(await s.libs());
  await exportWorks(s.page());
}

// ---- scenarios ----
const SCENARIOS = {
  // A fresh install works with no signal.
  async fresh(s, srv, S) {
    await install(s, srv, S.current, SHELL + LIBS(S.current).length);
    await offlineCheck(s, srv);
  },
  // Library downloads dropped during the install: one online open completes the copy.
  async 'dropped-downloads'(s, srv, S) {
    srv.st.drop = installFetch(p => p.startsWith('/vendor/'));
    await install(s, srv, S.current, SHELL);
    await srv.setOffline(true);
    await (await s.launch()).open();
    const l = await s.libs();
    if (l.JSZip === 'undefined' && !/export library missing/.test(l.bar)) throw new Error('bar does not flag the missing library: ' + l.bar);
    await srv.setOffline(false); srv.st.drop = null;
    await (await s.launch()).open();
    await until(async () => (await s.cache(cacheName(S.current))).filter(p => p.startsWith('/vendor/')).length === LIBS(S.current).length, 30000, 'the libraries to be stored on the online open');
    await offlineCheck(s, srv);
  },
  // An upgrade reuses the libraries it already holds instead of downloading them.
  async 'upgrade-reuses-libraries'(s, srv, S) {
    await install(s, srv, S.current, SHELL + LIBS(S.current).length);
    srv.st.site = site(S.next); srv.st.vendorHits = 0;
    srv.st.drop = (req, p) => p.startsWith('/vendor/');
    await (await s.launch()).open();
    await until(async () => { const k = await s.cacheNames(); return k.length === 1 && k[0] === cacheName(S.next); }, 60000, 'the upgrade to replace the old cache');
    const held = (await s.cache(cacheName(S.next))).filter(p => p.startsWith('/vendor/'));
    if (held.length !== LIBS(S.next).length) throw new Error('libraries not carried into the new cache: ' + held);
    if (srv.st.vendorHits) throw new Error(srv.st.vendorHits + ' library downloads during the upgrade');
    srv.st.drop = null;
    await offlineCheck(s, srv);
  },
  // The update from the previous release, cut short before the data file.
  async 'from-previous-cut-short'(s, srv, S) {
    if (!S.previous) return 'skipped (no previous release in git history)';
    await install(s, srv, S.previous, SHELL + LIBS(S.previous).length);
    srv.st.site = site(S.current);
    srv.st.drop = installFetch(p => p === '/nps_locations.json');
    await (await s.launch()).open();
    await until(async () => ((await s.cache(cacheName(S.current))) || []).filter(p => p.startsWith('/vendor/')).length === LIBS(S.current).length, 60000, 'the new install to store the libraries');
    await offlineCheck(s, srv);
  },
  // The update from the previous release whose worker never installs.
  async 'from-previous-never-installed'(s, srv, S) {
    if (!S.previous) return 'skipped (no previous release in git history)';
    await install(s, srv, S.previous, SHELL + LIBS(S.previous).length);
    srv.st.site = site(S.current); srv.st.blockSw = true;
    await (await s.launch()).open();
    await sleep(3000);
    await offlineCheck(s, srv);
  },
  // A later release that renames a library, served by this release's worker
  // before its own installs: this worker must store the new file name too.
  async 'future-rename-before-install'(s, srv, S) {
    await install(s, srv, S.current, SHELL + LIBS(S.current).length);
    srv.st.site = site(S.renamed); srv.st.blockSw = true;
    await (await s.launch()).open();
    await until(async () => (await s.cache(cacheName(S.current))).includes(S.renamed.renamedLib), 20000, 'this worker to store ' + S.renamed.renamedLib);
    await offlineCheck(s, srv);
  },
};

// The messages, the bottom bar and the toast width, without a service worker.
async function messages(engine, srv, S) {
  srv.st.site = site(S.current);
  const b = await pw[engine].launch();
  const out = [];
  try {
    for (const cut of ['none', 'jszip', 'exceljs', 'docx']) {
      const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 744, height: 1133 } });   // iPad mini, portrait
      const page = await ctx.newPage(); page.on('dialog', d => d.accept());
      if (cut !== 'none') await page.route(u => new URL(u).pathname.startsWith('/vendor/' + cut), r => r.abort());
      await page.goto(srv.base + '/index.html', { waitUntil: 'load' });
      const r = await page.evaluate(async cut => {
        const toast = () => { const t = document.getElementById('toast'), b = t.getBoundingClientRect(); return { text: t.textContent, fits: b.left >= 0 && b.right <= innerWidth }; };
        const res = { bar: document.getElementById('appVersion').textContent };
        const Q = (k, v) => { res[k] = v; };
        savedEntries.push({ id: 'test', timestamp: new Date().toISOString(), photos: {} }); exportDateMode = 'all';
        if (cut === 'jszip' || cut === 'exceljs') { await runExport(); Q('export', toast()); }
        if (cut === 'exceljs') { await handlePriorFile({ target: { files: [new File(['x'], 'p.xlsx')] } }); Q('prior', toast()); }
        if (cut === 'jszip') { await handleTankFile({ target: { files: [new File(['x'], 't.docx')] } }); Q('tank', toast()); }
        if (cut === 'docx') {
          await generateWordReport(); Q('word', toast());
          // While the bar says "updating…" (a cache from another release only), the warning stays.
          await caches.open('nps-collector-v0.1'); _versionTries = 0; paintVersion();
          await new Promise(r => setTimeout(r, 500)); Q('barUpdating', document.getElementById('appVersion').textContent);
          await caches.delete('nps-collector-v0.1');
        }
        showToast('Exported 40 entries, 120 photos — Word files left out: Word library didn’t load (' + libraryAdvice() + ')', true); Q('longest', toast());
        window.Capacitor = { isNativePlatform: () => true }; Q('ios', libraryAdvice()); delete window.Capacitor;
        return res;
      }, cut);
      out.push([cut, r]);
      await ctx.close();
    }
  } finally { await b.close(); }
  const errs = [];
  const want = (c, k, re) => { const r = out.find(o => o[0] === c)[1]; const v = r[k] && (r[k].text || r[k]); if (!re.test(v || '')) errs.push(`${c}/${k}: ${JSON.stringify(v)}`); };
  want('none', 'bar', /^v[\d.]+$/);
  for (const c of ['jszip', 'exceljs', 'docx']) want(c, 'bar', /export library missing/);
  want('jszip', 'export', /^Export library didn’t load — open the app once with signal/);
  want('jszip', 'tank', /^Import library didn’t load/);
  want('exceljs', 'prior', /^Excel library didn’t load/);
  want('docx', 'word', /^Word library didn’t load/);
  want('docx', 'barUpdating', /updating….*export library missing/);
  for (const [c, r] of out) { if (!r.longest.fits) errs.push(c + ': the longest toast runs off a 744 px screen'); if (r.ios !== 'update the app') errs.push(c + ': iOS advice ' + r.ios); }
  if (errs.length) throw new Error(errs.join('; '));
}

(async () => {
  const S = buildSnapshots();
  console.log(`current v${S.current.version}` + (S.previous ? `, previous v${S.previous.version} (${S.previous.ref})` : ', no previous release'));
  let failed = 0;
  await Promise.all(ENGINES.map(async engine => {
    for (const [name, fn] of Object.entries(SCENARIOS).concat([['messages', null]])) {
      const srv = await startServer(); let s = null;
      try {
        let note;
        if (fn) { s = await session(engine, srv); note = await fn(s, srv, S); }
        else await messages(engine, srv, S);
        console.log(`${note ? 'SKIP' : 'PASS'}  ${engine}  ${name}${note ? ' — ' + note : ''}`);
      } catch (e) {
        failed++; console.log(`FAIL  ${engine}  ${name} — ${e.message.split('\n')[0]}`);
      } finally {
        if (s) await s.close().catch(() => {});
        await srv.setOffline(true);
      }
    }
  }));
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
