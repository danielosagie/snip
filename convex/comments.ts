import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  identityAvatarUrl,
  identityName,
  requireVideoAccess,
  requireUser,
} from "./auth";
import { resolveActiveShareGrant, shareCapabilities } from "./shareAccess";
import { resolveBundleVideos } from "./shareBundles";
import { indexSearchable, removeSearchable } from "./search";
import { internal } from "./_generated/api";
import { prefEnabled, resolveUserEmail } from "./notifications";

/**
 * Resolves the video targeted by a share-grant comment. Single-video shares
 * use the link's videoId; bundle shares require an itemVideoId that we
 * validate is part of the bundle so a paid grant for bundle A can't
 * spray comments onto videos in bundle B.
 */
async function resolveShareGrantVideo(
  ctx: QueryCtx | MutationCtx,
  shareLink: Doc<"shareLinks">,
  itemVideoId: Id<"videos"> | undefined,
): Promise<Doc<"videos"> | null> {
  if (shareLink.videoId) {
    return await ctx.db.get(shareLink.videoId);
  }
  if (!shareLink.bundleId || !itemVideoId) return null;
  const bundle = await ctx.db.get(shareLink.bundleId);
  if (!bundle) return null;
  const items = await resolveBundleVideos(ctx, bundle);
  return items.find((v) => v._id === itemVideoId) ?? null;
}

function toThreadedComments<T extends { _id: string; parentId?: string; timestampSeconds: number; _creationTime: number }>(
  comments: T[],
) {
  const topLevel = comments
    .filter((c) => !c.parentId)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  return topLevel.map((comment) => ({
    ...comment,
    replies: comments
      .filter((c) => c.parentId === comment._id)
      .sort((a, b) => a._creationTime - b._creationTime),
  }));
}

function toPublicCommentPayload(comment: {
  _id: string;
  _creationTime: number;
  text: string;
  timestampSeconds: number;
  parentId?: string;
  resolved: boolean;
  userName: string;
  userAvatarUrl?: string;
}) {
  return {
    _id: comment._id,
    _creationTime: comment._creationTime,
    text: comment.text,
    timestampSeconds: comment.timestampSeconds,
    parentId: comment.parentId,
    resolved: comment.resolved,
    userName: comment.userName,
    userAvatarUrl: comment.userAvatarUrl,
  };
}

async function getPublicVideoByPublicId(
  ctx: QueryCtx | MutationCtx,
  publicId: string,
) {
  const video = await ctx.db
    .query("videos")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();

  if (!video || video.visibility !== "public" || video.status !== "ready") {
    return null;
  }

  return video;
}

export const list = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    await requireVideoAccess(ctx, args.videoId);

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();

    return comments.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  },
});

export const create = mutation({
  args: {
    videoId: v.id("videos"),
    text: v.string(),
    timestampSeconds: v.number(),
    parentId: v.optional(v.id("comments")),
  },
  handler: async (ctx, args) => {
    const { user, video, project } = await requireVideoAccess(
      ctx,
      args.videoId,
      "viewer",
    );

    const parent = args.parentId ? await ctx.db.get(args.parentId) : null;
    if (args.parentId) {
      if (!parent || parent.videoId !== args.videoId) {
        throw new Error("Invalid parent comment");
      }
    }

    const commentId = await ctx.db.insert("comments", {
      videoId: args.videoId,
      userClerkId: user.subject,
      userName: identityName(user),
      userAvatarUrl: identityAvatarUrl(user),
      text: args.text,
      timestampSeconds: args.timestampSeconds,
      parentId: args.parentId,
      resolved: false,
    });

    try {
      await indexSearchable(ctx, {
        kind: "comment",
        refId: commentId,
        teamId: project.teamId,
        projectId: video.projectId,
        videoId: args.videoId,
        title: `Comment on ${video.title}`,
        contextLabel: `${project.name} · ${video.title}`,
        text: args.text,
      });
    } catch (e) {
      console.error("search index (comment create) failed", e);
    }

    // Notify the parent author of a reply (best-effort, pref-gated,
    // skips self-replies). No-ops without RESEND_API_KEY/APP_URL.
    try {
      if (
        parent &&
        parent.userClerkId &&
        parent.userClerkId !== user.subject &&
        (await prefEnabled(ctx, parent.userClerkId, "commentReply"))
      ) {
        const to = await resolveUserEmail(ctx, parent.userClerkId);
        const team = await ctx.db.get(project.teamId);
        if (to && team) {
          await ctx.scheduler.runAfter(
            0,
            internal.email.sendCommentReply,
            {
              to,
              replierName: identityName(user),
              videoTitle: video.title,
              path: `/dashboard/${team.slug}/${video.projectId}/${args.videoId}`,
            },
          );
        }
      }
    } catch (e) {
      console.error("comment reply notification failed", e);
    }

    return commentId;
  },
});

export const createForPublic = mutation({
  args: {
    publicId: v.string(),
    text: v.string(),
    timestampSeconds: v.number(),
    parentId: v.optional(v.id("comments")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const video = await getPublicVideoByPublicId(ctx, args.publicId);

    if (!video) {
      throw new Error("Video not found");
    }

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.videoId !== video._id) {
        throw new Error("Invalid parent comment");
      }
    }

    return await ctx.db.insert("comments", {
      videoId: video._id,
      userClerkId: user.subject,
      userName: identityName(user),
      userAvatarUrl: identityAvatarUrl(user),
      text: args.text,
      timestampSeconds: args.timestampSeconds,
      parentId: args.parentId,
      resolved: false,
    });
  },
});

export const createForShareGrant = mutation({
  args: {
    grantToken: v.string(),
    text: v.string(),
    timestampSeconds: v.number(),
    parentId: v.optional(v.id("comments")),
    // Required when the share is a bundle so we know which item the comment
    // attaches to. Ignored for single-video shares (we use the link's videoId).
    itemVideoId: v.optional(v.id("videos")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const resolved = await resolveActiveShareGrant(ctx, args.grantToken);

    if (!resolved) {
      throw new Error("Invalid share grant");
    }

    // Role gate: viewers (or links with comments turned off) can't comment.
    const { canComment } = shareCapabilities(
      resolved.grant.role,
      resolved.shareLink,
    );
    if (!canComment) {
      throw new Error("Commenting isn't enabled for your access level.");
    }

    const video = await resolveShareGrantVideo(ctx, resolved.shareLink, args.itemVideoId);
    if (!video || video.status !== "ready") {
      throw new Error("Video not found");
    }

    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.videoId !== video._id) {
        throw new Error("Invalid parent comment");
      }
    }

    return await ctx.db.insert("comments", {
      videoId: video._id,
      userClerkId: user.subject,
      userName: identityName(user),
      userAvatarUrl: identityAvatarUrl(user),
      text: args.text,
      timestampSeconds: args.timestampSeconds,
      parentId: args.parentId,
      resolved: false,
    });
  },
});

export const update = mutation({
  args: {
    commentId: v.id("comments"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");

    if (comment.userClerkId !== user.subject) {
      throw new Error("You can only edit your own comments");
    }

    await ctx.db.patch(args.commentId, { text: args.text });
  },
});

export const remove = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");

    if (comment.userClerkId !== user.subject) {
      await requireVideoAccess(ctx, comment.videoId, "admin");
    }

    const replies = await ctx.db
      .query("comments")
      .withIndex("by_parent", (q) => q.eq("parentId", args.commentId))
      .collect();

    for (const reply of replies) {
      await ctx.db.delete(reply._id);
    }

    await ctx.db.delete(args.commentId);

    try {
      await removeSearchable(ctx, "comment", args.commentId);
      for (const reply of replies) {
        await removeSearchable(ctx, "comment", reply._id);
      }
    } catch (e) {
      console.error("search index (comment remove) failed", e);
    }
  },
});

export const toggleResolved = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");

    await requireVideoAccess(ctx, comment.videoId, "member");

    await ctx.db.patch(args.commentId, { resolved: !comment.resolved });
  },
});

export const getThreaded = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    await requireVideoAccess(ctx, args.videoId);

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();

    return toThreadedComments(comments);
  },
});

export const getThreadedForPublic = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const video = await getPublicVideoByPublicId(ctx, args.publicId);
    if (!video) {
      return [];
    }

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_video", (q) => q.eq("videoId", video._id))
      .collect();

    return toThreadedComments(comments.map(toPublicCommentPayload));
  },
});

export const getThreadedForShareGrant = query({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
  },
  handler: async (ctx, args) => {
    const resolved = await resolveActiveShareGrant(ctx, args.grantToken);
    if (!resolved) {
      return [];
    }

    const video = await resolveShareGrantVideo(ctx, resolved.shareLink, args.itemVideoId);
    if (!video || video.status !== "ready") {
      return [];
    }

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_video", (q) => q.eq("videoId", video._id))
      .collect();

    return toThreadedComments(comments.map(toPublicCommentPayload));
  },
});
