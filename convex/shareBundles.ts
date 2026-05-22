import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { identityName, requireProjectAccess, requireVideoAccess } from "./auth";

/**
 * Bundles a folder or an ad-hoc selection of videos under a single share
 * link with one paywall. The bundle is the "what" — the share link layered
 * on top is the "how" (token, password, paywall, grant TTL).
 *
 * Live-folder bundles do not store a videoIds list — we always resolve the
 * folder's current contents on read. Selection bundles freeze the list.
 */

type ReadCtx = QueryCtx | MutationCtx;

async function requireBundleAccess(
  ctx: ReadCtx,
  bundleId: Id<"shareBundles">,
  requiredRole?: "viewer" | "member" | "admin" | "owner",
) {
  const bundle = await ctx.db.get(bundleId);
  if (!bundle) throw new Error("Bundle not found");
  const access = await requireProjectAccess(ctx, bundle.projectId, requiredRole);
  return { ...access, bundle };
}

/**
 * Returns the given folder id plus every descendant folder id (depth-first
 * over `folders.by_project_and_parent`). Cycle-guarded with a visited set so a
 * corrupt parent chain can't loop forever.
 */
async function collectFolderSubtree(
  ctx: ReadCtx,
  projectId: Id<"projects">,
  rootFolderId: Id<"folders">,
): Promise<Id<"folders">[]> {
  const visited = new Set<string>([rootFolderId]);
  const out: Id<"folders">[] = [rootFolderId];
  const queue: Id<"folders">[] = [rootFolderId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = await ctx.db
      .query("folders")
      .withIndex("by_project_and_parent", (q) =>
        q.eq("projectId", projectId).eq("parentFolderId", parentId),
      )
      .collect();
    for (const child of children) {
      if (visited.has(child._id)) continue;
      visited.add(child._id);
      out.push(child._id);
      queue.push(child._id);
    }
  }

  return out;
}

/**
 * Resolves the videos currently in a bundle. For folder bundles this is a
 * live query — new uploads appear automatically. For selection bundles this
 * is the frozen list, filtering out soft-deleted rows.
 */
export async function resolveBundleVideos(
  ctx: ReadCtx,
  bundle: Doc<"shareBundles">,
): Promise<Doc<"videos">[]> {
  if (bundle.kind === "folder") {
    if (!bundle.folderId) return [];
    // Resolve the folder AND every descendant subfolder (BFS), then collect
    // videos across all of them. A shared folder is expected to behave like the
    // real folder: nested subfolders and their files come along. Without this,
    // a folder whose assets live in subfolders resolves to zero items — which
    // also broke share-page downloads (no itemVideoId → "Video not found").
    const folderIds = await collectFolderSubtree(
      ctx,
      bundle.projectId,
      bundle.folderId,
    );
    const collected: Doc<"videos">[] = [];
    for (const folderId of folderIds) {
      const inFolder = await ctx.db
        .query("videos")
        .withIndex("by_folder", (q) => q.eq("folderId", folderId))
        .collect();
      collected.push(...inFolder);
    }
    return collected.filter(
      (v) => !v.deletedAt && v.isCurrentVersion !== false,
    );
  }

  if (bundle.kind === "project") {
    // Whole-project bundle — every non-deleted current-version video
    // in the project, across every folder.
    const all = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", bundle.projectId))
      .collect();
    return all.filter((v) => !v.deletedAt && v.isCurrentVersion !== false);
  }

  // selection
  if (!bundle.videoIds || bundle.videoIds.length === 0) return [];
  const fetched = await Promise.all(bundle.videoIds.map((id) => ctx.db.get(id)));
  return fetched.filter((v): v is Doc<"videos"> => Boolean(v && !v.deletedAt));
}

export const createForFolder = mutation({
  args: {
    folderId: v.id("folders"),
    name: v.optional(v.string()),
  },
  returns: v.id("shareBundles"),
  handler: async (ctx, args): Promise<Id<"shareBundles">> => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) throw new Error("Folder not found");
    const { user } = await requireProjectAccess(ctx, folder.projectId, "member");

    return await ctx.db.insert("shareBundles", {
      projectId: folder.projectId,
      name: args.name?.trim() || folder.name,
      kind: "folder",
      folderId: args.folderId,
      videoIds: undefined,
      createdByClerkId: user.subject,
      createdByName: identityName(user),
    });
  },
});

/**
 * Whole-project share bundle. One bundle per share — each fresh share
 * gets its own row so we can revoke independently. The bundle stays
 * "live": new uploads to the project show up on the share page
 * automatically (same semantics as folder bundles).
 */
export const createForProject = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
  },
  returns: v.id("shareBundles"),
  handler: async (ctx, args): Promise<Id<"shareBundles">> => {
    const { user, project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    return await ctx.db.insert("shareBundles", {
      projectId: args.projectId,
      name: args.name?.trim() || project.name,
      kind: "project",
      folderId: undefined,
      videoIds: undefined,
      createdByClerkId: user.subject,
      createdByName: identityName(user),
    });
  },
});

export const createForSelection = mutation({
  args: {
    videoIds: v.array(v.id("videos")),
    name: v.string(),
  },
  returns: v.id("shareBundles"),
  handler: async (ctx, args): Promise<Id<"shareBundles">> => {
    if (args.videoIds.length === 0) {
      throw new Error("Selection bundle must contain at least one item.");
    }
    if (args.videoIds.length > 200) {
      throw new Error("Selection bundle is capped at 200 items.");
    }

    // Verify access to every video and that they all share a project (no
    // cross-project bundles — keeps team-permission semantics simple).
    let sharedProjectId: Id<"projects"> | null = null;
    for (const id of args.videoIds) {
      const { user, project } = await requireVideoAccess(ctx, id, "member");
      void user;
      if (!sharedProjectId) sharedProjectId = project._id;
      else if (sharedProjectId !== project._id) {
        throw new Error("All bundle items must belong to the same project.");
      }
    }
    if (!sharedProjectId) throw new Error("Could not resolve project for bundle.");

    const identity = (await ctx.auth.getUserIdentity())!;

    return await ctx.db.insert("shareBundles", {
      projectId: sharedProjectId,
      name: args.name.trim() || `Bundle (${args.videoIds.length} items)`,
      kind: "selection",
      folderId: undefined,
      videoIds: args.videoIds,
      createdByClerkId: identity.subject,
      createdByName: identityName(identity),
    });
  },
});

export const get = query({
  args: { bundleId: v.id("shareBundles") },
  handler: async (ctx, args) => {
    const { bundle } = await requireBundleAccess(ctx, args.bundleId);
    return bundle;
  },
});

/** Public-facing bundle resolver for the share page. Returns the bundle
 * metadata plus a thin per-item view (no playback URLs — those come from
 * `videoActions.getSharedPaywalledPlayback` keyed on grantToken + itemId).
 */
export const getForShare = query({
  args: { bundleId: v.id("shareBundles") },
  handler: async (ctx, args) => {
    const bundle = await ctx.db.get(args.bundleId);
    if (!bundle) return null;
    const videos = await resolveBundleVideos(ctx, bundle);
    return {
      bundle: {
        _id: bundle._id,
        name: bundle.name,
        kind: bundle.kind,
        folderId: bundle.folderId ?? null,
      },
      items: videos
        .filter((video) => video.status === "ready")
        .map((video) => ({
          _id: video._id,
          title: video.title,
          contentType: video.contentType ?? null,
          duration: video.duration ?? null,
          thumbnailUrl: video.thumbnailUrl ?? null,
          muxPlaybackId: video.muxPlaybackId ?? null,
        })),
    };
  },
});
