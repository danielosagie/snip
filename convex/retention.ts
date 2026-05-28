import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { deleteMuxAsset } from "./mux";
import { deleteStreamAsset } from "./cloudflareStream";
import { BUCKET_NAME, getS3Client } from "./s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  isEvictionCandidate,
  isEvictionEnabled,
  resolveLadderProvider,
  retentionHotDays,
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
 */

const DAY_MS = 24 * 60 * 60 * 1000;
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

async function deleteProxyObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const s3 = getS3Client();
  await Promise.all(
    keys.map(async (key) => {
      try {
        await s3.send(
          new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
        );
      } catch (error) {
        // Best-effort — a leftover proxy object is a COGS rounding error,
        // not a correctness problem. The row is still marked evicted.
        console.warn(`retention: failed to delete proxy ${key}:`, error);
      }
    }),
  );
}

/**
 * Daily cold-eviction sweep (wired into convex/crons.ts). Reclaims the
 * encoded ladder for videos that have gone cold, leaving the source in
 * place for lazy re-encode. Idempotent and self-throttling: processes one
 * `EVICTION_BATCH` per run, coldest first.
 */
export const runColdEviction = internalAction({
  args: {},
  returns: v.object({ evicted: v.number(), skipped: v.number() }),
  handler: async (ctx): Promise<{ evicted: number; skipped: number }> => {
    if (!isEvictionEnabled()) {
      return { evicted: 0, skipped: 0 };
    }

    const cutoffMs = Date.now() - retentionHotDays() * DAY_MS;
    const candidates = await ctx.runQuery(
      internal.retention.listEvictionCandidates,
      { cutoffMs },
    );

    let evicted = 0;
    let skipped = 0;

    for (const c of candidates) {
      try {
        if (c.provider === "cloudflare_stream") {
          if (c.streamUid) await deleteStreamAsset(c.streamUid);
        } else if (c.muxAssetId) {
          await deleteMuxAsset(c.muxAssetId);
        }
        await deleteProxyObjects(c.proxyR2Keys);
        await ctx.runMutation(internal.videos.markRenditionEvicted, {
          videoId: c.videoId as Id<"videos">,
        });
        evicted++;
      } catch (error) {
        // Leave the row hot; next run retries. Deleting the provider asset
        // is the only irreversible step, so a failure there must not flip
        // the row to evicted (it would point at a half-deleted asset).
        console.error(
          `retention: eviction failed for ${c.videoId}:`,
          error,
        );
        skipped++;
      }
    }

    return { evicted, skipped };
  },
});
