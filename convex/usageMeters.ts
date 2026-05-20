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
