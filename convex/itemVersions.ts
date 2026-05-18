import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireProjectAccess } from "./auth";

/**
 * Unified versioning — foundation phase.
 *
 * One model for every reviewable item. Today there are two disjoint
 * mechanisms:
 *   - video lineage  (videos.lineageId / isCurrentVersion)  → kind "asset"
 *   - contractVersions snapshots                            → kind "doc"
 *
 * This module is the convergence point. It is wired as a DUAL-WRITE in
 * this phase: the legacy create paths still own their data and all
 * reads/UI stay on the legacy code (so nothing breaks), but every new
 * version is also recorded here via `recordItemVersion`. Once the table
 * has full coverage, later phases flip reads onto `list` and retire the
 * legacy fields/table.
 *
 * `recordItemVersion` is a plain helper (not a Convex mutation) so the
 * existing mutations can dual-write inside their own handlers — Convex
 * mutations can't call other mutations.
 */

export async function recordItemVersion(
  ctx: MutationCtx,
  args: {
    lineageKey: string;
    projectId: Id<"projects">;
    kind: "asset" | "doc";
    versionNumber: number;
    label?: string;
    createdByClerkId: string;
    createdByName: string;
    videoId?: Id<"videos">;
    contentHtml?: string;
    wizardAnswers?: string;
  },
): Promise<Id<"itemVersions">> {
  const siblings = await ctx.db
    .query("itemVersions")
    .withIndex("by_lineage", (q) => q.eq("lineageKey", args.lineageKey))
    .collect();
  for (const s of siblings) {
    if (s.isCurrent) await ctx.db.patch(s._id, { isCurrent: false });
  }
  return await ctx.db.insert("itemVersions", {
    lineageKey: args.lineageKey,
    projectId: args.projectId,
    kind: args.kind,
    versionNumber: args.versionNumber,
    isCurrent: true,
    label: args.label,
    createdByClerkId: args.createdByClerkId,
    createdByName: args.createdByName,
    videoId: args.videoId,
    contentHtml: args.contentHtml,
    wizardAnswers: args.wizardAnswers,
  });
}

/** Every version of one logical item, newest first. */
export const list = query({
  args: { projectId: v.id("projects"), lineageKey: v.string() },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const rows = await ctx.db
      .query("itemVersions")
      .withIndex("by_lineage", (q) => q.eq("lineageKey", args.lineageKey))
      .collect();
    return rows
      .filter((r) => r.projectId === args.projectId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  },
});

/**
 * Make a version the current one. For "asset" it also syncs the
 * still-authoritative `videos` lineage; for "doc" it restores the
 * snapshot into the live contract (mirrors contractVersions.restore,
 * clearing signed/sent stamps).
 */
export const setCurrent = mutation({
  args: { versionId: v.id("itemVersions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.versionId);
    if (!row) throw new Error("Version not found.");
    const { project } = await requireProjectAccess(
      ctx,
      row.projectId,
      "member",
    );

    const siblings = await ctx.db
      .query("itemVersions")
      .withIndex("by_lineage", (q) => q.eq("lineageKey", row.lineageKey))
      .collect();
    for (const s of siblings) {
      const shouldBe = s._id === row._id;
      if (s.isCurrent !== shouldBe) {
        await ctx.db.patch(s._id, { isCurrent: shouldBe });
      }
    }

    if (row.kind === "asset" && row.videoId) {
      const target = await ctx.db.get(row.videoId);
      if (target) {
        const lineageId = target.lineageId ?? target._id;
        const vids = await ctx.db
          .query("videos")
          .withIndex("by_lineage", (q) => q.eq("lineageId", lineageId))
          .collect();
        for (const vrow of vids) {
          const shouldBe = vrow._id === row.videoId;
          if (vrow.isCurrentVersion !== shouldBe) {
            await ctx.db.patch(vrow._id, { isCurrentVersion: shouldBe });
          }
        }
      }
    }

    if (row.kind === "doc") {
      if (!project.contract) {
        throw new Error("Project has no contract to restore into.");
      }
      await ctx.db.patch(row.projectId, {
        contract: {
          ...project.contract,
          contentHtml: row.contentHtml ?? project.contract.contentHtml,
          wizardAnswers:
            row.wizardAnswers ?? project.contract.wizardAnswers,
          sentForSignatureAt: undefined,
          signedAt: undefined,
          signedByName: undefined,
          lastSavedAt: Date.now(),
        },
      });
    }
  },
});
