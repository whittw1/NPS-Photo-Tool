# Porting to the USFS Photo Collector

The NPS and USFS photo collectors share most of their code: photo storage, the
service worker, autosave, the export pipeline and the search engine. That code
is meant to stay textually identical, so that a fix copies across cleanly. This
file lists the NPS changes to shared code that USFS does not have yet.

The steps are **in the order to apply them**: each step works once the ones
above it are in. For each one, copy the NPS code for the functions and rules it
names. Where USFS differs by design (its data files, its names, its title), the
step says so. Remove a step once USFS has it.

To see what is left, run `node scripts/sibling-diff.js` (with `USFS-Photo-Tool`
beside this folder). It lists every function both apps define whose code
differs, before and after porting. Some differences are agency-specific on
purpose: the region, forest and park pickers, citations and scoring. Every
other name it prints is a fix still to port.

## 1. Photo storage survives WebKit dropping its connection (NPS v4.6, 571d841)

**Problem.** WebKit (Safari, and Chrome on an iPad) can close an IndexedDB
connection while the app is in the background. USFS's `openPhotoDB()` keeps the
dead connection, so every photo reads as missing until the app is reloaded.

**Fix.** NPS reopens the connection. Copy:
- `withPhotoDB()`, `forgetPhotoDB()` and `lostPhotoDB()`;
- the versions of these functions that go through them: `openPhotoDB`,
  `getPhotoFromDB`, `savePhotoToDB`, `deletePhotoFromDB`, `getAllPhotoKeys`
  and `estimateIDBSize`.

`git show 571d841` has the rest of that commit's shared fixes: the photo
capture registry, `flushPendingSaves` on `pagehide`, and `safeThumb` and
`cleanPhotoMap` for backups restored from JSON.

## 2. Older shared fixes (NPS v2.x–v2.9)

Port these if `sibling-diff.js` still lists the functions:

**Phone layout and input safety**
- The phone-width question dropdown: one scrollable chip row and a 60vh list.
- `esc()` on the saved-list rows.
- The `&` and `"` escaping in the location picker's `onclick`.
- `closest('.form-group')` instead of `:has()`, for Safari 15.0–15.3.
- The phone-width `min-width: 0` on the flex selects.

**Export and backup**
- `shareOrDownload()` returning false on a cancelled share sheet.
- The fallback-photo purge limited to shipped keys.
- The saved-list date filter (`savedFilterMatch()` in `renderSavedPanel()`).
- The `loadAll()` guard against non-array saved entries.
- The removal of the post-export delete prompt.

**Editing and deleting**
- `saveEdit()` finding its target by id.
- `deleteEntry()` and backup import leaving edit mode cleanly.
- `addPhotoSlot()` never reusing a slot id.
- `confirmDelete()` on every destructive action.

**Storage and photos**
- `checkStorage()` using the browser's real quota.
- The photo viewer: `onPhotoTap` and `showPhotoViewer`.

## 3. One native-app check (NPS v4.9)

- Add `isNativeApp()` just before `fsPlugin()`.
- Start `fsPlugin()` with `if (!isNativeApp()) return null;`.

Steps 7 and 10 depend on this.

## 4. Toasts that fit, last, and fade correctly (NPS v4.9–v4.10)

**The `.toast` rule**
- Replace `white-space: nowrap` with
  `width: max-content; max-width: calc(100vw - 32px); text-align: center;`.
  Long messages then wrap inside the screen instead of running off both sides
  of an iPad in portrait.

**`showToast(msg, isWarn, whenFree)`**
- Copy NPS's version. It shows a message for 50 ms per character, between
  2.5 and 10 s.
- An earlier toast's timer never hides a newer one.
- Only the `show` class comes off, so a warning fades out amber instead of
  flashing green.
- A `whenFree` message waits until the one on screen has gone.

**Storage reminders**
- In `checkStorage()`, pass `true` as the third argument to both storage
  `showToast` calls, so the reminder never replaces an export result.

## 5. Header and bottom bar that fit an iPad (NPS v4.10)

**The problem.** The full header row needs about 1,050 px, so on every iPad in
portrait it ran off the screen. NPS moved the ⋯-menu breakpoint up and made the
bottom bar shrink its text instead of its buttons.

**The CSS to copy from NPS:**
- `.header > div:first-child { min-width: 0; }` and
  `.header-actions { margin-left: auto; }`.
- A `@media (max-width: 1100px)` block that wraps the header, hides
  `.header-btn-secondary` and shows `.overflow-menu-wrapper`.
- The phone rule letting the title block wrap.
- The `.entry-count` ellipsis, the bottom-bar left block
  `{ min-width: 0; flex: 1 1 auto; margin-right: 8px; }` and
  `#bottomActions { flex: none; }`.

**Check in USFS.** Its header has different buttons, so measure the width its
full row needs, and set its breakpoint just above that.

## 6. Library files under versioned names (NPS v4.8, v4.10)

**Rename the files:**

```sh
git mv vendor/jszip.min.js vendor/jszip-3.10.1.min.js
git mv vendor/exceljs.min.js vendor/exceljs-4.4.0.min.js
```

**Update the head tags.** Each tag says which global it defines (`data-lib`)
and names the file's old path (`data-legacy`). An old service worker still
holds the file under that old name offline.

```html
<script src="vendor/jszip-3.10.1.min.js" data-lib="JSZip" data-legacy="vendor/jszip.min.js"></script>
<script src="vendor/exceljs-4.4.0.min.js" data-lib="ExcelJS" data-legacy="vendor/exceljs.min.js"></script>
```

Update the names in `vendor/README.md`. Replace its "to upgrade, replace a
file" sentence with NPS's numbered steps; step 9 makes in-place replacement a
stale-library hazard. Never edit a vendored file in place again.

## 7. The page loads a missing library itself (NPS v4.8–v4.10)

**Why.** On an iPad, reopening the app resumes the page rather than reloading
it. The old advice to "restart" or "open the app once with signal" therefore
never worked.

**Functions to copy from NPS**, placed after `showToast`:
- `missingLibraries`
- `loadScript`
- `loadMissingLibraries`
- `ensureLibraries`
- `libraryAdvice`
- `libraryMissing`

**The three hooks.** Copy NPS's lines that run a load at startup, on `online`
and on `visibilitychange`. NPS puts them after `paintVersion()`. USFS has no
version stamp, so put them just before `init()`.

**The export guard** (USFS `index.html` ~2606). Replace it with:

```js
await ensureLibraries(['ExcelJS', 'JSZip']);
if (typeof ExcelJS === 'undefined' || typeof JSZip === 'undefined') { libraryMissing('Export'); return; }
```

Route any other library check through `ensureLibraries` and `libraryMissing`.

## 8. The service worker (USFS-specific)

USFS's `sw.js` is the older, simpler kind:
- an all-or-nothing `cache.addAll` install;
- no captive-portal checks;
- new pages cached into the old release's cache.

The clean port is NPS's `sw.js` with USFS's names:
- `CACHE_NAME = 'usfs-collector-v…'` (the prefix is read from it).
- `LIBRARIES`: USFS's two libraries, each with its SHA-256, which you get from
  `openssl dgst -sha256 -binary <file> | openssl base64 -A`.
- `URLS_TO_CACHE`, `ESSENTIAL` and `HEAD_ONLY`: `team_guide_citations.json` and
  `forest_locations.json`.
- The page check in `isGenuine()`: USFS's own title instead of
  "NPS Photo Collector".

That brings:
- hash-checked libraries;
- the portal checks;
- per-file install;
- offline answers from this release's cache first;
- a cut-short update finishing on the next online open.

## 9. Host config (USFS-specific names)

In `staticwebapp.config.json`:
- one rewrite per old library name to its versioned file (`/vendor/jszip.min.js`
  and `/vendor/exceljs.min.js`), placed before the next route;
- a `/vendor/*.js` route with `"Cache-Control": "public, max-age=31536000, immutable"`;
- `"/vendor/*"` added to `navigationFallback.exclude`.

## 10. Build and the iOS stale-copy check (NPS v4.10)

- **`web-files.txt`.** USFS's own list: `index.html`, `sw.js`, `manifest.json`,
  `team_guide_citations.json`, `forest_locations.json`, `vendor/*.js` and
  `vendor/LICENSE-*`.
- **Scripts.** Copy `scripts/build-web.sh`, `scripts/web-stamp.sh` and
  `ios/check-web-copy.sh` unchanged. Set `"build": "sh scripts/build-web.sh"`
  in `package.json`.
- **Xcode project.** Add a Run Script build phase, first in the App target:
  - name "Check web files are current";
  - shell `/bin/sh`;
  - script `sh "$SRCROOT/../check-web-copy.sh"`;
  - "Based on dependency analysis" off.
  
  Also set `ENABLE_USER_SCRIPT_SANDBOXING = NO` in the target's Debug and
  Release settings, because the check reads files outside its declared inputs.
  See the NPS `project.pbxproj`, object `A7C3E1F20B4D5E6F708192A3`.
- **Order matters.** Port the check together with the build and
  `web-files.txt`. On its own it would demand files the old build doesn't copy.
- **Then** run `npm run sync` and build.

## 11. Tests and the deploy gate (NPS v4.9–v4.10)

**`tests/offline.test.js`.** Its harness is generic: the snapshots, the
emulated Static Web App, the HTTP-cache clearing and the scenarios. To adapt it:
- `exportWorks()` fills in the NPS form, so point it at USFS's fields;
- change the cache prefix (`nps-collector-v`) and the `APP_VERSION` edits.

**CI.** Add the `test` job to the deploy workflow and make `build_and_deploy`
`needs: test`, as in NPS's `.github/workflows/azure-static-web-apps.yml`. It
checks out with `fetch-depth: 0`.

## 12. Docs

- **`ARCHITECTURE.md`.** Bring the library section in line with the steps
  above; USFS's copy still names the old files and says "restart the app".
- **`WEB_TO_TESTFLIGHT_PLAYBOOK.md`.** Copy NPS's version of these lines:
  - "CDN-loaded is fine" (line 20);
  - "(from cdnjs)" (lines 35–36);
  - the offline-support row (line 38);
  - the example `build` script;
  - "CDN libs: cache-first" (line 162);
  - the "Manual sync" lines (251–252).
