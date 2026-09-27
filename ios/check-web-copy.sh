#!/bin/sh
# Xcode build phase "Check web files are current" (App target, first phase).
# The iOS app ships whatever is in ios/App/App/public, and only `npm run sync`
# puts the web files there. Stop the build when that copy differs from the repo,
# so an archive can never carry a stale build (ARCHITECTURE.md §13).
# The file list is read from package.json's build script, so it has one home.

REPO="${SRCROOT:?run from Xcode, or set SRCROOT to ios/App}/../.."
PUB="$SRCROOT/App/public"

files=$(sed -n 's/.*"build":.*cp \([^"&]*\) www\/ .*/\1/p' "$REPO/package.json")
if [ -z "$files" ]; then
  echo "error: could not read the web file list from package.json's build script."
  exit 1
fi

stale=""
for f in $files; do
  cmp -s "$REPO/$f" "$PUB/$f" || stale="$stale $f"
done
for f in "$REPO"/vendor/*.js "$REPO"/vendor/LICENSE-*; do
  n="vendor/$(basename "$f")"
  cmp -s "$f" "$PUB/$n" || stale="$stale $n"
done
for f in "$PUB"/vendor/*; do
  [ -e "$f" ] || continue
  [ -e "$REPO/vendor/$(basename "$f")" ] || stale="$stale vendor/$(basename "$f")(not in the repo)"
done

if [ -n "$stale" ]; then
  echo "error: ios/App/App/public is out of date:$stale. Run npm run sync, then build again."
  exit 1
fi
echo "Web files in ios/App/App/public match the repo."
