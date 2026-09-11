# Web App → TestFlight Playbook

How we took a single-page HTML+JS app (USFS Photo Tool) and shipped it to TestFlight as a native iOS app via Capacitor. Reference for spinning up similar apps.

---

## TL;DR — the whole pipeline

```
edit index.html  →  npm run sync  →  bump build # in Xcode  →  archive  →  upload to App Store Connect  →  TestFlight
```

A single HTML file is wrapped by Capacitor into a tiny native iOS shell that just hosts a WebView pointing at your bundled assets. Most of the "iOS app" surface area is still web code.

---

## What you start with

- **One `index.html`** with all your UI + JS inline (or a small set of static files)
- Whatever client-side libraries you need (CDN-loaded is fine)
- Optional: `sw.js` (service worker) + `manifest.json` for PWA offline / install behaviour
- Any JSON data files you want bundled (we have `team_guide_citations.json`, `forest_locations.json`)

**Hard constraint:** everything must work client-side. Capacitor wraps a WebView; there's no Node runtime, no server. If your app needs SSR or Node APIs, this approach won't work.

---

## Tech stack

| Piece | What we use | Notes |
|---|---|---|
| Native shell | Capacitor 8 (`@capacitor/cli`, `@capacitor/core`, `@capacitor/ios`) | Maintained by Ionic; thinner than Cordova |
| WebView | iOS WKWebView (provided by Capacitor) | — |
| Storage | `localStorage` + `IndexedDB` | localStorage for metadata, IDB for blobs |
| Zip output | JSZip (from cdnjs) | Bundle photos + reports |
| Styled Excel | ExcelJS (from cdnjs) | SheetJS community can't do per-cell styling — see gotcha below |
| Camera / GPS | `<input type="file" capture>` + `navigator.geolocation` | Standard web APIs, no plugins needed for the basic case |
| Offline support | Service worker | Cache index.html + assets |

Apple side: a paid Apple Developer account ($99/yr) and Xcode installed.

---

## Project structure

```
project-root/
├── index.html              # the whole app
├── sw.js                   # service worker
├── manifest.json           # PWA manifest
├── *.json                  # bundled data files
├── package.json            # capacitor deps + sync scripts
├── capacitor.config.json   # capacitor config (bundle id, webDir, etc.)
├── www/                    # build output — what Capacitor bundles
│   └── (copy of all the above static files)
└── ios/                    # capacitor-generated Xcode project
    └── App/
        ├── App.xcodeproj/  # version / build numbers live here
        ├── App/
        │   ├── Info.plist  # usage descriptions, etc.
        │   └── public/     # the actual files shipped inside the .ipa
        └── Podfile
```

The `www/` directory is the bridge between "source files at project root" and "what Capacitor copies into the iOS bundle." It's regenerated every sync.

---

## One-time setup

```bash
cd project-root
npm init -y
npm i @capacitor/cli @capacitor/core @capacitor/ios
npx cap init "App Name" com.your.bundle.id --web-dir=www
mkdir www && cp index.html sw.js manifest.json *.json www/   # seed www
npx cap add ios
```

Then add these scripts to `package.json`:

```json
"scripts": {
  "build": "cp index.html sw.js manifest.json *.json www/",
  "sync":  "npm run build && npx cap sync ios",
  "open":  "npx cap open ios"
}
```

Adjust the `cp` source list to match your actual files. The `build` step is literally just copying — no bundler, no transpile.

---

## Day-to-day workflow

```bash
# 1. Test in browser (no Capacitor needed)
python3 -m http.server 8080

# 2. When ready to ship:
npm run sync           # copies root files → www/ → ios/App/App/public/
# (bump CACHE_NAME in sw.js if you changed any cached asset — see SW gotcha)
# (bump CURRENT_PROJECT_VERSION in pbxproj — see version gotcha)
npm run open           # opens Xcode

# 3. In Xcode:
#    Product → Archive
#    Distribute App → App Store Connect → Upload
#    Wait ~10 min for TestFlight processing
#    Install on device via TestFlight app
```

---

## iOS version / build numbers — the two-field thing

Edit `ios/App/App.xcodeproj/project.pbxproj` directly. Two fields per build configuration (and there are two configs — Debug and Release):

| Field | Purpose | When to bump |
|---|---|---|
| `MARKETING_VERSION` | User-facing version (`1.1`) | Major releases only |
| `CURRENT_PROJECT_VERSION` | Internal build number (`9`) | **Every TestFlight upload, no exception** |

Apple rejects uploads if `CURRENT_PROJECT_VERSION` matches a previously uploaded build. Both Debug AND Release entries must match.

You can also edit these in Xcode → Targets → App → General → Identity, but editing the pbxproj directly is faster once you know the pattern (two `CURRENT_PROJECT_VERSION = N;` lines per file).

The Info.plist references these as `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)` — don't hardcode versions in Info.plist.

---

## Service worker cache — the biggest gotcha

Capacitor bundles assets at install time, BUT a service worker registered from a previous app version can still serve stale cached responses on the next launch. We hit this multiple times — users would install a new TestFlight build and see no changes because the SW served the old `index.html`.

**Pattern that works:**

```js
const CACHE_NAME = 'app-name-v1.9';   // BUMP THIS every time cached files change

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(URLS_TO_CACHE)));
  self.skipWaiting();                  // activate immediately
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch handler: network-first for HTML/JSON, cache-first for static assets
```

**Rule of thumb:** whenever you change `index.html`, `sw.js`, or any cached data file, bump `CACHE_NAME` in `sw.js`. Otherwise users on the previous build will see old assets even after installing your new TestFlight build.

A reasonable cache strategy for an app like this:
- **HTML / JSON:** network-first, fall back to cache (so updates land fast when online)
- **Static assets / CDN libs:** cache-first

---

## Storage patterns

| What | Where | Why |
|---|---|---|
| App settings, small metadata | `localStorage` | Synchronous, ~5 MB limit, simple |
| Lists of saved entries (without photo bytes) | `localStorage` (JSON-stringified) | Survives reloads, fast to read |
| Photo / file blobs | `IndexedDB` | Async, much larger limit, designed for binary |
| Reference to a photo blob | Store `{ dbKey: 'photo_XYZ' }` in localStorage | Photo metadata lives with the entry, bytes live in IDB |

**Belt-and-suspenders fallback:** if IDB write fails, also stash the photo as a base64 data URL in `localStorage` under `photo_full_<dbKey>`. The export path tries IDB first, then falls back to the localStorage copy. Clean up the fallback copies after a successful export.

---

## Things that just work (no plugin needed)

- **Camera capture:** `<input type="file" accept="image/*" capture="environment">` opens the rear camera on iOS
- **GPS:** `navigator.geolocation.getCurrentPosition(...)` — but see the GPS gotcha below
- **File download / share:** `navigator.share()` on iOS opens the native share sheet; falls back to `<a download>` on desktop
- **PWA installation prompt:** standard `manifest.json` + service worker

---

## Gotchas we actually hit

1. **Wi-Fi-only iPads have no GPS chip.** All "location" on a Wi-Fi-only iPad comes from Apple's Wi-Fi BSSID database lookup. Useless in the backcountry. Solutions:
   - Get a cellular-SKU iPad (has a real GNSS receiver, works without a SIM)
   - Pair an external Bluetooth GPS (e.g. Bad Elf, Garmin GLO, Dual XGPS) — iOS treats it as the system location source, no app changes needed
   - Use an iPhone for capture instead

2. **Tethered hotspot doesn't help GPS.** iOS won't relay the iPhone's GPS to a tethered iPad, even though they're connected. The hotspot only provides internet.

3. **SheetJS community edition can't do per-cell styling.** No fonts, no wrap text, no fills, no borders. If you need styled Excel output, use **ExcelJS** instead (~500 KB but full styling).

4. **Service worker cache hides your changes.** Bump `CACHE_NAME` (see SW section above).

5. **First Xcode archive takes forever.** Code signing, provisioning profiles, etc. Subsequent archives are much faster.

6. **Capacitor expects assets in `www/`, not project root.** Hence the build script that copies. Don't symlink — the `cap sync` step copies, and symlinks confuse it.

7. **`<input type="file">` with `capture` ONLY opens the camera; without `capture` it shows the library/file picker.** Pick deliberately.

8. **iOS may strip EXIF / re-encode photos** when going through `<input type="file">`. If you need original-quality, original-EXIF photos, you'll need the Capacitor Camera plugin instead.

---

## Privacy / Info.plist usage descriptions

Apple rejects builds with missing usage descriptions. Add to `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Used to take photos of audit findings.</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Used to tag findings with GPS coordinates.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Used to attach existing photos to findings.</string>
```

Make the strings honest — Apple's reviewers actually read them.

---

## Bundle ID / App Store Connect setup

1. Pick a bundle ID like `com.yourorg.appname`. Set it in `capacitor.config.json` AND in Xcode (Targets → App → General → Bundle Identifier).
2. In App Store Connect, create a new app with that same bundle ID. (Bundle ID must be registered as an App ID in your developer account first.)
3. Pick the app name, primary language, SKU.
4. After first Xcode archive upload, you can add internal testers via email from the TestFlight tab.
5. Each new build replaces the previous TestFlight build — testers see "Update available" in the TestFlight app.

---

## Common commands cheat sheet

```bash
# Dev loop
python3 -m http.server 8080            # test in browser at localhost:8080

# Build + sync
npm run sync                            # build → www/ → ios/App/App/public/
npm run open                            # opens Xcode

# After editing pbxproj manually
grep CURRENT_PROJECT_VERSION ios/App/App.xcodeproj/project.pbxproj   # verify bump

# Manual sync (if you don't want to run build first)
npx cap sync ios

# Add other native platforms later
npx cap add android                     # if you ever want Android too
```

---

## Per-release checklist

Before every TestFlight upload:

- [ ] Test the change in browser (`python3 -m http.server 8080`)
- [ ] Bump `CACHE_NAME` in `sw.js` if you touched any cached file
- [ ] `npm run sync`
- [ ] Bump `CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj` (both Debug + Release)
- [ ] Verify Info.plist has usage descriptions for everything you call
- [ ] `npm run open`
- [ ] Product → Archive → Distribute → App Store Connect
- [ ] Watch for processing email (~10 min)
- [ ] Install on device via TestFlight, smoke-test the change

---

## What we'd do differently next time

- **Wire SW cache bumping into the build script.** Right now it's manual; one forgotten bump = hours of debugging "why isn't my change live." Could auto-bump based on file hashes.
- **Wire build-number bumping into the build script** too, for the same reason. `npm run release` → auto-bump + sync + open Xcode.
- **Set up an iOS simulator dev loop earlier.** We did most testing in a browser, which works fine for HTML/JS but doesn't catch iOS-WebView-specific bugs (which exist, but rarely).
- **Consider the Capacitor Camera plugin from day one** if photo quality / EXIF preservation matters — the `<input type="file">` approach is simpler but iOS will re-encode.

---

## Reference: the app this was built for

USFS Photo Tool (`com.hgsengineering.usfsphotocollector`) — single-page HTML wrapped by Capacitor 8, currently at version 1.1, build 10. Source lives at `~/Desktop/Claude Apps/USFS-Photo-Tool/`. Used by USFS field auditors to capture geotagged photos + findings, then export a styled XLSX + photo bundle.
