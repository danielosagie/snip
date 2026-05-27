import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { requireUser } from "./auth";

/**
 * Per-billing-period usage tally for enterprise pay-as-you-go
 * subscribers. Increments here are write-through to a local
 * `usageMeters` row first; the daily cron in
 * `convex/usageMetersActions.ts` then pushes deltas to Stripe via the
 * Meter Events API.
 *
 * Storage is sampled daily (cheaper than counting every write) and
 * accumulated as GB-month decimals; the rest is event-driven.
 */

const ONE_GIB = 1024 ** 3;
const ONE_MIN_MS = 60_000;

/**
 * Calendar-month period: start of the UTC month, exclusive end at the
 * start of the next UTC month. Cheap to compute, deterministic, and
 * aligns with how Stripe meter events bucket by `timestamp`.
 */
function currentPeriod(now = Date.now()): { start: number; end: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end };
}

async function getOrCreateRow(
  ctx: MutationCtx,
  ownerClerkId: string,
) {
  const period = currentPeriod();
  const existing = await ctx.db
    .query("usageMeters")
    .withIndex("by_owner_period", (q) =>
      q.eq("workspaceOwnerClerkId", ownerClerkId).eq("periodStart", period.start),
    )
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("usageMeters", {
    workspaceOwnerClerkId: ownerClerkId,
    periodStart: period.start,
    periodEnd: period.end,
    storageBytesGbMonths: 0,
    egressBytesGb: 0,
    seatCount: 0,
    transcribedMinutes: 0,
  });
  return await ctx.db.get(id);
}

export const getCurrentPeriod = query({
  args: { ownerClerkId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Caller-scoped read: if no ownerClerkId passed, default to the
    // authenticated user (so the settings page can call without args).
    const ownerClerkId = args.ownerClerkId
      ?? (await ctx.auth.getUserIdentity())?.subject;
    if (!ownerClerkId) return null;
    const period = currentPeriod();
    const row = await ctx.db
      .query("usageMeters")
      .withIndex("by_owner_period", (q) =>
        q.eq("workspaceOwnerClerkId", ownerClerkId).eq("periodStart", period.start),
      )
      .unique();
    return row ?? {
      workspaceOwnerClerkId: ownerClerkId,
      periodStart: period.start,
      periodEnd: period.end,
      storageBytesGbMonths: 0,
      egressBytesGb: 0,
      seatCount: 0,
      transcribedMinutes: 0,
    };
  },
});

export const incrementEgress = mutation({
  args: { bytes: v.number() },
  handler: async (ctx, args) => {
    if (args.bytes <= 0) return;
    const user = await requireUser(ctx);
    const row = await getOrCreateRow(ctx, user.subject);
    if (!row) return;
    await ctx.db.patch(row._id, {
      egressBytesGb: row.egressBytesGb + args.bytes / ONE_GIB,
    });
  },
});

/**
 * Egress increment that doesn't require an authenticated caller —
 * used from public/share-grant download paths where we resolve the
 * workspace owner from the video's team server-side.
 */
export const internalIncrementEgress = internalMutation({
  args: {
    ownerClerkId: v.string(),
    bytes: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.bytes <= 0) return;
    const row = await getOrCreateRow(ctx, args.ownerClerkId);
    if (!row) return;
    await ctx.db.patch(row._id, {
      egressBytesGb: row.egressBytesGb + args.bytes / ONE_GIB,
    });
  },
});

export const incrementTranscribedMinutes = internalMutation({
  args: {
    workspaceOwnerClerkId: v.string(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.durationMs <= 0) return;
    const row = await getOrCreateRow(ctx, args.workspaceOwnerClerkId);
    if (!row) return;
    await ctx.db.patch(row._id, {
      transcribedMinutes: row.transcribedMinutes + args.durationMs / ONE_MIN_MS,
    });
  },
});

/**
 * Bumps the encoded-minutes counter for a workspace. Called from the
 * Mux asset.ready webhook with the source duration in seconds — the
 * single signal Mux gives us for "you got billed for encoding N
 * source-minutes of media." Drives:
 *   • Basic/Pro overage gate via `workspaceBilling.getMyEncodingUsage`
 *   • Enterprise PAYG Stripe meter event (added to the daily cron in
 *     usageMetersActions when the meter id lands in stripeMeterIds).
 */
export const incrementEncodedMinutes = internalMutation({
  args: {
    workspaceOwnerClerkId: v.string(),
    durationSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.durationSeconds <= 0) return;
    const row = await getOrCreateRow(ctx, args.workspaceOwnerClerkId);
    if (!row) return;
    const current = row.encodedMinutes ?? 0;
    await ctx.db.patch(row._id, {
      encodedMinutes: current + args.durationSeconds / 60,
    });
  },
});

/**
 * Daily snapshot: writes the storage delta for the day. Called by the
 * cron in convex/crons.ts via the action wrapper. `bytesNow` is the
 * total bytes stored at the moment of the snapshot; this function
 * converts that into a GB-month increment over the elapsed day.
 */
export const snapshotStorageDelta = internalMutation({
  args: {
    workspaceOwnerClerkId: v.string(),
    bytesNow: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await getOrCreateRow(ctx, args.workspaceOwnerClerkId);
    if (!row) return;
    // GB-month proportional to a single calendar day. The cron runs
    // once per day, so 1/30 of a month is a decent approximation;
    // billing aligns on month boundaries anyway.
    const dayShare = 1 / 30;
    const delta = (args.bytesNow / ONE_GIB) * dayShare;
    await ctx.db.patch(row._id, {
      storageBytesGbMonths: row.storageBytesGbMonths + delta,
    });
  },
});

export const updateSeatCount = internalMutation({
  args: {
    workspaceOwnerClerkId: v.string(),
    seatCount: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await getOrCreateRow(ctx, args.workspaceOwnerClerkId);
    if (!row) return;
    await ctx.db.patch(row._id, { seatCount: args.seatCount });
  },
});

export const markReportedToStripe = internalMutation({
  args: { rowId: v.id("usageMeters") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.rowId, { lastReportedAt: Date.now() });
  },
});

/**
 * Internal helpers used by the daily Stripe cron in
 * `usageMetersActions.ts`. They live here (V8 isolate) instead of the
 * node action file so the cron can run them as queries.
 */
export const listEnterpriseSubscriptions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("workspaceSubscriptions").collect();
    return all
      .filter((s) => s.plan === "enterprise" && s.status === "active")
      .map((s) => ({
        ownerClerkId: s.ownerClerkId,
        stripeCustomerId: s.stripeCustomerId ?? null,
        stripeSubscriptionId: s.stripeSubscriptionId ?? null,
      }));
  },
});

export const getOwnerMeterRow = internalQuery({
  args: { ownerClerkId: v.string() },
  handler: async (ctx, args) => {
    const period = currentPeriod();
    const row = await ctx.db
      .query("usageMeters")
      .withIndex("by_owner_period", (q) =>
        q.eq("workspaceOwnerClerkId", args.ownerClerkId).eq("periodStart", period.start),
      )
      .unique();
    return row;
  },
});

/**
 * Resolve a video → its team's workspace owner Clerk ID. Used by the
 * download/transcript meter wiring so an event on any video lands on
 * the right `workspaceOwnerClerkId` row.
 *
 * Returns null when the video, project, or team is missing — callers
 * should treat that as "skip metering for this event".
 */
export const resolveVideoWorkspaceOwner = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return null;
    const project = await ctx.db.get(video.projectId);
    if (!project) return null;
    const team = await ctx.db.get(project.teamId);
    if (!team) return null;
    return {
      ownerClerkId: team.ownerClerkId,
      teamId: team._id,
      durationSec: video.duration ?? null,
      fileSize: video.fileSize ?? null,
    };
  },
});

/**
 * Sum storage bytes (sum of `videos.fileSize`) for a workspace owner.
 * Used by the daily cron's storage snapshot step. Walks every team the
 * owner belongs to and sums non-deleted video sizes.
 */
export const sumStorageForOwner = internalQuery({
  args: { ownerClerkId: v.string() },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", args.ownerClerkId))
      .collect();
    const teamIds = new Set(memberships.map((m) => m.teamId));
    let totalBytes = 0;
    for (const teamId of teamIds) {
      const team = await ctx.db.get(teamId);
      if (!team || team.ownerClerkId !== args.ownerClerkId) continue;
      // Walk every project on the team, then every non-deleted video.
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_team", (q) => q.eq("teamId", teamId))
        .collect();
      for (const project of projects) {
        if (project.deletedAt) continue;
        const videos = await ctx.db
          .query("videos")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect();
        for (const video of videos) {
          if (video.deletedAt) continue;
          totalBytes += video.fileSize ?? 0;
        }
      }
    }
    return { totalBytes };
  },
});

/**
 * Count distinct collaborators across the owner's teams — same logic
 * `workspaceBilling.computeSeatCount` uses, exposed for the cron.
 */
export const countSeatsForOwner = internalQuery({
  args: { ownerClerkId: v.string() },
  handler: async (ctx, args) => {
    const ownerMemberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", args.ownerClerkId))
      .collect();
    const distinct = new Set<string>();
    distinct.add(args.ownerClerkId);
    for (const m of ownerMemberships) {
      const team = await ctx.db.get(m.teamId);
      if (!team || team.ownerClerkId !== args.ownerClerkId) continue;
      const teamMembers = await ctx.db
        .query("teamMembers")
        .withIndex("by_team", (q) => q.eq("teamId", m.teamId))
        .collect();
      for (const member of teamMembers) {
        distinct.add(member.userClerkId);
      }
    }
    return { seatCount: distinct.size };
  },
});
