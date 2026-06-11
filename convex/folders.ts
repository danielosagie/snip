import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProjectAccess } from "./auth";
import { Id, Doc } from "./_generated/dataModel";

/**
 * Folders inside a project. Two surfaces:
 *
 *   - `list({ projectId, parentFolderId? })` — children of a folder (or
 *     of the project root when parentFolderId is omitted).
 *   - `breadcrumbs({ folderId })` — walks the parent chain up to root so
 *     the toolbar can render "Project / Drafts / v3".
 *
 * Naming is case-insensitive-unique within a parent so users can't make
 * two "Drafts" folders side-by-side and confuse themselves.
 */

function sanitizeName(input: string): string {
  const cleaned = input.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!cleaned) throw new Error("Folder name can't be empty.");
  // Filesystem-friendly subset, keeping spaces. Backslash, colon, *, ?, ", <,
  // >, | are common no-go characters in Windows / macOS filesystems.
  if (/[\\/:*?"<>|]/.test(cleaned)) {
    throw new Error('Folder names can\'t contain \\ / : * ? " < > |');
  }
  return cleaned;
}

export const list = query({
  args: {
    projectId: v.id("projects"),
    parentFolderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const rows = await ctx.db
      .query("folders")
      .withIndex("by_project_and_parent", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("parentFolderId", args.parentFolderId),
      )
      .collect();

    // Annotate each folder with how many direct children (folders + videos)
    // it contains, so the tile can show "12 items" without a follow-up
    // round-trip.
    return await Promise.all(
      rows.map(async (folder) => {
        const subFolders = await ctx.db
          .query("folders")
          .withIndex("by_project_and_parent", (q) =>
            q.eq("projectId", args.projectId).eq("parentFolderId", folder._id),
          )
          .collect();
        const videos = await ctx.db
          .query("videos")
          .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
          .collect();
        return {
          _id: folder._id,
          _creationTime: folder._creationTime,
          name: folder.name,
          parentFolderId: folder.parentFolderId ?? null,
          createdByName: folder.createdByName,
          itemCount: subFolders.length + videos.length,
        };
      }),
    );
  },
});

export const breadcrumbs = query({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args): Promise<Array<{ _id: Id<"folders">; name: string }>> => {
    const chain: Array<{ _id: Id<"folders">; name: string }> = [];
    let cursor: Id<"folders"> | undefined = args.folderId;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) break; // defensive cycle guard
      seen.add(cursor);
      const row: Doc<"folders"> | null = await ctx.db.get(cursor);
      if (!row) break;
      await requireProjectAccess(ctx, row.projectId);
      chain.unshift({ _id: row._id, name: row.name });
      cursor = row.parentFolderId ?? undefined;
    }
    return chain;
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    parentFolderId: v.optional(v.id("folders")),
  },
  returns: v.id("folders"),
  handler: async (ctx, args): Promise<Id<"folders">> => {
    const { user } = await requireProjectAccess(ctx, args.projectId, "member");
    const name = sanitizeName(args.name);

    // Reject duplicate names under the same parent (case-insensitive).
    const siblings = await ctx.db
      .query("folders")
      .withIndex("by_project_and_parent", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("parentFolderId", args.parentFolderId),
      )
      .collect();
    const lower = name.toLowerCase();
    if (siblings.some((s) => s.name.toLowerCase() === lower)) {
      throw new Error(`A folder named "${name}" already exists here.`);
    }

    return await ctx.db.insert("folders", {
      projectId: args.projectId,
      parentFolderId: args.parentFolderId,
      name,
      createdByClerkId: user.subject,
      createdByName:
        (user as { name?: string; email?: string }).name ??
        (user as { email?: string }).email ??
        "Unknown",
    });
  },
});

/**
 * Finder-style "combine into a new folder". Creates a folder at the given
 * level, then moves the supplied videos (and optionally folders) into it in a
 * single atomic handler — so a drop never leaves a half-made folder behind.
 * Reuses the same access checks + cycle guard as moveVideoToFolder/moveFolder.
 * Returns the new folder id so the caller can drop the user into renaming it.
 */
export const createWithItems = mutation({
  args: {
    projectId: v.id("projects"),
    parentFolderId: v.optional(v.id("folders")),
    name: v.string(),
    videoIds: v.array(v.id("videos")),
    folderIds: v.optional(v.array(v.id("folders"))),
  },
  returns: v.id("folders"),
  handler: async (ctx, args): Promise<Id<"folders">> => {
    const { user } = await requireProjectAccess(ctx, args.projectId, "member");
    const name = sanitizeName(args.name);

    // Reject duplicate names under the same parent (case-insensitive) — mirrors
    // create() so the gesture can't smuggle past the uniqueness rule.
    const siblings = await ctx.db
      .query("folders")
      .withIndex("by_project_and_parent", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("parentFolderId", args.parentFolderId),
      )
      .collect();
    const lower = name.toLowerCase();
    if (siblings.some((s) => s.name.toLowerCase() === lower)) {
      throw new Error(`A folder named "${name}" already exists here.`);
    }

    const folderIds = args.folderIds ?? [];
    // Don't let a folder be combined into itself (it would become its own
    // child once we move it into the brand-new folder). The new folder can't
    // yet be a descendant of anything, so a same-project check is enough for
    // the move targets — no deep cycle walk is required here.
    for (const fid of folderIds) {
      const f = await ctx.db.get(fid);
      if (!f || f.projectId !== args.projectId) {
        throw new Error("Folder doesn't belong to this project.");
      }
    }
    for (const vid of args.videoIds) {
      const video = await ctx.db.get(vid);
      if (!video || video.projectId !== args.projectId) {
        throw new Error("File doesn't belong to this project.");
      }
    }

    const newFolderId = await ctx.db.insert("folders", {
      projectId: args.projectId,
      parentFolderId: args.parentFolderId,
      name,
      createdByClerkId: user.subject,
      createdByName:
        (user as { name?: string; email?: string }).name ??
        (user as { email?: string }).email ??
        "Unknown",
    });

    for (const vid of args.videoIds) {
      await ctx.db.patch(vid, { folderId: newFolderId });
    }
    for (const fid of folderIds) {
      if (fid === newFolderId) continue;
      await ctx.db.patch(fid, { parentFolderId: newFolderId });
    }

    return newFolderId;
  },
});

export const rename = mutation({
  args: { folderId: v.id("folders"), name: v.string() },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) throw new Error("Folder not found.");
    await requireProjectAccess(ctx, folder.projectId, "member");
    const name = sanitizeName(args.name);
    if (name.toLowerCase() !== folder.name.toLowerCase()) {
      const siblings = await ctx.db
        .query("folders")
        .withIndex("by_project_and_parent", (q) =>
          q
            .eq("projectId", folder.projectId)
            .eq("parentFolderId", folder.parentFolderId),
        )
        .collect();
      const lower = name.toLowerCase();
      if (siblings.some((s) => s._id !== folder._id && s.name.toLowerCase() === lower)) {
        throw new Error(`A folder named "${name}" already exists here.`);
      }
    }
    await ctx.db.patch(folder._id, { name });
  },
});

export const remove = mutation({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) return;
    await requireProjectAccess(ctx, folder.projectId, "admin");

    // Refuse to delete non-empty folders. Moving contents elsewhere is a
    // separate explicit action — we'd rather throw than silently orphan or
    // delete videos.
    const sub = await ctx.db
      .query("folders")
      .withIndex("by_project_and_parent", (q) =>
        q.eq("projectId", folder.projectId).eq("parentFolderId", folder._id),
      )
      .first();
    const vid = await ctx.db
      .query("videos")
      .withIndex("by_folder", (q) => q.eq("folderId", folder._id))
      .first();
    if (sub || vid) {
      throw new Error(
        "Folder isn't empty. Move or delete its contents first.",
      );
    }
    await ctx.db.delete(folder._id);
  },
});

export const moveVideoToFolder = mutation({
  args: {
    videoId: v.id("videos"),
    folderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) throw new Error("File not found.");
    await requireProjectAccess(ctx, video.projectId, "member");
    if (args.folderId) {
      const target = await ctx.db.get(args.folderId);
      if (!target || target.projectId !== video.projectId) {
        throw new Error("Target folder doesn't belong to this project.");
      }
    }
    await ctx.db.patch(args.videoId, { folderId: args.folderId });
  },
});

/**
 * Move a folder into a different parent (or back to the project root
 * by omitting parentFolderId). Guards: same project, no cycles, no
 * sibling-name collisions.
 */
export const moveFolder = mutation({
  args: {
    folderId: v.id("folders"),
    parentFolderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) throw new Error("Folder not found.");
    await requireProjectAccess(ctx, folder.projectId, "member");

    const nextParent = args.parentFolderId ?? null;
    const currentParent = folder.parentFolderId ?? null;
    if (nextParent === currentParent) return;

    if (args.parentFolderId) {
      if (args.parentFolderId === args.folderId) {
        throw new Error("Can't put a folder inside itself.");
      }
      const target = await ctx.db.get(args.parentFolderId);
      if (!target || target.projectId !== folder.projectId) {
        throw new Error("Target folder doesn't belong to this project.");
      }
      // Walk up the proposed parent's chain. If we run into the
      // folder we're moving, that's a cycle (e.g. moving "A" into
      // its own child "B" would orphan everything else).
      let cursor: Id<"folders"> | undefined = target.parentFolderId;
      const seen = new Set<string>([args.parentFolderId]);
      while (cursor) {
        if (cursor === args.folderId) {
          throw new Error("Can't move a folder into one of its descendants.");
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const next: Doc<"folders"> | null = await ctx.db.get(cursor);
        cursor = next?.parentFolderId ?? undefined;
      }
    }

    // Reject duplicate names within the new parent.
    const siblings = await ctx.db
      .query("folders")
      .withIndex("by_project_and_parent", (q) =>
        q
          .eq("projectId", folder.projectId)
          .eq("parentFolderId", args.parentFolderId),
      )
      .collect();
    const lower = folder.name.toLowerCase();
    if (
      siblings.some(
        (s) => s._id !== folder._id && s.name.toLowerCase() === lower,
      )
    ) {
      throw new Error(`A folder named "${folder.name}" already exists there.`);
    }

    await ctx.db.patch(folder._id, { parentFolderId: args.parentFolderId });
  },
});
