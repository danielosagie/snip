# Building snip Desktop (DMG)

The desktop app packages as a macOS `.dmg` via `electron-builder`. Output lands
in `desktop/release/`.

## Quick start

```bash
cd desktop
bun install                     # picks up electron-builder
bun run build:dmg               # universal (arm64 + x64)
# or:
bun run build:dmg:arm64         # Apple Silicon only — faster
bun run build:dmg:x64           # Intel only
```

The first build downloads the matching Electron framework binary (~120 MB) into
`~/.cache/electron`; subsequent builds are fast.

## What the build does

1. `vite build` compiles the renderer to `dist/`.
2. `electron-builder` packs `electron-main.cjs`, `preload.cjs`, `dist/`, and
   `resources/` into an `.app` bundle, then wraps it in a DMG.
3. Code-signing + notarization are **off by default** (see below).

Result: `desktop/release/snip-0.1.0-arm64.dmg` (and the x64 variant if you
asked for both).

## Cutting a release (versioning + auto-update)

Installed apps self-update via `electron-updater` against GitHub Releases
(`build.publish` → `danielosagie/snip`). To ship a new version:

1. Bump `desktop/package.json` `version` (e.g. `0.1.1` → `0.1.2`).
2. Commit, then tag and push: `git tag desktop-v0.1.2 && git push origin desktop-v0.1.2`.
3. The `release` job in `.github/workflows/desktop-dmg.yml` builds **both arches
   in one signed invocation** (`bun run release`) and publishes the DMG + zip +
   `latest-mac.yml` to a GitHub Release tagged `v0.1.2`, copies the per-arch
   DMGs to the stable names the web download buttons use (`snip-desktop.dmg` /
   `snip-desktop-x64.dmg`), then marks the release **latest**.

`releases/latest` is therefore both the download source (`vercel.json` redirects
`/downloads/snip-desktop.dmg` here) and the feed `electron-updater` reads.

**The tag version must match `package.json`** — CI fails fast otherwise.

**Auto-update requires signing** (next section). Squirrel.Mac will not apply an
unsigned update, and the `release` job errors out if no signing cert is present.
The in-app **Settings → Updates** panel shows the current version, lets you
"Check for updates", and surfaces "Restart & install" once a build is staged.

To cut a release locally instead of via CI (signing env must be set, plus a
`GH_TOKEN` with `repo` scope): `cd desktop && bun run release`.

## Code signing & notarization

Unsigned DMGs work on the dev machine but Gatekeeper will reject them on other
Macs ("can't be opened because Apple cannot check it for malicious software").

To sign you need an Apple Developer ID:

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="TEAMID"
```

Then flip `mac.notarize` to `true` in `package.json` and rebuild. electron-
builder will sign the app bundle and submit it to Apple's notary service.

Without notarization, users have to right-click → Open the first time, or run
`xattr -d com.apple.quarantine /Applications/snip.app` after install.

## Generating the DMG cosmetics

```bash
bun run generate:dmg-assets                   # uses ../public/grass-logo.svg
bun run generate:dmg-assets ./icon-1024.png   # custom source
```

What it does:
- **`resources/icon.icns`** — full Apple iconset (16/32/64/128/256/512/1024 + @2x
  variants), built with macOS-bundled `sips` + `iconutil`. From an SVG source
  it shells out to `rsvg-convert` (`brew install librsvg`). PNG sources work
  with no extra deps.
- **`resources/dmg-background.png`** — 540×380 brutalist cream backdrop with
  an orange band where the drag-to-Applications arrow sits. Uses ImageMagick
  (`brew install imagemagick`) when present; falls back to a flat cream PNG
  so the DMG still builds without it.

The script only needs to run when the source artwork changes. Both outputs
are committed-once so CI builds don't depend on the optional brew tools.

## What still needs to ship before public release

- **Source artwork**: `public/grass-logo.svg` (used as the default) is the
  wordmark, not an app-icon mark. For a publishable build, drop a
  1024×1024 PNG of the *icon* (just the orange mark on a cream square, no
  wordmark) and run `bun run generate:dmg-assets path/to/icon-1024.png`.
- **Code signing + notarization**: see above.

## Bundled prerequisites

The mount feature shells out to `rclone` and requires the macFUSE driver. The
app does **not** bundle these — it surfaces an install hint in the UI when
they're missing. (Bundling rclone is technically fine but inflates the DMG by
~20 MB. macFUSE has to be a separate install because it ships a kernel
extension that needs the user's explicit approval in System Settings →
Privacy & Security.)
