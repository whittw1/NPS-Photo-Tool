# Porting to the USFS Photo Collector

The NPS and USFS photo collectors keep shared code textually identical so fixes
copy across cleanly. This file lists the NPS changes to shared code that the
USFS app does not have yet, newest last. Copy the marked blocks **as is**; where
USFS differs (its service worker, its data file names), the note says so.
Remove a section here once USFS has it.

Background: NPS v4.7 bundled the export libraries in `vendor/` (USFS did the
same in c460fc6). Reviews then found that an update on bad signal could leave
the web app unable to export offline, that the "restart the app" advice didn't
work, that the iOS build shipped without the libraries' licences, and more.
NPS v4.8 and v4.9 fix them. `tests/offline.test.js` in the NPS repo shows each
scenario.

## 1. Library file names carry their version (NPS v4.8)

```sh
git mv vendor/jszip.min.js vendor/jszip-3.10.1.min.js
git mv vendor/exceljs.min.js vendor/exceljs-4.4.0.min.js
```

`index.html` `<head>` (NPS also has a docx line):

```html
<script src="vendor/jszip-3.10.1.min.js"></script>
<script src="vendor/exceljs-4.4.0.min.js"></script>
```

Update `URLS_TO_CACHE` in `sw.js` and the names in `vendor/README.md` to match.
Never edit a vendored file in place again: an upgrade is a new file name.

## 2. Library messages that give advice that works (NPS v4.8, v4.9)

After `showToast` (section 3), paste:

```js
// The export libraries ship with the app (vendor/). On the web a missing one
// means the offline copy is not complete yet: it fills in the next time the app
// opens with signal. In the iOS build it means a broken bundle.
function libraryAdvice() {
  return isNativeApp() ? 'update the app' : 'open the app once with signal, then try again';
}
function libraryMissing(name) {
  showToast(name + ' library didn\u2019t load \u2014 ' + libraryAdvice(), true);
}
```

Replace the export guard (USFS index.html ~2606) with:

```js
  if (typeof ExcelJS === 'undefined' || typeof JSZip === 'undefined') { libraryMissing('Export'); return; }
```

Route any other "didn't load" message through `libraryMissing('<name>')`.

## 3. Toasts wrap inside the screen and stay up long enough (NPS v4.9)

In the `.toast` CSS, replace `white-space: nowrap;` so the rule reads:

```css
  .toast {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--success);
    color: white;
    padding: 12px 24px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 14px;
    z-index: 300;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
    width: max-content;
    max-width: calc(100vw - 32px);
    text-align: center;
  }
```

and replace `showToast` with:

```js
let _toastTimer = 0;
function showToast(msg, isWarn = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show' + (isWarn ? ' toast-warn' : '');
  // A long message stays up long enough to read, and an earlier toast's timer
  // never hides a newer one.
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, Math.max(2500, String(msg).length * 50));
}
```

## 4. One native-app check (NPS v4.9)

Replace the first lines of `fsPlugin` with:

```js
function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
function fsPlugin() {
  if (!isNativeApp()) return null;
```

## 5. `package.json` build (NPS v4.8)

Keeping USFS's own data file names:

```json
"build": "rm -rf www/vendor && mkdir -p www/vendor && cp index.html sw.js manifest.json team_guide_citations.json forest_locations.json www/ && cp vendor/*.js vendor/LICENSE-* www/vendor/",
```

This creates `www/` on a fresh clone, clears stale library files, and ships the
licence files in the iOS bundle.

## 6. `staticwebapp.config.json` (NPS v4.8, v4.9)

- A route `"/vendor/*.js"` with `"Cache-Control": "public, max-age=31536000, immutable"`
  (the `.js` files only: README and licence names carry no version).
- Before it, one rewrite per old name, for pages from before the rename that
  are still running, for example
  `{ "route": "/vendor/jszip.min.js", "rewrite": "/vendor/jszip-3.10.1.min.js" }`.
- Add `"/vendor/*"` to `navigationFallback.exclude`, so a missing library is a
  404, never the app page.

## 7. The Xcode build refuses a stale web copy (NPS v4.9)

Copy `ios/check-web-copy.sh` unchanged: it reads the file list from
`package.json`'s build script. Then add a Run Script build phase, first in the App
target: shell `/bin/sh`, script `sh "$SRCROOT/../check-web-copy.sh"`, "Based on
dependency analysis" off. See the NPS `project.pbxproj`, object
`A7C3E1F20B4D5E6F708192A3`.

## 8. USFS-specific: `sw.js`

USFS's worker is not the NPS one (no portal checks, and an all-or-nothing
`cache.addAll` install), so nothing here is a paste. The changes that matter:

1. `URLS_TO_CACHE`: the new file names, placed before the large locations file.
2. First in the fetch handler, after `const url = …`:
   `if (url.origin !== self.location.origin) return;`
3. In the cache-first branch, store any library under `/vendor/` fetched on a
   cache miss. This covers a later release renaming a library, served by the
   old worker before the new one installs:
   ```js
   event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
     if (url.pathname.startsWith('/vendor/') && url.pathname.endsWith('.js') && response.ok
         && !response.redirected && !/html/i.test(response.headers.get('content-type') || '')) {
       const copy = response.clone();
       event.waitUntil(caches.open(CACHE_NAME).then(c => c.put(event.request, copy)));
     }
     return response;
   })));
   ```
4. Optional: `addAll` downloads every library again on each release. NPS
   installs file by file and copies a library an older cache already holds
   (`reuseLibrary` in the NPS `sw.js`).

## 9. Docs

`WEB_TO_TESTFLIGHT_PLAYBOOK.md` in USFS has the stale lines NPS fixed: "CDN-loaded
is fine" (line 20), "(from cdnjs)" (35-36), "Service worker" as the offline
support for iOS (38), the example `build` script, "CDN libs: cache-first" (162),
and a "Manual sync" `npx cap sync ios` (251-252). Copy the NPS version of those
lines.
