# NPS Photo Collector

A Progressive Web App (PWA) for National Park Service field photo documentation with GPS tracking, searchable Team Guide citation lookup, and offline support. Forked from the [USFS Photo Collector](https://github.com/whittw1/USFS-Photo-Tool) (itself forked from the DLA Audit Photo Tool).

**Live (web):** https://victorious-ocean-0a7852b10.3.azurestaticapps.net

Deep technical reference: [ARCHITECTURE.md](ARCHITECTURE.md). Deployment status: [Status.md](Status.md).

## Quick Start

1. Open the app URL on your phone/tablet
2. Tap **"Add to Home Screen"** for an app-like experience
3. The app works fully offline after the first load

## What it does

An auditor picks a park (or lets GPS auto-detect it), selects a location from the bundled list of NPS facilities and points of interest (or types one), sets the protocol area, searches the Team Guide citation index, scores the entry **Finding** or **Observation**, writes a description, and attaches photos (camera or library). Everything is stored on-device. Export produces a ZIP with renamed photos, a CSV, and a styled two-sheet Excel findings report.

## Repository layout

```
NPS-Photo-Tool/
├── index.html                   ← Entire app (HTML + CSS + JS, no build step)
├── sw.js                        ← Service worker for offline caching (bump CACHE_NAME on every change)
├── manifest.json                ← PWA manifest
├── team_guide_citations.json    ← 6,445 searchable Team Guide citations (identical to the USFS app)
├── nps_locations.json           ← 449 park units → 43,026 named GPS locations
├── build_citations.js           ← Rebuilds the citation index from the Team Guide markdown files
├── build_locations.js           ← Rebuilds nps_locations.json + the REGION_MAP in index.html from NPS GIS services
├── staticwebapp.config.json     ← Azure Static Web Apps routes / cache headers
├── privacy.html                 ← Privacy policy (App Store review requirement)
├── package.json, capacitor.config.json, ios/   ← Capacitor 8 iOS shell (scaffold only so far)
└── *.md                         ← ARCHITECTURE, Status, Azure + TestFlight playbooks
```

## Differences from the USFS app

| Area | USFS | NPS |
|---|---|---|
| Score buttons | Finding, General (+ Region 9-only Safety/Observation/Positive/Corrected) | **Finding, Observation** — always both, no region logic |
| Location data | `forest_locations.json` (112 forests, offices + rec sites) | `nps_locations.json` (449 park units, public points of interest + buildings), same `{n, t, d, lat, lng}` shape; `d` = park alpha code (e.g. `YELL`) |
| Regions | 9 USFS regions (static list) | 7 NPS regions from the boundary data (AKR, IMR, MWR, NCR, NER, PWR, SER), generated into `REGION_MAP` by the build script |
| Findings Report sort | citation-bearing first, then scored, then General | Finding → Observation → unscored, then citation-bearing (by code) before citationless |
| Branding | FS green `#2e7d32` | NPS brown `#5c3b1e` |
| Storage keys | `usfs_*`, IDB `usfs_photos_v1`, FS dir `usfs_photos/` | `nps_*`, IDB `nps_photos_v1`, FS dir `nps_photos/` |
| Export files | `USFS_Export_MMDDYY.zip` … | `NPS_Export_MMDDYY.zip`, `NPS_Report_…xlsx`, `NPS_Data_…csv` |

Everything else — photo capture and three-tier durable storage, service worker discipline, export pipeline, autosave, the Team Guide citation search and Common Citations — is **textually identical** to the USFS `index.html`, on purpose.

## Sibling-app sync rule

The USFS and NPS apps are kept in sync by hand-porting fixes between them. Keep shared code identical (no reformatting, renaming or restructuring) so a fix in one app applies to the other as a clean copy-paste. Internal identifiers such as `forestData`, `selectedForest` and `onForestChange` are deliberately **not** renamed in this app; only the user-facing labels say "Park".

## Developer notes

- **Test locally:** `python3 -m http.server 8080` then open http://localhost:8080
- **Rebuild locations:** `node build_locations.js` (add `--refresh` to re-download; raw service responses are cached in `nps_raw/`). Then bump `CACHE_NAME` in `sw.js`.
- **Rebuild citations:** `node build_citations.js` (reads the shared Team Guide markdown in `fs-reference-web`). Then bump `CACHE_NAME`.
- **Web deploy:** push to `main` → GitHub Actions → Azure Static Web Apps (`nps-data-collector`).
- **iOS:** `npm install && npm run sync && npm run open`; see [WEB_TO_TESTFLIGHT_PLAYBOOK.md](WEB_TO_TESTFLIGHT_PLAYBOOK.md). The generated project still needs the Info.plist usage strings, signing team, and app icon before a TestFlight upload.
- **Version bumps** (iOS build number, marketing version) only on explicit request.

## Data model

```javascript
{
  id:                "e_1711234567890_a1b2",
  siteName:          "Old Faithful Visitor Education Center — YELL",   // duplicate of location (legacy)
  location:          "Old Faithful Visitor Education Center — YELL",
  protocolArea:      "Petroleum, Oil and Lubricants",
  teamGuideCitation: "PO.65.6.US — 40 CFR 279.22(c)",
  score:             "Finding",                                        // "Finding" | "Observation" — required to save
  details:           "Used-oil drum unlabeled, no secondary containment",
  latitude:          44.4605, longitude: -110.8281, gpsAccuracy: 8,
  timestamp:         "2026-09-10T14:30:00.000Z",
  exportedAt:        "2026-09-10T18:02:11.000Z",                       // absent until exported
  photos: { p_main: { timestamp, thumbnail, fileType, dbKey }, p_wide: {…}, p_extra_0: {…} }
}
```

## Storage

| Layer | Purpose | Key / name |
|---|---|---|
| localStorage | Entries (with thumbnails), autosaved draft, settings, imported site list, selected park, recent citations | `nps_saved`, `nps_current`, `nps_photo_settings`, `nps_site_list`, `nps_selected_park`, `nps_recent_tg` |
| Native filesystem (iOS app) | Durable full-resolution photos | `DATA/nps_photos/<dbKey>.jpg` |
| IndexedDB | Full-resolution photos (web build; redundancy on iOS) | db `nps_photos_v1`, store `photos` |
| localStorage fallback | Last-resort photo copy | `photo_full_<dbKey>` |
| Service worker cache | App shell, data JSON, JSZip, ExcelJS | `nps-collector-v1.0` |

Unique `nps_*` keys let this app coexist with the USFS and DLA apps on the same device.
