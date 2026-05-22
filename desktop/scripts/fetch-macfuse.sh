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

# Authenticate the API call when a token is available — unauthenticated GitHub
# API requests from CI runners get 403'd by rate limiting. GITHUB_TOKEN can read
# public repos' release metadata fine.
auth=()
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
[[ -n "$TOKEN" ]] && auth=(-H "Authorization: Bearer $TOKEN")

URL="$(curl -fsSL "${auth[@]}" https://api.github.com/repos/macfuse/macfuse/releases/latest \
  | python3 -c "import sys,json; a=json.load(sys.stdin).get('assets',[]); print(next((x['browser_download_url'] for x in a if x['name'].endswith('.dmg')), ''))" \
  2>/dev/null || true)"

# Fallback to a pinned release if the API is unavailable.
if [[ -z "$URL" ]]; then
  echo "fetch-macfuse: API lookup failed — using pinned macFUSE 4.8.0"
  URL="https://github.com/macfuse/macfuse/releases/download/macfuse-4.8.0/macfuse-4.8.0.dmg"
fi
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
