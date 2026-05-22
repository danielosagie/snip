#!/bin/bash
# Downloads the latest official macFUSE installer and stashes its .pkg at
# resources/macfuse.pkg so electron-builder bundles it into the app (and the
# .pkg postinstall installs it). Run from the desktop/ directory before build.
#
# macFUSE ships as a .dmg containing "Install macFUSE.pkg"; we mount it, copy
# the pkg out, and detach. macOS only (needs hdiutil) — skipped elsewhere.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "fetch-macfuse: not macOS — skipping."
  exit 0
fi

DEST="resources/macfuse.pkg"
if [[ -f "$DEST" ]]; then
  echo "fetch-macfuse: $DEST already present — skipping download."
  exit 0
fi

URL="$(curl -fsSL https://api.github.com/repos/macfuse/macfuse/releases/latest \
  | python3 -c "import sys,json; assets=json.load(sys.stdin)['assets']; print(next(a['browser_download_url'] for a in assets if a['name'].endswith('.dmg')))")"
echo "fetch-macfuse: downloading $URL"

TMP="$(mktemp -d)"
MNT="$(mktemp -d)"
cleanup() { hdiutil detach "$MNT" >/dev/null 2>&1 || true; rm -rf "$TMP" "$MNT"; }
trap cleanup EXIT

curl -fsSL "$URL" -o "$TMP/macfuse.dmg"
hdiutil attach "$TMP/macfuse.dmg" -nobrowse -mountpoint "$MNT" >/dev/null

PKG="$(find "$MNT" -maxdepth 1 -iname '*.pkg' | head -1)"
if [[ -z "$PKG" ]]; then
  echo "fetch-macfuse: no .pkg found inside macFUSE dmg" >&2
  exit 1
fi

mkdir -p resources
cp "$PKG" "$DEST"
echo "fetch-macfuse: wrote $DEST ($(du -h "$DEST" | cut -f1))"
