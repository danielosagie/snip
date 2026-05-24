import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { Id, Doc } from "./_generated/dataModel";
import { requireProjectAccess, requireTeamAccess } from "./auth";

/**
 * Timeline-snapshot CRUD — V8 isolate side. The HTTP endpoint in
 * convex/http.ts that the Resolve plugin POSTs to is a separate concern
 * (it bridges from anonymous-but-token-authed plugin calls into these
 * internal mutations).
 *
 * Snapshots are immutable once created. To "edit" a snapshot the user
 * pushes a new one with the same branch + parentSnapshotId. This mirrors
 * Git's append-only commit log and means restoring is just "load this
 * snapshot's FCPXML back into Resolve."
 */

const sourceValidator = v.union(
  v.literal("resolve"),
  v.literal("premiere"),
  v.literal("manual"),
);

export const list = query({
  args: {
    projectId: v.id("projects"),
    branch: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    let q;
    if (args.branch) {
      const branch = args.branch;
      q = ctx.db
        .query("timelineSnapshots")
        .withIndex("by_project_branch", (idx) =>
          idx.eq("projectId", args.projectId).eq("branch", branch),
        );
    } else {
      q = ctx.db
        .query("timelineSnapshots")
        .withIndex("by_project", (idx) => idx.eq("projectId", args.projectId));
    }
    const rows = await q.order("desc").take(args.limit ?? 50);
    return rows.map((row) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      branch: row.branch,
      message: row.message,
      parentSnapshotId: row.parentSnapshotId ?? null,
      versionId: row.versionId ?? null,
      source: row.source,
      createdByName: row.createdByName,
      sizeBytes: row.sizeBytes ?? null,
      sourceProjectId: row.sourceProjectId ?? null,
      sourceTimelineId: row.sourceTimelineId ?? null,
    }));
  },
});

export const get = query({
  args: { snapshotId: v.id("timelineSnapshots") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.snapshotId);
    if (!row) return null;
    await requireProjectAccess(ctx, row.projectId);
    return {
      _id: row._id,
      _creationTime: row._creationTime,
      projectId: row.projectId,
      teamId: row.teamId,
      versionId: row.versionId ?? null,
      branch: row.branch,
      parentSnapshotId: row.parentSnapshotId ?? null,
      message: row.message,
      source: row.source,
      sourceProjectId: row.sourceProjectId ?? null,
      sourceTimelineId: row.sourceTimelineId ?? null,
      createdByName: row.createdByName,
      // Full payloads — separate from `list` to keep that query cheap.
      cuts: row.cuts,
      color: row.color,
      audio: row.audio,
      effects: row.effects,
      markers: row.markers,
      metadata: row.metadata,
      fcpxml: row.fcpxml ?? null,
    };
  },
});

/** Branches present on a project. Derived from snapshot rows. */
export const listBranches = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectAccess(ctx, args.projectId);
    const all = await ctx.db
      .query("timelineSnapshots")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const byBranch = new Map<
      string,
      { branch: string; tipId: Id<"timelineSnapshots">; tipAt: number; count: number }
    >();
    for (const row of all) {
      const cur = byBranch.get(row.branch);
      if (!cur || row._creationTime > cur.tipAt) {
        byBranch.set(row.branch, {
          branch: row.branch,
          tipId: row._id,
          tipAt: row._creationTime,
          count: (cur?.count ?? 0) + 1,
        });
      } else {
        cur.count += 1;
      }
    }
    return Array.from(byBranch.values()).sort((a, b) => b.tipAt - a.tipAt);
  },
});

/** Looks up a team by its pluginToken. Used by the HTTP endpoint. */
export const findTeamByPluginToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const team = await ctx.db
      .query("teams")
      .withIndex("by_plugin_token", (q) => q.eq("pluginToken", args.token))
      .unique();
    if (!team) return null;
    return { _id: team._id, name: team.name, slug: team.slug };
  },
});

/**
 * Insert a snapshot. Called from convex/http.ts after the plugin's
 * Authorization header has been verified.
 */
export const recordSnapshot = internalMutation({
  args: {
    teamId: v.id("teams"),
    projectId: v.id("projects"),
    versionId: v.optional(v.id("projectVersions")),
    cuts: v.string(),
    color: v.string(),
    audio: v.string(),
    effects: v.string(),
    markers: v.string(),
    metadata: v.string(),
    fcpxml: v.optional(v.string()),
    branch: v.optional(v.string()),
    parentSnapshotId: v.optional(v.id("timelineSnapshots")),
    message: v.string(),
    sourceProjectId: v.optional(v.string()),
    sourceTimelineId: v.optional(v.string()),
    createdByName: v.string(),
    source: sourceValidator,
  },
  returns: v.id("timelineSnapshots"),
  handler: async (ctx, args): Promise<Id<"timelineSnapshots">> => {
    // Confirm the project belongs to the team — defends against a leaked
    // plugin token pushing to projects on a different team.
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");
    if (project.teamId !== args.teamId) {
      throw new Error("Project does not belong to the authenticating team.");
    }

    // Auto-resolve parentSnapshotId to the current branch tip if the
    // plugin didn't supply one — keeps a single linear branch by default.
    const branch = (args.branch ?? "main").trim() || "main";
    let parent = args.parentSnapshotId;
    if (!parent) {
      const tip = await ctx.db
        .query("timelineSnapshots")
        .withIndex("by_project_branch", (q) =>
          q.eq("projectId", args.projectId).eq("branch", branch),
        )
        .order("desc")
        .first();
      parent = tip?._id;
    }

    const sizeBytes =
      args.cuts.length +
      args.color.length +
      args.audio.length +
      args.effects.length +
      args.markers.length +
      args.metadata.length +
      (args.fcpxml?.length ?? 0);

    return await ctx.db.insert("timelineSnapshots", {
      teamId: args.teamId,
      projectId: args.projectId,
      versionId: args.versionId,
      cuts: args.cuts,
      color: args.color,
      audio: args.audio,
      effects: args.effects,
      markers: args.markers,
      metadata: args.metadata,
      fcpxml: args.fcpxml,
      branch,
      parentSnapshotId: parent,
      message: args.message,
      sourceProjectId: args.sourceProjectId,
      sourceTimelineId: args.sourceTimelineId,
      createdByName: args.createdByName,
      source: args.source,
      sizeBytes,
    });
  },
});

/**
 * Desktop-side full snapshot push. Replaces the (now-deprecated) Resolve
 * plugin's direct HTTP call. The desktop app talks to a running Resolve
 * via DaVinciResolveScript, harvests the FCPXML + parses domains, then
 * POSTs through this Clerk-authed mutation so we never need a separate
 * plugin token.
 */
export const createFromDesktop = mutation({
  args: {
    projectId: v.id("projects"),
    cuts: v.string(),
    color: v.string(),
    audio: v.string(),
    effects: v.string(),
    markers: v.string(),
    metadata: v.string(),
    fcpxml: v.optional(v.string()),
    branch: v.optional(v.string()),
    parentSnapshotId: v.optional(v.id("timelineSnapshots")),
    message: v.string(),
    sourceProjectId: v.optional(v.string()),
    sourceTimelineId: v.optional(v.string()),
    versionId: v.optional(v.id("projectVersions")),
    source: v.optional(sourceValidator),
  },
  returns: v.object({
    _id: v.id("timelineSnapshots"),
    branch: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ _id: Id<"timelineSnapshots">; branch: string }> => {
    const { user, project } = await requireProjectAccess(ctx, args.projectId, "member");
    const branch = (args.branch ?? "main").trim() || "main";

    // Auto-resolve parent to current branch tip when not specified.
    let parent = args.parentSnapshotId;
    if (!parent) {
      const tip = await ctx.db
        .query("timelineSnapshots")
        .withIndex("by_project_branch", (q) =>
          q.eq("projectId", args.projectId).eq("branch", branch),
        )
        .order("desc")
        .first();
      parent = tip?._id;
    }

    const sizeBytes =
      args.cuts.length +
      args.color.length +
      args.audio.length +
      args.effects.length +
      args.markers.length +
      args.metadata.length +
      (args.fcpxml?.length ?? 0);

    const _id = await ctx.db.insert("timelineSnapshots", {
      teamId: project.teamId,
      projectId: args.projectId,
      versionId: args.versionId,
      cuts: args.cuts,
      color: args.color,
      audio: args.audio,
      effects: args.effects,
      markers: args.markers,
      metadata: args.metadata,
      fcpxml: args.fcpxml,
      branch,
      parentSnapshotId: parent,
      message: args.message,
      sourceProjectId: args.sourceProjectId,
      sourceTimelineId: args.sourceTimelineId,
      createdByClerkId: user.subject,
      createdByName:
        (user as { name?: string; email?: string }).name ??
        (user as { email?: string }).email ??
        "Unknown",
      source: args.source ?? "resolve",
      sizeBytes,
    });

    return { _id, branch };
  },
});

/**
 * Web-side mutation (Clerk-authed) used for "Rename branch" / metadata edits
 * + manual snapshots created from the dashboard.
 */
export const createManual = mutation({
  args: {
    projectId: v.id("projects"),
    message: v.string(),
    branch: v.optional(v.string()),
    versionId: v.optional(v.id("projectVersions")),
  },
  handler: async (ctx, args) => {
    const { user, project } = await requireProjectAccess(ctx, args.projectId, "member");
    // Manual snapshots are a "marker" without actual timeline data — useful
    // for tagging "v3 approved" without re-pushing the timeline.
    return await ctx.db.insert("timelineSnapshots", {
      teamId: project.teamId,
      projectId: args.projectId,
      versionId: args.versionId,
      cuts: "{}",
      color: "{}",
      audio: "{}",
      effects: "{}",
      markers: "{}",
      metadata: "{}",
      branch: (args.branch ?? "main").trim() || "main",
      message: args.message,
      createdByClerkId: user.subject,
      createdByName:
        (user as { name?: string; email?: string }).name ??
        (user as { email?: string }).email ??
        "Unknown",
      source: "manual",
      sizeBytes: 0,
    });
  },
});

export const remove = mutation({
  args: { snapshotId: v.id("timelineSnapshots") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.snapshotId);
    if (!row) return;
    await requireProjectAccess(ctx, row.projectId, "admin");
    // Re-parent children to my parent so the history stays connected.
    const children = (
      await ctx.db
        .query("timelineSnapshots")
        .withIndex("by_project_branch", (q) =>
          q.eq("projectId", row.projectId).eq("branch", row.branch),
        )
        .collect()
    ).filter((c) => c.parentSnapshotId === args.snapshotId);
    for (const child of children) {
      await ctx.db.patch(child._id, { parentSnapshotId: row.parentSnapshotId });
    }
    await ctx.db.delete(args.snapshotId);
  },
});

/** Plugin-token management (owner-only, web-side). */
export const generatePluginToken = mutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const { membership } = await requireTeamAccess(ctx, args.teamId);
    if (membership.role !== "owner") {
      throw new Error("Only the team owner can rotate the plugin token.");
    }
    // 48-char URL-safe token. Crypto-random would be better but Convex
    // v8 isolate doesn't expose Web Crypto consistently; this is fine for
    // a shared-secret bearer token.
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let token = "snip_";
    for (let i = 0; i < 48; i++) {
      token += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    await ctx.db.patch(args.teamId, { pluginToken: token });
    return { token };
  },
});

export const getPluginToken = query({
  args: { teamId: v.id("teams") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { membership } = await requireTeamAccess(ctx, args.teamId);
    if (membership.role !== "owner") return null;
    const team = await ctx.db.get(args.teamId);
    return team?.pluginToken ?? null;
  },
});

/** Resolve project ↔ snip project lookup helper. Returns project + team. */
export const findProjectForPlugin = internalQuery({
  args: { projectId: v.id("projects"), teamId: v.id("teams") },
  handler: async (ctx, args): Promise<Doc<"projects"> | null> => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    if (project.teamId !== args.teamId) return null;
    return project;
  },
});
