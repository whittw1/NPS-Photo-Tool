# NPS Photo Collector

A Progressive Web App (PWA) for National Park Service Environmental Audit Program field work: GPS-tagged photos, searchable EnviroCheck question lookup, 1/2a/2b/3/4/P priorities, repeat-finding links to the previous audit, and exports laid out like the WASO findings spreadsheet and the report's photo log. Works offline, and — once you sign in with your Microsoft work account — backs up to the firm's SharePoint as you go and can send the export there directly. Forked from the [USFS Photo Collector](https://github.com/whittw1/USFS-Photo-Tool) (itself forked from the DLA Audit Photo Tool).

**Live (web):** https://victorious-ocean-0a7852b10.3.azurestaticapps.net · current version **v4.6**, shown in the app's bottom bar

Deep technical reference: [ARCHITECTURE.md](ARCHITECTURE.md). Deployment status and release history: [Status.md](Status.md). Live backup setup: [api/README.md](api/README.md).

## Quick Start

1. Open the app URL on your phone/tablet
2. Tap **"Add to Home Screen"** for an app-like experience
3. The app works fully offline after the first load
4. Optional, to back up as you go: open **Settings**, and under **☁ Live backup to SharePoint** tap **Sign in with Microsoft** (your HGS account), tick **Turn it on**, then tap **Save Settings**. **Test** checks the connection.

## What it does

An auditor picks a park (or lets GPS auto-detect it), selects a location from the bundled list of NPS facilities and points of interest (or types one), picks the specific EnviroCheck question (which fills in the sheet, suggests the **priority** from the question's P-level and suggests a WASO **description code**), adjusts the priority — **1, 2a, 2b, 3, 4 or P** — if needed (or taps **Note** for a general observation that is not a finding: no sheet, question or code, kept out of the WASO sheets and numbered findings), optionally marks the entry as a **repeat** of a finding from the previous audit's spreadsheet, writes a description, and attaches photos (camera or library). Tapping a photo opens it full size, with a **Retake** button, rather than replacing it. Everything is stored on-device: the saved list filters to **All / Today / Yesterday / Earlier**, marks which entries have been exported, and every delete asks twice.

Two exports share one date filter: **Export ZIP** (renamed photos + CSV + an Excel workbook with an Audit Summary, one WASO-layout `Audit Report <PARK>` sheet per park, the raw entries, the SPCC tank check, the LOC sites and the personnel, plus two Word files: **NPS_Notes** listing just the field notes, and **NPS_LOC_Sites** with one NPS EDL site data form per Location of Concern) and **Word Report** (a `.docx` photo log per park in finding-number order, "No Photo Available" where a finding has none, photo numbers matching the ZIP). The ZIP is named `NPS_Export_<PARK>_<MMDDYY>_<HHMM>.zip`, so two exports on the same day never collide, and **Send to SharePoint** delivers the same ZIP straight to the park's SharePoint folder instead of the share sheet. Finding numbers are assigned per park at export time after the WASO sort — priority, sheet, citation, location — so they are never stored.

The **SPCC tank check** verifies the park's plan tables tank by tank, and **LOC / EDL sites** capture the NPS EDL site form in the field: GPS taken as soon as a site is created, photos with a caption and a facing direction the compass can pre-select, and a running list of what is still blank. Both ride along in every export.

## Live backup and Send to SharePoint

Optional, and off until you switch it on. Once you have signed in with your Microsoft work account:

- **Live backup** copies each save and each new photo to `NPS/Audits/<park>/<year>/Live Backup/` in the firm's SharePoint whenever the app is open and online: a state file holding every entry, site, tank and name; each photo, once; and `photos_<device>.csv`, which says what each photo file is. With no signal, work waits in a queue on the device and goes up later — nothing is lost, and saving and exporting never wait for it. The badge in the header says where things stand: **☁ backed up**, **☁ n waiting** (not up yet — usually no signal), or **☁ sign in to back up**.
- **Send to SharePoint**, in the Export dialog, puts the export ZIP in `NPS/Audits/<park>/<year>/`, beside the exports copied there by hand. It uploads in chunks and picks up where it left off if the wifi drops; keep the app open until the dialog says it is in SharePoint. Entries are marked exported only once SharePoint confirms.

The iPad never holds Microsoft credentials or a key: two small server functions do the writing, and they accept only accounts in the firm's domain. The backup folder is a safety net — its photo files are named by internal key, which the CSV decodes — and the ZIP remains the deliverable. iOS gives web apps no background uploads, so backup happens while the app is open. How it works: [ARCHITECTURE.md §20](ARCHITECTURE.md). Setup: [api/README.md](api/README.md).

## Repository layout

```
NPS-Photo-Tool/
├── index.html                   ← Entire app (HTML + CSS + JS, no build step)
├── sw.js                        ← Service worker for offline caching (bump CACHE_NAME on every change)
├── manifest.json                ← PWA manifest
├── envirocheck_checklists.json  ← 810 checklist questions from the 17 NPS EnviroCheck Sheets
├── nps_locations.json           ← 449 park units → 43,026 named GPS locations
├── build_envirocheck.js         ← Rebuilds the question index from the EnviroCheck Sheet .docx files
├── build_locations.js           ← Rebuilds nps_locations.json + the REGION_MAP in index.html from NPS GIS services
├── api/                         ← Server functions for live backup and Send to SharePoint (setup: api/README.md)
│   ├── shared/graph.js          ←   settings, Microsoft Graph sign-in, who is asking, destinations, path rules
│   ├── upload/                  ←   writes one file of up to 8 MB
│   └── upload-session/          ←   starts a large-file upload for the export ZIP
├── staticwebapp.config.json     ← Azure Static Web Apps routes, cache headers, sign-in on the API routes
├── .github/workflows/           ← Deploys the app and the functions on every push to main
├── privacy.html                 ← Privacy policy (App Store review requirement), covering live backup and sign-in
├── package.json, capacitor.config.json, ios/   ← Capacitor 8 iOS shell (scaffold only so far)
└── *.md                         ← ARCHITECTURE, Status, Azure + TestFlight playbooks
```

## Differences from the USFS app

| Area | USFS | NPS |
|---|---|---|
| Score buttons | Finding, General (+ Region 9-only Safety/Observation/Positive/Corrected) | **NPS priorities 1, 2a, 2b, 3, 4, P** (red = corrective action required, orange = recommended, green = positive practice), pre-selected from the question's P-level, plus **Note** (grey) for a general observation that is not a finding. Plus a **Description Code** (the ten WASO codes, suggested from the question wording) and a **Repeat Finding** link |
| Reference data | Team Guide citations (6,445, incl. state supplements) with the ★ Common quick-pick | **NPS EnviroCheck Sheets** — 810 checklist questions from the 17 federal sheets, coded `UO.05`, `SPCC.02`, with each question's citation and P1–P4 priority. Common Citations removed. |
| Protocol area | 18 Team Guide areas | The 17 EnviroCheck sheets, named exactly as the WASO spreadsheet pulldown (`SPCC Planning`, `Hazard Communication (HAZCOM)` …) |
| Reports | ZIP (photos + CSV + XLSX) | ZIP whose workbook has an **Audit Summary**, a **WASO-layout `Audit Report <PARK>` sheet per park** (columns A–S exactly as the official template, plus a grey app-only Photos column), the raw **NPS Entries**, **SPCC Tank Check**, **LOC Sites** and **Personnel**, a Word **Notes** document and Word **EDL site forms** inside the ZIP; plus a **Word photo log** (`.docx`) per park by finding number |
| Audit extras | — | **SPCC tank verification** imported from the park's Tables 1-3 Word file, **LOC / EDL sites** (photos with caption and facing direction, GPS and the field observations of the EDL form), an **audit team / coordinator / personnel** roster, and the **previous audit's findings spreadsheet** imported in-app so repeats can be marked in the field (a repeated Priority 2 becomes 2a, and the export writes `YYYY-Finding ###`) |
| SharePoint | — | **Live backup** and **Send to SharePoint**, behind Microsoft sign-in, through two server functions in `api/` |
| Location data | `forest_locations.json` (112 forests, offices + rec sites) | `nps_locations.json` (449 park units, public points of interest + buildings), same `{n, t, d, lat, lng}` shape; `d` = park alpha code (e.g. `YELL`) |
| Regions | 9 USFS regions (static list) | 7 NPS regions from the boundary data (AKR, IMR, MWR, NCR, NER, PWR, SER), generated into `REGION_MAP` by the build script |
| Findings sort / numbering | citation-bearing first, then scored, then General | The WASO sort — park, priority (1 → P), sheet, question code, location — with finding numbers `001…` assigned per park at export time; photos are numbered in the same order |
| Branding | FS green `#2e7d32` | NPS brown `#5c3b1e` |
| Storage keys | `usfs_*`, IDB `usfs_photos_v1`, FS dir `usfs_photos/` | `nps_*`, IDB `nps_photos_v1`, FS dir `nps_photos/` |
| Export files | `USFS_Export_MMDDYY.zip` … | `NPS_Export_<PARK>_<MMDDYY>_<HHMM>.zip`, and inside it `NPS_Report_…xlsx`, `NPS_Data_…csv`, `NPS_Notes_…docx`, `NPS_LOC_Sites_…docx`; the Word Report is `NPS_Photo_Log_<PARKS>_…docx` |

Everything else — photo capture and three-tier durable storage, service worker discipline, autosave, and the search engine itself — is shared with the USFS `index.html` and meant to stay **textually identical**; fixes made here to shared code that the USFS app has not received yet are listed under *Port candidates* in [Status.md](Status.md). Only the reference data and hint tables the search ranks over differ. The export pipeline (`runExport`, `buildAndSendExport`, `generateWordReport`) and the entry form have diverged for the NPS report format; the NPS-only logic lives in the **NPS AUDIT DATA**, **SPCC TANK CHECK + PERSONNEL**, **LOC / EDL SITES**, **LIVE BACKUP TO SHAREPOINT** and **WORD PHOTO LOG** sections at the bottom of the file, and in **EXPORT STRAIGHT TO SHAREPOINT** after the utilities.

## Sibling-app sync rule

The USFS and NPS apps are kept in sync by hand-porting fixes between them. Keep shared code identical (no reformatting, renaming or restructuring) so a fix in one app applies to the other as a clean copy-paste. Internal identifiers such as `forestData`, `selectedForest` and `onForestChange` are deliberately **not** renamed in this app; only the user-facing labels say "Park". Live backup and the `api/` functions are NPS-only; if the USFS app gets the same feature, it needs its own Static Web App, its own destination list and its own storage keys.

## Developer notes

- **Test locally:** `python3 -m http.server 8080` then open http://localhost:8080. The `api/` functions only run on Azure (or under the Azure Functions Core Tools); to test the client locally, stub `/.auth/me` and `/api/*`.
- **Test in WebKit** before deploying: Chrome, Safari and every other browser on iPad run on it. Playwright's `webkit` with an iPhone or iPad profile is the closest thing to the field device.
- **Rebuild locations:** `node build_locations.js` (add `--refresh` to re-download; raw service responses are cached in `nps_raw/`). Then bump `CACHE_NAME` in `sw.js`.
- **Rebuild EnviroCheck questions:** `node build_envirocheck.js` (reads the sheet `.docx` files from SharePoint; pass the folder as an argument to override). Then bump `CACHE_NAME`.
- **Web deploy:** push to `main` → GitHub Actions → Azure Static Web Apps (`nps-data-collector`), app and functions together. Bump `CACHE_NAME` in `sw.js` and `APP_VERSION` in `index.html` together on every release; the bottom bar shows the running version (tap it to reload).
- **Live backup settings** (`GRAPH_*`, `ALLOWED_DOMAIN`, `GRAPH_TARGETS`) live in the Static Web App's application settings, never in the repo — see [api/README.md](api/README.md). The repository is public.
- **iOS:** `npm install && npm run sync && npm run open`; see [WEB_TO_TESTFLIGHT_PLAYBOOK.md](WEB_TO_TESTFLIGHT_PLAYBOOK.md). The generated project still needs the Info.plist usage strings, signing team, and app icon before a TestFlight upload.
- **Version bumps** (iOS build number, marketing version) only on explicit request.

## Data model

```javascript
{
  id:                "e_1711234567890_a1b2",
  siteName:          "Old Faithful Visitor Education Center — YELL",   // duplicate of location (legacy)
  location:          "Old Faithful Visitor Education Center — YELL",
  park:              "YELL",                                           // alpha code; derived from the location suffix for old entries
  protocolArea:      "Used Oil Management",                             // one of the 17 EnviroCheck sheets, WASO spelling
  teamGuideCitation: "UO.05 — 40 CFR 279.22(c)",                       // EnviroCheck question (field name kept for sibling parity)
  score:             "2b",                                             // priority "1" | "2a" | "2b" | "3" | "4" | "P", or "N" for a Note — required to save
  descCode:          "Label/Signs",                                    // one of the ten WASO description codes, or ""
  repeatOf:          { year: 2021, park: "YELL", num: 8, priority: "2b", sheet: "…", citation: "…", desc: "…" },  // or null
  details:           "Used-oil drum unlabeled, no secondary containment",
  latitude:          44.4605, longitude: -110.8281, gpsAccuracy: 8,
  timestamp:         "2026-09-10T14:30:00.000Z",
  exportedAt:        "2026-09-10T18:02:11.000Z",                       // absent until exported (Send to SharePoint: until SharePoint confirms)
  photos: { p_main: { timestamp, thumbnail, fileType, dbKey, unsaved? }, p_wide: {…}, p_extra_0: {…} }
}
```

## Storage

| Layer | Purpose | Key / name |
|---|---|---|
| localStorage | Entries (with thumbnails), autosaved draft, settings, imported site list, selected park, recent questions, tank check, personnel, audit team, prior audit, LOC sites | `nps_saved`, `nps_current`, `nps_photo_settings`, `nps_site_list`, `nps_selected_park`, `nps_recent_tg`, `nps_tanks`, `nps_people`, `nps_audit`, `nps_prior`, `nps_loc_sites` |
| localStorage | Live backup: the switch, folder, destination and last signed-in account; the upload queue; photos already up; this device's name | `nps_backup_cfg`, `nps_backup_queue`, `nps_backup_done`, `nps_device_id` |
| Native filesystem (iOS app) | Durable full-resolution photos | `DATA/nps_photos/<dbKey>.jpg` |
| IndexedDB | Full-resolution photos (web build; redundancy on iOS) | db `nps_photos_v1`, store `photos` |
| localStorage fallback | Last-resort photo copy | `photo_full_<dbKey>` |
| Service worker cache | App shell, data JSON, JSZip, ExcelJS, docx | `nps-collector-v4.6` (always matches the app version) |
| SharePoint (live backup on) | Off-device copy: state file, photo index, photos | `NPS/Audits/<park>/<year>/Live Backup/` |

Unique `nps_*` keys let this app coexist with the USFS and DLA apps on the same device.
