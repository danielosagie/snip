import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { identityName, requireProjectAccess } from "./auth";
import { Id, Doc } from "./_generated/dataModel";
import { removeSearchable } from "./search";

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

/** Remove a folder tree but keep its files recoverable in Recently deleted. */
export async function trashFolderTree(
  ctx: MutationCtx,
  folder: Doc<"folders">,
  deletedByName: string,
): Promise<{ folderCount: number; fileCount: number }> {
  const [projectFolders, projectVideos] = await Promise.all([
    ctx.db
      .query("folders")
      .withIndex("by_project", (q) => q.eq("projectId", folder.projectId))
      .collect(),
    ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", folder.projectId))
      .collect(),
  ]);

  const folderIds = new Set<string>([folder._id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of projectFolders) {
      if (
        candidate.parentFolderId &&
        folderIds.has(candidate.parentFolderId) &&
        !folderIds.has(candidate._id)
      ) {
        folderIds.add(candidate._id);
        changed = true;
      }
    }
  }

  const now = Date.now();
  const containedVideos = projectVideos.filter(
    (video) => video.folderId && folderIds.has(video.folderId),
  );
  for (const video of containedVideos) {
    await ctx.db.patch(video._id, {
      folderId: undefined,
      deletedAt: video.deletedAt ?? now,
      deletedByName: video.deletedByName ?? deletedByName,
      driveModifiedAt: now,
      driveVersion: (video.driveVersion ?? 0) + 1,
    });
  }

  const foldersToDelete = projectFolders.filter((candidate) =>
    folderIds.has(candidate._id),
  );
  for (const candidate of foldersToDelete) {
    await ctx.db.delete(candidate._id);
  }

  return {
    folderCount: foldersToDelete.length,
    fileCount: containedVideos.filter((video) => !video.deletedAt).length,
  };
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
        const visibleLineages = new Set(
          videos
            .filter((video) => !video.deletedAt)
            .map((video) => String(video.lineageId ?? video._id)),
        );
        return {
          _id: folder._id,
          _creationTime: folder._creationTime,
          name: folder.name,
          parentFolderId: folder.parentFolderId ?? null,
          createdByName: folder.createdByName,
          itemCount: subFolders.length + visibleLineages.size,
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

    const now = Date.now();
    return await ctx.db.insert("folders", {
      projectId: args.projectId,
      parentFolderId: args.parentFolderId,
      name,
      createdByClerkId: user.subject,
      createdByName:
        (user as { name?: string; email?: string }).name ??
        (user as { email?: string }).email ??
        "Unknown",
      driveModifiedAt: now,
      driveVersion: 1,
    });
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
    await ctx.db.patch(folder._id, {
      name,
      driveModifiedAt: Date.now(),
      driveVersion: (folder.driveVersion ?? 0) + 1,
    });
  },
});

export const remove = mutation({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) return;
    const { user } = await requireProjectAccess(ctx, folder.projectId, "admin");
    const deletedByName =
      (user as { name?: string; email?: string }).name ??
      (user as { email?: string }).email ??
      "Unknown";
    return await trashFolderTree(ctx, folder, deletedByName);
  },
});

/** Atomic bulk trash for the project selection toolbar. */
export const removeSelection = mutation({
  args: {
    projectId: v.id("projects"),
    videoIds: v.array(v.id("videos")),
    folderIds: v.array(v.id("folders")),
    contractIds: v.optional(v.array(v.id("contracts"))),
    removeLegacyContract: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "admin",
    );
    const deletedByName =
      (user as { name?: string; email?: string }).name ??
      (user as { email?: string }).email ??
      "Unknown";
    const now = Date.now();
    const contractIds = args.contractIds ?? [];

    // Validate every document before the first write so a pending signing
    // request cannot leave a mixed selection half-deleted.
    const selectedContracts = await Promise.all(
      contractIds.map((contractId) => ctx.db.get(contractId)),
    );
    for (const contract of selectedContracts) {
      if (!contract || contract.projectId !== args.projectId) {
        throw new Error("One of the selected documents is no longer available.");
      }
      if (contract.status === "pending") {
        throw new Error(
          `Void “${contract.title}” before deleting it because its signing links are still active.`,
        );
      }
    }
    if (args.removeLegacyContract && project.contract) {
      await ctx.db.insert("trashedContracts", {
        projectId: args.projectId,
        teamId: project.teamId,
        projectName: project.name,
        contract: project.contract,
        deletedAt: now,
        deletedByClerkId: user.subject,
        deletedByName: identityName(user),
      });
      await ctx.db.patch(args.projectId, { contract: undefined });
      await removeSearchable(ctx, "document", args.projectId).catch(() => {});
    }

    for (const videoId of args.videoIds) {
      const video = await ctx.db.get(videoId);
      if (!video || video.projectId !== args.projectId) {
        throw new Error("One of the selected files is no longer available.");
      }
      if (!video.deletedAt) {
        await ctx.db.patch(videoId, {
          deletedAt: now,
          deletedByName,
          driveModifiedAt: now,
          driveVersion: (video.driveVersion ?? 0) + 1,
        });
      }
    }

    let removedFolders = 0;
    let containedFiles = 0;
    const selectedFolders = await Promise.all(
      args.folderIds.map((folderId) => ctx.db.get(folderId)),
    );
    for (const folder of selectedFolders) {
      if (!folder) continue;
      if (folder.projectId !== args.projectId) {
        throw new Error("One of the selected folders is no longer available.");
      }
      const result = await trashFolderTree(ctx, folder, deletedByName);
      removedFolders += result.folderCount;
      containedFiles += result.fileCount;
    }
    for (const contract of selectedContracts) {
      if (contract && !contract.deletedAt) {
        await ctx.db.patch(contract._id, { deletedAt: now, deletedByName });
      }
    }

    return {
      fileCount: args.videoIds.length + containedFiles,
      folderCount: removedFolders,
      documentCount: selectedContracts.length,
      legacyContractCount: args.removeLegacyContract && project.contract ? 1 : 0,
    };
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
    await ctx.db.patch(args.videoId, {
      folderId: args.folderId,
      driveModifiedAt: Date.now(),
      driveVersion: (video.driveVersion ?? 0) + 1,
    });
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

    await ctx.db.patch(folder._id, {
      parentFolderId: args.parentFolderId,
      driveModifiedAt: Date.now(),
      driveVersion: (folder.driveVersion ?? 0) + 1,
    });
  },
});
