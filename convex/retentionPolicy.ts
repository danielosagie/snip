import type { Doc } from "./_generated/dataModel";

/**
 * Pure retention policy — no Convex/Mux/S3 imports, so it's safe to unit
 * test in isolation. The runtime wiring (cron action, eviction mutation)
 * lives in `convex/retention.ts` and imports from here.
 *
 * See retention.ts for the model overview.
 */

/** Days of inactivity before the encoded ladder is eligible for eviction. */
export function retentionHotDays(): number {
  const raw = Number(process.env.RETENTION_HOT_DAYS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 30;
}

/**
 * Whether cold eviction runs on this deployment. Explicit env wins;
 * otherwise it's on only when billing is enforced — single-tenant / demo
 * deployments keep everything hot so there's no surprise re-encode latency
 * for a tool someone is self-hosting.
 */
export function isEvictionEnabled(): boolean {
  const flag = (process.env.RETENTION_EVICTION ?? "").trim().toLowerCase();
  if (flag === "on" || flag === "true" || flag === "1") return true;
  if (flag === "off" || flag === "false" || flag === "0") return false;
  const secret = process.env.STRIPE_SECRET_KEY;
  return typeof secret === "string" && secret.trim().length > 0;
}

/** Wall-clock of the most recent activity; falls back to creation. */
export function videoLastActivityAt(video: Doc<"videos">): number {
  return video.lastViewedAt ?? video._creationTime;
}

/** Provider that owns the encoded ladder for a row. */
export function resolveLadderProvider(
  video: Doc<"videos">,
): "mux" | "cloudflare_stream" {
  if (video.playbackProvider) return video.playbackProvider;
  return video.streamUid ? "cloudflare_stream" : "mux";
}

/** True if the row currently has a live encoded ladder we can evict. */
export function hasLiveLadder(video: Doc<"videos">): boolean {
  return resolveLadderProvider(video) === "cloudflare_stream"
    ? Boolean(video.streamUid)
    : Boolean(video.muxPlaybackId || video.muxAssetId);
}

/**
 * Eviction safety filter. We only evict the *review* ladder of plain,
 * member-facing videos. Skipped:
 *   • non-ready / deferred / already-evicted rows,
 *   • rows with no live ladder to reclaim,
 *   • paid-delivery rows (`muxSignedPlaybackId` or a video-level paywall) —
 *     external paid viewers can't trigger a re-encode (it requires member
 *     access), so we leave their ladder intact,
 *   • image/audio rows (no Mux/Stream ladder in the first place).
 */
export function isEvictionCandidate(
  video: Doc<"videos">,
  cutoffMs: number,
): boolean {
  if (video.deletedAt) return false;
  if (video.status !== "ready") return false;
  if (video.encodingDeferred) return false;
  if (video.renditionEvictedAt) return false;
  if (!hasLiveLadder(video)) return false;
  // Don't strand paid external delivery.
  if (video.muxSignedPlaybackId) return false;
  if (video.paywall) return false;
  // Image/audio rows aren't video ladders.
  if (video.kind === "image" || video.kind === "audio") return false;
  return videoLastActivityAt(video) < cutoffMs;
}
