import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  getUser,
  identityName,
  requireTeamAccess,
  requireProjectAccess,
} from "./auth";
import { assertTeamHasActiveSubscription } from "./billingHelpers";
import { indexSearchable, removeSearchable, stripHtml } from "./search";
import { internal } from "./_generated/api";
import { prefEnabled } from "./notifications";

export const create = mutation({
  args: {
    teamId: v.id("teams"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTeamAccess(ctx, args.teamId, "member");
    await assertTeamHasActiveSubscription(ctx, args.teamId);

    return await ctx.db.insert("projects", {
      teamId: args.teamId,
      name: args.name,
      description: args.description,
    });
  },
});

export const list = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await requireTeamAccess(ctx, args.teamId);

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();

    // Get video counts for each project. Soft-deleted projects are
    // filtered out — they're only visible in the trash listing.
    const live = projects.filter((p) => !p.deletedAt);
    const projectsWithCounts = await Promise.all(
      live.map(async (project) => {
        const videos = await ctx.db
          .query("videos")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();
        return {
          ...project,
          videoCount: videos.length,
        };
      })
    );

    return projectsWithCounts;
  },
});

export const listUploadTargets = query({
  args: {
    teamSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    if (!user) return [];

    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", user.subject))
      .collect();

    const uploadableMemberships = memberships.filter(
      (membership) => membership.role !== "viewer",
    );

    const targets = await Promise.all(
      uploadableMemberships.map(async (membership) => {
        const team = await ctx.db.get(membership.teamId);
        if (!team) return [];
        if (args.teamSlug && team.slug !== args.teamSlug) return [];

        const projects = await ctx.db
          .query("projects")
          .withIndex("by_team", (q) => q.eq("teamId", team._id))
          .collect();

        return projects.map((project) => ({
          projectId: project._id,
          projectName: project.name,
          teamId: team._id,
          teamName: team.name,
          teamSlug: team.slug,
          role: membership.role,
        }));
      }),
    );

    return targets
      .flat()
      .sort((a, b) =>
        a.teamName.localeCompare(b.teamName) ||
        a.projectName.localeCompare(b.projectName),
      );
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { project, membership } = await requireProjectAccess(ctx, args.projectId);
    return { ...project, role: membership.role };
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, "member");

    const updates: Partial<{ name: string; description: string }> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;

    await ctx.db.patch(args.projectId, updates);
  },
});

const contractInputValidator = v.object({
  contentHtml: v.string(),
  scope: v.optional(v.string()),
  deliverablesSummary: v.optional(v.string()),
  priceCents: v.optional(v.number()),
  currency: v.optional(v.string()),
  revisionsAllowed: v.optional(v.number()),
  deadline: v.optional(v.string()),
  clientName: v.optional(v.string()),
  clientEmail: v.optional(v.string()),
  originalFilename: v.optional(v.string()),
});

export const upsertContract = mutation({
  args: {
    projectId: v.id("projects"),
    contract: contractInputValidator,
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(ctx, args.projectId, "member");
    const existing = project.contract;
    // A contract edits like any other document. Editing one that was
    // already sent or signed reverts it to a draft — the prior signature
    // no longer matches the text, so it has to go back out for signature.
    // (Signing is demo/local today; production e-sign isn't wired yet.)
    //
    // CRITICAL: preserve the wizard-generated payload (`clauses`,
    // `wizardAnswers`, `projectType`) — these aren't part of the body
    // editor's `contractInputValidator`, so without explicit pass-through
    // every body auto-save would silently drop the outline the user just
    // built with the wizard. Flat fields (scope, priceCents, etc.) still
    // overwrite from input so clearing works as expected.
    await ctx.db.patch(args.projectId, {
      contract: {
        ...args.contract,
        // Wizard-owned state, never sent by the body editor.
        clauses: existing?.clauses,
        wizardAnswers: existing?.wizardAnswers,
        projectType: existing?.projectType,
        // Preserve fields we don't accept on input.
        docxS3Key: existing?.docxS3Key,
        sentForSignatureAt: undefined,
        signedAt: undefined,
        signedByName: undefined,
        lastSavedAt: Date.now(),
      },
    });

    try {
      // contentHtml is the document body; clause bodies are managed by
      // contractClauses mutations and swept in by search.reindexProject.
      await indexSearchable(ctx, {
        kind: "document",
        refId: args.projectId,
        teamId: project.teamId,
        projectId: args.projectId,
        title: `${project.name} — contract`,
        contextLabel: `${project.name} · Contract`,
        text: stripHtml(args.contract.contentHtml),
      });
    } catch (e) {
      console.error("search index (contract upsert) failed", e);
    }
  },
});

export const linkContractDocxFile = mutation({
  args: {
    projectId: v.id("projects"),
    docxS3Key: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(ctx, args.projectId, "member");
    if (!project.contract) throw new Error("No contract drafted.");
    if (project.contract.signedAt) throw new Error("Contract already signed.");
    await ctx.db.patch(args.projectId, {
      contract: { ...project.contract, docxS3Key: args.docxS3Key },
    });
  },
});

export const sendContractForSignature = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(ctx, args.projectId, "member");
    if (!project.contract) throw new Error("No contract drafted yet.");
    if (project.contract.signedAt) throw new Error("Contract already signed.");
    await ctx.db.patch(args.projectId, {
      contract: { ...project.contract, sentForSignatureAt: Date.now() },
    });
  },
});

export const signContractDemo = mutation({
  args: {
    projectId: v.id("projects"),
    signedByName: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccess(ctx, args.projectId, "member");
    if (!project.contract) throw new Error("No contract.");
    if (project.contract.signedAt) throw new Error("Already signed.");
    await ctx.db.patch(args.projectId, {
      contract: {
        ...project.contract,
        signedAt: Date.now(),
        signedByName: args.signedByName,
      },
    });

    // Notify opted-in team members that the contract was signed
    // (best-effort, pref-gated). No-ops without RESEND_API_KEY/APP_URL.
    try {
      const team = await ctx.db.get(project.teamId);
      if (team) {
        const members = await ctx.db
          .query("teamMembers")
          .withIndex("by_team", (q) => q.eq("teamId", project.teamId))
          .collect();
        for (const m of members) {
          if (!m.userEmail) continue;
          if (!(await prefEnabled(ctx, m.userClerkId, "contractSigned")))
            continue;
          await ctx.scheduler.runAfter(
            0,
            internal.email.sendContractSigned,
            {
              to: m.userEmail,
              projectName: project.name,
              signedByName: args.signedByName,
              path: `/dashboard/${team.slug}/${args.projectId}/contract`,
            },
          );
        }
      }
    } catch (e) {
      console.error("contract-signed notification failed", e);
    }
  },
});

/**
 * Soft-delete the contract attached to a project. Snapshots the whole
 * contract blob into `trashedContracts` so the user can restore it from
 * "Recently deleted" later — and only then unsets the field on the
 * project so the project's contract tile flips back to the empty
 * "Draft" state.
 *
 * No-op if the project has no contract attached (avoids creating an
 * empty trashed row).
 */
export const clearContract = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectAccess(
      ctx,
      args.projectId,
      "admin",
    );
    if (!project.contract) return;
    await ctx.db.insert("trashedContracts", {
      projectId: args.projectId,
      teamId: project.teamId,
      projectName: project.name,
      contract: project.contract,
      deletedAt: Date.now(),
      deletedByClerkId: user.subject,
      deletedByName: identityName(user),
    });
    await ctx.db.patch(args.projectId, { contract: undefined });
    try {
      await removeSearchable(ctx, "document", args.projectId);
    } catch (e) {
      console.error("search index (contract clear) failed", e);
    }
  },
});

/**
 * Restore a trashed contract back onto its project. Refuses if the
 * project already has a contract (so accidentally restoring an old
 * snapshot can't silently overwrite an in-progress draft) — the user
 * can clear the current one first.
 */
export const restoreContract = mutation({
  args: { trashedContractId: v.id("trashedContracts") },
  handler: async (ctx, args) => {
    const trashed = await ctx.db.get(args.trashedContractId);
    if (!trashed) throw new Error("Trashed contract not found.");
    const { project } = await requireProjectAccess(
      ctx,
      trashed.projectId,
      "admin",
    );
    if (project.contract) {
      throw new Error(
        "This project already has a contract. Delete it first if you want to restore the older one.",
      );
    }
    await ctx.db.patch(trashed.projectId, {
      contract: trashed.contract,
    });
    await ctx.db.delete(args.trashedContractId);
  },
});

/**
 * Permanently delete a trashed-contract snapshot. The project itself
 * isn't touched.
 */
export const purgeContract = mutation({
  args: { trashedContractId: v.id("trashedContracts") },
  handler: async (ctx, args) => {
    const trashed = await ctx.db.get(args.trashedContractId);
    if (!trashed) return;
    await requireProjectAccess(ctx, trashed.projectId, "admin");
    await ctx.db.delete(args.trashedContractId);
  },
});

/**
 * Lists every trashed contract across the user's teams, sorted by
 * `deletedAt desc`. Used by the Recently deleted page alongside the
 * trashed-projects + trashed-videos feeds.
 */
export const listDeletedContracts = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user) return [];
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", user.subject))
      .collect();
    const all: Array<{
      _id: Id<"trashedContracts">;
      projectId: Id<"projects">;
      projectName: string;
      projectDeleted: boolean;
      teamId: Id<"teams">;
      teamName: string;
      teamSlug: string;
      clientName?: string;
      deletedAt: number;
      deletedByName?: string;
    }> = [];
    for (const m of memberships) {
      const team = await ctx.db.get(m.teamId);
      if (!team) continue;
      const trashed = await ctx.db
        .query("trashedContracts")
        .withIndex("by_team", (q) => q.eq("teamId", m.teamId))
        .collect();
      for (const t of trashed) {
        const project = await ctx.db.get(t.projectId);
        const projectName = project?.name ?? t.projectName;
        all.push({
          _id: t._id,
          projectId: t.projectId,
          projectName,
          projectDeleted: !!project?.deletedAt,
          teamId: team._id,
          teamName: team.name,
          teamSlug: team.slug,
          clientName:
            (t.contract as { clientName?: string } | undefined)?.clientName,
          deletedAt: t.deletedAt,
          deletedByName: t.deletedByName,
        });
      }
    }
    all.sort((a, b) => b.deletedAt - a.deletedAt);
    return all;
  },
});

/**
 * Soft-delete the project — sets `deletedAt` so the project disappears
 * from team listings but the row + all its videos / folders / etc.
 * stay intact for restore. Use `purge` to actually wipe everything.
 */
export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { user } = await requireProjectAccess(ctx, args.projectId, "admin");
    const name =
      (user as { name?: string; email?: string }).name ??
      (user as { email?: string }).email ??
      "Someone";
    await ctx.db.patch(args.projectId, {
      deletedAt: Date.now(),
      deletedByName: name,
    });
  },
});

/**
 * Lift a project out of the trash. Clears the soft-delete markers so
 * it shows up in regular listings again.
 */
export const restore = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, "admin");
    await ctx.db.patch(args.projectId, {
      deletedAt: undefined,
      deletedByName: undefined,
    });
  },
});

/**
 * Hard-delete a project and every video/folder/contract it owns.
 * Only available from the trash UI — regular delete soft-deletes.
 */
export const purge = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId, "admin");
    const project = await ctx.db.get(args.projectId);
    if (!project?.deletedAt) {
      throw new Error("Move the project to the trash first.");
    }

    const videos = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    for (const video of videos) {
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_video", (q) => q.eq("videoId", video._id))
        .collect();
      for (const comment of comments) {
        await ctx.db.delete(comment._id);
      }

      const shareLinks = await ctx.db
        .query("shareLinks")
        .withIndex("by_video", (q) => q.eq("videoId", video._id))
        .collect();
      for (const link of shareLinks) {
        const grants = await ctx.db
          .query("shareAccessGrants")
          .withIndex("by_share_link", (q) => q.eq("shareLinkId", link._id))
          .collect();
        for (const grant of grants) {
          await ctx.db.delete(grant._id);
        }
        await ctx.db.delete(link._id);
      }

      await ctx.db.delete(video._id);
    }

    // Folders + clauses-related rows.
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const f of folders) await ctx.db.delete(f._id);

    // Any contracts that were soft-deleted off this project also go
    // when the project itself gets purged — otherwise we leave orphan
    // trashed-contract rows pointing at a vanished project.
    const trashedContracts = await ctx.db
      .query("trashedContracts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const t of trashedContracts) await ctx.db.delete(t._id);

    await ctx.db.delete(args.projectId);
  },
});

/**
 * Trash listing for the current user — every soft-deleted project
 * across every team they belong to. Sorted by deletedAt desc so the
 * most-recently-trashed appears first.
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
      _id: Id<"projects">;
      name: string;
      teamId: Id<"teams">;
      teamName: string;
      teamSlug: string;
      deletedAt: number;
      deletedByName?: string;
    }> = [];

    for (const m of memberships) {
      const team = await ctx.db.get(m.teamId);
      if (!team) continue;
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_team", (q) => q.eq("teamId", m.teamId))
        .collect();
      for (const p of projects) {
        if (typeof p.deletedAt !== "number") continue;
        all.push({
          _id: p._id,
          name: p.name,
          teamId: team._id,
          teamName: team.name,
          teamSlug: team.slug,
          deletedAt: p.deletedAt,
          deletedByName: p.deletedByName,
        });
      }
    }

    all.sort((a, b) => b.deletedAt - a.deletedAt);
    return all;
  },
});
