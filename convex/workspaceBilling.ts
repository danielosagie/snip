import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireUser } from "./auth";
import {
  getTeamStorageBreakdown,
  resolvePlanFromStripePriceId,
} from "./billingHelpers";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Account-level (workspace) billing.
 *
 * Pricing model: flat monthly fee based on managed storage capacity.
 * Paid tiers include unlimited collaborators. Storage is the cost
 * lever because the desktop drive, browser uploads, and delivery
 * sources all land in Snip-managed object storage.
 *
 * Why account-level instead of team-level: users with multiple teams
 * shouldn't pay multiple base fees. The old per-team subscription
 * pattern (`teams.plan` / `teams.stripeSubscriptionId`) is being
 * phased out — those fields stay on the team row for migration only.
 */

// ─── Tiers ──────────────────────────────────────────────────────────────

const GIBIBYTE = 1024 ** 3;
const LEGACY_STORAGE_BYTES: Partial<Record<TierKey, number>> = {
  basic: 2 * 1024 * GIBIBYTE,
  pro: 5 * 1024 * GIBIBYTE,
};

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
    // Free has a small collaboration cap as an anti-abuse measure.
    perSeatCents: 0,
    // Owner + 1 collaborator. "Free gets 1 invitee" so an existing
    // owner can pull in one trusted teammate before having to pay.
    includedSeats: 2,
    unlimitedSeats: false,
    storageBytes: 25 * GIBIBYTE,
    currency: "usd",
    features: [...COMMON_FEATURES],
  },
  basic: {
    plan: "basic",
    label: "Basic",
    baseCents: 2500,
    perSeatCents: 0,
    includedSeats: 0,
    unlimitedSeats: true,
    storageBytes: 500 * GIBIBYTE,
    currency: "usd",
    features: [...COMMON_FEATURES],
  },
  pro: {
    plan: "pro",
    label: "Pro",
    baseCents: 5000, // $50/mo — must equal the live Stripe price
    perSeatCents: 0,
    includedSeats: 0,
    unlimitedSeats: true,
    storageBytes: 2 * 1024 * GIBIBYTE,
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
    unlimitedSeats: true,
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

// ─── Add-on SKUs ─────────────────────────────────────────────────────────
//
// Each add-on is purchased separately on top of the base subscription.
// Margin is high — each one is mostly billing config + a feature
// toggle, no incremental COGS at customer-realistic volumes.
//
// All available on Basic and Pro. Free tier can't purchase add-ons
// (no Stripe customer to attach them to).
export const ADD_ON_PRICES_CENTS = {
  whiteLabel: 2000, // $20/mo — drop snip branding from share links/email
  customDomain: 1000, // $10/mo — CNAME for paywalled deliveries
  apiTier: 3000, // $30/mo — public API access + bumped rate limits
} as const;

export type AddOnKey = keyof typeof ADD_ON_PRICES_CENTS;

// ─── Annual prepay ───────────────────────────────────────────────────────
//
// Annual customers get 17% off, billed monthly equivalent. The Stripe
// price IDs for the annual versions live in env (paired with monthly):
//   STRIPE_PRICE_BASIC_ANNUAL  → STRIPE_PRICE_BASIC_MONTHLY
//   STRIPE_PRICE_PRO_ANNUAL    → STRIPE_PRICE_PRO_MONTHLY
export const ANNUAL_DISCOUNT_RATIO = 10 / 12; // 17% off when paid yearly

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

type BillingCtx = QueryCtx | MutationCtx;

/**
 * Distinct collaborator count across teams the owner *owns* (not
 * teams they were invited to). This is the right number for the
 * free-tier hard cap and for billing — the owner's plan covers their
 * own teams, but they shouldn't be charged for seats in teams owned
 * by other people.
 *
 * Pending invites count as +1 each because they'll become seats on
 * accept. Without that, a free-tier owner could blast out invites in
 * parallel and bypass the cap.
 */
async function computeOwnedWorkspaceSeats(
  ctx: BillingCtx,
  ownerClerkId: string,
): Promise<{ seats: number; pendingInvites: number }> {
  const ownedTeams = await ctx.db
    .query("teams")
    .withIndex("by_owner", (q) => q.eq("ownerClerkId", ownerClerkId))
    .collect();

  const distinct = new Set<string>();
  distinct.add(ownerClerkId);
  let pendingInvites = 0;
  const now = Date.now();

  for (const team of ownedTeams) {
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .collect();
    for (const m of members) distinct.add(m.userClerkId);

    const invites = await ctx.db
      .query("teamInvites")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .collect();
    for (const i of invites) {
      if (i.expiresAt > now) pendingInvites++;
    }
  }

  return { seats: distinct.size, pendingInvites };
}

/**
 * Resolves the effective tier for the user who owns the given team —
 * `"free"` when no active workspaceSubscriptions row exists, otherwise
 * the row's plan key (normalized for legacy values).
 */
async function getTeamOwnerTier(
  ctx: BillingCtx,
  teamId: Id<"teams">,
): Promise<{ ownerClerkId: string; tierKey: TierKey }> {
  const team = await ctx.db.get(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  const sub = await ctx.db
    .query("workspaceSubscriptions")
    .withIndex("by_owner", (q) => q.eq("ownerClerkId", team.ownerClerkId))
    .unique();
  const isLive = sub?.status === "active" || sub?.status === "trialing";
  const tierKey: TierKey = sub && isLive ? normalizePlanKey(sub.plan) : "free";
  return { ownerClerkId: team.ownerClerkId, tierKey };
}

/**
 * Throws a typed ConvexError if adding a seat to `teamId` would
 * exceed the team owner's plan's hard cap. Paid tiers (basic/pro/
 * enterprise) have no collaborator cap.
 *
 * Use at invite-send time and again at invite-accept time. The
 * accept-time check matters because multiple invites can be sent
 * before any are accepted; only enforcing at send leaves a race.
 */
export async function assertCanAddWorkspaceSeat(
  ctx: BillingCtx,
  teamId: Id<"teams">,
) {
  const { ownerClerkId, tierKey } = await getTeamOwnerTier(ctx, teamId);
  // Paid tiers include unlimited collaborators.
  if (tierKey !== "free") return;

  const { seats, pendingInvites } = await computeOwnedWorkspaceSeats(
    ctx,
    ownerClerkId,
  );
  const tier = TIERS.free;
  const used = seats + pendingInvites;

  if (used >= tier.includedSeats) {
    throw new ConvexError({
      code: "seat_limit_exceeded",
      plan: tierKey,
      seats,
      pendingInvites,
      includedSeats: tier.includedSeats,
      message: `Free workspaces are capped at ${tier.includedSeats} seats. Upgrade in Billing & usage to invite more people.`,
    });
  }
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

    const { seats: seatCount } = await computeOwnedWorkspaceSeats(
      ctx,
      ownerClerkId,
    );

    // Normalize the stored plan key — legacy rows still say "studio".
    // When a sub exists but isn't active/trialing, treat the user as
    // free-tier so quotas (25 GB) kick in rather than the formerly-paid
    // limits.
    const normalizedKey = normalizePlanKey(sub?.plan);
    const isLive = sub?.status === "active" || sub?.status === "trialing";
    const effectiveKey: TierKey = sub && isLive ? normalizedKey : "free";
    const effectiveTier = TIERS[effectiveKey];

    const effective = sub
      ? {
          ...sub,
          plan: effectiveKey,
          // Canonical tier values win over stale row snapshots so old
          // seat-priced subscriptions render the current storage model.
          baseCents: isLive ? effectiveTier.baseCents : 0,
          perSeatCents: isLive ? effectiveTier.perSeatCents : 0,
          includedSeats: effectiveTier.includedSeats,
          storageLimitBytes:
            sub.storageLimitBytes ??
            LEGACY_STORAGE_BYTES[effectiveKey] ??
            effectiveTier.storageBytes,
        }
      : {
          ownerClerkId,
          plan: DEFAULT_TIER.plan,
          status: "none" as const,
          baseCents: DEFAULT_TIER.baseCents,
          perSeatCents: DEFAULT_TIER.perSeatCents,
          includedSeats: DEFAULT_TIER.includedSeats,
          storageLimitBytes: DEFAULT_TIER.storageBytes,
          currency: DEFAULT_TIER.currency,
          // Present so the returned union always carries the field; a
          // workspace with no Stripe subscription has no cadence.
          billingCadence: undefined as "monthly" | "annual" | undefined,
          currentPeriodEnd: undefined,
          stripeCustomerId: undefined,
          stripeSubscriptionId: undefined,
          cancelAtPeriodEnd: false,
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
      overageSeats:
        effective.perSeatCents > 0
          ? Math.max(0, seatCount - effective.includedSeats)
          : 0,
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
      unlimitedSeats: v.boolean(),
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
      unlimitedSeats: t.unlimitedSeats,
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
      unlimitedSeats: tier.unlimitedSeats,
      storageBytes: tier.storageBytes,
      currency: tier.currency,
      features: [...tier.features],
    };
  },
});

/**
 * Seat usage + cap for a specific team, resolved against the team
 * owner's workspace subscription. Drives the invite dialog's "X of Y
 * seats used" indicator and the disable-when-full state.
 *
 *   • `seatsUsed`     — distinct collaborators across the owner's
 *                       owned teams (including the owner themselves).
 *   • `pendingInvites`— active outstanding invites the same owner has
 *                       sent across their teams.
 *   • `includedSeats` — the tier's included seat count.
 *   • `hardCapped`    — true on free tier when seatsUsed + pendingInvites
 *                       has reached includedSeats. Paid tiers never
 *                       hard-cap; collaborators are included.
 *   • `perSeatCents`  — retained for legacy/enterprise metering.
 */
export const getTeamSeatUsage = query({
  args: { teamId: v.id("teams") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    plan: TierKey;
    label: string;
    seatsUsed: number;
    pendingInvites: number;
    includedSeats: number;
    unlimitedSeats: boolean;
    perSeatCents: number;
    hardCapped: boolean;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const team = await ctx.db.get(args.teamId);
    if (!team) return null;
    const { tierKey } = await getTeamOwnerTier(ctx, args.teamId);
    const { seats, pendingInvites } = await computeOwnedWorkspaceSeats(
      ctx,
      team.ownerClerkId,
    );
    const tier = TIERS[tierKey];
    return {
      plan: tierKey,
      label: tier.label,
      seatsUsed: seats,
      pendingInvites,
      includedSeats: tier.includedSeats,
      unlimitedSeats: tier.unlimitedSeats,
      perSeatCents: tier.perSeatCents,
      hardCapped:
        tierKey === "free" && seats + pendingInvites >= tier.includedSeats,
    };
  },
});

/**
 * Internal: resolves the caller's workspace tier. Used by gates that
 * need to check the tier of the signed-in user (e.g. desktop drive
 * access). Returns "free" when no live subscription exists.
 */
export const getCallerTier = internalQuery({
  args: {},
  handler: async (ctx): Promise<TierKey> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return "free";
    const sub = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", identity.subject))
      .unique();
    const live = sub?.status === "active" || sub?.status === "trialing";
    return sub && live ? normalizePlanKey(sub.plan) : "free";
  },
});

const TIER_RANK: Record<TierKey, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  enterprise: 3,
};

/**
 * Internal: the BEST tier across every team the caller is a member of,
 * resolved from each team's *owner's* subscription — not the caller's
 * own. This is the right gate for shared-resource access like the
 * desktop drive: a free-tier user who collaborates in a paid
 * workspace should get the drive for that workspace's files, since
 * the storage scope already grants them those prefixes.
 *
 * Returns "free" when the caller belongs to no paid-owned team.
 */
export const getCallerMaxTier = internalQuery({
  args: {},
  handler: async (ctx): Promise<TierKey> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return "free";

    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userClerkId", identity.subject))
      .collect();

    let best: TierKey = "free";
    // Cache owner→tier so two teams owned by the same person only
    // cost one subscription lookup.
    const tierByOwner = new Map<string, TierKey>();
    for (const m of memberships) {
      const team = await ctx.db.get(m.teamId);
      if (!team?.ownerClerkId) continue;
      let tier = tierByOwner.get(team.ownerClerkId);
      if (tier === undefined) {
        const sub = await ctx.db
          .query("workspaceSubscriptions")
          .withIndex("by_owner", (q) =>
            q.eq("ownerClerkId", team.ownerClerkId),
          )
          .unique();
        const live = sub?.status === "active" || sub?.status === "trialing";
        tier = sub && live ? normalizePlanKey(sub.plan) : "free";
        tierByOwner.set(team.ownerClerkId, tier);
      }
      if (TIER_RANK[tier] > TIER_RANK[best]) best = tier;
    }
    return best;
  },
});

/**
 * Internal: resolves a project's owning workspace tier. Used by the
 * lazy-encode decision in `videoActions.shouldDeferEncoding` — the
 * tier dictates whether we should skip Mux ingest at upload time.
 * Returns "free" when no live subscription exists so the defer rule
 * naturally lands on the cheapest tier.
 */
export const getProjectOwnerTier = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<TierKey> => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return "free";
    const { tierKey } = await getTeamOwnerTier(ctx, project.teamId);
    return tierKey;
  },
});

/**
 * Storage policy for a project's team: effective tier + whether the
 * workspace is drive-first. Used by the upload flow to decide both
 * provider routing (`startEncoding`) and whether to defer encoding
 * (`shouldDeferEncoding`). Drive-first always defers — the cloud ladder
 * only materializes on watch or for paid delivery.
 */
export const getProjectStoragePolicy = internalQuery({
  args: { projectId: v.id("projects") },
  returns: v.object({
    tier: v.union(
      v.literal("free"),
      v.literal("basic"),
      v.literal("pro"),
      v.literal("enterprise"),
    ),
    driveFirst: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ tier: TierKey; driveFirst: boolean }> => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return { tier: "free", driveFirst: false };
    const { tierKey } = await getTeamOwnerTier(ctx, project.teamId);
    const team = await ctx.db.get(project.teamId);
    return { tier: tierKey, driveFirst: team?.driveFirstStorage === true };
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
    hotBytes: number;
    coldBytes: number;
    driveBytes: number;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Resolve the user's effective tier from their workspace
    // subscription. No row / non-live status = free tier (25 GB).
    const sub = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", identity.subject))
      .unique();
    const isLive = sub?.status === "active" || sub?.status === "trialing";
    const key: TierKey =
      sub && isLive ? normalizePlanKey(sub.plan) : "free";
    const tier = TIERS[key];

    // A workspace owner pays for storage in teams they own. Storage in
    // somebody else's workspace belongs to that owner's subscription.
    const ownedTeams = await ctx.db
      .query("teams")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", identity.subject))
      .collect();

    let hotBytes = 0;
    let coldBytes = 0;
    let driveBytes = 0;
    for (const team of ownedTeams) {
      const b = await getTeamStorageBreakdown(ctx, team._id);
      hotBytes += b.hotBytes;
      coldBytes += b.coldBytes;
      driveBytes += b.driveBytes;
    }
    // All Snip-managed object storage counts, including desktop-drive
    // source files. Otherwise the most expensive storage path is free.
    const usedBytes = hotBytes + coldBytes + driveBytes;

    const limitBytes =
      isLive && sub
        ? (sub.storageLimitBytes ??
          LEGACY_STORAGE_BYTES[key] ??
          tier.storageBytes)
        : tier.storageBytes;
    const percent =
      limitBytes > 0
        ? Math.min(100, Math.round((usedBytes / limitBytes) * 100))
        : 0;

    return {
      usedBytes,
      limitBytes,
      plan: key,
      label: tier.label,
      percent,
      hotBytes,
      coldBytes,
      driveBytes,
    };
  },
});

/**
 * Returns the add-ons currently active on the caller's workspace
 * subscription. Drives the UI toggles in Billing & usage and the
 * white-label / API-tier conditional rendering elsewhere in the app.
 */
export const getMyAddOns = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    whiteLabel: boolean;
    customDomain: string | null;
    apiTier: boolean;
    prices: typeof ADD_ON_PRICES_CENTS;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const sub = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", identity.subject))
      .unique();
    // Add-ons only exist on a live PAID subscription. Returning null
    // for free / canceled / no-sub callers means the AddOnsSection UI
    // hides itself (its `if (!addOns) return null` guard) instead of
    // showing toggles that would fail the `no_subscription` mutation.
    const live =
      sub && (sub.status === "active" || sub.status === "trialing");
    if (!live || normalizePlanKey(sub.plan) === "free") return null;
    const addOns = sub.addOns ?? {};
    return {
      whiteLabel: Boolean(addOns.whiteLabel),
      customDomain: addOns.customDomain ?? null,
      apiTier: Boolean(addOns.apiTier),
      prices: ADD_ON_PRICES_CENTS,
    };
  },
});

/**
 * Shared guard for add-on mutations: returns the caller's
 * subscription row only if it's a live, paid plan. Throws the typed
 * `no_subscription` ConvexError otherwise so the client can prompt an
 * upgrade rather than silently enabling a feature without billing.
 */
async function requireLivePaidSubscription(
  ctx: MutationCtx,
  ownerClerkId: string,
) {
  const sub = await ctx.db
    .query("workspaceSubscriptions")
    .withIndex("by_owner", (q) => q.eq("ownerClerkId", ownerClerkId))
    .unique();
  const live =
    sub && (sub.status === "active" || sub.status === "trialing");
  if (!sub || !live || normalizePlanKey(sub.plan) === "free") {
    throw new ConvexError({
      code: "no_subscription",
      message: "Subscribe to Basic or Pro before adding optional features.",
    });
  }
  return sub;
}

// ─── Mutations ───────────────────────────────────────────────────────────

/**
 * Toggle an add-on on the caller's subscription. Requires a live
 * paid subscription — add-ons can't attach to the free tier (no
 * Stripe customer). In demo mode (no Stripe configured), the toggle
 * still flips locally so the UI surfaces the feature behavior.
 *
 * Real billing wiring (Stripe SubscriptionItem add/remove) follows
 * in a separate PR; this mutation is the durable-state half.
 */
export const toggleAddOn = mutation({
  args: {
    addOn: v.union(
      v.literal("whiteLabel"),
      v.literal("apiTier"),
    ),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (process.env.STRIPE_SECRET_KEY?.trim()) {
      throw new Error("Use the billed add-on action for Stripe subscriptions.");
    }
    const user = await requireUser(ctx);
    const sub = await requireLivePaidSubscription(ctx, user.subject);
    const next = { ...(sub.addOns ?? {}), [args.addOn]: args.enabled };
    await ctx.db.patch(sub._id, { addOns: next });
  },
});

/**
 * Sets the custom-domain CNAME for paywalled deliveries. The DNS
 * verification + cert provisioning happens out-of-band; this mutation
 * just records the requested hostname so the share-link renderer can
 * use it.
 */
export const setCustomDomain = mutation({
  args: { hostname: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    if (process.env.STRIPE_SECRET_KEY?.trim()) {
      throw new Error("Use the billed add-on action for Stripe subscriptions.");
    }
    const user = await requireUser(ctx);
    const sub = await requireLivePaidSubscription(ctx, user.subject);
    const hostname = args.hostname?.trim() || undefined;
    const next = { ...(sub.addOns ?? {}), customDomain: hostname };
    await ctx.db.patch(sub._id, { addOns: next });
  },
});

/** Stripe action/webhook reconciliation for one add-on subscription item. */
export const recordAddOnBillingState = internalMutation({
  args: {
    ownerClerkId: v.string(),
    stripeSubscriptionId: v.string(),
    addOn: v.union(
      v.literal("whiteLabel"),
      v.literal("customDomain"),
      v.literal("apiTier"),
    ),
    enabled: v.boolean(),
    stripeSubscriptionItemId: v.optional(v.string()),
    customDomain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", args.ownerClerkId))
      .unique();
    if (!sub || sub.stripeSubscriptionId !== args.stripeSubscriptionId) {
      throw new Error("Workspace subscription changed while the add-on was updating.");
    }
    const addOns = { ...(sub.addOns ?? {}) };
    const itemIds = { ...(sub.stripeAddOnItemIds ?? {}) };
    if (args.addOn === "customDomain") {
      addOns.customDomain = args.enabled ? args.customDomain : undefined;
    } else {
      addOns[args.addOn] = args.enabled;
    }
    itemIds[args.addOn] = args.enabled
      ? args.stripeSubscriptionItemId
      : undefined;
    await ctx.db.patch(sub._id, {
      addOns,
      stripeAddOnItemIds: itemIds,
    });
  },
});

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
        storageLimitBytes: tier.storageBytes,
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
      storageLimitBytes: tier.storageBytes,
      currency: tier.currency,
      currentPeriodEnd: periodEnd,
    });
  },
});

/**
 * Demo-mode cancel: flips status to "canceled". Billing changes never
 * delete or remove collaborators; the free-tier cap is enforced only
 * when somebody tries to add another collaborator.
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
    cancelAtPeriodEnd: v.optional(v.boolean()),
    billingCadence: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
    addOnItems: v.optional(
      v.object({
        whiteLabel: v.optional(v.string()),
        customDomain: v.optional(v.string()),
        customDomainHostname: v.optional(v.string()),
        apiTier: v.optional(v.string()),
      }),
    ),
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

    const tier =
      TIERS[
        normalizePlanKey(
          resolvePlanFromStripePriceId(args.stripePriceId) ??
            args.plan ??
            existing?.plan,
        )
      ];
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
      const addOnItems = args.addOnItems;
      const nextAddOns = addOnItems
        ? {
            ...(existing.addOns ?? {}),
            whiteLabel: Boolean(addOnItems.whiteLabel),
            apiTier: Boolean(addOnItems.apiTier),
            customDomain: addOnItems.customDomain
              ? (addOnItems.customDomainHostname ?? existing.addOns?.customDomain)
              : undefined,
          }
        : existing.addOns;
      await ctx.db.patch(existing._id, {
        status: statusUnion,
        plan: tier.plan,
        baseCents: tier.baseCents,
        perSeatCents: tier.perSeatCents,
        includedSeats: tier.includedSeats,
        storageLimitBytes:
          existing.storageLimitBytes ??
          LEGACY_STORAGE_BYTES[normalizePlanKey(existing.plan)] ??
          tier.storageBytes,
        currency: tier.currency,
        currentPeriodEnd: args.currentPeriodEnd ?? existing.currentPeriodEnd,
        stripeCustomerId: args.stripeCustomerId ?? existing.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
        billingCadence: args.billingCadence ?? existing.billingCadence,
        addOns: nextAddOns,
        stripeAddOnItemIds: addOnItems
          ? {
              whiteLabel: addOnItems.whiteLabel,
              customDomain: addOnItems.customDomain,
              apiTier: addOnItems.apiTier,
            }
          : existing.stripeAddOnItemIds,
        canceledAt:
          statusUnion === "canceled"
            ? (existing.canceledAt ?? Date.now())
            : undefined,
      });
    } else {
      await ctx.db.insert("workspaceSubscriptions", {
        ownerClerkId: args.ownerClerkId as string,
        plan: tier.plan,
        status: statusUnion,
        baseCents: tier.baseCents,
        perSeatCents: tier.perSeatCents,
        includedSeats: tier.includedSeats,
        storageLimitBytes: tier.storageBytes,
        currency: tier.currency,
        currentPeriodEnd: args.currentPeriodEnd,
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
        billingCadence: args.billingCadence,
        addOns: args.addOnItems
          ? {
              whiteLabel: Boolean(args.addOnItems.whiteLabel),
              apiTier: Boolean(args.addOnItems.apiTier),
              customDomain: args.addOnItems.customDomain
                ? args.addOnItems.customDomainHostname
                : undefined,
            }
          : undefined,
        stripeAddOnItemIds: args.addOnItems
          ? {
              whiteLabel: args.addOnItems.whiteLabel,
              customDomain: args.addOnItems.customDomain,
              apiTier: args.addOnItems.apiTier,
            }
          : undefined,
      });
    }
  },
});
