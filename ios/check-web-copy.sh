#!/bin/sh
# Xcode build phase "Check web files are current" (App target, first phase).
# The iOS app ships whatever is in ios/App/App/public, and only `npm run sync`
# puts it there. The build stops when that copy is not what a sync of the
# current repo would give: a file missing, different or left over from an older
# build, or the native side changed since (capacitor.config.json, package.json,
# the Capacitor plugins). The file list is web-files.txt, the one the build uses.

REPO="${SRCROOT:?run from Xcode, or set SRCROOT to ios/App}/../.."
PUB="$SRCROOT/App/public"
cd "$REPO" || exit 1

# Xcode's User Script Sandboxing (set to No for this target) would deny these
# reads and make every file look stale: say that instead of blaming the sync.
if ! ls "$PUB" >/dev/null 2>&1 || ! cat web-files.txt >/dev/null 2>&1; then
  if [ -d "$PUB" ]; then
    echo "error: this check cannot read the project files. If ENABLE_USER_SCRIPT_SANDBOXING was turned on (Xcode's \"recommended settings\" do that), set it back to No for the App target."
  else
    echo "error: ios/App/App/public does not exist. Run npm run sync, then build again."
  fi
  exit 1
fi

stale=""
expected=""
for pattern in $(grep -v '^[[:space:]]*#' web-files.txt); do
  for f in $pattern; do                       # the * expands here, in the repo
    if [ ! -f "$f" ]; then stale="$stale $pattern(nothing in the repo)"; continue; fi
    expected="$expected
$f"
    if [ ! -f "$PUB/$f" ]; then stale="$stale $f(missing)"
    elif ! cmp -s "$f" "$PUB/$f"; then stale="$stale $f"; fi
  done
done
# Anything else in public/ is left over from an older build. Capacitor adds the
# two cordova files, and the build adds the fingerprint.
for f in $(cd "$PUB" && find . -type f ! -name cordova.js ! -name cordova_plugins.js ! -name .web-stamp | sed 's|^\./||'); do
  printf '%s\n' "$expected" | grep -qxF "$f" || stale="$stale $f(left over)"
done
[ "$(cat "$PUB/.web-stamp" 2>/dev/null)" = "$(sh scripts/web-stamp.sh)" ] || stale="$stale native-side(capacitor.config.json, package.json or a Capacitor plugin changed)"

if [ -n "$stale" ]; then
  echo "error: ios/App/App/public is out of date:$stale. Run npm run sync, then build again."
  exit 1
fi
echo "Web files in ios/App/App/public match the repo."
