"use node";

// Node-runtime half of the hot/cold retention sweep. This file is split out
// from `retention.ts` (which holds the V8 `listEvictionCandidates` query)
// because deleting the Mux asset goes through `@mux/mux-node`, which imports
// Node's `crypto`. A file that imports that helper directly MUST run in the
// Node runtime ("use node"); mixing it with a query in one file makes Convex
// try to bundle `crypto` for V8 and the deploy fails. See retention.ts.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { deleteMuxAsset } from "./mux";
import { deleteStreamAsset } from "./cloudflareStream";
import { BUCKET_NAME, getS3Client } from "./s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { isEvictionEnabled, retentionHotDays } from "./retentionPolicy";

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * batch per run, coldest first.
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
        console.error(`retention: eviction failed for ${c.videoId}:`, error);
        skipped++;
      }
    }

    return { evicted, skipped };
  },
});

// One-off remediation for the duplicate-upload storm: free the orphaned R2
// objects (original + any proxies) and Mux assets of videos stuck in
// "uploading", then soft-delete the rows. Dry-run unless `apply` is true. Run:
//   npx convex run retentionActions:purgeStuckDriveUploads '{"apply":true}'
export const purgeStuckDriveUploads = internalAction({
  args: { apply: v.optional(v.boolean()), olderThanMs: v.optional(v.number()) },
  returns: v.object({
    targets: v.number(),
    r2Deleted: v.number(),
    muxDeleted: v.number(),
    rowsPurged: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    targets: number;
    r2Deleted: number;
    muxDeleted: number;
    rowsPurged: number;
  }> => {
    const targets: Array<{
      videoId: Id<"videos">;
      s3Key: string | null;
      muxAssetId: string | null;
      proxyKeys: string[];
    }> = await ctx.runQuery(internal.desktopBrowse.listStuckDriveUploads, {
      olderThanMs: args.olderThanMs,
    });
    let r2Deleted = 0;
    let muxDeleted = 0;
    let rowsPurged = 0;
    if (!args.apply) {
      return { targets: targets.length, r2Deleted, muxDeleted, rowsPurged };
    }
    const s3 = getS3Client();
    for (const t of targets) {
      const keys = [t.s3Key, ...t.proxyKeys].filter(
        (k): k is string => typeof k === "string" && k.length > 0,
      );
      for (const key of keys) {
        try {
          await s3.send(
            new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
          );
          r2Deleted++;
        } catch (error) {
          console.warn(`purge: R2 delete failed for ${key}:`, error);
        }
      }
      if (t.muxAssetId) {
        try {
          await deleteMuxAsset(t.muxAssetId);
          muxDeleted++;
        } catch (error) {
          console.warn(`purge: Mux delete failed for ${t.muxAssetId}:`, error);
        }
      }
      try {
        await ctx.runMutation(internal.desktopBrowse.markDriveUploadPurged, {
          videoId: t.videoId,
        });
        rowsPurged++;
      } catch (error) {
        console.warn(`purge: mark failed for ${t.videoId}:`, error);
      }
    }
    return { targets: targets.length, r2Deleted, muxDeleted, rowsPurged };
  },
});
