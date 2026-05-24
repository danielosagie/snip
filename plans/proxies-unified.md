# Proxies, unified: download proxies + drive edit-proxies = one pipeline

Two efforts converge on the **same artifact** — a Mux static-rendition MP4:

- **Download proxies** (`plans/download-proxies.md`): let viewers/editors download a
  smaller MP4 from the dashboard menu + share sheet.
- **Drive edit-proxies** (the LucidLink-style mount): editors cut off proxies on the
  mounted R2 drive; toggle to full-res on demand.

Build **one** transcode pipeline; the drive is a thin add-on that mirrors the ready
rendition into R2.

## Shared blocker
snip's Mux assets are `mp4_support: "none"` (`convex/mux.ts:85,155`) → no MP4 exists.
Both features need Mux **static renditions** turned on. Generation is async + costs a
re-encode, so it's **on-demand**, not per-upload (user is cost-sensitive).

## One pipeline (backend)

1. **Request** — `requestProxies({videoId, resolutions?})` (member-gated) calls
   `mux.video.assets.createStaticRendition(assetId, {resolution})` per resolution.
   Default to a single **720p** (a good offline edit proxy; ~11 Mbps). Idempotent:
   skip resolutions already preparing/ready. Writes `staticRenditions[]` = "preparing".
2. **Track** — webhook `video.asset.static_rendition.ready|.errored` upserts the entry
   on the `videos` row by `name` (e.g. `"720p.mp4"`), mirroring the `muxPreviewAsset*`
   pattern. Status: preparing → ready/errored, with `filesizeBytes`.
3. **Serve (download)** — `getProxyDownloadUrl` builds
   `https://stream.mux.com/{playbackId}/{name}` (`name` = `720p.mp4`).
   - Dashboard (member): public playback id, no token.
   - Share grant: reuse the EXACT gates from `getSharedDownloadUrl` (allowDownload,
     paywall+grantPaidAt). Prefer the **signed** playback id + a short Mux JWT
     (audience `v`) so the URL is short-lived/revocable like the S3 ones; fall back
     to public only for non-paywalled allowDownload shares. `recordEgressBytes`.
4. **Availability** — surface ready rendition names on the grant query + dashboard
   query so the UI only offers resolutions that exist.

## Drive add-on (separate, builds on the above)

5. **Mirror to R2** — when a rendition goes ready, an action streams the Mux MP4 into
   R2 at the project proxy path so the mounted drive serves it:
   `projects/<teamSlug>/<projectId>/proxies/<videoId>/<name>` and the original at
   `projects/.../originals/...`. (Reconciles the `videos/` vs `projects/` layout split
   noted in `bench/FINDINGS-AND-PLAN.md` Phase 2.)
6. **Proxy toggle** — the mount/NLE resolves the `proxies/` key by default; "full-res"
   resolves `originals/`. Toggle = which subtree the drive presents. Full-res is pulled
   on demand and cached after first touch (no edit box plays full-res 4K live anyway).

## Cost shape
COGS = storage(originals + proxies) + one-time transcode per requested rendition.
Proxies ≈ 10% the bytes; on R2 egress is $0. Generating one 720p per asset on demand
keeps Mux re-encode spend bounded.

## Status / handoff
- **Built (backend pipeline):** schema `staticRenditions[]` (+ `r2Key`), `mux.ts`
  helpers, webhook ready/errored handling, `videos.ts` mutations + grant-query proxy
  fields, `requestProxies` + `getProxyDownloadUrl` actions. Typechecked.
- **Built (drive mirror, step 5):** `mirrorRenditionToR2` internalAction +
  `getProxyMirrorContext`/`setStaticRenditionR2Key`; the `static_rendition.ready`
  webhook schedules it. Buffered + **size-guarded at 300 MB** — GB-scale feature
  proxies stay download-only here and should be mirrored by the desktop app / a
  worker (true streaming upload; `@aws-sdk/lib-storage` isn't installed on the
  Convex side).
- **Built (UI):** dashboard context-menu proxy entries (availability-aware:
  download-per-ready, "generating…" per pending, "Generate proxy (720p)" trigger)
  in `-project.tsx`; quality picker in `ShareDownloadSheet.tsx`.
- **Next:** proxy↔full-res toggle in the mount (step 6); per-item availability in
  the share sheet (thread `staticRenditions` through `getShareSummaryByGrant` so
  unavailable qualities are hidden, not just errored); streaming R2 mirror for
  GB-scale proxies; backfill action for existing assets (admin/cost-gated). NOT
  deployed/tested against live Mux — only typechecked.
