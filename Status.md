# NPS Photo Collector — Status

**Last updated:** 2026-09-16

## Status: ✅ Web app functional and deployed (iOS shell scaffolded, TestFlight deferred)

- **Web (PWA):** Live at https://victorious-ocean-0a7852b10.3.azurestaticapps.net on Azure Static Web Apps (resource `nps-data-collector`, resource group `rg-fs-tools`, Central US, Free tier), auto-deploying on push to `main` via GitHub Actions. Works fully offline after first load via service worker (cache `nps-collector-v1.2`).
- **Source:** https://github.com/whittw1/NPS-Photo-Tool — forked 2026-09-10 from the USFS Photo Collector. Shared code (photo storage, service worker, export pipeline, autosave, search engine) is kept textually identical to the USFS `index.html` so fixes port between the apps as clean copy-paste.
- **Reference data (2026-09-16):** the app now runs off the **NPS EnviroCheck Sheets**, not the Forest Service Team Guide. `envirocheck_checklists.json` holds 810 checklist questions parsed from the 17 federal sheets (2017 editions) by `build_envirocheck.js`, with each question's regulatory citation and P1–P4 priority. The Team Guide index, its build script and the Common Citations quick-pick were removed.
- **Locations:** `nps_locations.json` — 449 park units, 43,026 named locations (4.2 MB) built from the NPS Land Resources Division boundary centroids plus the NPS Public POIs and Public Buildings national datasets (no API key needed).
- **iOS (TestFlight):** Capacitor 8 project generated (`ios/`, bundle id `com.hgsengineering.npsphotocollector`, marketing version 1.0, build 1) but **not yet customized or uploaded** — still needs Info.plist usage strings, `ITSAppUsesNonExemptEncryption`, signing team, app icon, and an App Store Connect record. Deferred by request until the web app has been used in the field.

## What the App Does

NPS Photo Collector is a single-file Progressive Web App (all HTML/CSS/JS in `index.html`, no build step) for National Park Service environmental-audit photo documentation, used by HGS Engineering auditors. Each entry captures a park + location (picked from the bundled facility list with GPS distance sorting, park auto-detect and nearest-location auto-suggest), an EnviroCheck sheet, a specific EnviroCheck question (searchable index of 810 questions with sheet filter chips, synonym matching, ranking hints and recent picks), a **Finding / Observation** score (required), a condition description, GPS coordinates with accuracy, and any number of photos (camera or library, client-side compressed, written through three-tier durable storage with verified writes and an integrity badge).

Two exports share the same date filter and missing-photo guard:

- **Export ZIP** — renamed photos (`MMDDYY_Location_PARKCODE_NNNN.jpg`), a CSV, and a styled two-sheet Excel workbook whose Findings Report sorts Findings before Observations. Stamps entries as exported and offers a post-export batch delete.
- **Word Report** — a `.docx` photo log: one photo per row at the same numbers the ZIP gives them, with captions carrying the F-1/O-1 label, location, description, sheet, question, GPS and time. A report only: it never stamps entries or offers deletion.

## Current Capabilities

- Offline-first PWA on Azure Static Web Apps (auto-deploy from GitHub `main`)
- Region → Park → Location picker over 449 park units / 43,026 locations, GPS Nearby filtering, park auto-detect, nearest-location auto-suggest
- EnviroCheck question search: 810 questions from the 17 federal sheets, sheet filter chips, synonym matching, phrase ranking hints, recent picks, priority (P1–P4) shown on every result
- Finding / Observation scoring (required to save)
- Photo capture/import with configurable compression, unlimited slots, verified three-tier durable storage, integrity badge
- ZIP export (photos + CSV + styled XLSX) and Word photo log export, both date-filtered and both blocked on missing photos
- Storage usage bar, previous-day reminder, JSON backup/restore
- NPS brown header/accent so it is visually distinct from the green USFS app on the same device

## Open Items / Decisions to Confirm

- **Question code format** was chosen here, not given: questions are numbered `<SHEET>.<NN>` (e.g. `UO.05`, `SPCC.02`, `HW.01`) following each sheet's own question numbering. Say the word if auditors cite them differently.
- **Common Citations was removed**, not replaced — the old quick-pick held Forest Service Team Guide codes. If there is a short list of findings NPS writes constantly, it can come back as an NPS quick-pick.
- The EnviroCheck sheets are the **2017 federal editions** only. There are no state supplements in the set, and the sheets do not cover NPS-specific policy (for example bear-resistant containers), so those searches find nothing.
- Midwest-region NPS GIS data is largely unnamed; about 1,000 locations carry synthesized names like `Campground (unnamed)`. The NPS Data API (free key) could backfill named facilities.
- The Word report embeds photos through docx 8.2.2, which names every embedded image `.png` regardless of format. Word reads the JPEG bytes correctly (the DLA tool has shipped this for months), but a future docx upgrade should be checked against Word.
- TestFlight pipeline when the web app has proven itself.
- Version/build bumps only on explicit request (team policy).
