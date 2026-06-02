import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import {
  isEvictionCandidate,
  resolveLadderProvider,
} from "./retentionPolicy";

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

    const candidates = scanned.filter((v) =>
      isEvictionCandidate(v, args.cutoffMs),
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
