#!/bin/sh
# Prints a fingerprint of what `npx cap sync ios` turns into the iOS project's
# native side: capacitor.config.json, package.json, and the installed Capacitor
# packages and plugins with their versions. `npm run build` writes it into www/
# (the sync carries it to ios/App/App/public), and ios/check-web-copy.sh
# recomputes it, so a config or plugin change without a sync stops the build.
cd "$(dirname "$0")/.." || exit 1
{
  cat capacitor.config.json package.json
  for p in node_modules/@capacitor/*/package.json node_modules/@capacitor-community/*/package.json; do
    [ -f "$p" ] && printf '%s %s\n' "$p" "$(sed -n 's/^  "version": "\(.*\)",*$/\1/p' "$p")"
  done
} | shasum -a 256 | cut -d' ' -f1
