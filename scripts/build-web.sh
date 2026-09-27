#!/bin/sh
# npm run build: copies the web app's files, as listed in web-files.txt, into
# www/, which `npx cap sync ios` then copies into the iOS app. www/ is emptied
# first, so a file renamed or removed never lingers in the app. It also writes
# the native-side fingerprint (scripts/web-stamp.sh) that the Xcode check uses.
set -e
cd "$(dirname "$0")/.."
rm -rf www
mkdir www
for pattern in $(grep -v '^[[:space:]]*#' web-files.txt); do
  found=
  for f in $pattern; do                       # the * expands here, in the repo
    [ -f "$f" ] || continue
    mkdir -p "www/$(dirname "$f")"
    cp "$f" "www/$f"
    found=1
  done
  [ -n "$found" ] || { echo "build: nothing matches '$pattern' in web-files.txt" >&2; exit 1; }
done
sh scripts/web-stamp.sh > www/.web-stamp
