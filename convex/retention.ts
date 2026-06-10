import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  isEvictionCandidate,
  resolveLadderProvider,
} from "./retentionPolicy";
import { resolveBundleVideos } from "./shareBundles";

/**
 * Every video currently reachable through an ACTIVE (non-expired) paywalled
 * share link — single-video links AND bundle/folder/project links — so the
 * cold-eviction sweep never strands a paid client deliverable's ladder.
 *
 * `isEvictionCandidate` already guards per-video paywalls (`video.paywall` /
 * `muxSignedPlaybackId`), but the paywall on a BUNDLE share lives on the
 * shareLink, not on each video it covers — so without this a video inside a
 * paid folder/project share looks evictable. An external client can't trigger
 * a re-encode (that needs member access), so they'd hit a dead player.
 *
 * Built once per eviction run. Paywalled shares are a niche slice of all
 * links, so the link scan stays cheap; bundle expansion reuses the same
 * resolver the share page uses.
 */
async function collectPaywalledVideoIds(
  ctx: QueryCtx,
): Promise<Set<string>> {
  const now = Date.now();
  const protectedIds = new Set<string>();
  const links = await ctx.db.query("shareLinks").collect();
  for (const link of links) {
    if (!link.paywall) continue;
    if (link.expiresAt && link.expiresAt < now) continue; // lapsed → unprotect
    if (link.videoId) {
      protectedIds.add(link.videoId);
    }
    if (link.bundleId) {
      const bundle = await ctx.db.get(link.bundleId);
      if (!bundle) continue;
      const videos = await resolveBundleVideos(ctx, bundle);
      for (const vd of videos) protectedIds.add(vd._id);
    }
  }
  return protectedIds;
}

/**
 * Hot/cold retention — the COGS half of the storage pricing model.
 *
 * The customer's storage cap is billed on *source* bytes (`videos.fileSize`),
 * which we keep forever in our own object store. What's expensive on the
 * provider side (Mux / Cloudflare Stream) is the encoded multi-bitrate
 * ladder — roughly 1.5–3× the source — sitting there for footage no one
 * watches after a review cycle ends.
 *
 * Hybrid model:
 *   • Hot set  — viewed within RETENTION_HOT_DAYS (default 30). Full ladder
 *                stays live. Instant play + scrub: the "feels like local"
 *                experience.
 *   • Cold set — no view in the window. We delete the encoded ladder (and any
 *                R2-mirrored proxies) but KEEP the source, then flip the row
 *                back to `encodingDeferred`. The next watch lazily re-encodes
 *                via the existing `requestEncoding` path — one re-encode of
 *                latency, hot again afterward.
 *
 * Nothing here touches the source object, so eviction is always reversible.
 * Paid-delivery assets are skipped (see `isEvictionCandidate`) so external
 * viewers never hit a missing asset they can't trigger a re-encode for.
 *
 * NOTE: the eviction ACTION (`runColdEviction`) lives in `retentionActions.ts`
 * ("use node") because it deletes the Mux asset via `@mux/mux-node` (which
 * needs Node's `crypto`). This file stays in the V8 runtime so the scan query
 * below can read the DB cheaply. Keep Node-only imports out of here.
 */

// Cap reads per cron run. The scan is ordered by lastViewedAt so the
// coldest rows are processed first; anything left over is picked up by
// the next daily run.
const EVICTION_BATCH = 200;

/**
 * One batch of cold-eviction candidates, ordered by lastViewedAt
 * ascending (coldest first). Never-viewed rows sort first; the
 * `isEvictionCandidate` activity check keeps recently-uploaded rows safe.
 */
export const listEvictionCandidates = internalQuery({
  args: { cutoffMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cap = Math.min(args.limit ?? EVICTION_BATCH, 500);
    const scanned = await ctx.db
      .query("videos")
      .withIndex("by_last_viewed", (q) => q.lt("lastViewedAt", args.cutoffMs))
      .take(cap * 3);

    const perVideoCandidates = scanned.filter((v) =>
      isEvictionCandidate(v, args.cutoffMs),
    );

    // Second pass: drop anything reachable through an active paywalled bundle
    // share. Only computed when there's at least one candidate to test.
    const protectedIds =
      perVideoCandidates.length > 0
        ? await collectPaywalledVideoIds(ctx)
        : new Set<string>();
    const candidates = perVideoCandidates.filter(
      (v) => !protectedIds.has(v._id),
    );

    return candidates.slice(0, cap).map((video) => ({
      videoId: video._id,
      provider: resolveLadderProvider(video),
      muxAssetId: video.muxAssetId ?? null,
      streamUid: video.streamUid ?? null,
      proxyR2Keys: (video.staticRenditions ?? [])
        .map((r) => r.r2Key)
        .filter((k): k is string => typeof k === "string"),
    }));
  },
});
