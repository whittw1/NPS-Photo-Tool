# NPS Photo Collector — Architecture

**Document date:** 2026-09-25 · reflects app version v4.6 and service-worker cache `nps-collector-v4.6`; iOS marketing version 1.0 / build 1 (scaffold only, never uploaded).

This is the deep-dive technical reference. Companion documents:
- [README.md](README.md) — feature overview and the USFS-vs-NPS difference table
- [WEB_TO_TESTFLIGHT_PLAYBOOK.md](WEB_TO_TESTFLIGHT_PLAYBOOK.md) — the iOS build/upload pipeline (inherited from the USFS app)
- [AZURE_DEPLOYMENT_PLAYBOOK.md](AZURE_DEPLOYMENT_PLAYBOOK.md) — the web hosting pipeline (inherited from the USFS app)
- [Status.md](Status.md) — current deployment status and open decisions
- [api/README.md](api/README.md) — live backup and Send to SharePoint: the server functions, their settings, and the one-time Azure setup (§20)

**Provenance:** this app is a fork of the [USFS Photo Collector](https://github.com/whittw1/USFS-Photo-Tool) (taken at its commit `74667a4`, 2026-09-10), which is itself a fork of the DLA Audit Photo Tool. The USFS `ARCHITECTURE.md` describes the shared design in the same section numbering; this document repeats the shared material so it is self-contained and calls out every NPS deviation with **NPS:** markers.

---

## 1. What this is

A field data-collection app for National Park Service environmental audits, used by HGS Engineering auditors. An auditor walks a facility, and for each finding captures: park + location (GPS-assisted), EnviroCheck sheet and question, score (Finding or Observation), description, coordinates, and photos. Everything persists on-device with zero connectivity; at the end of the day the auditor exports a ZIP containing renamed photos, a CSV, and a styled Excel findings report, delivered through the iOS share sheet (native app) or a browser download (web).

Two optional paths put the work into the firm's SharePoint without the auditor carrying files (§20): **live backup** copies every save and every photo while the app is open and online, and **Send to SharePoint** delivers the export ZIP itself. Both need the auditor signed in with their own Microsoft account; live backup is also off until switched on in Settings. Neither is ever needed to capture or export.

All on-device keys are prefixed `nps_` so this app, the USFS app (`usfs_`) and the DLA app can coexist on one device without data collisions.

**The sibling-sync rule:** the USFS and NPS apps are kept in sync by hand-porting fixes. Everything outside the NPS-specific sections (§4 item 4, §5 scores, §8, §9's data and hint tables, the export sort in §11, §11.1's Word log, branding) is textually identical to the USFS `index.html` — no reformatting, renaming or restructuring — so a fix in one applies to the other as a clean copy-paste. The internal identifiers `forestData`, `selectedForest`, `loadForestData`, `onForestChange`, `autoDetectForest`, `populateForestDropdown`, `FOREST_TO_REGION`, `LS_FOREST` and the element ids `forestSelect` / `forestHint` are deliberately **unrenamed**; in this app they refer to NPS park units.

## 2. System context

```
┌────────────────────────────┐        push to main        ┌──────────────────────────┐
│  Repo (GitHub whittw1/     │ ─────────────────────────▶ │  GitHub Actions →        │
│  NPS-Photo-Tool, main)     │                            │  Azure Static Web Apps   │
└────────────┬───────────────┘                            │  (PWA + api/ functions)  │
             │  npm run sync                              └────────────┬─────────────┘
             ▼                                                         │ first load caches app
┌────────────────────────────┐   Xcode archive + upload   ┌────────────▼─────────────┐
│  www/ → ios/App/App/public │ ─────────────────────────▶ │  Field devices           │
│  (Capacitor iOS shell)     │     TestFlight (not yet)   │  (iPad/iPhone: native    │
└────────────────────────────┘                            │  app; browser: PWA)      │
                                                          └──────────────────────────┘
```

Two delivery channels share one codebase:

1. **Web PWA** — live at https://victorious-ocean-0a7852b10.3.azurestaticapps.net (Azure Static Web Apps, resource `nps-data-collector` in `rg-fs-tools`, Central US, Free tier). Auto-deploys on every push to `main` via `.github/workflows/azure-static-web-apps.yml`; the deployment token lives in the repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN` (the resource was created without a GitHub source link, so there is no Azure-generated workflow to delete). Works fully offline after first load via the service worker.
2. **Native iOS** — the same files wrapped in a Capacitor 8 WKWebView shell as **"NPS Photos"** (`com.hgsengineering.npsphotocollector`). **NPS:** the Xcode project is generated (`npx cap add ios --packagemanager SPM`) but not yet customized (Info.plist usage strings, `ITSAppUsesNonExemptEncryption`, `DEVELOPMENT_TEAM`, icon) or uploaded — see Status.md. The native channel additionally gets durable filesystem photo storage (§7) and the native share sheet.

Capture and export need **no server at all**: every byte of user data lives on the device until the auditor exports it or switches on live backup. The Static Web App carries two small managed functions (`api/`) for the optional SharePoint paths; they hold the firm's Microsoft Graph credentials, so the device never does (§20). There is no telemetry. The network calls the app makes are same-origin fetches of its own files, the three pinned CDN script loads and — only once someone has signed in — `/.auth/me`, `/api/upload`, `/api/upload-session`, and the pre-authorised SharePoint upload URL a session hands back. The Azure URL and the GitHub repository are both public.

## 3. Repository layout

| Path | Role |
|---|---|
| `index.html` | **The entire application** — all HTML, CSS, and JavaScript (~7,050 lines). No build step, no framework, no modules. |
| `sw.js` | Service worker: offline caching + update discipline (§12). |
| `manifest.json` | PWA manifest (`display: browser`, brown theme `#5c3b1e`). |
| `envirocheck_checklists.json` | 810 checklist questions from the 17 federal NPS EnviroCheck Sheets, with citation and P1–P4 priority. Array of `{c, s, d, r}` (§9). |
| `nps_locations.json` | 449 park units → 43,026 named GPS locations. `{ "Park Name": [{n, t, d, lat, lng}, …] }` (§8). |
| `build_envirocheck.js` | Node script that regenerates the question index from the EnviroCheck Sheet `.docx` files (§14.1). |
| `build_locations.js` | Node script that regenerates `nps_locations.json` **and** the `REGION_MAP` literal in `index.html` from NPS GIS services (§14.2). |
| `package.json` | Capacitor deps + the `build` / `sync` / `open` scripts. `@capacitor/filesystem` is the only plugin beyond core. |
| `capacitor.config.json` | Bundle id, app name "NPS Photos", `webDir: www`. |
| `www/` | Build output — a copy of the static files, what Capacitor bundles. Regenerated by `npm run build`; never edit directly. Git-ignored. |
| `ios/` | Capacitor-generated Xcode project (SPM). Version/build numbers live in `ios/App/App.xcodeproj/project.pbxproj` (both Debug and Release configs). |
| `nps_raw/` | Git-ignored cache of the raw GIS service responses used by `build_locations.js`. |
| `staticwebapp.config.json` | Azure routes and headers: cache-control per file, the `authenticated` role on the two API routes, a real 401 for signed-out calls, the Node 20 functions runtime (§13). |
| `api/` | The two managed functions behind live backup and Send to SharePoint (§20): `shared/graph.js` (settings, the app's own Graph sign-in, who is asking, the destination list, the path rules), `upload/` (one file up to 8 MB per request), `upload-session/` (starts a large-file upload and returns its URL). `README.md` holds the one-time Azure setup. |
| `.github/workflows/azure-static-web-apps.yml` | Deploys on every push to `main`: `app_location: "/"`, `api_location: "api"`, `skip_app_build: true`. |
| `privacy.html` | Privacy policy page required for App Store review. |

## 4. Application structure inside index.html

One main `<script>` block (plus a few lines in the `<head>` that register the service worker), organized into banner-commented sections in this order:

1. **Constants** — photo slots, defaults, all storage keys
2. **State** — module-level `let` variables (no state library)
3. **Init** — `init()`, called at the bottom of the script on parse
4. **Region/Park data** — generated `REGION_MAP`, `loadForestData()`. **NPS:** no score-visibility logic (the USFS `updateScoreVisibility()` and its three call sites are gone).
5. **Location list** — picker modal, haversine, GPS auto-suggest, `.txt` import
6. **Dynamic photo slots** — add/remove/renumber Photos 3+
7. **Score buttons** — `toggleScore()`, `setScoreButtons()`; the Note mode that hides the sheet card is `updateNoteMode()` in the NPS audit data section (§19)
8. **Save & New / Clear / Saved panel / Edit** — entry CRUD
9. **Photo handling** — capture/browse inputs, resize pipeline, the pending-capture registry, the IndexedDB layer and its reconnect wrapper (§7)
10. **Durable photo storage** — Capacitor Filesystem layer, migration, integrity (§7)
11. **Photo settings** — resolution/quality dialog
12. **Export** — dialog, date filter, one-export-at-a-time wrapper, ZIP/CSV/XLSX build, integrity guard (§11)
13. **Backup/Import** — JSON backup with photo references, the restore cleaners (§11)
14. **Geolocation** — `captureGPS()`, display, accuracy coloring
15. **EnviroCheck question search** — synonyms, hints, sheet chips, recents (§9)
16. **Persistence** — autosave, `saveAll()`/`loadAll()`, storage monitor
17. **Utilities** — CSV quoting, datestamp, `shareOrDownload()`, toast
18. **Export straight to SharePoint** — `uploadBigFile()`, the resumable large-file upload behind Send to SharePoint (§20.4)
19. **Overflow menu**
20. **NPS audit data** — priorities, description codes, finding numbers, prior audit (§19). NPS-only.
21. **SPCC tank check + personnel** — the tank verification module and the personnel roster (§18). NPS-only.
22. **LOC / EDL sites** — the site list, the EDL form, site photos, compass and gaps (§18.3). NPS-only.
23. **Live backup to SharePoint** — the queue, sign-in, destinations, the state file and photo index (§20). NPS-only.
24. **Word photo log** — the `.docx` export (§11.1). NPS-only. Everything above the Word log's banner is shared with the USFS app except the sections marked NPS-only.
25. **Start** — the call to `init()`.

All UI event wiring is inline `onclick`/`oninput`/`onchange` attributes plus two document-level click listeners (close citation results, close overflow menu). All rendering is string-built `innerHTML`; user text is escaped through `esc()` (a div-textContent round-trip) before interpolation, and `_attr()` adds `&quot;` for attribute values.

**Restored data is untrusted (v4.6).** A JSON backup, a prior-audit workbook or a tank table can come from anywhere, so what they carry is checked where it enters and escaped where it is shown. `safeThumb()` accepts only a genuine JPEG/PNG/WebP data URL; `cleanPhotoMap()` accepts only the slot names and keys the app itself makes (they end up in element ids and inline handlers); `cleanTankData()` and `cleanSites()` apply the same rules to tank and site photos; a restored prior audit must carry a list of findings and a numeric year. At the sinks, every finding-photo `<img src>` goes through `_attr()`, the saved-list row escapes the description code and repeat citation, and the prior-audit chips carry their value in a `data-` attribute rather than inside the handler's JavaScript.

### External dependencies (exactly three, all pinned, all CDN)

| Library | Version | Source | Used for |
|---|---|---|---|
| JSZip | 3.10.1 | cdnjs | Building the export ZIP |
| ExcelJS | 4.4.0 | cdnjs | The styled two-sheet XLSX (SheetJS was replaced in mid-2026 because its community edition cannot style cells) |
| docx | 8.2.2 | jsDelivr | The Word photo log (§11.1). Pinned to 8.2.2 — docx 9.x ships only as `.cjs`, which jsDelivr serves with a content type browsers refuse to execute |

All three are precached by the service worker so exports work offline. If JSZip or ExcelJS never loaded (a fresh install that has never been online), the export stops with "Export library not loaded — go online once first"; a missing docx library only leaves the Word files out of the ZIP.

### Design system

Light theme only, defined as CSS custom properties on `:root`: background `#f4f6fa`, cards `#ffffff`, **NPS brown accent `#5c3b1e`** (hover `#74502c`; also the header gradient `#3d2613 → #5c3b1e → #7a5533` and the XLSX header fill `FF5C3B1E`), danger `#dc2626`, success `#16a34a`, warning `#ca8a04`, 12px radius. The brown exists purely so the app is visually distinct from the green USFS sibling on a shared device. **NPS:** `.tg-chip.active` text is white (USFS: black) because black is illegible on the dark brown. One breakpoint at 640px collapses the header buttons into an overflow (⋯) menu. Safe-area insets are respected top (header) and bottom (fixed bottom bar).

## 5. State model

Module-level variables (the entire runtime state):

| Variable | Type | Meaning |
|---|---|---|
| `savedEntries` | array | All saved entries (persisted to `nps_saved`) |
| `currentPhotos` | object | Draft entry's photos, keyed by slot id |
| `currentEntryId` | string | Draft entry id, `e_<epoch-ms>_<4 base36 chars>` from `genId()` |
| `currentGPS` | object\|null | `{latitude, longitude, accuracy}` |
| `editingIndex` | number\|null | Index into `savedEntries` while editing; null = new-entry mode |
| `extraPhotoSlots` | array | Slot ids `p_extra_0…` currently in the DOM |
| `siteList` | array | Location names for the picker (park-derived or imported) |
| `forestData` | object | Parsed `nps_locations.json` (name kept for sibling parity) |
| `selectedForest` | string | Selected **park** name; persisted to `nps_selected_park` |
| `locationRadius` | 'nearby'\|'all' | Picker radius toggle (10 mi) |
| `tgCitations` / `tgLoaded` / `tgRecent` / `tgAreaFilter` | — | Citation search state |
| `idbAvailable` | bool | False only when the database cannot be opened (the startup probe, an open failure). A failed write does not set it (v4.1) — it also gates reads, and one quota error used to hide every stored photo |
| `photoDB` | IDBDatabase | Cached open handle, forgotten when the browser closes it (`onclose`, `onversionchange`) or a transaction finds it dead; `withPhotoDB()` then reopens it (§7) |
| `exportDateMode` | string | 'all' \| 'today' \| 'yesterday' \| 'earlier' \| 'custom' |
| `_editPhotoKeys` / `_editOriginalPhotos` | array / object | Keys written during an edit, and the photos the entry had when it was opened — what `saveEdit()` and `abandonEdit()` reap or keep (§7) |
| `_photoCapturesPending` | Map | Photo keys still being read, resized or written, with their start time; `saveEdit()` waits for them (§7) |
| `_exportBusy` / `_exportMode` | bool / string | One export at a time, whichever button started it (§11) |
| `tankData` / `locSites` / `peopleList` / `auditInfo` / `priorAudit` | — | Tank check, LOC sites, personnel, audit header, prior audit (§18, §19) |
| `backupCfg` / `backupUser` / `backupTargets` / `backupQueue` / `backupDone` | — | Live backup: switch, folder and destination; the account last confirmed; the offered destinations; work waiting; photos already up (§20) |

### The entry object

```js
{
  id:                "e_1711234567890_a1b2",
  siteName:          "Old Faithful Visitor Education Center — YELL",  // duplicate of location (legacy)
  location:          "Old Faithful Visitor Education Center — YELL",
  park:              "YELL",                        // alpha code at save time; old entries get it from the location suffix
  protocolArea:      "Used Oil Management",       // one of the 17 EnviroCheck sheets, WASO spelling ('' allowed)
  teamGuideCitation: "UO.05 — 40 CFR 279.22(c)",  // EnviroCheck question; field name kept for sibling parity
  score:             "2b",                          // priority "1" | "2a" | "2b" | "3" | "4" | "P", or "N" for a Note — REQUIRED to save
  descCode:          "Label/Signs",                 // one of the ten WASO description codes, or ''
  repeatOf:          null,                          // or { year, park, num, priority, sheet, desc } from the prior audit (§19)
  details:           "Observed sediment discharge…",
  latitude:  44.4605, longitude: -110.8281,        // null when no GPS
  gpsAccuracy: 8.5,                                 // meters, null when no GPS
  timestamp: "2026-09-10T14:30:00.000Z",           // creation time; preserved across edits
  exportedAt: "2026-09-10T18:02:11.000Z",          // stamped by runExport(); absent = never exported
  photos: {
    p_main:    { timestamp, thumbnail, fileType: 'image/jpeg', dbKey, unsaved? },
    p_wide:    { … },
    p_extra_0: { … }
  }
}
```

Key details:
- `photos[slot].thumbnail` is an **inline base64 data URL** (~80 px wide, JPEG q=0.4) stored *inside the entry in localStorage* — it's what the saved list and slot previews render without touching the photo stores.
- `photos[slot].dbKey` is the pointer to the full-resolution bytes: `photoDBKey(entryId, slotId)` = entryId with non-alphanumerics replaced by `_`, then `__`, then the slot id, e.g. `e_1711234567890_a1b2__p_main`. The same key addresses all three storage tiers. **A retake outside edit mode reuses the slot's key; inside edit mode it gets a fresh one** (the slot id plus a time-and-random suffix), so the saved entry keeps its photo until the edit is saved (§7).
- `photos[slot].unsaved === true` means the durable write **failed verification** at capture time (§7).
- **Score is mandatory**: `saveEntryAndNew()` and `saveEdit()` both refuse with the toast "Tap a priority (1, 2a, 2b, 3, 4, P) or Note to score this entry first" until a priority button is selected.
- **NPS scores are the EAP priorities:** six buttons, `1`, `2a`, `2b`, `3` (red when active — corrective action required), `4` (orange — BMP, recommended) and `P` (green — positive practice). The `score` field keeps its name for sibling parity but holds the priority string. The USFS `General` and Region 9-only buttons, `updateScoreVisibility()`, the `.score-btn.hidden` rule and `setGeneralPhoto()` were removed in the fork; the 2026-09-16 rule that hid the sheet card for Observations went with the Observation button. `normalisePriority()` maps the old `Finding` → `2b` and `Observation` → `N` (Note) (and anything else unknown to unscored) when entries are loaded, restored from a backup or migrated at startup (`migrateSavedEntries()`, which also brings old sheet spellings up to the WASO names through `SHEET_RENAMES`). See §19 for how the priority, description code and repeat link are suggested and stored.

### Complete on-device key inventory

| Store | Key | Contents |
|---|---|---|
| localStorage | `nps_saved` | JSON array of all saved entries (incl. thumbnails) |
| localStorage | `nps_current` | Autosaved draft: form fields + `currentPhotos` + slot list + GPS + entry id |
| localStorage | `nps_photo_settings` | `{maxWidth, maxHeight, quality, preset}` |
| localStorage | `nps_site_list` | Imported `.txt` location list (fallback when no park selected) |
| localStorage | `nps_selected_park` | Park name, restored on launch (constant `LS_FOREST`) |
| localStorage | `nps_recent_tg` | Last 10 selected question codes, most recent first |
| localStorage | `nps_tanks` | The imported SPCC tank list with each row's status, notes, corrections and photo pointers (§18) |
| localStorage | `nps_loc_sites` | LOC / EDL sites: name, EDL ID, GPS, field observations and photo pointers with caption and facing direction (§18.3). Not `nps_site_list`, which is the imported location list, and not the `siteList` variable, which holds it |
| localStorage | `nps_people` | Park personnel contacted: `[{name, title}]` (§18) |
| localStorage | `nps_audit` | Audit team and coordinator: `{team: [{name, org}], coordinator, coordinatorTitle}` (§19) |
| localStorage | `nps_prior` | The previous audit's findings spreadsheet, parsed: `{source, importedAt, year, findings: [...]}` (§19) |
| localStorage | `nps_backup_cfg` | Live backup: `{url, on, folder, target, user}` — the switch, the typed folder, the destination key, and the last account confirmed signed in (§20) |
| localStorage | `nps_backup_queue` | Work waiting to upload: `{k: 'state'\|'index'\|'photo', key?, folder, target, n?}`, oldest first, first 2,000 kept (§20) |
| localStorage | `nps_backup_done` | Photo keys already uploaded, last 2,000 (§20) |
| localStorage | `nps_device_id` | `ipad-xxxxx` — names this device's state file and photo index in SharePoint (§20) |
| localStorage | `photo_full_<dbKey>` | **Fallback-only** full-res photo as data URL (§7 tier 3) — note: not `nps_`-prefixed, same as USFS; the two apps only collide here if the same entry id is generated twice, which `genId()` makes practically impossible |
| IndexedDB | db `nps_photos_v1`, store `photos` | `{data: ArrayBuffer, type, size}` keyed by dbKey |
| Native FS | `DATA/nps_photos/<sanitized dbKey>.jpg` | Durable full-res JPEG (native app only) |
| SW Cache | `nps-collector-v<APP_VERSION>` (now `v4.6`) | App shell + data JSON + the three CDN libraries (§12) |

**NPS:** `loadAll()` also restores **edit mode** when the autosaved draft's id matches a saved entry, so a reload mid-edit (the version stamp is a one-tap reload, behind a confirm) cannot leave a duplicate draft sharing the saved entry's photos. `autoSaveCurrent()` runs on effectively every input event, so a mid-entry app kill (including iOS killing the WebView while the camera is open — a real iOS behavior) restores the full draft, thumbnails included, on next launch. The storage monitor tallies every localStorage key starting with `nps_` or `photo_full_`.

## 6. Startup sequence (`init()`)

1. Generate a fresh `currentEntryId`.
2. Open IndexedDB and run a **write→read→delete probe** with a 4-byte test record; any failure flips `idbAvailable = false` for the session.
3. `loadAll()` — restore saved entries and the autosaved draft (form fields, GPS, thumbnails, extra photo slots rebuilt into the DOM).
4. Render saved panel, header badge, storage bar; queue the previous-day reminder toast (fires at 1.5 s if any entry's timestamp is from an earlier calendar day).
5. `navigator.storage.persist()` — ask the browser/WebView not to evict our origin's storage (best-effort, wrapped in try/catch).
6. `migratePhotosToFS()` → then `runIntegrityCheck(false)` (§7).
7. `loadForestData()` — fetch `nps_locations.json`, populate the Region/Park dropdowns from `REGION_MAP`, restore the persisted park selection.
8. If no park is stored, fall back to the imported `.txt` site list.
9. **Same-day location carry-over**: if the location field is empty, prefill it from the most recent entry saved *today* (auditors save many entries at one site).
10. **Live backup** (§20): `loadBackupCfg()` restores the switch, the queue and the last account confirmed; `refreshBackupUser()` asks `/.auth/me` who is signed in and, when backup is on, fetches the destination list. A 30-second interval and the `online` event drive `drainBackupQueue()`, and the first drain after launch reconciles the queue against every photo on the device.
11. **Flush handlers**: `pagehide` and `visibilitychange` (hidden) call `flushPendingSaves()`, which writes only the tank and site edits still waiting on their 400 ms debounce (§16).

Independently of `init()`, the script's top level kicks off `loadCitations()` and `loadRecentTg()` for the citation search (§9 covers the retry when the list has not arrived).

## 7. Photo storage — the three-tier durable design

**Why this exists:** iOS can silently evict WKWebView storage (IndexedDB *and* localStorage) under disk pressure — a sibling HGS app lost a day of field photos this way. Full-resolution photos on the native app are written to a **real file** in the app's DATA container via `@capacitor/filesystem`, which iOS does not evict. The web/PWA build (no native bridge) continues to rely on IndexedDB. **Do not simplify this** (see §16).

### Write path — `storePhotoBytes(dbKey, dataUrl)` → `{ok, where}`

Tries tiers in order, **verifying each write before claiming success**:

1. **Native filesystem** (`where:'fs'`): `Filesystem.writeFile` to `nps_photos/<key>.jpg` in `DATA`, then `Filesystem.stat` to confirm the file exists with size > 0. Only attempted when `window.Capacitor.isNativePlatform()` is true and the plugin is present (`fsPlugin()` returns null otherwise, making every fs helper a no-op on the web).
2. **IndexedDB** (`where:'idb'`): put `{data: ArrayBuffer, type, size}`. A failure falls through to the next tier without touching `idbAvailable`, which also gates reads (v4.1).
3. **localStorage** (`where:'fallback'`): the data URL under `photo_full_<key>` — last resort only, tiny quota, itself evictable. Read back to confirm.
4. Nothing stuck → `{ok:false, where:'none'}`.

### IndexedDB connections (v4.6)

Every IndexedDB operation goes through `withPhotoDB(run)`. WebKit drops IndexedDB connections — after the app has sat in the background, or when its storage process restarts — and a transaction on the dead handle throws `InvalidStateError` or fails with `UnknownError`. `lostPhotoDB()` recognises both, `forgetPhotoDB()` drops the cached handle, and the operation runs once more on a fresh connection; the handle is also forgotten when the browser closes it (`onclose`) or another copy wants to upgrade it (`onversionchange`). Only after that one retry do the read helpers answer null or an empty list. Before this, every stored photo read as missing until the app was reloaded.

### Capture-time verification (`handlePhoto`)

The photo slot shows an amber `…` badge while the write is in flight. On `{ok:true}` it becomes the green ✓ badge and a toast reports the size; on failure the badge becomes a red **⚠ NOT SAVED**, `photos[slot].unsaved = true`, and a warning toast says "Export & clear now". Nothing fails silently.

**The form can move on while a photo is being processed** — Save & New, Cancel Edit — so two guards compare the entry id at capture with the one on the form:

- **Before the photo is put on the form** (it is still being decoded): the photo is discarded with a toast. Nothing of this capture has been written yet, so any bytes under its key belong to an earlier photo — and a retake outside edit mode shares its key with the original the saved finding now holds. The key is deleted only if nothing references it (`allReferencedPhotoKeys()`), and the toast says whether the finding kept its original (v4.6).
- **After the write**: Save & New has copied the photo into the entry it was taken for, so bytes a saved entry references are kept and their saved state recorded on that entry; only an unclaimed photo is deleted (v4.1).

`_photoCapturesPending` records every capture from the moment the file is picked until it finishes, however it ends (a `finally`, plus `img.onerror` and `reader.onerror`, which also tell the auditor the photo could not be read). `saveEdit()` refuses with "A photo is still being saved — tap Save again in a moment" while one is in flight; a 30-second age limit means a capture that died can never block saving for good.

### Edit mode

`editEntry()` loads the entry's photos into the form and remembers them in `_editOriginalPhotos`; retakes go to fresh keys listed in `_editPhotoKeys`. `saveEdit()` keeps the original for any slot whose retake did not store — a good original is never traded for a reference to nothing (v4.6) — writes the entry through `saveAll()`, then `reapPhotoBytes()` deletes every key from the edit that no saved entry points at. `abandonEdit()` is every other way an edit can end (Cancel Edit, deleting the entry, a backup that replaces the list, promoting a tank): it reaps the edit's own keys and leaves the entry's photos untouched.

### Read path — `loadPhotoBytes(dbKey)`

Filesystem → IndexedDB → localStorage fallback, first hit wins, returning `{bytes: Uint8Array, type}`. `photoBytesExist()` is the same walk returning a boolean. Used by export and the integrity check.

### Migration — `migratePhotosToFS()` (once per launch, native only)

Lists all IndexedDB keys, lists the filesystem directory (`fsPresentKeySet()` reads `nps_photos/`), and copies every IDB-only photo to the filesystem (base64-encoded in 32 KB chunks — `uint8ToBase64` avoids the `String.fromCharCode.apply` stack overflow above ~100 KB). Shows "Secured N photos to durable storage" if it moved anything. IDB copies are left in place as redundancy.

### Deletion

`deletePhotoFromDB(key)` removes **all three tiers** (localStorage fallback, filesystem, IndexedDB) and resolves only once every copy is gone — the filesystem delete is awaited too. Callers delete only after the list that stopped referencing the photo has been written: deleting an entry, `reapPhotoBytes()`, a tank-list re-import (§18.1). The post-export batch delete was removed in v2.9.

### Integrity badge

`runIntegrityCheck()` diffs the set of dbKeys referenced by entries + draft against the union of keys present in all three tiers (`presentPhotoKeySet()`). The header badge shows green "✓ N photos safe" or red "⚠ X of N photos MISSING"; tapping it re-checks and, in verbose mode, alerts with the affected entry locations and points the user at earlier exports for recovery. `updateIntegrityBadge()` debounces re-checks 500 ms after any photo mutation.

## 8. Location system (NPS-specific)

Three sources feed the location field, in priority order:

1. **Bundled park data** (`nps_locations.json`): `{ "Park Name": [ {n: name, t: type, d: park alpha code, lat, lng} ] }` — 449 park units, 43,026 locations. Selecting a park maps them to display strings `"Name — CODE"` (e.g. `Old Faithful Visitor Education Center — YELL`) and enables the GPS features. `t` is the NPS feature type (`Visitor Center`, `Campground`, `Service Shop Maintenance`, `Sewage Treatment`, `Parking Lot`, …) and shows as a `[type]` tag in the picker.
2. **Imported `.txt` list** (`nps_site_list`): one location per line, `#` comments, used only when no park is selected.
3. **Free typing** — the field is a plain text input; anything goes.

**Why the park code is the second segment:** the USFS entry never stored its forest, so the location string carried it. NPS entries now store `park` as well (§19), but the code stays in the string because the photo file names and the report's Location column are built from it. The USFS strings carry the ranger district there; NPS units have no public sub-unit equivalent, so the 4-letter unit code fills the slot. It rides into the export as `MMDDYY_Name_CODE_NNNN.jpg` and into the Findings Report "Location" column, which keeps multi-park exports unambiguous. Change `d` in `build_locations.js` to switch to the full park name or blank.

Static data in code: `REGION_MAP` — the **7 legacy NPS regions** carried by the boundary data (`AKR — Alaska`, `IMR — Intermountain`, `MWR — Midwest`, `NCR — National Capital`, `NER — Northeast`, `PWR — Pacific West`, `SER — Southeast`) → park names — is **generated** by `build_locations.js` between the `// REGION_MAP:BEGIN` / `// REGION_MAP:END` markers; never hand-edit it. The derived reverse lookup `FOREST_TO_REGION` is unchanged code. The Region dropdown only filters the Park dropdown (no region-dependent scoring); both selections persist. (The DOI "Unified Interior Regions" 1–12 are not carried by any NPS GIS dataset, hence the legacy codes.)

GPS-powered behaviors (all use `haversineMi()`, earth radius 3958.8 mi) — identical code to USFS:

- **Picker sorting**: with a fix, the location picker sorts by distance and shows a per-row distance chip; the **Nearby (10 mi) / All** toggle filters (Nearby silently falls back to All when nothing is within radius).
- **Auto-detect park** (`autoDetectForest`): if no park is selected when a fix arrives, scan *every* location in every park for the nearest one; adopt that park (and its region) when < 100 mi. Every unit is detectable because units with no mapped facilities still carry one "Park Unit" centroid location.
- **Auto-suggest location** (`autoSuggestLocation`): if the location field is empty, fill it with the nearest location in the selected park when < 50 mi, with a toast showing the distance.

## 9. EnviroCheck question search

**NPS audits run off the NPS Environmental Audit Program EnviroCheck Sheets, not the Forest Service Team Guide.** The Team Guide index, its build script and the Common Citations quick-pick were removed on 2026-09-16; the search machinery around them is unchanged, so this section still diffs cleanly against the USFS app (the `tg*` identifiers are deliberately kept).

**Data:** `envirocheck_checklists.json` — 810 records of `{c, s, d, r}` built by `build_envirocheck.js` (§14.1) from the 17 federal sheets (2017 editions):

| Field | Meaning | Example |
|---|---|---|
| `c` | Question code, `<SHEET>.<NN>`, following each sheet's own numbering | `UO.05` |
| `s` | Sheet, section and priority | `Used Oil Management: Storage and Handling · P2` |
| `d` | The checklist question | `Are containers and ASTs storing used oil … labeled or marked clearly with the words "Used Oil"?` |
| `r` | Regulatory citation(s) pulled from the question's brackets | `40 CFR 279.22(c)` |

Sheet codes: `AQ` Air Quality, `EPP` Environmentally Preferable Purchasing, `EPR` Emergency Planning and Reporting, `FSM` Fuel Storage Management, `HC` Hazard Communication, `HM` Hazardous Materials and Toxic Substances, `HW` Hazardous Waste Management, `IPM` Integrated Pest Management, `LAB` Laboratory Chemicals, `ODS` Ozone Depleting Substances, `RP` Respiratory Protection, `SW` Solid Waste Management, `SPCC` Spill Prevention Control and Countermeasure, `STW` Storm Water Management, `UW` Universal Waste Management, `UO` Used Oil Management, `WW` Wastewater Management. The same 17 sheets are the Protocol Area dropdown, and `SHEET_CODE` / `sheetCodeOf()` (§19) map a sheet name back to its code for the report's Question column.

**The code prefix is load-bearing:** the chips and the browse-by-sheet list both split `c` on the first dot, so a sheet code must never contain one.

**Search algorithm** (`_filterCitations`, debounced 150 ms) — unchanged from the USFS app apart from the data it ranks:

1. Empty/1-char query → the sticky sheet chip row plus either the active sheet's first 50 questions, the **Recent picks** list (last 10 codes from `nps_recent_tg`), or a hint.
2. Query terms split on whitespace; each expands through `TG_SYNONYM_MAP` (~34 groups of field vocabulary — "msds"→"safety data sheet", "unlabeled"→"label", "dumpster"→"refuse", "ust"→"underground storage tank"). Multi-word phrase keys match against the whole query.
3. **Every** term (in some variant) must appear in `c + s + d + r`, lowercased. Scoring: +10 if the variant is in the code, +5 if in the citation, +2 for the typed term / +1 for a synonym.
4. **Sheet hints** (`TG_PROTOCOL_HINTS`, ~60 regex→sheet→bonus rules rewritten for the EnviroCheck sheets) add sheet-level bonuses — e.g. `/refrigerant|r-22|ozone.depleting/` boosts every `ODS.*` question by 18.
5. **Question hints** (`TG_QUESTION_HINTS`) boost a specific question — e.g. a query about labelling used oil boosts `UO.05` by 25.
6. The active chip filters to that sheet. Top 30 by score render with `<mark>` highlighting of every matched variant.

Selecting a question writes `"CODE — citation"` (or the bare code) into the hidden `teamGuideCitation` input, renders the summary card, and pushes the code onto the recents list. A bare code with no regulatory citation (18 of the 810 questions) never lands in the report's citation column; a Priority 4 on one reads `BMP` (v3.0).

**Loading.** `loadCitations()` runs once at startup. If the list has not arrived when the auditor searches, the search says so and tries again at most once every 3 seconds (`_citationRetryAt`), recovering on its own once there is signal (v3.2).

**Known gaps:** the set is federal-only — no state supplements — and it does not cover NPS-specific policy, so searches for things like bear-resistant containers find nothing. The sheets are the 2017 editions; re-run the build script when NPS reissues them.

## 10. Photo capture pipeline

1. **Camera** (`takePhoto`): the `<input type=file accept=image/* capture=environment>` is **destroyed and recreated on every tap** — iOS caches a stale file on reused inputs. **Library** (`browsePhoto`): same input without `capture`, which makes iOS open the photo picker instead.
2. `handlePhoto` reads the file as a data URL, draws it into a canvas scaled to fit the configured max box (default 1920×1080; presets 1280×720 / 2560×1440 / custom / original-no-resize), re-encodes JPEG at the configured quality (default 0.80). Settings persist in `nps_photo_settings`; the settings dialog shows a rough size estimate (`w·h·q·0.00015` KB, clamped 50 KB–3 MB).
3. A second canvas produces the ~80 px thumbnail (JPEG q=0.4) stored inline in the entry.
4. Bytes go through the verified durable-write path (§7); the slot badge reflects the outcome. The entry-moved guards and the pending-capture registry are described in §7.
5. **GPS auto-capture**: if the draft has no fix yet, a silent `captureGPS(true)` fires with each photo (high accuracy, 15 s timeout, no error UI in silent mode).

Photos 1–2 are fixed slots (`p_main`, `p_wide`); "Add Photo" appends `p_extra_N` slots, removable and renumbered live, and a new slot never reuses an id (v2.9); edit mode and draft-restore both rebuild extra slots from data. Tapping a photo opens it full size with a Retake button rather than replacing it.

Tank and site photos (`handleTankPhoto`, `handleSitePhoto`) use the same resize and verified write, and look their row or site up again after the write, so a photo for a row or site deleted meanwhile is discarded with a message (v3.4–v3.5).

Note: going through `<input type=file>` means **iOS strips EXIF and re-encodes** — GPS lives in the entry record, not the image file, by design.

## 11. Export pipeline (`runExport`)

**Dialog:** shows the naming preview, a date filter (chips All / Today / Yesterday / Earlier / Custom with two date inputs, opening on whatever the saved list is filtered to), and a live count "N entries will be exported" / "M of N match this filter". **NPS divergence:** the in-progress draft counts as an entry only if it has a description or photos, and never while an entry is open for editing — the form is then a copy of a saved entry (`draftIsExportable()`); the location carries over between entries, so a location-only draft is just the carried-over field. An unscored draft is never exported (it would be a numbered blank finding); the dialog says so (`draftPendingScore()`). The exports and the backup build the draft through one `draftEntry()`, which applies the Note rule (no sheet, code or repeat). The JSON backup applies the same rule. (USFS counts a location-only draft.)

**Two ways out.** **Export ZIP** hands the ZIP to the share sheet; **Send to SharePoint** uploads it (§20.4). `runExport(mode)` allows one export at a time, whichever button started it, and a second tap is told one is already running. For Send to SharePoint the dialog stays open, showing its progress and the "do not close the app" warning, with the Word, ZIP and SharePoint buttons locked until it finishes; closing the dialog is always allowed, since a stalled upload must never trap anyone in it, and a toast then says it is still sending (v4.6). `buildAndSendExport()` does the work.

**Selection:** deep-clone `savedEntries`, append the draft (with its live form values) if exportable, then filter by the date range (`entryInRange` on `timestamp`; open-ended bounds allowed). Empty result → abort with a toast. Then `findingNumbers()` (§19) assigns each entry its per-park finding number.

**Photo naming:** one **global 4-digit sequence** across the whole export (`0001…`), ordered **in finding order** (`findingOrder()`: park, priority, sheet, question code, location — so photo 001 belongs to finding 001; USFS orders by entry), then slot (`p_main`, `p_wide`, extras by index). Name = `MMDDYY_<segments>_NNNN` where the location string is split on any of `-> → > – — | /` and the **last two segments** are kept, each sanitized to `[a-zA-Z0-9_- ]`, spaces→underscores. With the bundled data that yields `MMDDYY_Location_PARKCODE_NNNN` (e.g. `091026_A-Frame_at_Happy_Isles_YOSE_0001.jpg`). Extension is `.jpg` unless the stored MIME says PNG.

**ZIP contents** (`NPS_Export_<PARK>_<MMDDYY>_<HHMM>.zip`, via JSZip — the park and the minute are in the name so a second export on the same day cannot replace the first, v4.3):

```
photos/MMDDYY_Location_PARKCODE_0001.jpg …
NPS_Report_MMDDYY.xlsx
NPS_Data_MMDDYY.csv
NPS_Notes_MMDDYY.docx          when there are notes
NPS_LOC_Sites_MMDDYY.docx      when there are LOC sites
```

Excel refuses a row taller than 409 points and a cell longer than 32,767 characters, so cells are capped at 32,000 (`EXCEL_MAX_CELL`, `EXCEL_MAX_ROW_H`); the CSV keeps the full text (v3.1).

**CSV** — columns: `Entry #, Park, Finding #, Location, Latitude, Longitude, GPS Accuracy (m), EnviroCheck Sheet, EnviroCheck Question, Priority, Description Code, Repeat Of, Description, Timestamp, Photo 1…Photo N` (N = max photos on any entry, min 2). Coordinates fixed to 6 decimals; `quote()` handles commas/quotes/newlines.

**XLSX** (ExcelJS, NPS-only layout built by `addAuditSummarySheet()`, `addWasoSheets()` and the raw sheet in `runExport()`):

- **Sheet 1 "Audit Summary":** export time, audit team, coordinator, the loaded prior audit, then one row per park — park, name, site-visit date span, locations visited, counts by priority (1, 2a, 2b, 3, 4, P), total, repeats, and counts by citation source (`citationSource()`: 40 CFR (EPA), 29 CFR (OSHA), 49 CFR (DOT), State / local / other, Executive Order, DOI policy, NPS policy, BMP, BMP-P, No citation) — the same breakdown as the report's dashboard table. Tank-check and personnel summaries below.
- **One "Audit Report <PARK>" sheet per park** (`wasoRow()`): columns A–S carry the 19 WASO template headers verbatim — `Park | Finding Number | Audit Date | Priority | NPS EnviroCheck Sheet | Location | Citation (for P1, P2a, P2b, and P3) | Citation (for BMP; BMP-P for positives) | Description Code | Finding Description | Recommended Corrective Action | Assigned Estimated Completion Date | Responsible Party | Other Sources Of Information (optional) | Repeat Finding | Repeat Finding Citation | Park Comment on Draft Audit Report | Progress Towards Corrective Action Completion (Date) | Date Completed` — so the block pastes into the official file unchanged. Finding Number is the text `001…`; Audit Date is a real date cell (UTC midnight, `m/d/yyyy`) from the entry timestamp; Location is the location name without the ` — CODE` suffix, or the park code when blank; the regulatory citation (the part of `teamGuideCitation` after ` — `) goes to column G for priorities 1/2a/2b/3, to column H for a 4 (`BMP` when there is none), and column H reads `BMP-P` for a P; Repeat Finding is Yes/No for 1/2a/2b/3 and blank for 4/P unless marked; Repeat Finding Citation is `YYYY-Finding ###`. Columns K–N and Q–S are left for the office. Column T `Photos` (grey header) is app-only: the entry's photo numbers as 3-digit collapsed ranges (`001–003, 005`). Rows in finding order, header frozen with the first two columns, brown header, thin borders, wrap text.
- **"NPS Entries"** (raw): the same columns as the CSV; `Entry #`, GPS columns, and all photo columns **hidden** by default so reviewers see a clean sheet but the data is still there.
- **"SPCC Tank Check"**, **"LOC Sites"** and **"Personnel"** (§18) when they hold anything.
- **Word files in the ZIP** (v2.3): `NPS_Notes_<date>.docx` lists only the notes, per park, in the Field Notes sheet's order with the same photo numbers; `NPS_LOC_Sites_<date>.docx` holds one EDL site data form per site (§18.3). Both need the docx library; if it is missing the ZIP still ships and the toast says the Word files were left out.

**Integrity guard:** every missing photo (all three storage tiers empty for a referenced dbKey) is counted during the ZIP build; if any are missing, a `confirm()` names the affected entries and forces an explicit choice between "export anyway (incomplete)" and cancel. A short export can never ship silently.

**Delivery:** `shareOrDownload()` — Web Share API with a `File` (native share sheet on iOS; the user typically AirDrops or saves to Files), falling back to an `<a download>` blob click in desktop browsers. A cancelled share sheet (`AbortError`) returns false: nothing is stamped, and the toast says nothing was saved or sent (v2.2). Send to SharePoint does not use this path (§20.4).

**After a successful export** every exported entry in `savedEntries` is stamped `exportedAt` (the clones exported are matched back by id) — for Send to SharePoint, only once SharePoint has confirmed the write. The saved list renders a green "✓ exported" or amber "⚠ not exported" badge per entry, and single-entry delete confirms with the entry's export status ("NO export record — this entry may never have left the device!"). Nothing else happens: see §11.0.

**Backups** (`saveBackup`) are JSON named `NPS_Backup_MMDDYY.json` holding every entry **with its photo references and thumbnails** — never the full-size bytes — plus the tank list, LOC sites, personnel, audit header and prior audit. `importBackup` merges or replaces through `normaliseEntry()`; restoring on the same device re-attaches the photos still stored under those keys, and the integrity badge says at once whether they are all there (v4.1). The import writes through `saveAll()`: when the device is full it changes nothing and says so, instead of reporting success in memory only (v4.1). Everything a backup restores is treated as untrusted (§4).

### 11.0 After an export (v2.9)

An export stamps `exportedAt` on the entries it shipped and stops there. There is no delete prompt and no purge: entries stay on the device until deleted by hand, so the localStorage fallback copies of their photos are kept too. Every delete goes through `confirmDelete()`, which asks a second time before anything is removed; a backup import that would REPLACE the entries asks again and falls back to merging if declined; a tank-list re-import asks twice when it would delete photos (§18.1).

### 11.1 Word photo log (`generateWordReport`)

A second, independent export behind the **Word Report** button in the same dialog. It is the only feature in this app with no USFS counterpart, and it lives in its own section at the bottom of the script so the shared export code above it stays diffable.

- **Same selection as the ZIP:** the saved entries plus an exportable draft, filtered by the same date chips, and the same missing-photo `confirm()` guard.
- **Same photo numbers:** the global sequence is rebuilt in the same finding order with the identical slot ordering, and — as in `runExport()` — a photo that cannot be loaded does not consume a number. So "Photo 003" in the report is the file ending `_0003.jpg` in the ZIP and `003` in the Excel report.
- **Layout follows the report's Attachment 5:** letter portrait, 0.75 in margins, Arial. A brown banner (parks, counts by priority, photo count, date span), then **one section per park** (page break between parks) listing **every finding in finding-number order**: a `keepNext` header block — `Finding NNN · Priority 2b · <sheet>`, location, description, question + description code, `Repeat of YYYY-Finding ###` — followed by its photos, one per row inside a single-cell `cantSplit` table captioned `Photo NNN · Finding NNN` with GPS and capture time, or a single **"No Photo Available"** card when the finding has none. Each image keeps its aspect ratio, fitted into 640 × 330 px at 96 dpi, which puts two photos on a page. Audit team and park personnel tables close the document.
- **Report only:** it does **not** stamp `exportedAt` and does **not** offer the post-export delete. The ZIP remains the archival export — the same split the DLA tool uses.
- **Delivery:** `shareOrDownload()` with `NPS_Photo_Log_<PARKCODES>_MMDDYY.docx`.

Note: docx 8.2.2 names every embedded image `.png` inside the package whatever its real format. The bytes are the stored JPEGs and Word reads them (the DLA tool has shipped this combination for months), but re-check in Word if the library is ever upgraded.

## 12. Service worker (`sw.js`)

Small but load-bearing — it has caused more field bugs than any other file in the sibling app.

- `CACHE_NAME = 'nps-collector-v4.6'` — kept equal to `APP_VERSION` in `index.html`, and **bumped whenever any cached file changes** (`index.html`, `sw.js` itself, either data JSON). The bump is what makes installed PWAs and the iOS WebView pick up changes; the bottom bar reads both and says "updating…" while they disagree.
- Precache list (`URLS_TO_CACHE`): `./`, `index.html`, `envirocheck_checklists.json`, `nps_locations.json`, JSZip, ExcelJS, docx. `ESSENTIAL` is the app and the two data files.
- **Genuine answers only (v3.1–v3.3).** Park wifi puts captive portals in front of everything, and a portal answers any request with a 200 and a login page. `isGenuine()` refuses anything not ok, redirected or opaque; a `.json` must carry a JSON content type and parse (the 4 MB `nps_locations.json` only has its first 64 bytes read, via `readHead()`, so it is never pulled into memory twice); a library must not read as HTML; the page must contain "NPS Photo Collector".
- **Install:** each file is fetched on its own as `new Request(url, {cache:'reload'})` and stored only if `isGenuine()` says so, so a portal at install time caches nothing and the previous working copy survives. The `reload` is critical: without it the SW install reads through the **browser HTTP cache**, and a stale `max-age` copy of the data JSON gets baked into the brand-new SW cache — this exact bug shipped day-old citation data in the USFS app in July 2026 despite a cache bump. `skipWaiting()` activates immediately.
- **Activate:** old caches are deleted only once the new one holds everything in `ESSENTIAL`, so an incomplete install never leaves a device with no working copy; then `clients.claim()`.
- **Fetch:** non-GET requests and anything under `/.auth/` or `/api/` go straight to the network, never cached (v3.9) — uploads and sign-in must not be answered from a cache. Navigations and anything ending in `.html`, `/` or `.json` are **network-first**, fetched with `{cache:'no-cache'}` (forces conditional revalidation, cheap ETag 304s); `cacheIfGenuine()` clones the response before any await and stores the copy only if it is genuine, and a data file offline never falls back to the app shell. Everything else (the CDN libraries) is cache-first.

The Azure config (§13) is the server half of the same fix: the data JSONs are served `public, no-cache` so the client always revalidates; `sw.js`, `index.html`, and `manifest.json` are `no-cache, no-store, must-revalidate`.

## 13. Hosting and deployment

**Web:** push to `main` → GitHub Actions (`azure-static-web-apps.yml`, `skip_app_build: true`, `api_location: "api"`) → Azure Static Web Apps (`nps-data-collector`, ~1 min deploys; the `api/` folder deploys as managed functions on Node 20). `staticwebapp.config.json` additionally sets a navigation fallback to `index.html` (excluding JSON and images), JSON MIME types, `public, no-cache` on both data JSONs, and security headers (nosniff, DENY framing, strict referrer).

**Sign-in and the API routes (v3.9).** Sign-in is Static Web Apps' built-in Microsoft provider — `/.auth/login/aad`, `/.auth/me`, `/.auth/logout` — so there is no sign-in app registration to maintain. `/api/upload` and `/api/upload-session` carry `allowedRoles: ["authenticated"]`, and `responseOverrides` turns the platform's sign-in redirect into a plain 401, because a `fetch` would otherwise follow the redirect and read the login page as success. The functions read their settings (`GRAPH_*`, `ALLOWED_DOMAIN`) from the Static Web App's application settings; the list and the one-time setup are in [api/README.md](api/README.md).

**What a 200 means here.** The navigation fallback answers any unknown path with the app itself and a 200, so a status code proves nothing about whether a file exists — check the body. Everything in the repository root is published, these documents included; the repository itself is public too.

**iOS (not yet shipped):** `npm run sync` (copies the file list in package.json's `build` script — `index.html sw.js manifest.json envirocheck_checklists.json nps_locations.json` — into `www/`, then `npx cap sync ios` into `ios/App/App/public/`) → bump `CURRENT_PROJECT_VERSION` in **both** Debug and Release blocks of `project.pbxproj` (Apple rejects reused build numbers; `MARKETING_VERSION` is user-facing and bumped rarely) → Xcode Product → Archive → Distribute. Before the first upload the generated project still needs: camera / photo-library / location usage strings and `ITSAppUsesNonExemptEncryption=false` in `Info.plist`, `DEVELOPMENT_TEAM = QV4MJ85JSK` in both pbxproj configs, the NPS app icon in `Assets.xcassets/AppIcon.appiconset`, and an App Store Connect app record for the bundle id. Info.plist references the version fields via `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` — never hardcode there. Full checklist in the TestFlight playbook.

**The dual-channel skew rule:** the web app updates the moment a user reloads twice (SW update dance); the iOS app only updates when someone archives and uploads a new build. Between iOS builds the two channels intentionally run different versions of the same file — the SW cache-name discipline is what keeps each channel internally consistent.

## 14. Data build pipelines (developer-side, Node, no npm deps)

### 14.1 `build_envirocheck.js`
Parses the NPS EnviroCheck Sheets (`.docx`) into `envirocheck_checklists.json` (+ the `www/` copy). The sheets are NPS documents and live in SharePoint, not in this repo: `SRC_DIR` at the top of the script points at the local copy, and the folder can also be passed as the first argument. Each sheet is one topic; inside it, every checklist table carries a header row `[section name | (Y/N/NA) | Priority]`, which is where the section label comes from, and each following row is `[number | question + [citation] + guidance | answer | P1–P4]`. The parser pulls the bracketed citations into `r`, drops trailing `NOTE:`/`Auditors:` guidance, caps a question at 400 characters, and numbers each question `<SHEET>.<NN>` from the sheet's own numbering (falling back to a running counter where Word auto-numbered the list). Needs only Node and the system `unzip`. Run `node build_envirocheck.js` after any sheet update, then bump the SW cache.

Current yield: 810 questions — AQ 108, FSM 130, HW 90, HM 76, ODS 62, EPR 50, SPCC 42, SW 38, LAB 31, EPP 29, IPM 29, UW 28, RP 23, HC 22, WW 21, UO 17, STW 15.

### 14.2 `build_locations.js` (NPS-specific)
Fetches three **public, key-less** ArcGIS services directly (Node 18+ global `fetch`, 2,000-record pages, retries, raw pages cached under `nps_raw/`; `--refresh` re-downloads):

1. **NPS Boundary Centroids** (Land Resources Division service on ArcGIS Online, layer 0) — 442 rows → 429 distinct park units after de-duplicating spelling variants on normalized name (`UNIT_CODE`, `UNIT_NAME`, `REGION`, plus the centroid in WGS84 via `outSR=4326`).
2. **NPS Public Points of Interest** (`mapservices.nps.gov/…/NationalDatasets/NPS_Public_POIs_Geographic`) — 35,570 rows. Kept: 22,134. Dropped by type (`POI_EXCLUDE`, ~130 types): per-item clutter (campsites, benches, signs, mile markers, bear boxes…), natural features (peaks, lakes, waterfalls…), route/road points, gazetteer places; also dropped: planned/removed/non-extant, unnamed-and-untyped.
3. **NPS Public Buildings** (`…/NPS_Public_Buildings_Geographic`) — 29,054 polygons queried with `returnCentroid=true`. Kept: 26,103 (decommissioned / excess / inactive / non-extant dropped). `BLDGTYPE` is cleaned (`Bldg ` prefix and ` (GSF)` suffix stripped) into `t`.

Name resolution is `POINAME`/`BLDGNAME` → `MAPLABEL` → alt name; the Midwest region publishes most of its geometry with only `MAPLABEL`, and ~1,000 features with no name at all but a facility-grade type are kept as `"<Type> (unnamed)"` (`UNNAMED_KEEP_TYPES`). Feature unit codes are matched to the master list (uppercased; sub-unit codes that are not LRD units, such as `PARA` or `NACE`, get one canonical name per code — the shortest spelling seen). Units with nothing mapped keep their boundary centroid as a single `Park Unit` location so every unit stays selectable and GPS-detectable (52 units). Per park: dedupe on name + coords to 3 dp, sort by name; parks sorted by name. Output: minified `nps_locations.json` (+ `www/` copy if present) and the `REGION_MAP` literal rewritten in `index.html`.

Region labels come from the boundary data's `REGION` field (`AKR IMR MWR NCR NER PWR SER` → `REGION_LABELS`); anything else would land in `OTH — Other / Unassigned` (currently none).

**Not used:** the NPS Data API (`api.nps.gov`) — its `/parks`, `/visitorcenters`, `/campgrounds`, `/places` endpoints carry coordinates and names but require a per-developer API key (every request returns `API_KEY_MISSING` without one). It remains an option for backfilling named visitor centers/campgrounds in regions with poor GIS naming.

## 15. Security & privacy posture

- **Capture and export are entirely client-side.** Data leaves the device through the auditor's own export, or — once they have signed in — through live backup and Send to SharePoint (§20).
- **The device holds no Microsoft credentials and no shared key.** The functions sign in to Graph as their own app registration, which has `Sites.Selected`: write access to one SharePoint site and nothing else in the tenant. Its secret lives only in the Static Web App's application settings.
- **Two gates, both on the server.** Static Web Apps refuses the API routes to anyone signed out, and `admit()` in `api/shared/graph.js` refuses any account whose address does not end in `@` + `ALLOWED_DOMAIN`, on both verbs of both functions. The built-in provider admits any Microsoft account, so the second gate is the one that keeps outsiders out.
- **Paths.** The device names a destination *key*, never a library, and the function resolves it; a key not on the list is refused. `safeSegments()` strips `..`, drive letters, leading slashes and control characters from every folder and file name. Each destination's `root` is the boundary that matters, because `Sites.Selected` covers the whole document library. An upload-session URL is scoped to one file and expires on its own.
- **Untrusted input.** Imported workbooks, tank tables and JSON backups are checked where they enter and escaped where they are shown (§4); location names in picker `onclick` handlers get quote-escaping. The app never renders remote content.
- **Cookies:** only the Static Web Apps session cookie, after sign-in. No analytics, no telemetry.
- **Public by design.** The Azure URL, the repository and these documents are public. Nothing secret lives in the repo; settings with secrets exist only in Azure.
- **`privacy.html`** was written for the offline-only app and says the App itself does not transmit data to any server. That stops being true once live backup is switched on, so the policy needs revising before it is relied on — and before any App Store submission.

## 16. Known constraints & sharp edges (institutional memory, inherited from USFS)

1. **Wi-Fi-only iPads have no GPS hardware** — location comes from Wi-Fi BSSID lookup and is useless in the backcountry. Use cellular-SKU iPads (GNSS works without a SIM), an external Bluetooth GPS (Bad Elf/Garmin GLO — iOS treats it as the system source), or an iPhone. Tethering does *not* relay the phone's GPS.
2. **iOS storage eviction** is why the filesystem tier exists (§7). Don't "simplify" photo storage back to IDB-only.
3. **The SW cache name is the release mechanism.** Changed a cached file? Bump `CACHE_NAME` or field devices won't see it. And keep the `cache:'reload'` / `no-cache` fetch options — removing them reintroduces the stale-JSON bug.
4. **`<input type=file>` recreation** on every camera tap is deliberate (iOS stale-file bug). So is the missing `capture` attribute on Browse.
5. **iOS re-encodes photos and strips EXIF** through file inputs; original-quality/EXIF capture would require the Capacitor Camera plugin.
6. **SheetJS community edition can't style cells** — that's why ExcelJS, despite ~500 KB.
7. **Every web release bumps `APP_VERSION` and `CACHE_NAME` together** — the version stamp is how anyone tells which build an iPad is running. iOS build numbers move only with an iOS build.
8. **`www/` is generated** — edit root files, run `npm run sync`.
9. The 3-digit Photos column vs 4-digit filenames in the XLSX report is a deliberate user preference, not a bug.
10. Storage warnings use the browser's real quota from `navigator.storage.estimate()` and warn at 70% of it (v2.9); without a usable quota they fall back to warning at 40 MB of an 80 MB working limit (`STORAGE_WARN_MB`, `STORAGE_LIMIT_MB`).
11. **NPS:** `nps_locations.json` is 4.2 MB (USFS: 2.7 MB) — still parsed in well under a second on an iPad, but keep the type exclusions in `build_locations.js` when refreshing rather than dropping them.
12. **NPS:** `REGION_MAP` is generated — hand edits are overwritten by the next `node build_locations.js`.
13. **Live backup is foreground-only.** iOS gives a web app no background uploads. The queue drains while the app is open and online, survives reloads, and is reconciled against every photo on the device at the first drain after launch, so a lost or truncated queue costs nothing (§20).
14. **A Static Web Apps function will not take a request body anywhere near the Functions limit** — about 30 MB in practice, and `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT` is erased on SWA. That is why the export ZIP goes straight to SharePoint through an upload session instead of through `/api/upload` (§20.4). Graph wants upload-session chunks in multiples of 320 KiB, sent in order.
15. **WebKit drops IndexedDB connections** after the app has sat in the background. Every IndexedDB call goes through `withPhotoDB()` (§7); a new one must too.
16. **Two copies of the app share one storage** — a second tab, or the Home Screen icon beside a browser tab — and every save writes a whole list. So nothing may write on hide or close except edits still waiting on a debounce (`flushPendingSaves()`), or a stale copy puts its old lists over newer work (v4.6).
17. **Chrome, Safari and every other browser on iPad run WebKit.** Test in WebKit (Playwright's `webkit` with an iPhone or iPad profile), not only Chromium, before deploying.

## 17. How to extend safely (checklist)

- **Sibling first:** before changing shared code, diff `index.html` against the USFS copy; apply the identical hunk to both apps (or note why not).
- Editing `index.html`/data JSON → test in a browser (`python3 -m http.server 8080` or the deployed URL), **bump `CACHE_NAME` in `sw.js` and `APP_VERSION` in `index.html` together** (the bottom bar shows the running version; it reads the cache names and says "updating…" while they disagree, so a missed bump is visible), push to `main` (web ships), and note the iOS channel stays behind until the next TestFlight build.
- New cached asset → add to `URLS_TO_CACHE` *and* bump the cache name *and* (if it must ship in the iOS bundle) add it to package.json's `build` copy list.
- New entry field → touch all of: the form HTML, `saveEntryAndNew()`, `saveEdit()`, `editEntry()` (via `loadNpsFields()` for NPS fields), `autoSaveCurrent()`/`loadAll()`, `normaliseEntry()`, the draft objects in `runExport()`, `generateWordReport()` and `saveBackup()`, the CSV row, the XLSX sheets, and the saved-panel renderer.
- New photo behavior → preserve the verify-after-write contract and the three-tier delete.
- Anything touching citations/locations data → regenerate via the build scripts, never hand-edit the JSON or the generated `REGION_MAP`.
- New priority value → add the button, extend `PRIORITIES` / `PRIORITY_RANK` (§19), decide how `wasoRow()` places its citation, and update the two validation toasts.
- Renaming an EnviroCheck sheet → change the `<option>`, `NPS_SHEETS`, and add the old spelling to `SHEET_RENAMES` so saved entries migrate.
- New state worth keeping → add it to `saveBackup()` and, for live backup, to `backupStateFile()`; give its restore a cleaner; anything restored that reaches HTML goes through `esc()` / `_attr()`, and an image through `safeThumb()` (§4).
- New upload → one file up to 8 MB through `sendToBackup()` and `/api/upload`; anything larger through `uploadBigFile()` and `/api/upload-session`. Queue items get their `folder` and `target` stamped when they are queued, never resolved at send time (§20).
- New list with typed fields → save at once, or use a debounce timer that `flushPendingSaves()` knows about and that is set back to null when the save runs. Never write a whole list on hide or close (§16).
- New IndexedDB access → through `withPhotoDB()` (§7).
- New wait on a photo → register the capture in `_photoCapturesPending` and release it however the capture ends (§7).
- Before shipping a fix → reproduce the bug on the current build, then show the fix with the same test, in WebKit.

## 18. SPCC tank check and personnel (NPS only)

Two audit needs the photo pipeline alone could not cover. Both live in one section at the bottom of `index.html`, next to the Word log, and both are invisible in the exports until they hold something.

### 18.1 Tank verification

**Import.** The park's SPCC plan tables arrive as a Word file ("MDI Tables 1-3.docx"). A `.docx` is a zip and JSZip is already loaded for the export, so `parseTankDocx()` reads `word/document.xml` in the app and no conversion step is asked of the auditor. Per table it takes the one-cell caption row as the group title, the first row with four or more filled cells as the header, and every row after that as a tank. **Rows whose first two cells are blank are continuation rows** — the plan gives each tank a second row for another discharge scenario — and are folded into the tank above rather than counted as tanks. On the Acadia MDI file that turns 48, 8 and 17 table rows into 24 covered tanks, 6 oil-filled units and 15 excluded containers.

**Re-import** replaces the list. When checked tanks carry photos it asks twice, the second time saying how many photos go; it writes the new list first and deletes the old photos only once that write has succeeded, so a failed write leaves the old list and its photos exactly as they were (v4.1). Imported rows, like rows restored from a backup, pass through `cleanTankData()`.

**Field mapping.** `TANK_FIELDS` matches on header text, longest-specific first, so `container type` wins over the looser `type` before `Type of failure (discharge scenario)` can claim it. Every original column is kept in `row.cols` and carried into the export, whatever the plan's vintage; only the six fields worth checking on a walk are shown on screen.

**Checking.** Each row takes one of three states — `ok` Confirmed, `diff` Discrepancy, `missing` Not found — plus a corrected-values field, free notes, and any number of photos through the same verified three-tier write the findings use. Typed fields save on a 400 ms debounce (`setTankText`); closing the list or hiding the app flushes a pending one. `addManualTank()` covers a container found on site that the plan never listed; those rows land in their own group and start as a discrepancy.

**Promotion.** A tank problem becomes a finding only when the auditor asks. `promoteTank()` clears the draft, fills in the location, the `SPCC Planning` sheet and a description built from the plan's values, the observation and the note, suggests priority `2b` and description code `Plans` (both still yield to the question pick), and **copies** the tank's photo bytes into fresh keys under the draft entry, so the tank sheet and the photo log each stand alone. Each copy takes a moment, so after every await it checks the draft is still the one it started with, and it looks the row up again before stamping it (v4.0). It stamps `promotedAt` on the row and leaves the citation for the auditor to pick.

**Export.** `buildTankExport()` appends tank photos to the same `photos/` folder, continuing the export's own numbering after the entry photos, so "Photo 041" in the tank sheet is the file ending `_0041.jpg`. `addTankSheet()` adds an **SPCC Tank Check** sheet carrying the plan's values beside the status, corrections, notes and photo numbers. Tank photos are counted by the integrity badge and by the export's missing-photo guard. The tank check is **not** date-filtered: a list belongs to the park visit that imported it. The list remembers the park it was imported under (`tankData.park`) for the photo file names.

### 18.3 LOC / EDL sites (v2.3)

A Location of Concern gets the NPS EDL site data form (27 rows, chosen answers highlighted yellow, then a photo page). `EDL_FORM` holds the form row by row in its own wording; rows with `pick` are captured on the phone as tap buttons (`SITE_CHOICES`): site access (several allowed, as auditors mark them), affected media, resource impact, footprint, emergency response and stability. Name, EDL ID, points of contact and field notes are typed; GPS comes from `captureSiteGPS()`, which calls the geolocation API directly so the entry form's GPS and location are untouched. Auditor, visit date, region and park alpha fill themselves from the team list, the first photo's time and the park. Every other row is written with all answers listed and none highlighted, for the office. Photos use the tank photo path (same resize, verified write, integrity badge) and carry a caption and a facing direction (N…NW, or Map / Aerial for the form's two fixed slots); `sitePhotoLabels()` words them as "Photo 1 – Parking lot (North)". `buildSiteExport()` numbers site photos after the tank photos; `addSiteSheet()` and `buildSitesDocx()` write the sheet and the forms. Sites are not date-filtered, ride in the backup (`sites`) and are restored only onto a device that has none; restored site photos pass through `cleanSites()` (§4).

**GPS and compass (v2.7–v2.8).** A new site takes its own GPS as soon as it is created, and again at its first photo if it still has none, silently if the device refuses. A **Compass** button in the Sites list pre-selects the facing of each new camera photo from the device heading (`webkitCompassHeading` on iOS, `deviceorientationabsolute` elsewhere, rounded to the nearest of eight points by `headingPoint()`), marked as set by the compass until tapped; library photos are never pre-selected, and the listener runs only while the list is open. **Gaps:** `siteGaps()` lists what is still blank among the rows the phone fills — GPS, photos and the six tap-button rows — in the row, the list summary and the Export dialog; gaps never block an export. Typed fields and captions save on a 400 ms debounce (`setSiteText`, `setSitePhotoCaption`), flushed when the list closes or the app is hidden.

### 18.2 Team and personnel

One dialog holds three lists kept at audit level rather than per entry, because that is how the report's Attachment 2 reads: the **audit team** (`{name, org}`) and the **NPS regional environmental coordinator** (name + title) in `nps_audit`, and the **park personnel contacted** (`{name, title}`) in `nps_people`. They become a **Personnel** sheet in the workbook (role, name, title/organization), the header block of the Audit Summary, and "Audit Team" / "Park Personnel Contacted" tables at the end of the Word log. Nothing carries over between audits by design; the dialog's Clear All wipes all three.

All of it rides along in the JSON backup and is restored only when the device has none, so a backup can never overwrite work in progress.

## 19. NPS audit data: priorities, description codes, finding numbers, prior audit (NPS only)

The **NPS AUDIT DATA** section of `index.html` (just above the tank check) holds what the WASO findings spreadsheet needs beyond a photo and a note. The design rule throughout: **suggest in the field, decide in the office** — the app pre-fills what the question implies and never blocks on it.

**Sheets.** `NPS_SHEETS` is the list of 17 EnviroCheck sheets with the WASO pulldown spelling, the question-code prefix, and a loose regex that recognises older spellings (`"Solid Waste"`, `"SPCC "`). `normaliseSheet()` brings any spelling to the WASO name; `sheetCodeOf()` gives the prefix.

**Priority.** `PRIORITIES = ['1','2a','2b','3','4','P']` (listed explicitly — object key order would put the numeric-looking keys first). A seventh button, **Note** (`NOTE = 'N'`), is a general observation rather than a finding: `updateNoteMode()` hides the sheet card, the description code and the repeat row while it is selected; `findingOrder()` sorts notes after P within the park (`scoreRank()`), `findingNumbers()` gives them no number and skips them in the count, `addWasoSheets()` leaves them out, `addNotesSheet()` puts them on a **Field Notes** sheet (park, date, location, note, GPS, photos), the Audit Summary counts them in a Notes column, and the Word log heads them "Field Note" with photo captions "Photo NNN · Note". Old `Observation` scores migrate to Note. Picking a question calls `applyQuestionDefaults()`: it sets the sheet from the code prefix, and — when no priority is chosen yet, or the current one was itself a suggestion (`scoreAuto`) — maps the question's P-level `P1→1, P2→2b, P3→3, P4→4` and shows a hint. A tap on a button clears `scoreAuto`, so the auditor's choice survives later question changes; tapping the button the question suggested confirms it rather than toggling it off (only a self-chosen priority clears on a second tap). `scoreAuto` is autosaved with the draft.

**Description code.** `DESC_CODE_RULES` is an ordered list of `[code, regex]` over the question wording (plans, reporting, records, training, labels, monitoring, disposal, releases, storage, implementation); `suggestDescCode()` returns the first match. The same `descCodeAuto` discipline applies: a suggested code follows the question (and clears when a new question suggests nothing), a code the auditor picked stays.

**Park code.** Every entry stores `park` at save time (`currentParkCode()`: the ` — CODE` suffix of the location first, then the selected park, then — when an entry is edited — the park it already had). `entryParkCode()` reads it back, falling back to the suffix for entries saved before 2026-09-20.

**Finding numbers.** Never stored. `findingOrder()` sorts export entries by park, `PRIORITY_RANK`, sheet, question code, location name, then original order — the WASO instruction's "Priority, EnviroCheck Sheet, Citation, Location" — and `findingNumbers()` counts `001…` per park. Both exports call it, and the photo sequence follows the same order, so finding 001 owns photo 001 and the numbers only shift when the exported set changes (which is expected: the office assigns the final numbers on the same rule).

**Citation source.** `citationSource()` classifies the regulatory citation for the Audit Summary: 40/29/49 CFR, `EO`/Executive Order, DOI (`DM`), NPS (`DO`, `RM`, `NPS-`), BMP wording or a priority 4, `BMP-P` for a P, and everything else (NFPA, state statutes such as `12 MRSA`) as State / local / other.

**Prior audit.** `importPriorAudit()` reads the previous audit's findings spreadsheet in the app with ExcelJS (`parsePriorWorkbook()`): every worksheet is scanned for a header row containing "Finding Number" and "Priority" (the official template has a blank first row; older files start on row 1), columns are matched by header text (`COLS` regexes), each data row becomes `{park, num, date, priority, sheet, code, location, citation, bmp, descCode, desc, action, repeat, repeatCite}`, and the audit year is the most common year in the Audit Date column (the auditor is asked when there is none). Cell values may be strings, numbers, dates, rich text or formulas — `_cellText()` / `_cellDate()` flatten them. The **Prior** dialog lists findings by park with park and sheet chips and a text filter; opened from the entry form (`showPriorPicker()`) it pre-selects the current park and tapping a finding runs `pickPriorFinding()`: `repeatOf = {year, park, num, priority, sheet, citation, desc}` goes on the draft, a repeated 2a/2b **bumps an empty or 2b priority to 2a** (the definition of 2a), the sheet is **set to the prior finding's sheet** (the sheet carries over between entries, and a repeat is on the prior sheet by definition), and a blank or suggested description code is filled from the prior finding. The export writes `Repeat Finding = Yes` and `Repeat Finding Citation = YYYY-Finding ###` (`repeatCitation()`), and when no question was picked the prior finding's citation is used for the citation column; the Word log adds a "Repeat of …" line. Clearing the prior list keeps repeats already marked on entries.

**Backup.** `nps_audit` and `nps_prior` ride along in the JSON backup and are restored only when the device has none. A restored prior audit must carry a list of findings, and its year is kept only if it is a number (v4.6).

## 20. Live backup and Send to SharePoint (v3.6–v4.6, NPS only)

Two optional paths into the firm's SharePoint library ("Project Files", under `NPS/Audits`). The setup — the app registration, its one-site permission, the application settings — is in [api/README.md](api/README.md); this section is how it works.

```
 device (signed in with Microsoft)       Static Web App (api/)                  Microsoft 365
 ─────────────────────────────────       ─────────────────────                  ─────────────
 backup queue in localStorage
   POST /api/upload  (≤ 8 MB)  ──────▶  route: authenticated only
                                        admit(): address in ALLOWED_DOMAIN
                                        graphToken(): the app's own sign-in ──▶ Graph PUT ──▶ one library
                                                                                 (Sites.Selected)
 Send to SharePoint
   POST /api/upload-session  ────────▶  same gates → createUploadSession ────▶ upload URL for one file,
                                                                                 expires on its own
   PUT 5 MiB chunks straight to that URL, resuming from nextExpectedRanges ─────────────────────▶
```

### 20.1 What goes up

Under `<root>/<folder>/`, where the root belongs to the destination (§20.3) and the folder is the one typed in Settings, or `<park>/<year>/Live Backup` when none is:

| File | Contents | When |
|---|---|---|
| `state/<device>_state.json` | Every entry without its photos, the LOC sites, the tank list, personnel and the audit header, with the app version and the time | Replaced about 2.5 s after any save |
| `photos_<device>.csv` | A row per photo: the file name exactly as uploaded, whether it belongs to a finding, a note, an SPCC tank or a LOC site, the park, location, description, priority, slot and time taken | With the state file; skipped when unchanged (v4.2) |
| `photos/<YYYYMMDD>/<key>.jpg` | Each photo once, named by its storage key, in the folder for the day it was **uploaded** | As each photo is captured |

The names are storage keys because the export's tidy names cannot be known at capture time: the sequence number in `…_ACAD_0007.jpg` is assigned across every finding at export time, and a location can still be edited afterwards. `<device>` is `nps_device_id`. The ZIP from Send to SharePoint lands one level up, in `<root>/<park>/<year>/`, beside the exports copied there by hand.

### 20.2 The client (LIVE BACKUP section of `index.html`)

- **The queue** (`nps_backup_queue`) holds `{k: 'state'|'index'|'photo', key?, folder, target, n?}`. `queueBackup('state')` is debounced and deduplicated and brings an `index` item with it; photos are queued as each one is captured (findings, tanks, sites). The **folder and destination are stamped when an item is queued**, never resolved when it is sent, so switching park or destination later cannot misfile work already waiting.
- **Draining** (`drainBackupQueue()`, every 30 s and on `online`) makes one pass per call. The network and the backoff are checked before the account, so no signal is never reported as a sign-out. A file SharePoint refuses (400/502) steps to the back after three tries instead of blocking everything behind it; any other failure pauses the queue — a minute, or ten for 401 and 503. The first drain after launch runs `reconcileBackupQueue()`, which re-queues every photo not in `backupDone` plus the state file and the index: the stored queue is a convenience, not the record, and a queue lost or truncated at its 2,000-item cap costs nothing.
- **The account.** `refreshBackupUser()` asks `/.auth/me`. The last account confirmed is remembered in `nps_backup_cfg`, and only a real answer saying nobody is signed in clears it; an unreachable `/.auth/me` keeps it. Sign-in and sign-out are redirects to `/.auth/login/aad` and `/.auth/logout`.
- **The badge** never claims more than it knows: `☁ backed up` only with an account and nothing waiting, `☁ n waiting` while work is queued, `☁ sign in to back up` when nobody is signed in.
- **Destinations.** `GET /api/upload` returns the destinations as `{key, label, root}` — never a drive id. The device stores only a key, and the picker hides itself when there is one destination. A stored key the server no longer offers falls back to the default with a toast, because with the picker hidden there would otherwise be no way back. The list is fetched one request at a time, and at most once a minute from the Settings dialog (v4.6).
- **Settings** fills its fields only when it opens; a repaint that arrives later from the network never touches what the auditor is typing (v4.6).

### 20.3 The functions (`api/`)

- **`shared/graph.js`** — everything both functions share, so they cannot drift: `cfg()` (the application settings); `targets()` / `resolveTarget()` (the destinations from `GRAPH_TARGETS`, the first being the default, a key not on the list refused rather than redirected; without that setting, the single `GRAPH_DRIVE_ID` or `GRAPH_SITE_ID` destination under `GRAPH_ROOT_FOLDER`); `admit()` (401 with no principal, 403 outside the domain); `graphToken()` (client credentials, cached while warm); `safeSegments()` / `safeFolder()` / `safePath()`; `itemUrl()` / `fullPath()`.
- **`upload/`** — `GET` reports whether it is configured, who is asking and the destinations; `POST {path, folder, target, contentBase64, contentType}` writes one file of up to 8 MB with `PUT …/content?@microsoft.graph.conflictBehavior=replace`.
- **`upload-session/`** — `POST {path, folder, target, size}` (up to 512 MB) calls `createUploadSession` for that one path and returns `uploadUrl` and its expiry. It never carries the bytes.

### 20.4 Send to SharePoint

`runExport('cloud')` builds the same ZIP as Export ZIP; `sendExportToSharePoint()` then hands it to `uploadBigFile()`, which starts a session and PUTs the ZIP in 5 MiB chunks (16 × 320 KiB) with a `Content-Range` header. A 202 carries `nextExpectedRanges`, where the next chunk starts; 200 or 201 means done. When a chunk fails — the wifi drops behind a building — the client waits, asks the session URL where it got to with a plain `GET`, and carries on from that byte; 404 or 410 means the session expired, and six failures in a row give up. The upload URL is pre-authorised and scoped to one file, so the bytes go from the device straight to SharePoint and the device still holds no credentials. This was verified cross-origin, from the app's own origin, in Chromium and WebKit against the tenant, including a chunk killed mid-upload.

Entries are stamped `exportedAt` only once SharePoint confirms the write. A failure says that nothing was marked as exported and that it can be sent again — the ZIP only ever existed in memory. The dialog's behaviour while it runs is in §11.
