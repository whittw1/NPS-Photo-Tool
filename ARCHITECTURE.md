# NPS Photo Collector — Architecture

**Document date:** 2026-09-10 · reflects service-worker cache `nps-collector-v1.0`, iOS marketing version 1.0 / build 1 (scaffold only, never uploaded).

This is the deep-dive technical reference. Companion documents:
- [README.md](README.md) — feature overview and the USFS-vs-NPS difference table
- [WEB_TO_TESTFLIGHT_PLAYBOOK.md](WEB_TO_TESTFLIGHT_PLAYBOOK.md) — the iOS build/upload pipeline (inherited from the USFS app)
- [AZURE_DEPLOYMENT_PLAYBOOK.md](AZURE_DEPLOYMENT_PLAYBOOK.md) — the web hosting pipeline (inherited from the USFS app)
- [Status.md](Status.md) — current deployment status and open decisions

**Provenance:** this app is a fork of the [USFS Photo Collector](https://github.com/whittw1/USFS-Photo-Tool) (taken at its commit `74667a4`, 2026-09-10), which is itself a fork of the DLA Audit Photo Tool. The USFS `ARCHITECTURE.md` describes the shared design in the same section numbering; this document repeats the shared material so it is self-contained and calls out every NPS deviation with **NPS:** markers.

---

## 1. What this is

A field data-collection app for National Park Service environmental audits, used by HGS Engineering auditors. An auditor walks a facility, and for each finding captures: park + location (GPS-assisted), protocol area, Team Guide citation, score (Finding or Observation), description, coordinates, and photos. Everything persists on-device with zero connectivity; at the end of the day the auditor exports a ZIP containing renamed photos, a CSV, and a styled Excel findings report, delivered through the iOS share sheet (native app) or a browser download (web).

All on-device keys are prefixed `nps_` so this app, the USFS app (`usfs_`) and the DLA app can coexist on one device without data collisions.

**The sibling-sync rule:** the USFS and NPS apps are kept in sync by hand-porting fixes. Everything outside the NPS-specific sections (§4 item 4, §5 scores, §8, the export sort in §11, branding) is textually identical to the USFS `index.html` — no reformatting, renaming or restructuring — so a fix in one applies to the other as a clean copy-paste. The internal identifiers `forestData`, `selectedForest`, `loadForestData`, `onForestChange`, `autoDetectForest`, `populateForestDropdown`, `FOREST_TO_REGION`, `LS_FOREST` and the element ids `forestSelect` / `forestHint` are deliberately **unrenamed**; in this app they refer to NPS park units.

## 2. System context

```
┌────────────────────────────┐        push to main        ┌──────────────────────────┐
│  Repo (GitHub whittw1/     │ ─────────────────────────▶ │  GitHub Actions →        │
│  NPS-Photo-Tool, main)     │                            │  Azure Static Web Apps   │
└────────────┬───────────────┘                            │  (public URL, PWA)       │
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

There is **no backend, no server, no authentication, and no telemetry**. Every byte of user data lives on the device until the user exports it. The Azure URL is public; the only "API calls" the app ever makes are same-origin fetches for its own bundled JSON and the two pinned CDN script loads.

## 3. Repository layout

| Path | Role |
|---|---|
| `index.html` | **The entire application** — all HTML, CSS, and JavaScript (~3,850 lines). No build step, no framework, no modules. |
| `sw.js` | Service worker: offline caching + update discipline (§12). |
| `manifest.json` | PWA manifest (`display: browser`, brown theme `#5c3b1e`). |
| `team_guide_citations.json` | 6,445 searchable citations (federal US + FS + 7 state supplements). Array of `{c, s, d, r}` (§9). **Byte-identical to the USFS copy.** |
| `nps_locations.json` | 449 park units → 43,026 named GPS locations. `{ "Park Name": [{n, t, d, lat, lng}, …] }` (§8). |
| `build_citations.js` | Node script that regenerates the citations JSON from Team Guide markdown files (§14.1). Identical to USFS except `REPO_ROOT`. |
| `build_locations.js` | Node script that regenerates `nps_locations.json` **and** the `REGION_MAP` literal in `index.html` from NPS GIS services (§14.2). |
| `package.json` | Capacitor deps + the `build` / `sync` / `open` scripts. `@capacitor/filesystem` is the only plugin beyond core. |
| `capacitor.config.json` | Bundle id, app name "NPS Photos", `webDir: www`. |
| `www/` | Build output — a copy of the static files, what Capacitor bundles. Regenerated by `npm run build`; never edit directly. Git-ignored. |
| `ios/` | Capacitor-generated Xcode project (SPM). Version/build numbers live in `ios/App/App.xcodeproj/project.pbxproj` (both Debug and Release configs). |
| `nps_raw/` | Git-ignored cache of the raw GIS service responses used by `build_locations.js`. |
| `staticwebapp.config.json` | Azure routes/headers — cache-control per file (§13). |
| `privacy.html` | Privacy policy page required for App Store review. |
| `Team Guide Cheat Sheet.docx` | Source document for the hardcoded `COMMON_CITATIONS` list. |

## 4. Application structure inside index.html

One `<script>` block, organized into banner-commented sections in this order:

1. **Constants** — photo slots, defaults, all storage keys
2. **State** — module-level `let` variables (no state library)
3. **Init** — `init()`, called at the bottom of the script on parse
4. **Region/Park data** — generated `REGION_MAP`, `loadForestData()`. **NPS:** no score-visibility logic (the USFS `updateScoreVisibility()` and its three call sites are gone).
5. **Location list** — picker modal, haversine, GPS auto-suggest, `.txt` import
6. **Dynamic photo slots** — add/remove/renumber Photos 3+
7. **Score buttons** — `toggleScore()`, `setScoreButtons()`
8. **Save & New / Clear / Saved panel / Edit** — entry CRUD
9. **Photo handling** — capture/browse inputs, resize pipeline, IndexedDB layer
10. **Durable photo storage** — Capacitor Filesystem layer, migration, integrity (§7)
11. **Photo settings** — resolution/quality dialog
12. **Export** — dialog, date filter, ZIP/CSV/XLSX build, integrity guard, post-export delete (§11)
13. **Backup/Import** — metadata-only JSON
14. **Geolocation** — `captureGPS()`, display, accuracy coloring
15. **Team Guide citation search** — synonyms, hints, chips, recents (§9)
16. **Common Citations** — cheat-sheet quick-pick modal
17. **Persistence** — autosave, `saveAll()`/`loadAll()`, storage monitor
18. **Utilities** — CSV quoting, datestamp, `shareOrDownload()`, toast, overflow menu

All UI event wiring is inline `onclick`/`oninput`/`onchange` attributes plus two document-level click listeners (close citation results, close overflow menu). All rendering is string-built `innerHTML`; user text is escaped through `esc()` (a div-textContent round-trip) before interpolation.

### External dependencies (exactly two, both pinned, both CDN)

| Library | Version | Source | Used for |
|---|---|---|---|
| JSZip | 3.10.1 | cdnjs | Building the export ZIP |
| ExcelJS | 4.4.0 | cdnjs | The styled two-sheet XLSX (SheetJS was replaced in mid-2026 because its community edition cannot style cells) |

Both are precached by the service worker so exports work offline. If ExcelJS never loaded (fresh install that has never been online), `runExport()` aborts with "ExcelJS not loaded — go online once first".

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
| `idbAvailable` | bool | Set false the moment any IndexedDB operation fails |
| `photoDB` | IDBDatabase | Cached open handle |
| `exportDateMode` | string | 'all' \| 'today' \| 'yesterday' \| 'custom' |
| `_lastExportedIds` | array | Ids offered for post-export deletion |

### The entry object

```js
{
  id:                "e_1711234567890_a1b2",
  siteName:          "Old Faithful Visitor Education Center — YELL",  // duplicate of location (legacy)
  location:          "Old Faithful Visitor Education Center — YELL",
  protocolArea:      "Water Quality",              // one of 18 dropdown values ('' allowed)
  teamGuideCitation: "WQ.10.1.US — 40 CFR ...",    // "CODE — regulation" or bare code or ''
  score:             "Finding",                     // "Finding" | "Observation" — REQUIRED to save
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
- `photos[slot].dbKey` is the pointer to the full-resolution bytes: `photoDBKey(entryId, slotId)` = entryId with non-alphanumerics replaced by `_`, then `__`, then the slot id, e.g. `e_1711234567890_a1b2__p_main`. The same key addresses all three storage tiers.
- `photos[slot].unsaved === true` means the durable write **failed verification** at capture time (§7).
- **Score is mandatory**: `saveEntryAndNew()` and `saveEdit()` both refuse with the toast "Tap Finding or Observation to score this entry first" until a score button is selected.
- **NPS scores:** exactly two buttons, `Finding` and `Observation`, always visible. The USFS `General` and the Region 9-only `Safety` / `Positive` / `Corrected On Site` buttons, the `data-r9-only` attributes, `updateScoreVisibility()`, the `.score-btn.hidden` rule and the dead `setGeneralPhoto()` helper were all removed. Entries imported from a USFS backup keep whatever score string they carry; the export sort treats anything other than Finding/Observation as unscored.

### Complete on-device key inventory

| Store | Key | Contents |
|---|---|---|
| localStorage | `nps_saved` | JSON array of all saved entries (incl. thumbnails) |
| localStorage | `nps_current` | Autosaved draft: form fields + `currentPhotos` + slot list + GPS + entry id |
| localStorage | `nps_photo_settings` | `{maxWidth, maxHeight, quality, preset}` |
| localStorage | `nps_site_list` | Imported `.txt` location list (fallback when no park selected) |
| localStorage | `nps_selected_park` | Park name, restored on launch (constant `LS_FOREST`) |
| localStorage | `nps_recent_tg` | Last 10 selected citation codes, most recent first |
| localStorage | `photo_full_<dbKey>` | **Fallback-only** full-res photo as data URL (§7 tier 3) — note: not `nps_`-prefixed, same as USFS; the two apps only collide here if the same entry id is generated twice, which `genId()` makes practically impossible |
| IndexedDB | db `nps_photos_v1`, store `photos` | `{data: ArrayBuffer, type, size}` keyed by dbKey |
| Native FS | `DATA/nps_photos/<sanitized dbKey>.jpg` | Durable full-res JPEG (native app only) |
| SW Cache | `nps-collector-v1.0` | App shell + data JSON + the two CDN libraries |

`autoSaveCurrent()` runs on effectively every input event, so a mid-entry app kill (including iOS killing the WebView while the camera is open — a real iOS behavior) restores the full draft, thumbnails included, on next launch. The storage monitor tallies every localStorage key starting with `nps_` or `photo_full_`.

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

Independently of `init()`, the script's top level kicks off `loadCitations()` and `loadRecentTg()` for the citation search.

## 7. Photo storage — the three-tier durable design

**Why this exists:** iOS can silently evict WKWebView storage (IndexedDB *and* localStorage) under disk pressure — a sibling HGS app lost a day of field photos this way. Full-resolution photos on the native app are written to a **real file** in the app's DATA container via `@capacitor/filesystem`, which iOS does not evict. The web/PWA build (no native bridge) continues to rely on IndexedDB. **Do not simplify this** (see §16).

### Write path — `storePhotoBytes(dbKey, dataUrl)` → `{ok, where}`

Tries tiers in order, **verifying each write before claiming success**:

1. **Native filesystem** (`where:'fs'`): `Filesystem.writeFile` to `nps_photos/<key>.jpg` in `DATA`, then `Filesystem.stat` to confirm the file exists with size > 0. Only attempted when `window.Capacitor.isNativePlatform()` is true and the plugin is present (`fsPlugin()` returns null otherwise, making every fs helper a no-op on the web).
2. **IndexedDB** (`where:'idb'`): put `{data: ArrayBuffer, type, size}`; an exception flips `idbAvailable = false`.
3. **localStorage** (`where:'fallback'`): the data URL under `photo_full_<key>` — last resort only, tiny quota, itself evictable. Read back to confirm.
4. Nothing stuck → `{ok:false, where:'none'}`.

### Capture-time verification (`handlePhoto`)

The photo slot shows an amber `…` badge while the write is in flight. On `{ok:true}` it becomes the green ✓ badge and a toast reports the size; on failure the badge becomes a red **⚠ NOT SAVED**, `photos[slot].unsaved = true`, and a warning toast says "Export & clear now". Nothing fails silently.

### Read path — `loadPhotoBytes(dbKey)`

Filesystem → IndexedDB → localStorage fallback, first hit wins, returning `{bytes: Uint8Array, type}`. `photoBytesExist()` is the same walk returning a boolean. Used by export and the integrity check.

### Migration — `migratePhotosToFS()` (once per launch, native only)

Lists all IndexedDB keys, lists the filesystem directory (`fsPresentKeySet()` reads `nps_photos/`), and copies every IDB-only photo to the filesystem (base64-encoded in 32 KB chunks — `uint8ToBase64` avoids the `String.fromCharCode.apply` stack overflow above ~100 KB). Shows "Secured N photos to durable storage" if it moved anything. IDB copies are left in place as redundancy.

### Deletion

`deletePhotoFromDB(key)` removes **all three tiers** (localStorage fallback, filesystem fire-and-forget, IndexedDB). It's called on single-entry delete and on post-export batch delete.

### Integrity badge

`runIntegrityCheck()` diffs the set of dbKeys referenced by entries + draft against the union of keys present in all three tiers (`presentPhotoKeySet()`). The header badge shows green "✓ N photos safe" or red "⚠ X of N photos MISSING"; tapping it re-checks and, in verbose mode, alerts with the affected entry locations and points the user at earlier exports for recovery. `updateIntegrityBadge()` debounces re-checks 500 ms after any photo mutation.

## 8. Location system (NPS-specific)

Three sources feed the location field, in priority order:

1. **Bundled park data** (`nps_locations.json`): `{ "Park Name": [ {n: name, t: type, d: park alpha code, lat, lng} ] }` — 449 park units, 43,026 locations. Selecting a park maps them to display strings `"Name — CODE"` (e.g. `Old Faithful Visitor Education Center — YELL`) and enables the GPS features. `t` is the NPS feature type (`Visitor Center`, `Campground`, `Service Shop Maintenance`, `Sewage Treatment`, `Parking Lot`, …) and shows as a `[type]` tag in the picker.
2. **Imported `.txt` list** (`nps_site_list`): one location per line, `#` comments, used only when no park is selected.
3. **Free typing** — the field is a plain text input; anything goes.

**Why the park code is the second segment:** the entry record does not store the park (same as the USFS entry never stored the forest). The USFS strings carry the ranger district there; NPS units have no public sub-unit equivalent, so the 4-letter unit code fills the slot. It rides into the export as `MMDDYY_Name_CODE_NNNN.jpg` and into the Findings Report "Location" column, which keeps multi-park exports unambiguous. Change `d` in `build_locations.js` to switch to the full park name or blank.

Static data in code: `REGION_MAP` — the **7 legacy NPS regions** carried by the boundary data (`AKR — Alaska`, `IMR — Intermountain`, `MWR — Midwest`, `NCR — National Capital`, `NER — Northeast`, `PWR — Pacific West`, `SER — Southeast`) → park names — is **generated** by `build_locations.js` between the `// REGION_MAP:BEGIN` / `// REGION_MAP:END` markers; never hand-edit it. The derived reverse lookup `FOREST_TO_REGION` is unchanged code. The Region dropdown only filters the Park dropdown (no region-dependent scoring); both selections persist. (The DOI "Unified Interior Regions" 1–12 are not carried by any NPS GIS dataset, hence the legacy codes.)

GPS-powered behaviors (all use `haversineMi()`, earth radius 3958.8 mi) — identical code to USFS:

- **Picker sorting**: with a fix, the location picker sorts by distance and shows a per-row distance chip; the **Nearby (10 mi) / All** toggle filters (Nearby silently falls back to All when nothing is within radius).
- **Auto-detect park** (`autoDetectForest`): if no park is selected when a fix arrives, scan *every* location in every park for the nearest one; adopt that park (and its region) when < 100 mi. Every unit is detectable because units with no mapped facilities still carry one "Park Unit" centroid location.
- **Auto-suggest location** (`autoSuggestLocation`): if the location field is empty, fill it with the nearest location in the selected park when < 50 mi, with a toast showing the distance.

## 9. Team Guide citation search

**Unchanged from USFS** — data file, build script logic, synonym map, protocol hints, chips, recents and Common Citations are all byte-for-byte the same; only the recents key (`nps_recent_tg`) differs.

**Data:** `team_guide_citations.json` — 6,445 records of `{c: code, s: section label, d: description, r: regulatory reference}`. Codes are `AREA.question.sub.JURISDICTION` (e.g. `HW.10.1.US`, `PM.1.1.FS`, `AE.10.1.MI`); jurisdictions are `US` (federal, Dec 2023), `FS` (Forest Service supplement, Sep 2008), and state supplements `KY MI MN MO OR TN WA`. The FS supplement and the three "FS:" Protocol Area options were kept on purpose (open item in Status.md). Loaded lazily on startup; fetched again on demand if the first fetch failed.

**Search algorithm** (`_filterCitations`, debounced 150 ms):

1. Empty/1-char query → show the sticky **area chip row** plus either the active area's first 50 citations, or the **Recent picks** list (last 10 selected codes), or a hint.
2. Query terms are split on whitespace; each term expands through `TG_SYNONYM_MAP` (~33 groups of field vocabulary — "msds"→"safety data sheet", the many "burn pile" variants, "ust"→"underground storage tank", etc.). Multi-word phrase keys match against the whole query.
3. Every term (in some synonym variant) must appear in the citation's concatenated haystack (`c + s + d + r`, lowercased). Scoring per hit: +10 if the variant appears in the code, +5 if in the regulation reference, +2 for the exact typed term / +1 for a synonym.
4. **Protocol-area hints** (`TG_PROTOCOL_HINTS`, ~100 regex→area→bonus rules ported from fs-reference-web's `field_notes.py`) add area-level bonuses — e.g. a query matching `/refrigerant/` boosts every `AE.*` citation by 15.
5. **Question hints** (`TG_QUESTION_HINTS`) boost specific question ids hard — e.g. "large capacity septic" +30 on `WQ.114.3` (also matched with the `.US`/`.FS` suffix stripped).
6. Active area chip filters to that code prefix. Top 30 by score render with `<mark>` highlighting of every matched variant (`_highlight` escapes regex chars, longest-first to protect longer matches).

Selecting a citation writes `"CODE — regulation"` (or bare code) into the hidden `teamGuideCitation` input, renders the summary card, and pushes the code onto the recents list (capped at 10, persisted).

**Common Citations** (★ Common) is a separate hardcoded cheat-sheet modal (`COMMON_CITATIONS`, sourced from `Team Guide Cheat Sheet.docx`) of ~17 high-frequency codes grouped by category, filtered by the selected Protocol Area through `PROTOCOL_TO_CATEGORIES`; picking one routes through the normal `selectCitation` path when the code exists in the full index.

## 10. Photo capture pipeline

1. **Camera** (`takePhoto`): the `<input type=file accept=image/* capture=environment>` is **destroyed and recreated on every tap** — iOS caches a stale file on reused inputs. **Library** (`browsePhoto`): same input without `capture`, which makes iOS open the photo picker instead.
2. `handlePhoto` reads the file as a data URL, draws it into a canvas scaled to fit the configured max box (default 1920×1080; presets 1280×720 / 2560×1440 / custom / original-no-resize), re-encodes JPEG at the configured quality (default 0.80). Settings persist in `nps_photo_settings`; the settings dialog shows a rough size estimate (`w·h·q·0.00015` KB, clamped 50 KB–3 MB).
3. A second canvas produces the ~80 px thumbnail (JPEG q=0.4) stored inline in the entry.
4. Bytes go through the verified durable-write path (§7); the slot badge reflects the outcome.
5. **GPS auto-capture**: if the draft has no fix yet, a silent `captureGPS(true)` fires with each photo (high accuracy, 15 s timeout, no error UI in silent mode).

Photos 1–2 are fixed slots (`p_main`, `p_wide`); "Add Photo" appends `p_extra_N` slots, removable and renumbered live; edit mode and draft-restore both rebuild extra slots from data.

Note: going through `<input type=file>` means **iOS strips EXIF and re-encodes** — GPS lives in the entry record, not the image file, by design.

## 11. Export pipeline (`runExport`)

**Dialog:** shows the naming preview, a date filter (chips All / Today / Yesterday / Custom with two date inputs, defaulting to today), and a live count "N entries will be exported" / "M of N match this filter". The in-progress draft counts as an entry if it has a location, description, or photos.

**Selection:** deep-clone `savedEntries`, append the draft (with its live form values) if non-empty, then filter by the date range (`entryInRange` on `timestamp`; open-ended bounds allowed). Empty result → abort with a toast.

**Photo naming:** one **global 4-digit sequence** across the whole export (`0001…`), ordered by entry, then slot (`p_main`, `p_wide`, extras by index). Name = `MMDDYY_<segments>_NNNN` where the location string is split on any of `-> → > – — | /` and the **last two segments** are kept, each sanitized to `[a-zA-Z0-9_- ]`, spaces→underscores. With the bundled data that yields `MMDDYY_Location_PARKCODE_NNNN` (e.g. `091026_A-Frame_at_Happy_Isles_YOSE_0001.jpg`). Extension is `.jpg` unless the stored MIME says PNG.

**ZIP contents** (`NPS_Export_MMDDYY.zip`, via JSZip):

```
photos/MMDDYY_Location_PARKCODE_0001.jpg …
NPS_Report_MMDDYY.xlsx
NPS_Data_MMDDYY.csv
```

**CSV** — columns: `Entry #, Location, Latitude, Longitude, GPS Accuracy (m), Protocol Area, Team Guide Citation, Score, Description, Timestamp, Photo 1…Photo N` (N = max photos on any entry, min 2). Coordinates fixed to 6 decimals; `quote()` handles commas/quotes/newlines.

**XLSX** (ExcelJS, two sheets):

- **Sheet 1 "Findings Report"** (opens first, styled): columns `Location(36) | Condition(60) | Score(12) | FindingDate(13) | Question(16) | Photos(18)`. **NPS row order:** all `Finding` entries, then all `Observation` entries, then anything unscored (`SCORE_RANK` map); within each group, citation-bearing entries first (alphanumeric by code), then entries without a citation; original entry order as the tiebreak. (USFS orders citation-bearing → scored non-General → General.) `Question` = the citation code before " — ", else the protocol area's 2-letter code (`AREA_CODE` map), else "—". `Photos` = the entry's photo sequence numbers as **3-digit** collapsed ranges (`001–003, 005`) — intentionally 3-digit vs the 4-digit filenames; flip the `padStart(3,…)` in `formatPhotoNumbers` if that ever changes. Styling: bold white-on-brown (`FF5C3B1E`) 28 px header, frozen first row, gridlines off, Arial 10, thin `FFC8CDD9` borders everywhere, Condition left/others centered, wrap text, row heights estimated from character counts (~55 chars/line Condition, ~32 Location, 15 px/line + 6).
- **Sheet 2 "NPS Entries"** (raw): the same columns as the CSV; `Entry #`, GPS columns, and all photo columns **hidden** by default so reviewers see a clean sheet but the data is still there.

**Integrity guard:** every missing photo (all three storage tiers empty for a referenced dbKey) is counted during the ZIP build; if any are missing, a `confirm()` names the affected entries and forces an explicit choice between "export anyway (incomplete)" and cancel. A short export can never ship silently.

**Delivery:** `shareOrDownload()` — Web Share API with a `File` (native share sheet on iOS; the user typically AirDrops or saves to Files), falling back to an `<a download>` blob click in desktop browsers. Share-sheet cancel (`AbortError`) is treated as done.

**After a successful export:**
1. Every exported entry in `savedEntries` is stamped `exportedAt` (the clones exported are matched back by id). The saved list renders a green "✓ exported" or amber "⚠ not exported" badge per entry, and single-entry delete confirms with the entry's export status ("NO export record — this entry may never have left the device!").
2. The post-export dialog offers to **batch-delete the exported entries** (photos included, all tiers); it exits edit mode/clears the draft if those were part of the export. "Keep on device" declines.
3. All `photo_full_*` localStorage fallback copies are purged.

Backups (`saveBackup`) are metadata-only JSON named `NPS_Backup_MMDDYY.json`; `importBackup` merges or replaces through `normaliseEntry()`.

## 12. Service worker (`sw.js`)

Small but load-bearing — it has caused more field bugs than any other file in the sibling app.

- `CACHE_NAME = 'nps-collector-v1.0'` — **must be bumped whenever any cached file changes** (`index.html`, `sw.js` itself, either data JSON). The bump is what makes installed PWAs and the iOS WebView pick up changes.
- Precache list: `./`, `index.html`, `team_guide_citations.json`, `nps_locations.json`, JSZip, ExcelJS.
- **Install:** `cache.addAll` with every request created as `new Request(url, {cache:'reload'})`. The `reload` is critical: without it the SW install reads through the **browser HTTP cache**, and a stale `max-age` copy of the data JSON gets baked into the brand-new SW cache — this exact bug shipped day-old citation data in the USFS app in July 2026 despite a cache bump. `skipWaiting()` activates immediately.
- **Activate:** delete every cache whose name ≠ current, then `clients.claim()`.
- **Fetch:** requests that are navigations or end in `.html`, `/`, or `.json` are **network-first** — fetched with `{cache:'no-cache'}` (forces conditional revalidation, cheap ETag 304s) — with the response copied into the cache and the cache as offline fallback. Everything else (CDN libs) is cache-first.

The Azure config (§13) is the server half of the same fix: the data JSONs are served `public, no-cache` so the client always revalidates; `sw.js`, `index.html`, and `manifest.json` are `no-cache, no-store, must-revalidate`.

## 13. Hosting and deployment

**Web:** push to `main` → GitHub Actions (`azure-static-web-apps.yml`, `skip_app_build: true`) → Azure Static Web Apps (`nps-data-collector`, ~1 min deploys). `staticwebapp.config.json` additionally sets a navigation fallback to `index.html` (excluding JSON and images), JSON MIME types, `public, no-cache` on both data JSONs, and security headers (nosniff, DENY framing, strict referrer). No auth is configured; adding Entra ID in front of the URL is possible later.

**iOS (not yet shipped):** `npm run sync` (copies the file list in package.json's `build` script — `index.html sw.js manifest.json team_guide_citations.json nps_locations.json` — into `www/`, then `npx cap sync ios` into `ios/App/App/public/`) → bump `CURRENT_PROJECT_VERSION` in **both** Debug and Release blocks of `project.pbxproj` (Apple rejects reused build numbers; `MARKETING_VERSION` is user-facing and bumped rarely) → Xcode Product → Archive → Distribute. Before the first upload the generated project still needs: camera / photo-library / location usage strings and `ITSAppUsesNonExemptEncryption=false` in `Info.plist`, `DEVELOPMENT_TEAM = QV4MJ85JSK` in both pbxproj configs, the NPS app icon in `Assets.xcassets/AppIcon.appiconset`, and an App Store Connect app record for the bundle id. Info.plist references the version fields via `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` — never hardcode there. Full checklist in the TestFlight playbook.

**The dual-channel skew rule:** the web app updates the moment a user reloads twice (SW update dance); the iOS app only updates when someone archives and uploads a new build. Between iOS builds the two channels intentionally run different versions of the same file — the SW cache-name discipline is what keeps each channel internally consistent.

## 14. Data build pipelines (developer-side, Node, no npm deps)

### 14.1 `build_citations.js`
Parses Team Guide markdown files from `~/Desktop/Claude Apps/fs-reference-web/backend/data/team_guide` (shared with the fs-reference-web project). Filenames like `usae-Dec-23`, `fspm-Sep-08`, `kyae-oct-23` encode jurisdiction (first 2 chars) + area code (rest) → the `AREA_NAMES` map produces section labels ("Air Emissions", "FS: Pesticide Management", "MI: Hazardous Waste", …). Writes `team_guide_citations.json` **and** the `www/` copy. Identical to the USFS script except `REPO_ROOT`. Run `node build_citations.js` after any Team Guide update, then bump the SW cache.

### 14.2 `build_locations.js` (NPS-specific)
Fetches three **public, key-less** ArcGIS services directly (Node 18+ global `fetch`, 2,000-record pages, retries, raw pages cached under `nps_raw/`; `--refresh` re-downloads):

1. **NPS Boundary Centroids** (Land Resources Division service on ArcGIS Online, layer 0) — 442 rows → 429 distinct park units after de-duplicating spelling variants on normalized name (`UNIT_CODE`, `UNIT_NAME`, `REGION`, plus the centroid in WGS84 via `outSR=4326`).
2. **NPS Public Points of Interest** (`mapservices.nps.gov/…/NationalDatasets/NPS_Public_POIs_Geographic`) — 35,570 rows. Kept: 22,134. Dropped by type (`POI_EXCLUDE`, ~130 types): per-item clutter (campsites, benches, signs, mile markers, bear boxes…), natural features (peaks, lakes, waterfalls…), route/road points, gazetteer places; also dropped: planned/removed/non-extant, unnamed-and-untyped.
3. **NPS Public Buildings** (`…/NPS_Public_Buildings_Geographic`) — 29,054 polygons queried with `returnCentroid=true`. Kept: 26,103 (decommissioned / excess / inactive / non-extant dropped). `BLDGTYPE` is cleaned (`Bldg ` prefix and ` (GSF)` suffix stripped) into `t`.

Name resolution is `POINAME`/`BLDGNAME` → `MAPLABEL` → alt name; the Midwest region publishes most of its geometry with only `MAPLABEL`, and ~1,000 features with no name at all but a facility-grade type are kept as `"<Type> (unnamed)"` (`UNNAMED_KEEP_TYPES`). Feature unit codes are matched to the master list (uppercased; sub-unit codes that are not LRD units, such as `PARA` or `NACE`, get one canonical name per code — the shortest spelling seen). Units with nothing mapped keep their boundary centroid as a single `Park Unit` location so every unit stays selectable and GPS-detectable (52 units). Per park: dedupe on name + coords to 3 dp, sort by name; parks sorted by name. Output: minified `nps_locations.json` (+ `www/` copy if present) and the `REGION_MAP` literal rewritten in `index.html`.

Region labels come from the boundary data's `REGION` field (`AKR IMR MWR NCR NER PWR SER` → `REGION_LABELS`); anything else would land in `OTH — Other / Unassigned` (currently none).

**Not used:** the NPS Data API (`api.nps.gov`) — its `/parks`, `/visitorcenters`, `/campgrounds`, `/places` endpoints carry coordinates and names but require a per-developer API key (every request returns `API_KEY_MISSING` without one). It remains an option for backfilling named visitor centers/campgrounds in regions with poor GIS naming.

## 15. Security & privacy posture

- All data is client-side; the app makes no network writes anywhere. Exports leave the device only through the user's own share-sheet/download action.
- No accounts, no auth, no cookies, no analytics. The public Azure URL serves only the static app.
- XSS surface: all interpolated user/citation text passes through `esc()`; location names in picker onclick handlers get quote-escaping. The app never renders remote content.
- The privacy policy (`privacy.html`) exists to satisfy App Store review; it accurately states data never leaves the device.

## 16. Known constraints & sharp edges (institutional memory, inherited from USFS)

1. **Wi-Fi-only iPads have no GPS hardware** — location comes from Wi-Fi BSSID lookup and is useless in the backcountry. Use cellular-SKU iPads (GNSS works without a SIM), an external Bluetooth GPS (Bad Elf/Garmin GLO — iOS treats it as the system source), or an iPhone. Tethering does *not* relay the phone's GPS.
2. **iOS storage eviction** is why the filesystem tier exists (§7). Don't "simplify" photo storage back to IDB-only.
3. **The SW cache name is the release mechanism.** Changed a cached file? Bump `CACHE_NAME` or field devices won't see it. And keep the `cache:'reload'` / `no-cache` fetch options — removing them reintroduces the stale-JSON bug.
4. **`<input type=file>` recreation** on every camera tap is deliberate (iOS stale-file bug). So is the missing `capture` attribute on Browse.
5. **iOS re-encodes photos and strips EXIF** through file inputs; original-quality/EXIF capture would require the Capacitor Camera plugin.
6. **SheetJS community edition can't style cells** — that's why ExcelJS, despite ~500 KB.
7. **Version bumps are by explicit request only** (team policy) — both the iOS build number and any user-facing version.
8. **`www/` is generated** — edit root files, run `npm run sync`.
9. The 3-digit Photos column vs 4-digit filenames in the XLSX report is a deliberate user preference, not a bug.
10. Storage warnings: bar turns yellow at 40 MB with a throttled toast (≤1/5 min), red at 90% of the 80 MB working limit; `navigator.storage.estimate()` supplements the manual localStorage+IDB tally when it reports more.
11. **NPS:** `nps_locations.json` is 4.2 MB (USFS: 2.7 MB) — still parsed in well under a second on an iPad, but keep the type exclusions in `build_locations.js` when refreshing rather than dropping them.
12. **NPS:** `REGION_MAP` is generated — hand edits are overwritten by the next `node build_locations.js`.

## 17. How to extend safely (checklist)

- **Sibling first:** before changing shared code, diff `index.html` against the USFS copy; apply the identical hunk to both apps (or note why not).
- Editing `index.html`/data JSON → test in a browser (`python3 -m http.server 8080` or the deployed URL), **bump `CACHE_NAME`**, push to `main` (web ships), and note the iOS channel stays behind until the next TestFlight build.
- New cached asset → add to `URLS_TO_CACHE` *and* bump the cache name *and* (if it must ship in the iOS bundle) add it to package.json's `build` copy list.
- New entry field → touch all of: the form HTML, `saveEntryAndNew()`, `saveEdit()`, `editEntry()`, `autoSaveCurrent()`/`loadAll()`, `normaliseEntry()`, the CSV row, both XLSX sheets, and the saved-panel renderer.
- New photo behavior → preserve the verify-after-write contract and the three-tier delete.
- Anything touching citations/locations data → regenerate via the build scripts, never hand-edit the JSON or the generated `REGION_MAP`.
- New score value → add the button, extend `SCORE_RANK` in `runExport()`, and update the two validation toasts.
