import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireUser } from "./auth";

/**
 * Account-level (workspace) billing.
 *
 * Pricing model: flat monthly base fee + per-seat overage.
 *   $19 / month base
 *   + $7 / additional seat beyond `includedSeats` (default 3)
 *
 * A "seat" is a distinct collaborator across every team the owner
 * participates in — i.e. `count(distinct teamMembers.userClerkId)`
 * for all teams where the user is owner/admin/member. Computed on
 * read, never stored, so seat counts are always live.
 *
 * Why account-level instead of team-level: users with multiple teams
 * shouldn't pay multiple base fees. The old per-team subscription
 * pattern (`teams.plan` / `teams.stripeSubscriptionId`) is being
 * phased out — those fields stay on the team row for migration only.
 */

// ─── Tiers ──────────────────────────────────────────────────────────────
//
// Two flat tiers. Both unlock the *entire* feature set — the
// difference is only how many seats are included and how much
// storage you get. This matches the user-mental-model of "pay more
// = make space for more collaborators and more footage" rather than
// "pay more = unlock a hidden feature."
//
// Per-seat overage is the same on both so the comparison is trivial.

const GIBIBYTE = 1024 ** 3;

const COMMON_FEATURES = [
  "Unlimited projects",
  "Video review + comments",
  "Folder organization",
  "Contract wizard + .docx export",
  "Signed playback + watermarking",
  "Paywalled deliveries via Stripe Connect",
  "Resolve / Premiere version snapshots",
] as const;

export const TIERS = {
  studio: {
    plan: "studio",
    label: "Studio",
    baseCents: 2500, // $25/mo
    perSeatCents: 500, // $5/seat overage
    includedSeats: 3,
    storageBytes: 100 * GIBIBYTE, // 100 GB
    currency: "usd",
    features: [...COMMON_FEATURES],
  },
  pro: {
    plan: "pro",
    label: "Pro",
    baseCents: 5000, // $50/mo
    perSeatCents: 500, // $5/seat overage
    includedSeats: 8,
    storageBytes: 1024 * GIBIBYTE, // 1 TB
    currency: "usd",
    features: [...COMMON_FEATURES, "Priority support"],
  },
  // Pay-as-you-go tier for enterprise customers. Zero base, everything
  // metered: storage by GB-month, egress by GB, seats by month, and
  // transcription by 1k-minute blocks. Reported to Stripe via the Meter
  // Events API by the daily cron in convex/crons.ts.
  enterprise: {
    plan: "enterprise",
    label: "Enterprise",
    baseCents: 0,
    perSeatCents: 500, // $5 / seat (no included seats)
    includedSeats: 0,
    storageBytes: Number.MAX_SAFE_INTEGER,
    currency: "usd",
    features: [
      ...COMMON_FEATURES,
      "Priority support",
      "Pay-as-you-go billing",
      "Custom SLA available",
      "Volume discount on request",
    ],
    meters: {
      storageGbMonthCents: 5, // $0.05 / GB-month stored
      egressGbCents: 10, // $0.10 / GB downloaded
      perSeatCents: 500, // $5 / seat / month
      transcriptionPer1kMinCents: 100, // $1.00 / 1000 transcribed minutes
    },
  },
} as const;

export const ENTERPRISE_PLAN_KEY = "enterprise" as const;

export type TierKey = keyof typeof TIERS;

const DEFAULT_TIER = TIERS.studio;

// ─── Helpers ─────────────────────────────────────────────────────────────

async function computeSeatCount(
  ctx: { db: any },
  ownerClerkId: string,
): Promise<number> {
  // Find every team the owner belongs to, then collapse the union of
  // distinct collaborators across them. This avoids double-counting
  // someone who's in two of the owner's teams.
  const ownerMemberships = await ctx.db
    .query("teamMembers")
    .withIndex("by_user", (q: any) => q.eq("userClerkId", ownerClerkId))
    .collect();

  const distinctCollaborators = new Set<string>();
  for (const m of ownerMemberships) {
    const teamMembers = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q: any) => q.eq("teamId", m.teamId))
      .collect();
    for (const member of teamMembers) {
      distinctCollaborators.add(member.userClerkId);
    }
  }
  // The owner themselves counts as a seat — they're using a license.
  distinctCollaborators.add(ownerClerkId);
  return distinctCollaborators.size;
}

function monthlyTotalCents(args: {
  baseCents: number;
  perSeatCents: number;
  includedSeats: number;
  seatCount: number;
}): number {
  const overage = Math.max(0, args.seatCount - args.includedSeats);
  return args.baseCents + overage * args.perSeatCents;
}

// ─── Queries ─────────────────────────────────────────────────────────────

/**
 * Returns the current user's workspace subscription (creating an
 * implicit "none" tier object if they've never subscribed) plus the
 * live seat count and monthly total. Safe for unauthenticated callers
 * — returns null so the UI can render a sign-in prompt.
 */
export const getMySubscription = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const ownerClerkId = identity.subject;
    const sub = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", ownerClerkId))
      .unique();

    const seatCount = await computeSeatCount(ctx, ownerClerkId);

    const effective = sub ?? {
      ownerClerkId,
      plan: DEFAULT_TIER.plan,
      status: "none" as const,
      baseCents: DEFAULT_TIER.baseCents,
      perSeatCents: DEFAULT_TIER.perSeatCents,
      includedSeats: DEFAULT_TIER.includedSeats,
      currency: DEFAULT_TIER.currency,
      currentPeriodEnd: undefined,
      stripeCustomerId: undefined,
      stripeSubscriptionId: undefined,
      canceledAt: undefined,
    };

    const monthlyCents = monthlyTotalCents({
      baseCents: effective.baseCents,
      perSeatCents: effective.perSeatCents,
      includedSeats: effective.includedSeats,
      seatCount,
    });

    return {
      ...effective,
      seatCount,
      overageSeats: Math.max(0, seatCount - effective.includedSeats),
      monthlyCents,
    };
  },
});

/**
 * Public tier listing — Studio, Pro, Enterprise. Marketing pages and
 * the billing tier picker call this; it never needs auth so unsigned-
 * in pricing pages render with the same shape signed-in users see.
 * `meters` is set for pay-as-you-go (enterprise) tiers and absent for
 * flat-rate tiers.
 */
export const listTiers = query({
  args: {},
  returns: v.array(
    v.object({
      plan: v.string(),
      label: v.string(),
      baseCents: v.number(),
      perSeatCents: v.number(),
      includedSeats: v.number(),
      storageBytes: v.number(),
      currency: v.string(),
      features: v.array(v.string()),
      meters: v.optional(
        v.object({
          storageGbMonthCents: v.number(),
          egressGbCents: v.number(),
          perSeatCents: v.number(),
          transcriptionPer1kMinCents: v.number(),
        }),
      ),
    }),
  ),
  handler: async () =>
    Object.values(TIERS).map((t) => ({
      plan: t.plan,
      label: t.label,
      baseCents: t.baseCents,
      perSeatCents: t.perSeatCents,
      includedSeats: t.includedSeats,
      storageBytes: t.storageBytes,
      currency: t.currency,
      features: [...t.features],
      meters: (t as { meters?: typeof TIERS.enterprise.meters }).meters,
    })),
});

/** Single-tier fetch by key. */
export const getTier = query({
  args: { plan: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const key = (args.plan ?? "studio") as TierKey;
    const tier = TIERS[key] ?? DEFAULT_TIER;
    return {
      plan: tier.plan,
      label: tier.label,
      baseCents: tier.baseCents,
      perSeatCents: tier.perSeatCents,
      includedSeats: tier.includedSeats,
      storageBytes: tier.storageBytes,
      currency: tier.currency,
      features: [...tier.features],
    };
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────

/**
 * Mutation called by the workspaceBillingActions checkout flow right
 * before redirecting the user to Stripe. Plants a "trialing" row with
 * the Stripe customer id so the UI shows pending status immediately;
 * the webhook fills in the real subscription details later.
 */
export const recordPendingCheckout = mutation({
  args: {
    plan: v.string(),
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tier = TIERS[(args.plan ?? "studio") as TierKey] ?? DEFAULT_TIER;
    const existing = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", user.subject))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "trialing",
        plan: tier.plan,
        baseCents: tier.baseCents,
        perSeatCents: tier.perSeatCents,
        includedSeats: tier.includedSeats,
        currency: tier.currency,
        stripeCustomerId: args.stripeCustomerId ?? existing.stripeCustomerId,
      });
      return;
    }
    await ctx.db.insert("workspaceSubscriptions", {
      ownerClerkId: user.subject,
      plan: tier.plan,
      status: "trialing",
      baseCents: tier.baseCents,
      perSeatCents: tier.perSeatCents,
      includedSeats: tier.includedSeats,
      currency: tier.currency,
      stripeCustomerId: args.stripeCustomerId,
    });
  },
});

/**
 * Webhook-driven sync for workspace subscriptions. Called from
 * convex/http.ts when Stripe fires customer.subscription.{created,updated,
 * deleted}. The createCheckout action stamps `ownerClerkId` and `plan` on
 * the subscription metadata; this mutation reads it back to find the right
 * workspaceSubscriptions row and flips status + period boundary in lockstep
 * with what Stripe believes.
 *
 * If no matching row exists (someone cancelled the checkout halfway and the
 * pending row never landed), we no-op — the user will see no subscription
 * in the dashboard, which is correct.
 */
export const syncWorkspaceSubscriptionFromWebhook = internalMutation({
  args: {
    ownerClerkId: v.string(),
    plan: v.string(),
    status: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tier =
      TIERS[(args.plan ?? "studio") as TierKey] ?? DEFAULT_TIER;
    const mapped = mapStripeStatus(args.status);
    const existing = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", args.ownerClerkId))
      .unique();

    const patch = {
      plan: tier.plan,
      status: mapped,
      baseCents: tier.baseCents,
      perSeatCents: tier.perSeatCents,
      includedSeats: tier.includedSeats,
      currency: tier.currency,
      stripeCustomerId: args.stripeCustomerId ?? existing?.stripeCustomerId,
      stripeSubscriptionId:
        args.stripeSubscriptionId ?? existing?.stripeSubscriptionId,
      currentPeriodEnd: args.currentPeriodEnd ?? existing?.currentPeriodEnd,
      canceledAt:
        mapped === "canceled"
          ? (args.canceledAt ?? Date.now())
          : undefined,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return;
    }
    await ctx.db.insert("workspaceSubscriptions", {
      ownerClerkId: args.ownerClerkId,
      ...patch,
    });
  },
});

function mapStripeStatus(
  status: string,
): "none" | "trialing" | "active" | "past_due" | "canceled" {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "trialing";
  }
}
