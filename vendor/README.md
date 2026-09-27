# Vendored libraries

Bundled with the app so exports work offline on the iOS build, which has no
service worker to cache CDN scripts. Do not edit these files; to upgrade, replace
a file with the new version's minified build, check it against the cdnjs SRI
hash (for docx, the file hash jsDelivr publishes), update the table below, and bump
`CACHE_NAME` in `sw.js`.

| File | Library | Version | Source | License |
|---|---|---|---|---|
| `jszip.min.js` | JSZip | 3.10.1 | https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js | MIT or GPLv3 (used under MIT) — `LICENSE-jszip.md` |
| `exceljs.min.js` | ExcelJS | 4.4.0 | https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js | MIT — `LICENSE-exceljs.txt` |
| `docx.umd.js` | docx | 8.2.2 | https://cdn.jsdelivr.net/npm/docx@8.2.2/build/index.umd.js | MIT — `LICENSE-docx.txt` |

SRI hashes (verified against `https://api.cdnjs.com/libraries/<lib>/<version>?fields=sri` on 2026-09-27):

- `jszip.min.js`: `sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==`
- `exceljs.min.js`: `sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==`

docx is not on cdnjs. `docx.umd.js` is the package's `build/index.umd.js` and `LICENSE-docx.txt` its
`LICENSE`, both verified against the file hashes jsDelivr publishes at
`https://data.jsdelivr.com/v1/packages/npm/docx@8.2.2` on 2026-09-27:

- `docx.umd.js`: `sha256-L8p4PXqv5Tf0dxxe9qmlkrMZkbUJ7aMS+D2Z3Bz7S3o=` (732,712 bytes; SRI `sha512-erFzi4xuyr2QqWOecuCJdsIqdTiv8o6z9kEfX0IM8zw8DfDjSV4bS42S9S7AqDyuORJmV6/VOCc4GRbkmWfKvg==`)
- `LICENSE-docx.txt`: `sha256-tbI2TAyVomsqI5nX5wamGsrGgL4dWxgLAFku6Fgwv/s=`
