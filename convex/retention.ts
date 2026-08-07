import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  isEvictionCandidate,
  resolveLadderProvider,
} from "./retentionPolicy";
import { resolveBundleVideos } from "./shareBundles";
import { isTrashExpired } from "./trashPolicy";

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
  ctx: QueryCtx | MutationCtx,
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
 * Legacy hot/cold retention plus active trash/preview reclamation queries.
 *
 * The customer's storage cap is billed on *source* bytes (`videos.fileSize`),
 * which we keep forever in our own object store. What's expensive on the
 * provider side (Mux / Cloudflare Stream) is the encoded multi-bitrate
 * ladder — roughly 1.5–3× the source — sitting there for footage no one
 * watches after a review cycle ends.
 *
 * The ladder-eviction model below is retained only so already-enqueued jobs
 * and old rows remain readable. `isEvictionEnabled()` is permanently false
 * and no cron invokes it; Mux native inactive-asset pricing keeps playback
 * instant without delete/re-encode churn.
 *
 * Historical model:
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

/**
 * Legacy upload-time preview assets that no active paywall needs anymore.
 * This reclaims the existing duplicate Mux footprint after preview generation
 * moved from upload completion to explicit paywall enablement.
 */
export const listUnusedPreviewAssets = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 250);
    const rows = await ctx.db
      .query("videos")
      .withIndex("by_mux_preview_asset_id", (q) =>
        q.gte("muxPreviewAssetId", ""),
      )
      .take(limit * 3);
    const protectedIds = await collectPaywalledVideoIds(ctx);
    return rows
      .filter(
        (video) =>
          Boolean(video.muxPreviewAssetId) &&
          !video.paywall &&
          !protectedIds.has(String(video._id)),
      )
      .slice(0, limit)
      .map((video) => ({
        videoId: video._id,
        muxPreviewAssetId: video.muxPreviewAssetId as string,
      }));
  },
});

/**
 * Transactionally detach an unused preview before deleting it at Mux. If a
 * paywall is enabled after this mutation, its scheduler sees no preview and
 * creates a new one; if one was enabled before it, this recheck refuses.
 */
export const detachUnusedPreviewAsset = internalMutation({
  args: { videoId: v.id("videos"), muxPreviewAssetId: v.string() },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (
      !video ||
      video.muxPreviewAssetId !== args.muxPreviewAssetId ||
      video.paywall
    ) return false;
    const protectedIds = await collectPaywalledVideoIds(ctx);
    if (protectedIds.has(String(video._id))) return false;
    await ctx.db.patch(video._id, {
      muxPreviewAssetId: undefined,
      muxPreviewPlaybackId: undefined,
      muxPreviewAssetStatus: undefined,
      muxPreviewAssetError: undefined,
      muxPreviewAssetUpdatedAt: undefined,
      // watermarkOverlayKey is shared generic artwork; keep the object key.
    });
    return true;
  },
});

const trashKind = v.union(
  v.literal("video"),
  v.literal("contract"),
  v.literal("legacy_contract"),
  v.literal("project"),
);

/**
 * Bounded daily work list for Recently Deleted. Videos are ordered before
 * projects so a large deleted project drains its media in small batches;
 * project finalization waits until every child media/document row is gone.
 */
export const listExpiredTrashTargets = internalQuery({
  args: { cutoffMs: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 250);
    const targets: Array<{ kind: "video" | "contract" | "legacy_contract" | "project"; id: string }> = [];
    const seen = new Set<string>();
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_deleted_at", (q) =>
        q.gte("deletedAt", 0).lte("deletedAt", args.cutoffMs),
      )
      .take(limit);

    const append = (kind: "video" | "contract" | "legacy_contract" | "project", id: string) => {
      const key = `${kind}:${id}`;
      if (seen.has(key) || targets.length >= limit) return;
      seen.add(key);
      targets.push({ kind, id });
    };

    // Individually trashed rows first.
    const videos = await ctx.db
      .query("videos")
      .withIndex("by_deleted_at", (q) =>
        q.gte("deletedAt", 0).lte("deletedAt", args.cutoffMs),
      )
      .take(limit);
    for (const video of videos) append("video", String(video._id));

    // A deleted project owns live-looking child rows; drain them through the
    // same per-item cleanup without scanning the global videos table.
    for (const project of projects) {
      if (targets.length >= limit) return targets;
      const children = await ctx.db
        .query("videos")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .take(limit - targets.length);
      for (const video of children) append("video", String(video._id));
    }

    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_deleted_at", (q) =>
        q.gte("deletedAt", 0).lte("deletedAt", args.cutoffMs),
      )
      .take(limit - targets.length);
    for (const contract of contracts) append("contract", String(contract._id));
    for (const project of projects) {
      if (targets.length >= limit) return targets;
      const children = await ctx.db
        .query("contracts")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .take(limit - targets.length);
      for (const contract of children) append("contract", String(contract._id));
    }

    const legacyContracts = await ctx.db
      .query("trashedContracts")
      .withIndex("by_deleted_at", (q) =>
        q.gte("deletedAt", 0).lte("deletedAt", args.cutoffMs),
      )
      .take(limit - targets.length);
    for (const contract of legacyContracts) append("legacy_contract", String(contract._id));
    for (const project of projects) {
      if (targets.length >= limit) return targets;
      const children = await ctx.db
        .query("trashedContracts")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .take(limit - targets.length);
      for (const contract of children) append("legacy_contract", String(contract._id));
    }

    for (const project of projects) append("project", String(project._id));
    return targets;
  },
});

function objectKeysFromContract(contract: {
  docxS3Key?: string;
  signablePdfS3Key?: string;
  signedPdfS3Key?: string;
  signedPackageS3Key?: string;
}): string[] {
  return [
    contract.docxS3Key,
    contract.signablePdfS3Key,
    contract.signedPdfS3Key,
    contract.signedPackageS3Key,
  ].filter((key): key is string => typeof key === "string" && key.length > 0);
}

/** Resolve and revalidate one target immediately before external deletion. */
export const getExpiredTrashTargetAssets = internalQuery({
  args: { kind: trashKind, id: v.string(), cutoffMs: v.number() },
  handler: async (ctx, args) => {
    const empty = { eligible: false, objectKeys: [] as string[], muxAssetIds: [] as string[], streamUids: [] as string[] };
    if (args.kind === "video") {
      const id = ctx.db.normalizeId("videos", args.id);
      const video = id ? await ctx.db.get(id) : null;
      if (!video) return empty;
      const project = await ctx.db.get(video.projectId);
      if (
        !isTrashExpired(video.deletedAt, args.cutoffMs) &&
        !isTrashExpired(project?.deletedAt, args.cutoffMs)
      ) return empty;

      const objectKeys = [
        video.imagePreviewS3Key,
        ...(video.sequenceFrameKeys ?? []),
        ...(video.staticRenditions ?? []).map((rendition) => rendition.r2Key),
      ].filter((key): key is string => typeof key === "string" && key.length > 0);
      // Source keys can be shared by a duplicated/version row. Only delete the
      // object when this is the final database reference.
      if (video.s3Key) {
        const refs = await ctx.db
          .query("videos")
          .withIndex("by_s3_key", (q) => q.eq("s3Key", video.s3Key))
          .collect();
        if (refs.every((ref) => ref._id === video._id)) objectKeys.push(video.s3Key);
      }
      return {
        eligible: true,
        objectKeys: [...new Set(objectKeys)],
        muxAssetIds: [...new Set([video.muxAssetId, video.muxPreviewAssetId].filter((id): id is string => Boolean(id)))],
        streamUids: video.streamUid ? [video.streamUid] : [],
      };
    }

    if (args.kind === "contract") {
      const id = ctx.db.normalizeId("contracts", args.id);
      const contract = id ? await ctx.db.get(id) : null;
      if (!contract) return empty;
      const project = await ctx.db.get(contract.projectId);
      if (
        !isTrashExpired(contract.deletedAt, args.cutoffMs) &&
        !isTrashExpired(project?.deletedAt, args.cutoffMs)
      ) return empty;
      return { ...empty, eligible: true, objectKeys: objectKeysFromContract(contract) };
    }

    if (args.kind === "legacy_contract") {
      const id = ctx.db.normalizeId("trashedContracts", args.id);
      const row = id ? await ctx.db.get(id) : null;
      if (!row) return empty;
      const project = await ctx.db.get(row.projectId);
      if (
        !isTrashExpired(row.deletedAt, args.cutoffMs) &&
        !isTrashExpired(project?.deletedAt, args.cutoffMs)
      ) return empty;
      const contract = row.contract as Parameters<typeof objectKeysFromContract>[0];
      return { ...empty, eligible: true, objectKeys: objectKeysFromContract(contract) };
    }

    const id = ctx.db.normalizeId("projects", args.id);
    const project = id ? await ctx.db.get(id) : null;
    if (!project || !isTrashExpired(project.deletedAt, args.cutoffMs)) return empty;
    const [videos, contracts, legacyContracts] = await Promise.all([
      ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", project._id)).take(1),
      ctx.db.query("contracts").withIndex("by_project", (q) => q.eq("projectId", project._id)).take(1),
      ctx.db.query("trashedContracts").withIndex("by_project", (q) => q.eq("projectId", project._id)).take(1),
    ]);
    // Child targets drain first. Never delete the project while they still
    // exist, even if a prior run partially removed external resources.
    if (videos.length || contracts.length || legacyContracts.length) return empty;
    const objectKeys = project.contract?.docxS3Key ? [project.contract.docxS3Key] : [];
    const bundles = await ctx.db.query("shareBundles").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
    for (const bundle of bundles) if (bundle.coverImageS3Key) objectKeys.push(bundle.coverImageS3Key);
    return { ...empty, eligible: true, objectKeys: [...new Set(objectKeys)] };
  },
});

/** Atomically closes the restore window before any external asset is removed. */
export const claimExpiredTrashTarget = internalMutation({
  args: { kind: trashKind, id: v.string(), cutoffMs: v.number() },
  handler: async (ctx, args) => {
    const table =
      args.kind === "video"
        ? "videos"
        : args.kind === "contract"
          ? "contracts"
          : args.kind === "legacy_contract"
            ? "trashedContracts"
            : "projects";
    const id = ctx.db.normalizeId(table, args.id);
    if (!id) return false;
    const row = await ctx.db.get(id);
    if (!row) return false;
    const deletedAt = "deletedAt" in row ? row.deletedAt : undefined;
    let eligible = isTrashExpired(deletedAt, args.cutoffMs);
    if (!eligible && "projectId" in row && row.projectId) {
      const project = await ctx.db.get(row.projectId as Id<"projects">);
      eligible = isTrashExpired(project?.deletedAt, args.cutoffMs);
    }
    if (!eligible) return false;
    if (!("trashPurgeStartedAt" in row) || !row.trashPurgeStartedAt) {
      await ctx.db.patch(id, { trashPurgeStartedAt: Date.now() });
    }
    return true;
  },
});

async function deleteLinkDependents(ctx: MutationCtx, linkId: Id<"shareLinks">) {
  const [grants, invites] = await Promise.all([
    ctx.db.query("shareAccessGrants").withIndex("by_share_link", (q) => q.eq("shareLinkId", linkId)).collect(),
    ctx.db.query("shareInvites").withIndex("by_share_link", (q) => q.eq("shareLinkId", linkId)).collect(),
  ]);
  for (const row of [...grants, ...invites]) await ctx.db.delete(row._id);
}

/** Database half of the purge. Revalidates age so a restored item wins races. */
export const finalizeExpiredTrash = internalMutation({
  args: { kind: trashKind, id: v.string(), cutoffMs: v.number() },
  handler: async (ctx, args) => {
    if (args.kind === "video") {
      const id = ctx.db.normalizeId("videos", args.id);
      const video = id ? await ctx.db.get(id) : null;
      if (!video) return false;
      const project = await ctx.db.get(video.projectId);
      if (!isTrashExpired(video.deletedAt, args.cutoffMs) && !isTrashExpired(project?.deletedAt, args.cutoffMs)) return false;
      const [comments, links] = await Promise.all([
        ctx.db.query("comments").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect(),
        ctx.db.query("shareLinks").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect(),
      ]);
      for (const row of comments) await ctx.db.delete(row._id);
      for (const link of links) { await deleteLinkDependents(ctx, link._id); await ctx.db.delete(link._id); }
      await ctx.db.delete(video._id);
      return true;
    }
    if (args.kind === "contract") {
      const id = ctx.db.normalizeId("contracts", args.id);
      const contract = id ? await ctx.db.get(id) : null;
      if (!contract) return false;
      const project = await ctx.db.get(contract.projectId);
      if (!isTrashExpired(contract.deletedAt, args.cutoffMs) && !isTrashExpired(project?.deletedAt, args.cutoffMs)) return false;
      const [recipients, fields, audit, versions] = await Promise.all([
        ctx.db.query("contractRecipients").withIndex("by_contract", (q) => q.eq("contractId", contract._id)).collect(),
        ctx.db.query("contractFields").withIndex("by_contract", (q) => q.eq("contractId", contract._id)).collect(),
        ctx.db.query("contractAuditEvents").withIndex("by_contract", (q) => q.eq("contractId", contract._id)).collect(),
        ctx.db.query("itemVersions").withIndex("by_lineage", (q) => q.eq("lineageKey", String(contract._id))).collect(),
      ]);
      for (const row of [...recipients, ...fields, ...audit, ...versions]) await ctx.db.delete(row._id);
      await ctx.db.delete(contract._id);
      return true;
    }
    if (args.kind === "legacy_contract") {
      const id = ctx.db.normalizeId("trashedContracts", args.id);
      const row = id ? await ctx.db.get(id) : null;
      if (!row) return false;
      const project = await ctx.db.get(row.projectId);
      if (!isTrashExpired(row.deletedAt, args.cutoffMs) && !isTrashExpired(project?.deletedAt, args.cutoffMs)) return false;
      await ctx.db.delete(row._id);
      return true;
    }
    const id = ctx.db.normalizeId("projects", args.id);
    const project = id ? await ctx.db.get(id) : null;
    if (!project || !isTrashExpired(project.deletedAt, args.cutoffMs)) return false;
    const [videos, contracts, legacyContracts] = await Promise.all([
      ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", project._id)).take(1),
      ctx.db.query("contracts").withIndex("by_project", (q) => q.eq("projectId", project._id)).take(1),
      ctx.db.query("trashedContracts").withIndex("by_project", (q) => q.eq("projectId", project._id)).take(1),
    ]);
    if (videos.length || contracts.length || legacyContracts.length) return false;
    const bundles = await ctx.db.query("shareBundles").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
    for (const bundle of bundles) {
      const links = await ctx.db.query("shareLinks").withIndex("by_bundle", (q) => q.eq("bundleId", bundle._id)).collect();
      for (const link of links) { await deleteLinkDependents(ctx, link._id); await ctx.db.delete(link._id); }
      await ctx.db.delete(bundle._id);
    }
    const folders = await ctx.db.query("folders").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect();
    for (const folder of folders) await ctx.db.delete(folder._id);
    await ctx.db.delete(project._id);
    return true;
  },
});
