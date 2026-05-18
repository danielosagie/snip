import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProjectAccess } from "./auth";
import { recordItemVersion } from "./itemVersions";

/**
 * Contract version snapshots — point-in-time copies of the contract
 * HTML + wizard answers blob so the user can:
 *
 *   - "Save version" before risky edits.
 *   - Browse what was sent / signed.
 *   - Restore an older draft if the wizard or a co-editor blew
 *     something up.
 *
 * Restore overwrites the live contract's contentHtml + wizardAnswers
 * but keeps signed/sent stamps cleared (we'd refuse to restore over a
 * signed contract anyway).
 */

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const rows = await ctx.db
      .query("contractVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
    return rows;
  },
});

export const snapshot = mutation({
  args: {
    projectId: v.id("projects"),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "member",
    );
    const contract = project.contract;
    if (!contract) {
      throw new Error("No contract to snapshot yet.");
    }

    // Pick the next version number — max + 1, like git tags.
    const latest = await ctx.db
      .query("contractVersions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    const nextVersion = (latest?.versionNumber ?? 0) + 1;

    const name =
      (user as { name?: string; email?: string }).name ??
      (user as { email?: string }).email ??
      "Someone";

    const versionId = await ctx.db.insert("contractVersions", {
      projectId: args.projectId,
      versionNumber: nextVersion,
      label: args.label?.trim() || undefined,
      contentHtml: contract.contentHtml,
      wizardAnswers: contract.wizardAnswers,
      createdByClerkId: user.subject,
      createdByName: name,
    });
    // Dual-write into the unified version model. Best-effort: a failure
    // here must never break snapshotting (contractVersions is still
    // authoritative this phase).
    try {
      await recordItemVersion(ctx, {
        lineageKey: args.projectId,
        projectId: args.projectId,
        kind: "doc",
        versionNumber: nextVersion,
        label: args.label?.trim() || undefined,
        createdByClerkId: user.subject,
        createdByName: name,
        contentHtml: contract.contentHtml,
        wizardAnswers: contract.wizardAnswers,
      });
    } catch (e) {
      console.error("itemVersions dual-write (doc) failed", e);
    }
    return versionId;
  },
});

export const restore = mutation({
  args: { versionId: v.id("contractVersions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.versionId);
    if (!row) throw new Error("Version not found.");
    const { project } = await requireProjectAccess(
      ctx,
      row.projectId,
      "member",
    );
    if (!project.contract) {
      throw new Error("Project has no contract to restore into.");
    }
    if (project.contract.signedAt) {
      throw new Error(
        "Can't restore over a signed contract. Clear & redraft first.",
      );
    }

    await ctx.db.patch(row.projectId, {
      contract: {
        ...project.contract,
        contentHtml: row.contentHtml,
        wizardAnswers: row.wizardAnswers ?? project.contract.wizardAnswers,
        sentForSignatureAt: undefined,
        signedAt: undefined,
        signedByName: undefined,
        lastSavedAt: Date.now(),
      },
    });
  },
});

export const remove = mutation({
  args: { versionId: v.id("contractVersions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.versionId);
    if (!row) return;
    await requireProjectAccess(ctx, row.projectId, "admin");
    await ctx.db.delete(row._id);
  },
});
