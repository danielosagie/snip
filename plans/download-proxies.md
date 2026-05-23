# Download Proxies — Implementation Plan

## Goal

Let users download a lower-resolution **proxy** (transcoded MP4 rendition) of a
video instead of the full original — from the dashboard right-click menu
("Download proxies" → Low / Medium / High) and the share-page download sheet.
Proxies are smaller/faster for editors cutting offline and for clients on slow
links.

## Key constraint (read first)

snip streams via Mux but **`mp4_support` is currently `none`** on assets (noted
when Whisper-on-mp4 was blocked). Static MP4 renditions therefore don't exist
yet. Proxies require enabling Mux **static renditions** (the modern replacement
for `mp4_support`). Nothing downloads as a proxy until that's turned on per
asset and Mux finishes generating them (async, like the preview asset).

## Backend

1. **Enable static renditions on Mux assets.**
   - On asset creation (`convex/muxActions.ts` / wherever `assets.create` /
     upload settings live) add `static_renditions` requesting resolutions, e.g.
     `[{ resolution: "highest" }, { resolution: "medium" }, { resolution: "low" }]`
     (or use `mp4_support: "capped-1080p"` if staying on the legacy field).
   - **Backfill action** for existing assets: iterate ready videos with a
     `muxAssetId`, call Mux `assets.createStaticRendition` (or update mp4_support),
     idempotently. Gate behind an admin/cron action; this re-encodes, so it
     incurs Mux cost — make it opt-in per team or run lazily on first proxy
     request.

2. **Track rendition state on the video row.**
   - Add `staticRenditions?: Array<{ name: string; resolution: string; status:
     "preparing"|"ready"|"errored"; ext: string; filesizeBytes?: number }>` to
     the `videos` table (mirrors how `muxPreviewAsset*` is tracked).
   - Update it from the Mux webhook (`video.asset.static_rendition.ready` /
     `.errored`) in the existing Mux webhook handler.

3. **Signed download URL action.**
   - `videoActions.getProxyDownloadUrl({ videoId | grantToken, itemVideoId?, renditionName })`.
   - Resolve the playback id; build `https://stream.mux.com/{playbackId}/{renditionName}.mp4`.
     For **signed** playback policies, mint a Mux JWT (audience `v`/video,
     same signing key used for the preview stream) and append `?token=`.
   - **Reuse the exact access/paywall gates** from `getSharedDownloadUrl`
     (allowDownload, paywall+paid, grant role) and `requireVideoMemberAccess`
     for the dashboard path. Record egress (`recordEgressBytes`).
   - Return `{ url, filename }` (filename like `${title} (medium).mp4`).

4. **Expose availability.**
   - Add ready rendition names to `getShareSummaryByGrant` items and the
     dashboard video query so the UI only offers resolutions that exist.

## Frontend

1. **Dashboard context menu** (`ContextMenu` in `-project.tsx`): add a
   "Download proxies" group — one entry per ready rendition (Low/Medium/High);
   disabled with "Generating…" while `status==="preparing"`; hidden when the
   asset has none. Wire to `getProxyDownloadUrl` + `triggerDownload`. Support
   the multi-select case (sequential queue, same pattern as `handleBulkDownload`).

2. **Share download sheet** (`ShareDownloadSheet`): add a per-row resolution
   picker (or a "Quality" select at the top: Original / High / Medium / Low) that
   routes downloads through `getProxyDownloadUrl` instead of
   `getSharedDownloadUrl` when a proxy is chosen. Respect the same paywall lock.

## Edge cases / notes

- Non-video assets (images, PDFs, audio) have no proxies — only offer for items
  with `hasMuxPlayback`.
- Generation is async + costs money: surface "Generating proxies…" and consider
  generating on first request rather than for every upload.
- If staying on legacy `mp4_support`, the URL is
  `https://stream.mux.com/{playbackId}/{low|medium|high}.mp4` and you skip the
  per-rendition tracking table (Mux exposes a fixed set), but you lose
  per-rendition status granularity.

## Handoff

The person on proxies owns steps 1–3 (Mux enablement + webhook + signed URL).
The UI hooks (context-menu group + sheet quality picker) are small and can land
once `getProxyDownloadUrl` + availability data exist.
