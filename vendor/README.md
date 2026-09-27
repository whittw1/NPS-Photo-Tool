# Vendored libraries

Bundled with the app so exports work offline everywhere: the iOS build carries
them in its bundle (it has no service worker), and on the web the service
worker keeps them for offline use. Each file name carries its version, so a name
always means the same bytes; the host serves `/vendor/*.js` as immutable for a
year, and the service worker copies them from one release to the next instead of
downloading them again. `sw.js` holds each file's SHA-256 and stores or reuses a
copy only when it matches; `npm test` checks those hashes against the files.

**Never edit a file here in place.** To upgrade or add a library:

1. Download the new version's browser build: the minified file cdnjs serves for
   JSZip and ExcelJS; for docx, the package's own `build/index.umd.js` (docx
   publishes no minified build, and jsDelivr's generated `.min.js` has no
   published hash). Check it against the cdnjs SRI hash, or for docx the file
   hash jsDelivr publishes.
2. Save it here under a new name with the version in it (`jszip-3.10.2.min.js`),
   `git rm` the old file, and update its licence file if the licence changed.
3. Point the `<script>` tag in `index.html` at the new name (keep `data-lib`;
   drop `data-legacy`, which names v4.7's copy of the old version), and replace
   the entry in `sw.js`'s `LIBRARIES` with the new name and its SHA-256
   (`openssl dgst -sha256 -binary <file> | openssl base64 -A`, prefixed
   `sha256-`). Delete the rewrite in `staticwebapp.config.json` that serves the
   old library's v4.7 name, since it points at the file removed.
4. Update the table and hashes below and the table in `ARCHITECTURE.md` §4.
5. Bump `CACHE_NAME` in `sw.js` and `APP_VERSION` in `index.html` together and
   run `npm test` (CI runs it before deploying: it checks the hashes, simulates
   an upgrade and a renamed library, and fails on a name any release still
   needs). Run `npm run sync` before the next iOS build; the Xcode build refuses
   a stale copy.

| File | Library | Version | Source | License |
|---|---|---|---|---|
| `jszip-3.10.1.min.js` | JSZip | 3.10.1 | https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js | MIT or GPLv3 (used under MIT) — `LICENSE-jszip.md` |
| `exceljs-4.4.0.min.js` | ExcelJS | 4.4.0 | https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js | MIT — `LICENSE-exceljs.txt` |
| `docx-8.2.2.umd.js` | docx | 8.2.2 | https://cdn.jsdelivr.net/npm/docx@8.2.2/build/index.umd.js | MIT — `LICENSE-docx.txt` |

SRI hashes (verified against `https://api.cdnjs.com/libraries/<lib>/<version>?fields=sri` on 2026-09-27; the files were renamed with their versions in v4.8, bytes unchanged):

- `jszip-3.10.1.min.js`: `sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==`
- `exceljs-4.4.0.min.js`: `sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==`

docx is not on cdnjs. `docx-8.2.2.umd.js` is the package's `build/index.umd.js` and `LICENSE-docx.txt` its
`LICENSE`, both verified against the file hashes jsDelivr publishes at
`https://data.jsdelivr.com/v1/packages/npm/docx@8.2.2` on 2026-09-27:

- `docx-8.2.2.umd.js`: `sha256-L8p4PXqv5Tf0dxxe9qmlkrMZkbUJ7aMS+D2Z3Bz7S3o=` (732,712 bytes; SRI `sha512-erFzi4xuyr2QqWOecuCJdsIqdTiv8o6z9kEfX0IM8zw8DfDjSV4bS42S9S7AqDyuORJmV6/VOCc4GRbkmWfKvg==`)
- `LICENSE-docx.txt`: `sha256-tbI2TAyVomsqI5nX5wamGsrGgL4dWxgLAFku6Fgwv/s=`
