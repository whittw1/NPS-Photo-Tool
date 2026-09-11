# NPS Photo Collector — Status

**Last updated:** 2026-09-10

## Status: ✅ Web app functional and deployed (iOS shell scaffolded, TestFlight deferred)

- **Web (PWA):** Live at https://victorious-ocean-0a7852b10.3.azurestaticapps.net on Azure Static Web Apps (resource `nps-data-collector`, resource group `rg-fs-tools`, Central US, Free tier), with auto-deploy on push to `main` via GitHub Actions (`AZURE_STATIC_WEB_APPS_API_TOKEN` secret set). Works fully offline after first load via service worker (cache `nps-collector-v1.0`).
- **Source:** https://github.com/whittw1/NPS-Photo-Tool — forked 2026-09-10 from the USFS Photo Collector at its `74667a4` commit (service-worker cache v1.12 / durable-photo-storage build). Shared code is kept textually identical to the USFS `index.html`; only the NPS-specific sections differ.
- **iOS (TestFlight):** Capacitor 8 project generated (`ios/`, SPM, bundle id `com.hgsengineering.npsphotocollector`, marketing version 1.0, build 1) but **not yet customized or uploaded** — still needs the Info.plist usage strings, `ITSAppUsesNonExemptEncryption`, signing team, app icon (a brown NPS variant of the USFS icon is drafted), and an App Store Connect record. Deferred by request until the web app has been used in the field.
- **Data (2026-09-10):** `nps_locations.json` — 449 park units, 43,026 named locations (4.2 MB) built from the NPS Land Resources Division boundary centroids plus the NPS Public POIs and Public Buildings national datasets on mapservices.nps.gov (no API key). Team Guide citations (6,445) copied unchanged from the USFS app.

## What the App Does

NPS Photo Collector is a single-file Progressive Web App (all HTML/CSS/JS in `index.html`, no build step) for National Park Service environmental-audit photo documentation, used by HGS Engineering auditors. Each entry captures a park + location (picked from the bundled facility list with GPS distance sorting and a Nearby/All radius toggle, GPS auto-detect of the park, and auto-suggest of the nearest location), a Protocol Area, a Team Guide citation (searchable index of 6,445 citations with synonym matching, area chips, recent picks, and the Common Citations quick-pick), a **Finding / Observation** score (required), a condition description, GPS coordinates with accuracy indicators, and any number of photos (camera or library, client-side compressed, written through the three-tier durable storage with verified writes and an integrity badge). Export produces a ZIP of renamed photos (`MMDDYY_Location_PARKCODE_NNNN.jpg`), a CSV, and a styled two-sheet Excel workbook whose Findings Report sorts Findings before Observations; entries are stamped as exported, with an optional post-export batch delete.

## Current Capabilities

- Offline-first PWA on Azure Static Web Apps (auto-deploy from GitHub `main`)
- Region → Park → Location picker over 449 park units / 43,026 locations, GPS Nearby filtering, park auto-detect, nearest-location auto-suggest
- Team Guide citation search (6,445 citations incl. FS and 7 state supplements) with chips, synonyms, ranking hints, recents, Common Citations
- Finding / Observation scoring (required to save)
- Photo capture/import with configurable compression, unlimited slots, verified three-tier durable storage, integrity badge
- ZIP export with date filter, styled XLSX Findings Report, CSV, missing-photo guard, exported/not-exported tracking, post-export batch delete
- Storage usage bar, previous-day reminder, JSON backup/restore
- NPS brown header/accent so it is visually distinct from the green USFS app on the same device

## Open Items / Decisions to Confirm

- **Findings Report order** was chosen without confirmation: Finding → Observation → unscored, then citation-bearing entries (by code) before citationless — change the `SCORE_RANK` sort in `runExport()` if a different order is wanted.
- The three **"FS:" protocol-area options** and the FS/state citation supplements were left in place (the citation system was to stay exactly as-is); drop them if they are noise for NPS audits.
- Locations show and export the **park alpha code** as the second segment (`Name — YELL`); switch `d` in `build_locations.js` to the full park name or blank if preferred.
- Midwest-region NPS GIS data is largely unnamed; ~1,000 locations carry synthesized names like `Campground (unnamed)`. The NPS Data API (api.nps.gov, free key) could backfill named visitor centers/campgrounds if that matters.
- TestFlight pipeline (see above) when the web app has proven itself.
- Version/build bumps only on explicit request (team policy).
