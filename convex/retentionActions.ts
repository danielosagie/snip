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
import { trashCutoffMs } from "./trashPolicy";

const DAY_MS = 24 * 60 * 60 * 1000;

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
  };
  return (
    value.status === 404 ||
    value.statusCode === 404 ||
    value.code === "NoSuchKey" ||
    value.name === "NotFoundError"
  );
}

async function deleteTrashObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const s3 = getS3Client();
  for (const key of keys) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
}

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
 * Best-effort GC for assets replaced by a drive overwrite
 * (desktopBrowse.commitVideoOverwrite): the old original object, encoded
 * Mux/Stream assets, preview asset, mirrored renditions. Every failure is
 * logged and swallowed — the row already points at the new upload, so a
 * leaked object is a COGS leak, not a correctness bug.
 */
export const purgeReplacedAssets = internalAction({
  args: {
    s3Keys: v.array(v.string()),
    muxAssetIds: v.array(v.string()),
    streamUid: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    for (const assetId of args.muxAssetIds) {
      try {
        await deleteMuxAsset(assetId);
      } catch (error) {
        console.warn(
          `overwrite-gc: failed to delete Mux asset ${assetId}:`,
          error,
        );
      }
    }
    if (args.streamUid) {
      try {
        await deleteStreamAsset(args.streamUid);
      } catch (error) {
        console.warn(
          `overwrite-gc: failed to delete Stream asset ${args.streamUid}:`,
          error,
        );
      }
    }
    await deleteProxyObjects(args.s3Keys);
    return null;
  },
});

/**
 * Frees the storage + encoding assets held by soft-deleted rows that are
 * byte-identical duplicates of a live row (what
 * desktopBrowse.cleanupCompletedDriveDuplicates trashes). Refuses to touch
 * any ref a live row still uses. Dry-run unless `apply` is true:
 * `npx convex run retentionActions:purgeDeletedDuplicateAssets '{"apply":true}'`
 */
export const purgeDeletedDuplicateAssets = internalAction({
  args: { apply: v.optional(v.boolean()) },
  returns: v.object({
    rows: v.number(),
    muxAssetsDeleted: v.number(),
    streamAssetsDeleted: v.number(),
    objectsDeleted: v.number(),
    skippedLiveRefs: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    rows: number;
    muxAssetsDeleted: number;
    streamAssetsDeleted: number;
    objectsDeleted: number;
    skippedLiveRefs: number;
  }> => {
    const refs: {
      deleted: Array<{
        videoId: Id<"videos">;
        muxAssetIds: string[];
        streamUid: string | null;
        objectKeys: string[];
      }>;
      liveMuxAssetIds: string[];
      liveStreamUids: string[];
      liveObjectKeys: string[];
    } = await ctx.runQuery(
      internal.desktopBrowse.listDeletedDuplicateRefs,
      {},
    );
    const liveMux = new Set(refs.liveMuxAssetIds);
    const liveStream = new Set(refs.liveStreamUids);
    const liveObjects = new Set(refs.liveObjectKeys);
    let muxAssetsDeleted = 0;
    let streamAssetsDeleted = 0;
    let objectsDeleted = 0;
    let skippedLiveRefs = 0;
    const s3 = getS3Client();
    for (const row of refs.deleted) {
      for (const assetId of row.muxAssetIds) {
        if (liveMux.has(assetId)) {
          skippedLiveRefs++;
          continue;
        }
        if (args.apply) {
          try {
            await deleteMuxAsset(assetId);
          } catch (error) {
            console.warn(`dup-purge: Mux asset ${assetId}:`, error);
            continue;
          }
        }
        muxAssetsDeleted++;
      }
      if (row.streamUid) {
        if (liveStream.has(row.streamUid)) {
          skippedLiveRefs++;
        } else {
          if (args.apply) {
            try {
              await deleteStreamAsset(row.streamUid);
              streamAssetsDeleted++;
            } catch (error) {
              console.warn(`dup-purge: Stream ${row.streamUid}:`, error);
            }
          } else {
            streamAssetsDeleted++;
          }
        }
      }
      for (const key of row.objectKeys) {
        if (liveObjects.has(key)) {
          skippedLiveRefs++;
          continue;
        }
        if (args.apply) {
          try {
            await s3.send(
              new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
            );
          } catch (error) {
            console.warn(`dup-purge: object ${key}:`, error);
            continue;
          }
        }
        objectsDeleted++;
      }
      if (args.apply) {
        await ctx.runMutation(internal.desktopBrowse.clearPurgedAssetRefs, {
          videoId: row.videoId,
        });
      }
    }
    return {
      rows: refs.deleted.length,
      muxAssetsDeleted,
      streamAssetsDeleted,
      objectsDeleted,
      skippedLiveRefs,
    };
  },
});

/**
 * Retained temporarily so already-enqueued jobs resolve safely after the
 * custom eviction policy was retired. `isEvictionEnabled()` is intentionally
 * always false; new code must rely on Mux native inactive-asset pricing.
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

/**
 * Daily hard-purge for items whose 30-day Recently Deleted recovery window
 * has ended. Each target is claimed transactionally before any provider data
 * is removed, then external deletion and database finalization run
 * idempotently. Failures leave the claimed row for the next daily retry.
 */
export const purgeExpiredTrash = internalAction({
  args: {},
  returns: v.object({ purged: v.number(), retried: v.number(), skipped: v.number() }),
  handler: async (ctx): Promise<{ purged: number; retried: number; skipped: number }> => {
    const cutoffMs = trashCutoffMs();
    const targets = await ctx.runQuery(internal.retention.listExpiredTrashTargets, {
      cutoffMs,
      limit: 100,
    });
    let purged = 0;
    let retried = 0;
    let skipped = 0;

    for (const target of targets) {
      const claimed = await ctx.runMutation(
        internal.retention.claimExpiredTrashTarget,
        { ...target, cutoffMs },
      );
      if (!claimed) {
        skipped++;
        continue;
      }
      const assets = await ctx.runQuery(
        internal.retention.getExpiredTrashTargetAssets,
        { ...target, cutoffMs },
      );
      if (!assets.eligible) {
        skipped++;
        continue;
      }
      try {
        for (const assetId of assets.muxAssetIds) {
          try {
            await deleteMuxAsset(assetId);
          } catch (error) {
            if (!isNotFoundError(error)) throw error;
          }
        }
        for (const streamUid of assets.streamUids) {
          await deleteStreamAsset(streamUid);
        }
        await deleteTrashObjects(assets.objectKeys);
        const finalized = await ctx.runMutation(
          internal.retention.finalizeExpiredTrash,
          { ...target, cutoffMs },
        );
        if (finalized) purged++;
        else skipped++;
      } catch (error) {
        console.error("trash purge failed; will retry", {
          ...target,
          error: error instanceof Error ? error.message : String(error),
        });
        retried++;
      }
    }
    return { purged, retried, skipped };
  },
});

/** Remove legacy upload-prewarmed previews that no paywall references. */
export const purgeUnusedPreviewAssets = internalAction({
  args: {},
  returns: v.object({ purged: v.number(), skipped: v.number(), failed: v.number() }),
  handler: async (ctx): Promise<{ purged: number; skipped: number; failed: number }> => {
    const candidates = await ctx.runQuery(
      internal.retention.listUnusedPreviewAssets,
      { limit: 100 },
    );
    let purged = 0;
    let skipped = 0;
    const failed = 0;
    for (const candidate of candidates) {
      const detached = await ctx.runMutation(
        internal.retention.detachUnusedPreviewAsset,
        candidate,
      );
      if (!detached) {
        skipped++;
        continue;
      }
      await ctx.scheduler.runAfter(
        0,
        internal.retentionActions.deleteDetachedMuxAsset,
        { muxAssetId: candidate.muxPreviewAssetId, attempt: 0 },
      );
      purged++;
    }
    return { purged, skipped, failed };
  },
});

/** Provider-only deletion with bounded retries after a DB-safe detach. */
export const deleteDetachedMuxAsset = internalAction({
  args: { muxAssetId: v.string(), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await deleteMuxAsset(args.muxAssetId);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      const attempt = args.attempt ?? 0;
      if (attempt >= 5) {
        console.error("detached Mux asset delete exhausted retries", {
          muxAssetId: args.muxAssetId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
      const retryDelayMs = Math.min(60 * 60 * 1000, 2 ** attempt * 60_000);
      await ctx.scheduler.runAfter(
        retryDelayMs,
        internal.retentionActions.deleteDetachedMuxAsset,
        { muxAssetId: args.muxAssetId, attempt: attempt + 1 },
      );
    }
    return null;
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
