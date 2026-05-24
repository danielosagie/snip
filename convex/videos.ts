import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { getUser, identityName, requireProjectAccess, requireVideoAccess } from "./auth";
import { Doc, Id } from "./_generated/dataModel";
import { generateUniqueToken } from "./security";
import { resolveActiveShareGrant } from "./shareAccess";
import { resolveBundleVideos, resolveBundleFolders } from "./shareBundles";
import { assertTeamCanStoreBytes } from "./billingHelpers";
import { recordItemVersion } from "./itemVersions";
import { indexSearchable, removeSearchableForVideo } from "./search";
import { api, internal } from "./_generated/api";
import { prefEnabled, resolveUserEmail } from "./notifications";

const workflowStatusValidator = v.union(
  v.literal("review"),
  v.literal("rework"),
  v.literal("done"),
);

const visibilityValidator = v.union(v.literal("public"), v.literal("private"));

type WorkflowStatus =
  | "review"
  | "rework"
  | "done";

function normalizeWorkflowStatus(status: WorkflowStatus | undefined): WorkflowStatus {
  return status ?? "review";
}

async function generatePublicId(ctx: MutationCtx) {
  return await generateUniqueToken(
    32,
    async (candidate) =>
      (await ctx.db
        .query("videos")
        .withIndex("by_public_id", (q) => q.eq("publicId", candidate))
        .unique()) !== null,
    5,
  );
}

async function deleteShareAccessGrantsForLink(
  ctx: MutationCtx,
  linkId: Id<"shareLinks">,
) {
  const grants = await ctx.db
    .query("shareAccessGrants")
    .withIndex("by_share_link", (q) => q.eq("shareLinkId", linkId))
    .collect();

  for (const grant of grants) {
    await ctx.db.delete(grant._id);
  }
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    contentType: v.optional(v.string()),
    // Optional destination folder. When set, the uploaded file appears
    // directly inside that folder instead of the project root.
    folderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectAccess(ctx, args.projectId, "member");
    await assertTeamCanStoreBytes(ctx, project.teamId, args.fileSize ?? 0);
    const publicId = await generatePublicId(ctx);

    // Defensive: a stale folderId from another project would otherwise
    // silently land a file in the wrong tree. Reject it loudly here.
    if (args.folderId) {
      const folder = await ctx.db.get(args.folderId);
      if (!folder || folder.projectId !== args.projectId) {
        throw new Error("Target folder doesn't belong to this project.");
      }
    }

    const videoId = await ctx.db.insert("videos", {
      projectId: args.projectId,
      uploadedByClerkId: user.subject,
      uploaderName: identityName(user),
      title: args.title,
      description: args.description,
      fileSize: args.fileSize,
      contentType: args.contentType,
      status: "uploading",
      muxAssetStatus: "preparing",
      workflowStatus: "review",
      visibility: "public",
      publicId,
      folderId: args.folderId,
    });

    try {
      await indexSearchable(ctx, {
        kind: "video",
        refId: videoId,
        teamId: project.teamId,
        projectId: args.projectId,
        videoId,
        title: args.title,
        contextLabel: `${project.name} · ${args.contentType ?? "file"}`,
        text: `${args.title} ${args.description ?? ""}`,
      });
    } catch (e) {
      console.error("search index (video create) failed", e);
    }

    return videoId;
  },
});

/**
 * Coalesce a batch of just-uploaded image-sequence frames into a single
 * `image_sequence` video. The upload manager auto-detects N≥3 files
 * matching `name.####.ext` in the same drop and calls this after every
 * frame has reached status:"ready". The first frame (by index) becomes
 * the sequence head; the others are soft-deleted so they don't clutter
 * the project grid but remain recoverable from trash.
 *
 * Preview is the client-side frame-grid scrubber in
 * `ImageSequenceFrameGrid` — no server-side video stitching. (ffmpeg
 * doesn't run cleanly in a Convex action; the frame grid is the
 * dependency-free preview that actually works.)
 */
export const coalesceIntoSequence = mutation({
  args: {
    frameVideoIds: v.array(v.id("videos")),
    stem: v.string(),
    ext: v.string(),
    fps: v.optional(v.number()),
  },
  returns: v.object({
    sequenceVideoId: v.id("videos"),
  }),
  handler: async (ctx, args) => {
    if (args.frameVideoIds.length < 3) {
      throw new Error("Sequence requires at least 3 frames.");
    }
    const frames = await Promise.all(
      args.frameVideoIds.map((id) => ctx.db.get(id)),
    );
    const validFrames = frames.filter(
      (f): f is NonNullable<typeof f> => f !== null && f.deletedAt === undefined,
    );
    if (validFrames.length !== args.frameVideoIds.length) {
      throw new Error("Some frames no longer exist.");
    }
    const projectId = validFrames[0].projectId;
    for (const f of validFrames) {
      if (f.projectId !== projectId) {
        throw new Error("All frames must belong to the same project.");
      }
      if (!f.s3Key) {
        throw new Error("Frame is missing its R2 key — upload may not be complete.");
      }
    }
    // Membership check on the shared project.
    await requireProjectAccess(ctx, projectId, "member");

    // Sort frames by their parsed sequence index (read from the title
    // since the upload manager preserves the original filename minus
    // extension as the title).
    const orderedFrames = [...validFrames].sort((a, b) => {
      const ai = extractSequenceIndex(a.title) ?? 0;
      const bi = extractSequenceIndex(b.title) ?? 0;
      return ai - bi;
    });

    const head = orderedFrames[0];
    const frameKeys = orderedFrames.map((f) => f.s3Key!).filter(Boolean);

    await ctx.db.patch(head._id, {
      title: args.stem,
      kind: "image_sequence",
      sequenceFrameKeys: frameKeys,
      sequenceFps: args.fps ?? 24,
      sequenceStem: args.stem,
      sequenceFrameExt: args.ext,
      status: "ready",
      muxAssetStatus: undefined,
    });

    // Soft-delete the per-frame rows so the project grid shows the
    // sequence as a single asset. The R2 objects remain because the
    // sequence head's sequenceFrameKeys references them.
    const now = Date.now();
    for (let i = 1; i < orderedFrames.length; i++) {
      await ctx.db.patch(orderedFrames[i]._id, {
        deletedAt: now,
        deletedByName: "Sequence coalesce",
      });
    }

    return { sequenceVideoId: head._id };
  },
});

/**
 * Parse the integer frame index from a filename stem. Matches
 * `name.0010` or `name_0010`, returning 10. Returns null if no match.
 */
function extractSequenceIndex(stem: string): number | null {
  const m = stem.match(/[._](\d{3,6})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Duplicate a finished video into the same folder. The copy shares the
 * original's underlying media — Mux playback IDs + S3 keys are reused, NOT
 * re-ingested — so it's instant and playable immediately. `remove`/`purge`
 * never delete Mux assets or S3 objects, so a shared reference is safe:
 * deleting either row can't break the other's playback.
 *
 * Critically we DON'T copy the asset/upload-level Mux IDs (muxAssetId,
 * muxPreviewAssetId, muxUploadId). Mux webhook handlers resolve a video by
 * those via `.unique()` (getVideoByMuxAssetId / preview / upload); two rows
 * sharing one of those IDs would make that throw. Playback IDs are only
 * read for delivery, never `.unique()`-looked-up, so they're safe to share.
 *
 * Restricted to status === "ready": a still-ingesting asset still has
 * webhooks in flight that key off the asset ID.
 */
export const duplicate = mutation({
  args: { videoId: v.id("videos") },
  returns: v.id("videos"),
  handler: async (ctx, args): Promise<Id<"videos">> => {
    const { user, video, project } = await requireVideoAccess(
      ctx,
      args.videoId,
      "member",
    );
    if (video.deletedAt) {
      throw new Error("Can't duplicate a trashed video.");
    }
    if (video.status !== "ready") {
      throw new Error("Can only duplicate a finished upload.");
    }
    // A duplicate is a new row; it counts toward storage the same way every
    // other row does (getTeamStorageUsedBytes sums fileSize per row).
    await assertTeamCanStoreBytes(ctx, project.teamId, video.fileSize ?? 0);

    const publicId = await generatePublicId(ctx);

    return await ctx.db.insert("videos", {
      projectId: video.projectId,
      folderId: video.folderId,
      uploadedByClerkId: user.subject,
      uploaderName: identityName(user),
      title: `${video.title} (copy)`,
      description: video.description,
      visibility: video.visibility,
      publicId,
      // Playback-only Mux refs — safe to share (delivery reads, never
      // `.unique()` webhook lookups).
      muxPlaybackId: video.muxPlaybackId,
      muxSignedPlaybackId: video.muxSignedPlaybackId,
      muxAssetStatus: video.muxAssetStatus,
      muxPreviewPlaybackId: video.muxPreviewPlaybackId,
      muxPreviewAssetStatus: video.muxPreviewAssetStatus,
      watermarkOverlayKey: video.watermarkOverlayKey,
      imagePreviewS3Key: video.imagePreviewS3Key,
      imagePreviewStatus: video.imagePreviewStatus,
      paywall: video.paywall,
      s3Key: video.s3Key,
      duration: video.duration,
      thumbnailUrl: video.thumbnailUrl,
      fileSize: video.fileSize,
      contentType: video.contentType,
      status: video.status,
      workflowStatus: video.workflowStatus,
      // Deliberately omitted: muxAssetId / muxPreviewAssetId / muxUploadId
      // (webhook `.unique()` collision), lineage fields (the copy is its
      // own standalone item, not a version in the original's stack),
      // deletedAt, uploadError.
    });
  },
});

export const list = query({
  args: {
    projectId: v.id("projects"),
    // Optional folder filter. `null` (or omitted) = items at the project
    // root (no folderId set). Passing a specific id filters to that folder.
    folderId: v.optional(v.union(v.id("folders"), v.null())),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);

    const allInProject = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
    // Drop soft-deleted videos — they live in Recently deleted now,
    // not in the project / folder grid.
    const liveInProject = allInProject.filter((v) => !v.deletedAt);
    // Apply folder filter in-memory. The dual-key Convex index would
    // require an explicit by_project_and_folder index; for now the in-mem
    // filter is fine since per-project video count stays modest. If lists
    // grow large we'll add the index.
    const all =
      args.folderId === undefined
        ? liveInProject
        : liveInProject.filter((v) =>
            args.folderId === null
              ? !v.folderId
              : v.folderId === args.folderId,
          );

    // Frame.io-style stack collapse: only show the row marked as the
    // current version per lineage. Pre-lineage rows (no lineageId) are
    // their own single-version lineage so they pass through. Build a
    // per-lineage map and emit only the row that's current (or the
    // newest row if nothing's been explicitly marked yet — defensive).
    const byLineage = new Map<string, typeof all>();
    for (const v of all) {
      const key = (v.lineageId ?? v._id) as string;
      const arr = byLineage.get(key) ?? [];
      arr.push(v);
      byLineage.set(key, arr);
    }
    const visible: typeof all = [];
    for (const [, group] of byLineage) {
      const current = group.find((v) => v.isCurrentVersion === true);
      visible.push(current ?? group[0]);
    }
    // Preserve the descending creation-time order.
    visible.sort((a, b) => b._creationTime - a._creationTime);

    return await Promise.all(
      visible.map(async (video) => {
        const comments = await ctx.db
          .query("comments")
          .withIndex("by_video", (q) => q.eq("videoId", video._id))
          .collect();

        // Per-lineage version count so the grid card can show "v3 of 3".
        const lineageKey = (video.lineageId ?? video._id) as string;
        const versionCount = (byLineage.get(lineageKey) ?? []).length;

        return {
          ...video,
          uploaderName: video.uploaderName ?? "Unknown",
          workflowStatus: normalizeWorkflowStatus(video.workflowStatus),
          commentCount: comments.length,
          versionCount,
        };
      }),
    );
  },
});

export const get = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const { video, membership } = await requireVideoAccess(ctx, args.videoId);
    return {
      ...video,
      uploaderName: video.uploaderName ?? "Unknown",
      workflowStatus: normalizeWorkflowStatus(video.workflowStatus),
      role: membership.role,
    };
  },
});

export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const video = await ctx.db
      .query("videos")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.publicId))
      .unique();

    if (
      !video ||
      video.deletedAt ||
      video.visibility !== "public" ||
      video.status !== "ready"
    ) {
      return null;
    }

    return {
      video: {
        _id: video._id,
        title: video.title,
        description: video.description,
        duration: video.duration,
        thumbnailUrl: video.thumbnailUrl,
        muxAssetId: video.muxAssetId,
        muxPlaybackId: video.muxPlaybackId,
        contentType: video.contentType,
        s3Key: video.s3Key,
      },
    };
  },
});

export const getByPublicIdForDownload = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const video = await ctx.db
      .query("videos")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.publicId))
      .unique();

    if (!video || video.deletedAt || video.visibility !== "public") {
      return null;
    }

    return {
      video: {
        _id: video._id,
        title: video.title,
        contentType: video.contentType,
        s3Key: video.s3Key,
        status: video.status,
      },
    };
  },
});

export const getPublicIdByVideoId = query({
  args: { videoId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const normalizedVideoId = ctx.db.normalizeId("videos", args.videoId);
    if (!normalizedVideoId) {
      return null;
    }

    const video = await ctx.db.get(normalizedVideoId);
    if (
      !video ||
      video.deletedAt ||
      video.visibility !== "public" ||
      video.status !== "ready" ||
      !video.publicId
    ) {
      return null;
    }

    return video.publicId;
  },
});

/**
 * Resolve the playable video for a share grant. For single-video links the
 * link's videoId is used directly. For bundle links the caller must pass
 * `itemVideoId` and we verify it's a member of the bundle — protects against
 * a paid grant being used to unlock videos in a *different* share.
 */
async function resolveShareTargetVideo(
  ctx: QueryCtx,
  shareLink: Doc<"shareLinks">,
  itemVideoId: Id<"videos"> | undefined,
): Promise<Doc<"videos"> | null> {
  if (shareLink.videoId) {
    return await ctx.db.get(shareLink.videoId);
  }
  if (!shareLink.bundleId) return null;
  if (!itemVideoId) return null;
  const bundle = await ctx.db.get(shareLink.bundleId);
  if (!bundle) return null;
  const bundleVideos = await resolveBundleVideos(ctx, bundle);
  const target = bundleVideos.find((v) => v._id === itemVideoId);
  return target ?? null;
}

export const getByShareGrant = query({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
  },
  handler: async (ctx, args) => {
    const resolved = await resolveActiveShareGrant(ctx, args.grantToken);
    if (!resolved) {
      return null;
    }

    const video = await resolveShareTargetVideo(
      ctx,
      resolved.shareLink,
      args.itemVideoId,
    );
    if (!video || video.deletedAt || video.status !== "ready") {
      return null;
    }

    return {
      video: {
        _id: video._id,
        title: video.title,
        description: video.description,
        duration: video.duration,
        thumbnailUrl: video.thumbnailUrl,
        muxAssetId: video.muxAssetId,
        muxPlaybackId: video.muxPlaybackId,
        contentType: video.contentType,
        s3Key: video.s3Key,
      },
      grantExpiresAt: resolved.grant.expiresAt,
    };
  },
});

export const getByShareGrantForDownload = query({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
  },
  handler: async (ctx, args) => {
    const resolved = await resolveActiveShareGrant(ctx, args.grantToken);
    if (!resolved) {
      return null;
    }

    const video = await resolveShareTargetVideo(
      ctx,
      resolved.shareLink,
      args.itemVideoId,
    );
    if (!video || video.deletedAt) {
      return null;
    }

    return {
      allowDownload: resolved.shareLink.allowDownload,
      grantExpiresAt: resolved.grant.expiresAt,
      grantPaidAt: resolved.grant.paidAt ?? null,
      paywall: resolved.shareLink.paywall ?? null,
      video: {
        _id: video._id,
        title: video.title,
        contentType: video.contentType,
        s3Key: video.s3Key,
        status: video.status,
        // Proxy (static-rendition) download support. Signed id is preferred for
        // gated downloads; public id is the fallback for non-paywalled shares.
        muxPlaybackId: video.muxPlaybackId,
        muxSignedPlaybackId: video.muxSignedPlaybackId,
        staticRenditions: video.staticRenditions ?? [],
      },
    };
  },
});

export const update = mutation({
  args: {
    videoId: v.id("videos"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { video, project } = await requireVideoAccess(
      ctx,
      args.videoId,
      "member",
    );

    const updates: Partial<{ title: string; description: string }> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;

    await ctx.db.patch(args.videoId, updates);

    try {
      const title = updates.title ?? video.title;
      const description = updates.description ?? video.description ?? "";
      await indexSearchable(ctx, {
        kind: "video",
        refId: args.videoId,
        teamId: project.teamId,
        projectId: video.projectId,
        videoId: args.videoId,
        title,
        contextLabel: `${project.name} · ${video.contentType ?? "file"}`,
        text: `${title} ${description}`,
      });
    } catch (e) {
      console.error("search index (video update) failed", e);
    }
  },
});

/**
 * Bulk rename — set a new title on each of several videos in one call. The
 * client computes the new titles (Add Text / Replace / Format) and previews
 * them; we just persist + reindex. Per-item access check (member role).
 */
export const bulkSetTitles = mutation({
  args: {
    items: v.array(
      v.object({ videoId: v.id("videos"), title: v.string() }),
    ),
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args): Promise<{ updated: number }> => {
    let updated = 0;
    for (const item of args.items) {
      const title = item.title.trim();
      if (!title) continue;
      const { video, project } = await requireVideoAccess(
        ctx,
        item.videoId,
        "member",
      );
      await ctx.db.patch(item.videoId, { title });
      try {
        await indexSearchable(ctx, {
          kind: "video",
          refId: item.videoId,
          teamId: project.teamId,
          projectId: video.projectId,
          videoId: item.videoId,
          title,
          contextLabel: `${project.name} · ${video.contentType ?? "file"}`,
          text: `${title} ${video.description ?? ""}`,
        });
      } catch (e) {
        console.error("search index (bulk rename) failed", e);
      }
      updated += 1;
    }
    return { updated };
  },
});

/**
 * Bulk metadata edit across a selection. Only the provided fields change:
 *  • workflowStatus — set the review status
 *  • description    — set the description (non-empty)
 *  • tags           — replace, or merge (appendTags) with existing unique tags
 * Per-item access check (member role); search index is refreshed.
 */
export const bulkEditMetadata = mutation({
  args: {
    videoIds: v.array(v.id("videos")),
    workflowStatus: v.optional(
      v.union(v.literal("review"), v.literal("rework"), v.literal("done")),
    ),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    appendTags: v.optional(v.boolean()),
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args): Promise<{ updated: number }> => {
    const cleanTags = args.tags
      ? Array.from(
          new Set(
            args.tags.map((t) => t.trim()).filter((t) => t.length > 0),
          ),
        )
      : undefined;

    let updated = 0;
    for (const videoId of args.videoIds) {
      const { video, project } = await requireVideoAccess(
        ctx,
        videoId,
        "member",
      );

      const patch: Partial<Doc<"videos">> = {};
      if (args.workflowStatus !== undefined) {
        patch.workflowStatus = args.workflowStatus;
      }
      if (args.description !== undefined && args.description.trim().length > 0) {
        patch.description = args.description.trim();
      }
      if (cleanTags !== undefined) {
        if (args.appendTags) {
          patch.tags = Array.from(
            new Set([...(video.tags ?? []), ...cleanTags]),
          );
        } else {
          patch.tags = cleanTags;
        }
      }

      if (Object.keys(patch).length === 0) continue;
      await ctx.db.patch(videoId, patch);

      try {
        const title = video.title;
        const description = patch.description ?? video.description ?? "";
        const tags = (patch.tags ?? video.tags ?? []).join(" ");
        await indexSearchable(ctx, {
          kind: "video",
          refId: videoId,
          teamId: project.teamId,
          projectId: video.projectId,
          videoId,
          title,
          contextLabel: `${project.name} · ${video.contentType ?? "file"}`,
          text: `${title} ${description} ${tags}`.trim(),
        });
      } catch (e) {
        console.error("search index (bulk metadata) failed", e);
      }
      updated += 1;
    }
    return { updated };
  },
});

/**
 * Backfill helper — older video rows pre-date the lineage fields. When we
 * first touch a row's lineage, we patch it so it's self-rooted as v1 +
 * current. Idempotent and cheap.
 */
async function ensureLineageRoot(
  ctx: { db: MutationCtx["db"] },
  video: Doc<"videos">,
): Promise<Doc<"videos">> {
  if (video.lineageId !== undefined && video.versionNumber !== undefined) {
    return video;
  }
  await ctx.db.patch(video._id, {
    lineageId: video.lineageId ?? video._id,
    versionNumber: video.versionNumber ?? 1,
    isCurrentVersion: video.isCurrentVersion ?? true,
  });
  const refreshed = await ctx.db.get(video._id);
  return refreshed as Doc<"videos">;
}

/**
 * Frame.io-style "upload a new version of this video." Creates a fresh
 * video row in the same lineage as `parentVideoId`, marks it as the
 * current version (and demotes the others). Returns the new videoId so
 * the client can kick off the regular upload pipeline against it.
 */
export const createNextVersion = mutation({
  args: {
    parentVideoId: v.id("videos"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    contentType: v.optional(v.string()),
    versionLabel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"videos">> => {
    const { user, video: rawParent, project } = await requireVideoAccess(
      ctx,
      args.parentVideoId,
      "member",
    );
    await assertTeamCanStoreBytes(ctx, project.teamId, args.fileSize ?? 0);
    const parent = await ensureLineageRoot(ctx, rawParent);
    const lineageId = parent.lineageId ?? parent._id;

    // Demote all current rows in the lineage. Use a collect since the
    // lineage is normally small (< 50 versions).
    const siblings = await ctx.db
      .query("videos")
      .withIndex("by_lineage", (q) => q.eq("lineageId", lineageId))
      .collect();
    const maxVersion = siblings.reduce(
      (m, v) => Math.max(m, v.versionNumber ?? 1),
      parent.versionNumber ?? 1,
    );
    for (const s of siblings) {
      if (s.isCurrentVersion) {
        await ctx.db.patch(s._id, { isCurrentVersion: false });
      }
    }

    const publicId = await generatePublicId(ctx);
    const nextNumber = maxVersion + 1;
    const newTitle =
      args.title?.trim() ||
      parent.title.replace(/\s*\(v\d+\)\s*$/, "") + ` (v${nextNumber})`;

    const videoId = await ctx.db.insert("videos", {
      projectId: parent.projectId,
      uploadedByClerkId: user.subject,
      uploaderName: identityName(user),
      title: newTitle,
      description: args.description ?? parent.description,
      fileSize: args.fileSize,
      contentType: args.contentType,
      status: "uploading",
      muxAssetStatus: "preparing",
      workflowStatus: "review",
      visibility: parent.visibility,
      publicId,
      lineageId,
      versionNumber: nextNumber,
      isCurrentVersion: true,
      versionLabel: args.versionLabel?.trim() || undefined,
    });
    // Dual-write into the unified version model. Best-effort: a failure
    // here must never break the upload flow (legacy lineage is still
    // authoritative this phase).
    try {
      await recordItemVersion(ctx, {
        lineageKey: lineageId,
        projectId: parent.projectId,
        kind: "asset",
        versionNumber: nextNumber,
        label: args.versionLabel?.trim() || undefined,
        createdByClerkId: user.subject,
        createdByName: identityName(user),
        videoId,
      });
    } catch (e) {
      console.error("itemVersions dual-write (asset) failed", e);
    }
    return videoId;
  },
});

export const setCurrentVersion = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const { video: rawVideo } = await requireVideoAccess(
      ctx,
      args.videoId,
      "member",
    );
    const video = await ensureLineageRoot(ctx, rawVideo);
    const lineageId = video.lineageId ?? video._id;
    const siblings = await ctx.db
      .query("videos")
      .withIndex("by_lineage", (q) => q.eq("lineageId", lineageId))
      .collect();
    for (const s of siblings) {
      const shouldBe = s._id === args.videoId;
      if (s.isCurrentVersion !== shouldBe) {
        await ctx.db.patch(s._id, { isCurrentVersion: shouldBe });
      }
    }
  },
});

export const renameVersion = mutation({
  args: {
    videoId: v.id("videos"),
    versionLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireVideoAccess(ctx, args.videoId, "member");
    await ctx.db.patch(args.videoId, {
      versionLabel: args.versionLabel?.trim() || undefined,
    });
  },
});

/**
 * Returns every version in the lineage `videoId` belongs to, ordered by
 * versionNumber descending (latest first). Falls back to "this video is
 * its own single-version lineage" for legacy rows.
 */
export const listVersions = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const { video } = await requireVideoAccess(ctx, args.videoId);
    const lineageId = video.lineageId ?? video._id;
    const fromIndex = await ctx.db
      .query("videos")
      .withIndex("by_lineage", (q) => q.eq("lineageId", lineageId))
      .collect();
    // Skip soft-deleted versions — they live in Recently deleted.
    const liveRows = fromIndex.filter((v) => !v.deletedAt);
    // Pre-lineage row case: video itself isn't yet tagged, no siblings
    // exist. Synthesize a single-row response.
    const rows = liveRows.length > 0 ? liveRows : video.deletedAt ? [] : [video];
    return rows
      .map((v) => ({
        _id: v._id,
        title: v.title,
        versionNumber: v.versionNumber ?? 1,
        versionLabel: v.versionLabel ?? null,
        isCurrentVersion: v.isCurrentVersion ?? v._id === video._id,
        status: v.status,
        workflowStatus: v.workflowStatus,
        thumbnailUrl: v.thumbnailUrl ?? null,
        duration: v.duration ?? null,
        uploaderName: v.uploaderName,
        _creationTime: v._creationTime,
      }))
      .sort((a, b) => b.versionNumber - a.versionNumber);
  },
});

export const setVisibility = mutation({
  args: {
    videoId: v.id("videos"),
    visibility: visibilityValidator,
  },
  handler: async (ctx, args) => {
    await requireVideoAccess(ctx, args.videoId, "member");

    await ctx.db.patch(args.videoId, {
      visibility: args.visibility,
    });
  },
});

const paywallInputValidator = v.object({
  priceCents: v.number(),
  currency: v.optional(v.string()),
  description: v.optional(v.string()),
});

export const setPaywall = mutation({
  args: {
    videoId: v.id("videos"),
    paywall: v.union(paywallInputValidator, v.null()),
  },
  handler: async (ctx, args) => {
    await requireVideoAccess(ctx, args.videoId, "member");
    if (args.paywall === null) {
      await ctx.db.patch(args.videoId, { paywall: undefined });
      return;
    }
    if (!Number.isFinite(args.paywall.priceCents) || args.paywall.priceCents < 50) {
      throw new Error("Paywall price must be at least 50 cents.");
    }
    await ctx.db.patch(args.videoId, {
      paywall: {
        priceCents: Math.floor(args.paywall.priceCents),
        currency: (args.paywall.currency ?? "usd").toLowerCase(),
        description: args.paywall.description?.trim() || undefined,
      },
    });
  },
});

/**
 * "Has the viewer paid for this video?" — checks for a succeeded payment
 * matching either the caller's authenticated email or an explicit
 * clientEmail (used by anonymous share-page viewers). Used by the
 * Canva-style download button to decide whether to gate the click.
 */
export const getVideoUnlockState = query({
  args: {
    videoId: v.id("videos"),
    clientEmail: v.optional(v.string()),
  },
  returns: v.object({
    paywall: v.union(
      v.object({
        priceCents: v.number(),
        currency: v.string(),
        description: v.optional(v.string()),
      }),
      v.null(),
    ),
    paid: v.boolean(),
    paidBy: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return { paywall: null, paid: false, paidBy: null };
    const paywall = video.paywall ?? null;
    if (!paywall) return { paywall: null, paid: true, paidBy: null };

    // Identity-based unlock: if caller is a member of the owning team,
    // they bypass the paywall.
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      const project = await ctx.db.get(video.projectId);
      if (project) {
        const membership = await ctx.db
          .query("teamMembers")
          .withIndex("by_team_and_user", (q) =>
            q.eq("teamId", project.teamId).eq("userClerkId", identity.subject),
          )
          .unique();
        if (membership) {
          return { paywall, paid: true, paidBy: "team-member" };
        }
      }
    }

    // Email-based unlock: any succeeded payment for this video + this
    // email counts. Fall back to the caller's identity email.
    const email =
      args.clientEmail?.trim().toLowerCase() ||
      (typeof identity?.email === "string"
        ? (identity.email as string).toLowerCase()
        : undefined);
    if (!email) return { paywall, paid: false, paidBy: null };

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();
    const paid = payments.find(
      (p) =>
        p.status === "succeeded" &&
        p.clientEmail &&
        p.clientEmail.toLowerCase() === email,
    );
    if (paid) return { paywall, paid: true, paidBy: email };
    return { paywall, paid: false, paidBy: null };
  },
});

export const updateWorkflowStatus = mutation({
  args: {
    videoId: v.id("videos"),
    workflowStatus: workflowStatusValidator,
  },
  handler: async (ctx, args) => {
    await requireVideoAccess(ctx, args.videoId, "member");

    await ctx.db.patch(args.videoId, {
      workflowStatus: args.workflowStatus,
    });
  },
});

/**
 * Soft-delete a video — sets `deletedAt` so it disappears from project
 * + folder listings but the row itself, comments, share links, and Mux
 * assets stay intact for restore. The "Recently deleted" page lists
 * trashed videos and lets the team admin restore or purge them.
 *
 * Hard delete still happens via `purge` (callable only from the
 * trash UI, or as a side-effect of purging the parent project).
 */
export const remove = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const { user } = await requireVideoAccess(ctx, args.videoId, "admin");
    const name = identityName(user);
    await ctx.db.patch(args.videoId, {
      deletedAt: Date.now(),
      deletedByName: name,
    });
    // Drop the video AND its frame-caption rows from search so trashed
    // items don't surface in ⌘K.
    try {
      await removeSearchableForVideo(ctx, args.videoId);
    } catch (e) {
      console.error("search index (video remove) failed", e);
    }
  },
});

/**
 * Lift a video out of the trash. Clears the soft-delete markers so
 * it appears back in its project's grid. If the parent project itself
 * has been trashed we refuse — restore the project first so the video
 * has a folder to land in.
 */
export const restore = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const { video, project } = await requireVideoAccess(
      ctx,
      args.videoId,
      "admin",
    );
    if (project.deletedAt) {
      throw new Error(
        "The project this video belongs to is also in the trash. Restore the project first.",
      );
    }
    if (!video.deletedAt) return;
    await ctx.db.patch(args.videoId, {
      deletedAt: undefined,
      deletedByName: undefined,
    });
  },
});

/**
 * Permanently delete a soft-deleted video. Cascades through comments,
 * share links, and share-access grants — same path the old hard-delete
 * used. Refuses if the video hasn't been trashed first so accidental
 * "permanent delete" clicks are scoped to the trash UI.
 */
export const purge = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const { video } = await requireVideoAccess(ctx, args.videoId, "admin");
    if (!video.deletedAt) {
      throw new Error("Move the video to the trash first.");
    }

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();
    for (const comment of comments) {
      await ctx.db.delete(comment._id);
    }

    const shareLinks = await ctx.db
      .query("shareLinks")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();
    for (const link of shareLinks) {
      await deleteShareAccessGrantsForLink(ctx, link._id);
      await ctx.db.delete(link._id);
    }

    await ctx.db.delete(args.videoId);
  },
});

/**
 * Trash listing for the current user — every soft-deleted video
 * across every team they belong to. Mirrors `projects.listDeleted` so
 * the Recently deleted page can show projects + videos in one feed.
 */
export const listDeleted = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];

    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", user.subject))
      .collect();

    const all: Array<{
      _id: Id<"videos">;
      title: string;
      projectId: Id<"projects">;
      projectName: string;
      projectDeleted: boolean;
      teamId: Id<"teams">;
      teamName: string;
      teamSlug: string;
      deletedAt: number;
      deletedByName?: string;
      thumbnailUrl?: string;
    }> = [];

    for (const m of memberships) {
      const team = await ctx.db.get(m.teamId);
      if (!team) continue;
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_team", (q) => q.eq("teamId", m.teamId))
        .collect();
      for (const project of projects) {
        const videos = await ctx.db
          .query("videos")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();
        for (const video of videos) {
          if (typeof video.deletedAt !== "number") continue;
          // Hide videos whose only path to restoration is via the
          // project trash — they'll come back when the project does.
          // Showing them separately would double-count.
          if (project.deletedAt) continue;
          all.push({
            _id: video._id,
            title: video.title,
            projectId: project._id,
            projectName: project.name,
            projectDeleted: !!project.deletedAt,
            teamId: team._id,
            teamName: team.name,
            teamSlug: team.slug,
            deletedAt: video.deletedAt,
            deletedByName: video.deletedByName,
            thumbnailUrl: video.thumbnailUrl,
          });
        }
      }
    }

    all.sort((a, b) => b.deletedAt - a.deletedAt);
    return all;
  },
});

export const setUploadInfo = internalMutation({
  args: {
    videoId: v.id("videos"),
    s3Key: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      s3Key: args.s3Key,
      muxUploadId: undefined,
      muxAssetId: undefined,
      muxPlaybackId: undefined,
      muxAssetStatus: "preparing",
      thumbnailUrl: undefined,
      duration: undefined,
      uploadError: undefined,
      fileSize: args.fileSize,
      contentType: args.contentType,
      status: "uploading",
    });
  },
});

export const reconcileUploadedObjectMetadata = internalMutation({
  args: {
    videoId: v.id("videos"),
    fileSize: v.number(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) {
      throw new Error("Video not found");
    }

    const project = await ctx.db.get(video.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const declaredSize =
      typeof video.fileSize === "number" && Number.isFinite(video.fileSize)
        ? Math.max(0, video.fileSize)
        : 0;
    const actualSize = Number.isFinite(args.fileSize) ? Math.max(0, args.fileSize) : 0;
    const sizeDelta = actualSize - declaredSize;

    if (sizeDelta > 0) {
      await assertTeamCanStoreBytes(ctx, project.teamId, sizeDelta);
    }

    await ctx.db.patch(args.videoId, {
      fileSize: actualSize,
      contentType: args.contentType,
    });
  },
});

export const markAsProcessing = internalMutation({
  args: {
    videoId: v.id("videos"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      status: "processing",
      muxAssetStatus: "preparing",
      uploadError: undefined,
    });
  },
});

/**
 * Non-video upload completion. Marks the row "ready" with no Mux fields,
 * so the row represents a plain file (doc/image/audio/source). The grid
 * + share view detect the missing playback ID and render a file tile +
 * download button instead of a player.
 */
export const markAsReadyAsFile = internalMutation({
  args: {
    videoId: v.id("videos"),
    fileSize: v.number(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      status: "ready",
      muxAssetStatus: undefined,
      muxAssetId: undefined,
      muxPlaybackId: undefined,
      muxSignedPlaybackId: undefined,
      muxPreviewAssetId: undefined,
      muxPreviewPlaybackId: undefined,
      muxPreviewAssetStatus: undefined,
      thumbnailUrl: undefined,
      duration: undefined,
      fileSize: args.fileSize,
      contentType: args.contentType,
      uploadError: undefined,
    });
  },
});

export const markAsReady = internalMutation({
  args: {
    videoId: v.id("videos"),
    muxAssetId: v.string(),
    muxPlaybackId: v.string(),
    duration: v.optional(v.number()),
    thumbnailUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const before = await ctx.db.get(args.videoId);
    await ctx.db.patch(args.videoId, {
      muxAssetId: args.muxAssetId,
      muxPlaybackId: args.muxPlaybackId,
      muxAssetStatus: "ready",
      duration: args.duration,
      thumbnailUrl: args.thumbnailUrl,
      uploadError: undefined,
      status: "ready",
    });

    // Pre-warm the watermarked preview asset right as the full asset
    // becomes available. By the time anyone creates a paywalled share
    // link against this video, the preview is already in Mux and ready
    // for instant playback. Skipped if the video already has a preview
    // asset (legacy lazy path) — the action itself is idempotent.
    if (!before?.muxPreviewAssetId) {
      await ctx.scheduler.runAfter(
        0,
        api.videoActions.ensurePreviewAssetForVideo,
        { videoId: args.videoId },
      );
    }

    // "Long upload finished" email — only if it took >5min, the
    // uploader opted in, and we can resolve their address. Best-effort,
    // no-ops without RESEND_API_KEY/APP_URL.
    try {
      if (before && before.status !== "ready") {
        const elapsed = Date.now() - before._creationTime;
        if (
          elapsed > 5 * 60 * 1000 &&
          (await prefEnabled(
            ctx,
            before.uploadedByClerkId,
            "uploadFinished",
          ))
        ) {
          const to = await resolveUserEmail(ctx, before.uploadedByClerkId);
          const project = await ctx.db.get(before.projectId);
          const team = project ? await ctx.db.get(project.teamId) : null;
          if (to && project && team) {
            await ctx.scheduler.runAfter(
              0,
              internal.email.sendUploadFinished,
              {
                to,
                videoTitle: before.title,
                path: `/dashboard/${team.slug}/${before.projectId}/${args.videoId}`,
              },
            );
          }
        }
      }
    } catch (e) {
      console.error("upload-finished notification failed", e);
    }
  },
});

export const markAsFailed = internalMutation({
  args: {
    videoId: v.id("videos"),
    uploadError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const before = await ctx.db.get(args.videoId);
    await ctx.db.patch(args.videoId, {
      muxAssetStatus: "errored",
      uploadError: args.uploadError,
      status: "failed",
    });

    // Always notify the uploader on failure (sparse, system-state event
    // — not gated by the chatty "Upload completion" pref). Best-effort,
    // no-ops without RESEND_API_KEY/APP_URL.
    try {
      if (before && before.uploadedByClerkId) {
        const to = await resolveUserEmail(ctx, before.uploadedByClerkId);
        const project = await ctx.db.get(before.projectId);
        const team = project ? await ctx.db.get(project.teamId) : null;
        if (to && project && team) {
          await ctx.scheduler.runAfter(
            0,
            internal.email.sendUploadFailed,
            {
              to,
              videoTitle: before.title,
              errorMessage: args.uploadError,
              path: `/dashboard/${team.slug}/${before.projectId}/${args.videoId}`,
            },
          );
        }
      }
    } catch (e) {
      console.error("upload-failed notification failed", e);
    }
  },
});

export const setMuxAssetReference = internalMutation({
  args: {
    videoId: v.id("videos"),
    muxAssetId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      muxAssetId: args.muxAssetId,
      muxAssetStatus: "preparing",
      status: "processing",
    });
  },
});

export const setMuxPlaybackId = internalMutation({
  args: {
    videoId: v.id("videos"),
    muxPlaybackId: v.string(),
    thumbnailUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      muxPlaybackId: args.muxPlaybackId,
      thumbnailUrl: args.thumbnailUrl,
    });
  },
});

export const setMuxCaptionsTrackId = internalMutation({
  args: {
    videoId: v.id("videos"),
    trackId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      muxCaptionsTrackId: args.trackId,
    });
  },
});

export const setMuxSignedPlaybackId = internalMutation({
  args: {
    videoId: v.id("videos"),
    muxSignedPlaybackId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      muxSignedPlaybackId: args.muxSignedPlaybackId,
    });
  },
});

export const setMuxPreviewAssetReference = internalMutation({
  args: {
    videoId: v.id("videos"),
    muxPreviewAssetId: v.string(),
    watermarkOverlayKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      muxPreviewAssetId: args.muxPreviewAssetId,
      muxPreviewAssetStatus: "preparing",
      muxPreviewAssetError: undefined,
      muxPreviewAssetUpdatedAt: Date.now(),
      watermarkOverlayKey: args.watermarkOverlayKey,
    });
  },
});

export const setMuxPreviewPlaybackId = internalMutation({
  args: {
    videoId: v.id("videos"),
    muxPreviewPlaybackId: v.string(),
    // Set by webhook + poll callers to fence stale events from a prior
    // generation. After an owner retry the video's `muxPreviewAssetId`
    // points at the NEW asset; a late `video.asset.ready` event for the
    // discarded old asset would otherwise overwrite the new state.
    expectedAssetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.expectedAssetId) {
      const current = await ctx.db.get(args.videoId);
      if (current?.muxPreviewAssetId !== args.expectedAssetId) {
        console.log("Ignoring stale preview ready event", {
          videoId: args.videoId,
          expectedAssetId: args.expectedAssetId,
          currentAssetId: current?.muxPreviewAssetId,
        });
        return;
      }
    }
    await ctx.db.patch(args.videoId, {
      muxPreviewPlaybackId: args.muxPreviewPlaybackId,
      muxPreviewAssetStatus: "ready",
      muxPreviewAssetError: undefined,
      muxPreviewAssetUpdatedAt: Date.now(),
    });
  },
});

export const setMuxPreviewAssetErrored = internalMutation({
  args: {
    videoId: v.id("videos"),
    reason: v.optional(v.string()),
    // Same stale-event guard as setMuxPreviewPlaybackId. Pre-Mux callers
    // (the action itself recording its own watermark-pipeline failures
    // before any asset id exists) omit this and unconditionally land.
    expectedAssetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.expectedAssetId) {
      const current = await ctx.db.get(args.videoId);
      if (current?.muxPreviewAssetId !== args.expectedAssetId) {
        console.log("Ignoring stale preview errored event", {
          videoId: args.videoId,
          expectedAssetId: args.expectedAssetId,
          currentAssetId: current?.muxPreviewAssetId,
        });
        return;
      }
    }
    await ctx.db.patch(args.videoId, {
      muxPreviewAssetStatus: "errored",
      muxPreviewAssetError: args.reason,
      muxPreviewAssetUpdatedAt: Date.now(),
    });
  },
});

// ── Static renditions (downloadable MP4 proxies / drive edit-proxies) ───────
// See plans/proxies-unified.md. Mirrors the muxPreviewAsset* webhook pattern.

// Mark a set of renditions as "preparing" right after requestProxies fires the
// Mux create calls. Never downgrades a rendition that's already ready.
export const setStaticRenditionsRequested = internalMutation({
  args: {
    videoId: v.id("videos"),
    entries: v.array(
      v.object({
        name: v.string(),
        resolution: v.string(),
        ext: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return;
    const byName = new Map(
      (video.staticRenditions ?? []).map((r) => [r.name, r]),
    );
    for (const e of args.entries) {
      const prev = byName.get(e.name);
      if (prev && prev.status === "ready") continue; // don't clobber a ready file
      byName.set(e.name, {
        name: e.name,
        resolution: e.resolution,
        ext: e.ext,
        status: "preparing" as const,
        filesizeBytes: prev?.filesizeBytes,
        error: undefined,
      });
    }
    await ctx.db.patch(args.videoId, {
      staticRenditions: Array.from(byName.values()),
      staticRenditionsUpdatedAt: Date.now(),
    });
  },
});

// Upsert a single rendition's terminal state from the Mux webhook.
export const upsertStaticRendition = internalMutation({
  args: {
    videoId: v.id("videos"),
    name: v.string(),
    resolution: v.string(),
    ext: v.string(),
    status: v.union(
      v.literal("preparing"),
      v.literal("ready"),
      v.literal("errored"),
      v.literal("skipped"),
    ),
    filesizeBytes: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return;
    const byName = new Map(
      (video.staticRenditions ?? []).map((r) => [r.name, r]),
    );
    byName.set(args.name, {
      name: args.name,
      resolution: args.resolution,
      ext: args.ext,
      status: args.status,
      filesizeBytes: args.filesizeBytes ?? byName.get(args.name)?.filesizeBytes,
      error: args.error,
    });
    await ctx.db.patch(args.videoId, {
      staticRenditions: Array.from(byName.values()),
      staticRenditionsUpdatedAt: Date.now(),
    });
  },
});

// Context the R2-mirror action needs: the project layout (teamSlug/projectId)
// to build the proxy key, the public playback id to fetch the MP4 from Mux, and
// the current renditions. Internal (no auth) — called only by mirrorRenditionToR2.
export const getProxyMirrorContext = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return null;
    const project = await ctx.db.get(video.projectId);
    if (!project) return null;
    const team = await ctx.db.get(project.teamId);
    if (!team) return null;
    return {
      teamSlug: team.slug,
      projectId: video.projectId as string,
      muxPlaybackId: video.muxPlaybackId,
      status: video.status,
      staticRenditions: video.staticRenditions ?? [],
    };
  },
});

// Record the R2 object key once a rendition has been mirrored for the drive.
export const setStaticRenditionR2Key = internalMutation({
  args: { videoId: v.id("videos"), name: v.string(), r2Key: v.string() },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return;
    const renditions = (video.staticRenditions ?? []).map((r) =>
      r.name === args.name ? { ...r, r2Key: args.r2Key } : r,
    );
    await ctx.db.patch(args.videoId, {
      staticRenditions: renditions,
      staticRenditionsUpdatedAt: Date.now(),
    });
  },
});

// Videos in a project that are ready, have a Mux asset, and have no proxy yet
// (none ready/preparing). Used by the backfill action. Capped so one run can't
// queue an unbounded Mux re-encode bill. Internal — access is checked by the
// calling action via api.projects.get.
export const listProxyBackfillCandidates = internalQuery({
  args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const all = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const out: Array<{ videoId: Id<"videos">; muxAssetId: string }> = [];
    for (const video of all) {
      if (video.deletedAt) continue;
      if (video.status !== "ready") continue;
      if (!video.muxAssetId) continue;
      const rends = video.staticRenditions ?? [];
      if (rends.some((r) => r.status === "ready" || r.status === "preparing")) {
        continue;
      }
      out.push({ videoId: video._id, muxAssetId: video.muxAssetId });
      if (out.length >= limit) break;
    }
    return out;
  },
});

// Owner-triggered reset: clears preview state so `ensurePreviewAssetForVideo`
// runs again on the next viewer poll (or when explicitly re-scheduled by
// the retry action).
export const clearMuxPreviewAsset = internalMutation({
  args: {
    videoId: v.id("videos"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      muxPreviewAssetId: undefined,
      muxPreviewPlaybackId: undefined,
      muxPreviewAssetStatus: undefined,
      muxPreviewAssetError: undefined,
      muxPreviewAssetUpdatedAt: Date.now(),
      watermarkOverlayKey: undefined,
    });
  },
});

/** Read-only helper for the sharp-based image preview generator. */
export const getForImagePreview = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return null;
    return {
      _id: video._id,
      s3Key: video.s3Key ?? null,
      contentType: video.contentType ?? null,
      imagePreviewS3Key: video.imagePreviewS3Key ?? null,
      imagePreviewStatus: video.imagePreviewStatus ?? null,
    };
  },
});

export const setImagePreview = internalMutation({
  args: {
    videoId: v.id("videos"),
    imagePreviewStatus: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("errored"),
    ),
    imagePreviewS3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      imagePreviewStatus: args.imagePreviewStatus,
      imagePreviewS3Key: args.imagePreviewS3Key,
    });
  },
});

export const getVideoByMuxPreviewAssetId = internalQuery({
  args: { muxPreviewAssetId: v.string() },
  returns: v.union(
    v.object({
      videoId: v.id("videos"),
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<{ videoId: Id<"videos"> } | null> => {
    const video = await ctx.db
      .query("videos")
      .withIndex("by_mux_preview_asset_id", (q) =>
        q.eq("muxPreviewAssetId", args.muxPreviewAssetId),
      )
      .unique();
    if (!video) return null;
    return { videoId: video._id };
  },
});

/** Lightweight read used by ensurePreviewAssetForVideo before triggering ingest. */
export const getForPreviewGen = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return null;
    return {
      _id: video._id,
      s3Key: video.s3Key,
      contentType: video.contentType,
      status: video.status,
      muxAssetStatus: video.muxAssetStatus,
      muxPreviewAssetId: video.muxPreviewAssetId,
      muxPreviewAssetStatus: video.muxPreviewAssetStatus,
      muxPreviewAssetUpdatedAt: video.muxPreviewAssetUpdatedAt,
      muxPreviewPlaybackId: video.muxPreviewPlaybackId,
      title: video.title,
    };
  },
});

/**
 * Atomic claim used by `ensurePreviewAssetForVideo` to fence concurrent
 * schedulers (e.g. one from `markAsReady` + one from `shareLinks.create`
 * for the same video). Inside a single Convex mutation the read+patch is
 * transactional, so exactly one caller observes `claimed: true` for a
 * given `(videoId, generation)` race. An in-flight claim is considered
 * stale after 10 minutes — that's well past the Mux ingest budget but
 * short enough that a wedged scheduler doesn't block retries forever.
 */
export const claimPreviewGeneration = internalMutation({
  args: { videoId: v.id("videos") },
  returns: v.object({
    claimed: v.boolean(),
    reason: v.optional(
      v.union(
        v.literal("video_missing"),
        v.literal("already_has_asset"),
        v.literal("in_flight"),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return { claimed: false, reason: "video_missing" as const };
    if (video.muxPreviewAssetId) {
      return { claimed: false, reason: "already_has_asset" as const };
    }
    const inFlight =
      video.muxPreviewAssetStatus === "preparing" &&
      typeof video.muxPreviewAssetUpdatedAt === "number" &&
      Date.now() - video.muxPreviewAssetUpdatedAt < 10 * 60 * 1000;
    if (inFlight) {
      return { claimed: false, reason: "in_flight" as const };
    }
    await ctx.db.patch(args.videoId, {
      muxPreviewAssetStatus: "preparing",
      muxPreviewAssetError: undefined,
      muxPreviewAssetUpdatedAt: Date.now(),
    });
    return { claimed: true };
  },
});

/** Resolves a share-grant token to the underlying video + paywall state. */
export const getByShareGrantWithPaywall = query({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
  },
  handler: async (ctx, args) => {
    const resolved = await resolveActiveShareGrant(ctx, args.grantToken);
    if (!resolved) return null;
    const video = await resolveShareTargetVideo(
      ctx,
      resolved.shareLink,
      args.itemVideoId,
    );
    if (!video) return null;
    return {
      grant: {
        _id: resolved.grant._id,
        paidAt: resolved.grant.paidAt ?? null,
        expiresAt: resolved.grant.expiresAt,
      },
      shareLink: {
        _id: resolved.shareLink._id,
        paywall: resolved.shareLink.paywall ?? null,
        clientEmail: resolved.shareLink.clientEmail ?? null,
        clientLabel: resolved.shareLink.clientLabel ?? null,
        allowDownload: resolved.shareLink.allowDownload,
        createdByClerkId: resolved.shareLink.createdByClerkId,
      },
      video: {
        _id: video._id,
        title: video.title,
        status: video.status,
        contentType: video.contentType,
        s3Key: video.s3Key,
        muxAssetId: video.muxAssetId,
        muxPlaybackId: video.muxPlaybackId,
        muxSignedPlaybackId: video.muxSignedPlaybackId,
        muxPreviewAssetId: video.muxPreviewAssetId,
        muxPreviewPlaybackId: video.muxPreviewPlaybackId,
        muxPreviewAssetStatus: video.muxPreviewAssetStatus,
        muxPreviewAssetError: video.muxPreviewAssetError ?? null,
        muxPreviewAssetUpdatedAt: video.muxPreviewAssetUpdatedAt ?? null,
        imagePreviewS3Key: video.imagePreviewS3Key ?? null,
        imagePreviewStatus: video.imagePreviewStatus ?? null,
      },
    };
  },
});

/**
 * Public share-page summary. Returns either `kind: "single"` (legacy
 * single-video share) or `kind: "bundle"` (folder/selection bundle with an
 * item list). The client uses this to decide whether to render the player
 * directly or a folder index grid + per-item playback.
 */
export const getShareSummaryByGrant = query({
  args: { grantToken: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveActiveShareGrant(ctx, args.grantToken);
    if (!resolved) return null;

    if (resolved.shareLink.videoId) {
      const video = await ctx.db.get(resolved.shareLink.videoId);
      if (!video || video.deletedAt) return null;
      return {
        kind: "single" as const,
        single: {
          videoId: video._id,
          title: video.title,
          description: video.description ?? null,
          duration: video.duration ?? null,
          thumbnailUrl: video.thumbnailUrl ?? null,
          contentType: video.contentType ?? null,
          status: video.status,
          // Metadata-tab fields (Phase 5).
          fileSize: video.fileSize ?? null,
          uploaderName: video.uploaderName,
          createdAt: video._creationTime,
          workflowStatus: video.workflowStatus,
          versionNumber: video.versionNumber ?? null,
          versionLabel: video.versionLabel ?? null,
        },
        bundle: null,
        paywall: resolved.shareLink.paywall ?? null,
        allowDownload: resolved.shareLink.allowDownload,
        grantExpiresAt: resolved.grant.expiresAt,
        grantPaidAt: resolved.grant.paidAt ?? null,
      };
    }

    if (resolved.shareLink.bundleId) {
      const bundle = await ctx.db.get(resolved.shareLink.bundleId);
      if (!bundle) return null;
      const videos = await resolveBundleVideos(ctx, bundle);
      const folderDocs = await resolveBundleFolders(ctx, bundle);

      // The share's "root" is the shared folder for folder bundles, or the
      // project root (represented as null) for project/selection bundles.
      // Normalizing the root folder id to null lets the client treat the root
      // level uniformly across bundle kinds.
      const rootFolderId =
        bundle.kind === "folder" ? bundle.folderId ?? null : null;
      const normalizeFolderId = (
        fid: Id<"folders"> | undefined | null,
      ): Id<"folders"> | null => {
        if (!fid) return null;
        if (rootFolderId && fid === rootFolderId) return null;
        return fid;
      };

      return {
        kind: "bundle" as const,
        single: null,
        bundle: {
          _id: bundle._id,
          name: bundle.name,
          kind: bundle.kind,
          // Notion-style per-share header. The cover URL is signed separately
          // via videoActions.getSharedBundleCover (private bucket object).
          headerTitle: bundle.headerTitle ?? null,
          headerDescription: bundle.headerDescription ?? null,
          hasCover: Boolean(bundle.coverImageS3Key),
          // null = the share root. Folders below carry their own ids.
          rootFolderId,
          // The root folder itself is represented as null, so exclude it here.
          folders: folderDocs
            .filter((f) => f._id !== rootFolderId)
            .map((f) => ({
              _id: f._id,
              name: f.name,
              parentFolderId: normalizeFolderId(f.parentFolderId),
            })),
          items: videos
            .filter((v) => v.status === "ready")
            .map((v) => ({
              _id: v._id,
              title: v.title,
              duration: v.duration ?? null,
              thumbnailUrl: v.thumbnailUrl ?? null,
              contentType: v.contentType ?? null,
              // For non-video items the share page needs to know whether the
              // watermarked preview is ready and whether the original is even
              // a Mux playable.
              imagePreviewStatus: v.imagePreviewStatus ?? null,
              hasMuxPlayback: Boolean(v.muxPlaybackId),
              // Ready downloadable proxies (Mux static renditions) so the share
              // download sheet only offers qualities that actually exist.
              proxies: (v.staticRenditions ?? [])
                .filter((r) => r.status === "ready")
                .map((r) => ({ name: r.name, resolution: r.resolution })),
              // Folder-aware fields (Phase 1): which folder the item lives in
              // (normalized to null at the root), plus metadata for the share
              // page's filters / sort / list view.
              folderId: normalizeFolderId(v.folderId),
              fileSize: v.fileSize ?? null,
              workflowStatus: v.workflowStatus,
              uploaderName: v.uploaderName,
              createdAt: v._creationTime,
              versionNumber: v.versionNumber ?? null,
              versionLabel: v.versionLabel ?? null,
            })),
        },
        paywall: resolved.shareLink.paywall ?? null,
        allowDownload: resolved.shareLink.allowDownload,
        grantExpiresAt: resolved.grant.expiresAt,
        grantPaidAt: resolved.grant.paidAt ?? null,
      };
    }

    return null;
  },
});

/**
 * Resolves a bundle's cover-image S3 key for a given share grant. Internal so
 * the key is never exposed to clients directly — videoActions.getSharedBundleCover
 * uses it to mint a short-TTL signed URL.
 */
export const getBundleCoverKeyByGrant = internalQuery({
  args: { grantToken: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const resolved = await resolveActiveShareGrant(ctx, args.grantToken);
    if (!resolved || !resolved.shareLink.bundleId) return null;
    const bundle = await ctx.db.get(resolved.shareLink.bundleId);
    return bundle?.coverImageS3Key ?? null;
  },
});

export const getVideoByMuxUploadId = internalQuery({
  args: {
    muxUploadId: v.string(),
  },
  returns: v.union(
    v.object({
      videoId: v.id("videos"),
    }),
    v.null()
  ),
  handler: async (ctx, args): Promise<{ videoId: Id<"videos"> } | null> => {
    const video = await ctx.db
      .query("videos")
      .withIndex("by_mux_upload_id", (q) => q.eq("muxUploadId", args.muxUploadId))
      .unique();

    if (!video) return null;
    return { videoId: video._id };
  },
});

export const getVideoByMuxAssetId = internalQuery({
  args: {
    muxAssetId: v.string(),
  },
  returns: v.union(
    v.object({
      videoId: v.id("videos"),
    }),
    v.null()
  ),
  handler: async (ctx, args): Promise<{ videoId: Id<"videos"> } | null> => {
    const video = await ctx.db
      .query("videos")
      .withIndex("by_mux_asset_id", (q) => q.eq("muxAssetId", args.muxAssetId))
      .unique();

    if (!video) return null;
    return { videoId: video._id };
  },
});

export const getVideoForPlayback = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const { video } = await requireVideoAccess(ctx, args.videoId, "viewer");
    return video;
  },
});

export const incrementViewCount = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const shareLink = await ctx.db
      .query("shareLinks")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (shareLink) {
      await ctx.db.patch(shareLink._id, {
        viewCount: shareLink.viewCount + 1,
      });
    }
  },
});

export const updateDuration = mutation({
  args: {
    videoId: v.id("videos"),
    duration: v.number(),
  },
  handler: async (ctx, args) => {
    await requireVideoAccess(ctx, args.videoId, "member");
    await ctx.db.patch(args.videoId, { duration: args.duration });
  },
});
