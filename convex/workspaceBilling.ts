import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireUser } from "./auth";
import { getTeamStorageUsedBytes } from "./billingHelpers";

/**
 * Account-level (workspace) billing.
 *
 * Pricing model: flat monthly base fee + per-seat overage. All flat
 * tiers unlock the entire feature set; the difference is included
 * seats + storage cap.
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
  free: {
    plan: "free",
    label: "Free",
    baseCents: 0,
    perSeatCents: 0,
    includedSeats: 3,
    storageBytes: 20 * GIBIBYTE, // 20 GB — enough to kick the tires
    currency: "usd",
    features: [...COMMON_FEATURES],
  },
  basic: {
    plan: "basic",
    label: "Basic",
    baseCents: 2000, // $20/mo
    perSeatCents: 500, // $5/seat overage
    includedSeats: 3,
    storageBytes: 2 * 1024 * GIBIBYTE, // 2 TB
    currency: "usd",
    features: [...COMMON_FEATURES],
  },
  pro: {
    plan: "pro",
    label: "Pro",
    baseCents: 5000, // $50/mo
    perSeatCents: 500, // $5/seat overage
    includedSeats: 8,
    storageBytes: 5 * 1024 * GIBIBYTE, // 5 TB
    currency: "usd",
    features: [...COMMON_FEATURES, "Priority support"],
  },
  // Pay-as-you-go tier for enterprise customers. Zero base, everything
  // metered: storage by GB-month, egress by GB, seats by month, and
  // transcription by 1k-minute blocks. Reported to Stripe via the Meter
  // Events API by the daily cron in convex/crons.ts. Hidden from the
  // public pricing page; reach out for access.
  enterprise: {
    plan: "enterprise",
    label: "Enterprise",
    baseCents: 0,
    perSeatCents: 500,
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
      storageGbMonthCents: 5,
      egressGbCents: 10,
      perSeatCents: 500,
      transcriptionPer1kMinCents: 100,
    },
  },
} as const;

export const ENTERPRISE_PLAN_KEY = "enterprise" as const;

export type TierKey = keyof typeof TIERS;

const DEFAULT_TIER = TIERS.free;

// Back-compat: the old TIERS table used the key "studio" for the
// $25/100GB tier. Map any stale "studio" plan values to "basic" so
// existing workspaceSubscriptions rows resolve to the new entry
// paid tier without a hard migration.
function normalizePlanKey(plan: string | undefined | null): TierKey {
  if (plan === "free" || plan === "basic" || plan === "pro" || plan === "enterprise") {
    return plan;
  }
  if (plan === "studio") return "basic";
  return "free";
}

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

    // Normalize the stored plan key — legacy rows still say "studio".
    // When a sub exists but isn't active/trialing, treat the user as
    // free-tier so quotas (20 GB) kick in rather than the formerly-paid
    // limits.
    const normalizedKey = normalizePlanKey(sub?.plan);
    const isLive = sub?.status === "active" || sub?.status === "trialing";
    const effectiveKey: TierKey = sub && isLive ? normalizedKey : "free";
    const effectiveTier = TIERS[effectiveKey];

    const effective = sub
      ? {
          ...sub,
          plan: effectiveKey,
          baseCents: isLive ? sub.baseCents : 0,
          perSeatCents: isLive ? sub.perSeatCents : 0,
          includedSeats: isLive
            ? sub.includedSeats
            : effectiveTier.includedSeats,
        }
      : {
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
    const tier = TIERS[normalizePlanKey(args.plan)];
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

/**
 * Storage usage + limit for the caller's default team. Used by the
 * sidebar progress bar and the Billing & usage page. Returns null for
 * unauthenticated callers / users with no team (the bar hides itself).
 */
export const getMyStorageUsage = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    usedBytes: number;
    limitBytes: number;
    plan: TierKey;
    label: string;
    percent: number;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Resolve the user's effective tier from their workspace
    // subscription. No row / non-live status = free tier (20 GB).
    const sub = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", identity.subject))
      .unique();
    const isLive = sub?.status === "active" || sub?.status === "trialing";
    const key: TierKey =
      sub && isLive ? normalizePlanKey(sub.plan) : "free";
    const tier = TIERS[key];

    // Usage is summed across every team the user belongs to —
    // that's what the user perceives as "their" storage even though
    // the rows live under different team scopes.
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", identity.subject))
      .collect();

    let usedBytes = 0;
    for (const m of memberships) {
      usedBytes += await getTeamStorageUsedBytes(ctx, m.teamId);
    }

    const limitBytes = tier.storageBytes;
    const percent =
      limitBytes > 0
        ? Math.min(100, Math.round((usedBytes / limitBytes) * 100))
        : 0;

    return { usedBytes, limitBytes, plan: key, label: tier.label, percent };
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────

/**
 * Demo-mode activation: flips the user's subscription to "active" on
 * the default tier without going through Stripe. The real
 * Stripe-Checkout path lands in a follow-up; this mirrors the
 * `simulatePayment*` pattern already used elsewhere in demo mode.
 */
export const simulateActivate = mutation({
  args: { plan: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const key = normalizePlanKey(args.plan);
    // Free is just "have no row"; reject the no-op rather than write
    // a $0 active subscription that confuses every downstream check.
    if (key === "free") {
      throw new Error("Pick a paid plan to activate.");
    }
    const tier = TIERS[key];
    const existing = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", user.subject))
      .unique();

    const periodEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        plan: tier.plan,
        baseCents: tier.baseCents,
        perSeatCents: tier.perSeatCents,
        includedSeats: tier.includedSeats,
        currency: tier.currency,
        currentPeriodEnd: periodEnd,
        canceledAt: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("workspaceSubscriptions", {
      ownerClerkId: user.subject,
      plan: tier.plan,
      status: "active",
      baseCents: tier.baseCents,
      perSeatCents: tier.perSeatCents,
      includedSeats: tier.includedSeats,
      currency: tier.currency,
      currentPeriodEnd: periodEnd,
    });
  },
});

/**
 * Demo-mode cancel: flips status to "canceled". Real flow would call
 * Stripe `subscriptions.update({ cancel_at_period_end: true })`.
 */
export const simulateCancel = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", user.subject))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: "canceled",
      canceledAt: Date.now(),
    });
  },
});

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
    const key = normalizePlanKey(args.plan);
    if (key === "free") {
      throw new Error("Pick a paid plan to start checkout.");
    }
    const tier = TIERS[key];
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
 * Webhook entry point: reconciles a workspaceSubscriptions row from a
 * Stripe subscription event. Resolves the owner from
 * `subscription.metadata.ownerClerkId` (set when checkout was created
 * in `workspaceBillingActions.createCheckout`). Returns silently if
 * the metadata is missing — those events belong to the legacy
 * per-team flow, handled by `billing.syncTeamSubscriptionFromWebhook`.
 */
export const syncWorkspaceSubscriptionFromWebhook = internalMutation({
  args: {
    ownerClerkId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.string(),
    stripePriceId: v.optional(v.string()),
    plan: v.optional(v.string()),
    status: v.string(),
    currentPeriodEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Locate the row. Prefer the explicit owner clerk id from metadata;
    // fall back to a lookup by Stripe customer id / subscription id so
    // we still sync if metadata wasn't set on the original sub (e.g.
    // imported from the Stripe dashboard).
    let existing = args.ownerClerkId
      ? await ctx.db
          .query("workspaceSubscriptions")
          .withIndex("by_owner", (q) =>
            q.eq("ownerClerkId", args.ownerClerkId as string),
          )
          .unique()
      : null;

    if (!existing && args.stripeSubscriptionId) {
      existing = await ctx.db
        .query("workspaceSubscriptions")
        .withIndex("by_stripe_subscription", (q) =>
          q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
        )
        .unique();
    }
    if (!existing && args.stripeCustomerId) {
      existing = await ctx.db
        .query("workspaceSubscriptions")
        .withIndex("by_stripe_customer", (q) =>
          q.eq("stripeCustomerId", args.stripeCustomerId),
        )
        .unique();
    }

    // No row + no owner clerk id → can't safely insert (we'd be
    // creating an orphan). Skip; this event almost certainly belongs
    // to the legacy per-team flow.
    if (!existing && !args.ownerClerkId) {
      return;
    }

    const tier = TIERS[normalizePlanKey(args.plan ?? existing?.plan)];
    const statusUnion = (
      ["none", "trialing", "active", "past_due", "canceled"] as const
    ).includes(args.status as never)
      ? (args.status as
          | "none"
          | "trialing"
          | "active"
          | "past_due"
          | "canceled")
      : ("canceled" as const);

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: statusUnion,
        plan: tier.plan,
        baseCents: tier.baseCents,
        perSeatCents: tier.perSeatCents,
        includedSeats: tier.includedSeats,
        currency: tier.currency,
        currentPeriodEnd: args.currentPeriodEnd ?? existing.currentPeriodEnd,
        stripeCustomerId: args.stripeCustomerId ?? existing.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        canceledAt:
          statusUnion === "canceled"
            ? (existing.canceledAt ?? Date.now())
            : undefined,
      });
      return;
    }

    await ctx.db.insert("workspaceSubscriptions", {
      ownerClerkId: args.ownerClerkId as string,
      plan: tier.plan,
      status: statusUnion,
      baseCents: tier.baseCents,
      perSeatCents: tier.perSeatCents,
      includedSeats: tier.includedSeats,
      currency: tier.currency,
      currentPeriodEnd: args.currentPeriodEnd,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
    });
  },
});
