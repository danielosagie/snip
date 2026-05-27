import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireUser } from "./auth";
import { getTeamStorageUsedBytes } from "./billingHelpers";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

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
    // Free seats can't be billed, so overage is meaningless here —
    // the cap is enforced as a hard block at invite time instead.
    perSeatCents: 0,
    // Owner + 1 collaborator. "Free gets 1 invitee" so an existing
    // owner can pull in one trusted teammate before having to pay.
    includedSeats: 2,
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

async function computeSeatCount(
  ctx: BillingCtx,
  ownerClerkId: string,
): Promise<number> {
  // Find every team the owner belongs to, then collapse the union of
  // distinct collaborators across them. This avoids double-counting
  // someone who's in two of the owner's teams.
  const ownerMemberships = await ctx.db
    .query("teamMembers")
    .withIndex("by_user", (q) => q.eq("userClerkId", ownerClerkId))
    .collect();

  const distinctCollaborators = new Set<string>();
  for (const m of ownerMemberships) {
    const teamMembers = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", m.teamId))
      .collect();
    for (const member of teamMembers) {
      distinctCollaborators.add(member.userClerkId);
    }
  }
  // The owner themselves counts as a seat — they're using a license.
  distinctCollaborators.add(ownerClerkId);
  return distinctCollaborators.size;
}

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
 * enterprise) have no hard cap — overage is billed at the per-seat
 * rate via `monthlyTotalCents` in `getMySubscription`.
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
  // Paid tiers allow overage seats at $5/mo each.
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

/**
 * Auto-prune seats when a workspace drops to the free tier. Called
 * from the webhook sync and the demo-mode cancel mutation when a
 * paid subscription becomes inactive. Removes the most recently
 * added non-owner members across the owner's owned teams until the
 * total collaborator count fits the free-tier cap.
 *
 * Pending invites also get cleaned — otherwise they'd accept into a
 * over-cap workspace and immediately bounce on the assert. Folder
 * permission rows for kicked members are not touched (cheap to
 * re-grant on re-invite; safer than over-deleting).
 */
async function pruneSeatsToFreeCap(
  ctx: MutationCtx,
  ownerClerkId: string,
): Promise<void> {
  const cap = TIERS.free.includedSeats;

  const ownedTeams = await ctx.db
    .query("teams")
    .withIndex("by_owner", (q) => q.eq("ownerClerkId", ownerClerkId))
    .collect();
  if (ownedTeams.length === 0) return;

  // Cancel every pending invite — none of them are going to fit, and
  // leaving them around just produces "you're at the cap" failures
  // on accept.
  for (const team of ownedTeams) {
    const invites = await ctx.db
      .query("teamInvites")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .collect();
    for (const invite of invites) {
      await ctx.db.delete(invite._id);
    }
  }

  // Collect every non-owner membership row across the owner's owned
  // teams. Then build the set of distinct users we want to keep,
  // oldest-first up to the cap. A user who appears in two of the
  // owner's teams counts as ONE seat — so once they're in the keep
  // set, every row of theirs stays.
  type Membership = {
    _id: Id<"teamMembers">;
    _creationTime: number;
    userClerkId: string;
  };
  const memberships: Membership[] = [];
  for (const team of ownedTeams) {
    const teamMembers = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .collect();
    for (const m of teamMembers) {
      if (m.userClerkId === ownerClerkId) continue;
      memberships.push({
        _id: m._id,
        _creationTime: m._creationTime,
        userClerkId: m.userClerkId,
      });
    }
  }

  // Pick the oldest membership per distinct user. Walk in ascending
  // creation order so the earliest-joined collaborators win the seats.
  memberships.sort((a, b) => a._creationTime - b._creationTime);
  const keepUsers = new Set<string>();
  keepUsers.add(ownerClerkId);
  for (const m of memberships) {
    if (keepUsers.size >= cap) break;
    keepUsers.add(m.userClerkId);
  }

  // Drop every membership row belonging to a user who didn't make
  // the keep-set. Users in the keep-set retain ALL their rows.
  for (const m of memberships) {
    if (!keepUsers.has(m.userClerkId)) {
      await ctx.db.delete(m._id);
    }
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
 *                       hard-cap; they bill overage at perSeatCents.
 *   • `perSeatCents`  — the per-seat overage rate (0 on free since
 *                       overage isn't allowed).
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
    const live =
      sub && (sub.status === "active" || sub.status === "trialing");
    const addOns = (live && sub.addOns) || {};
    return {
      whiteLabel: Boolean(addOns.whiteLabel),
      customDomain: addOns.customDomain ?? null,
      apiTier: Boolean(addOns.apiTier),
      prices: ADD_ON_PRICES_CENTS,
    };
  },
});

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
    const user = await requireUser(ctx);
    const sub = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", user.subject))
      .unique();
    if (!sub) {
      throw new ConvexError({
        code: "no_subscription",
        message: "Subscribe to Basic or Pro before adding optional features.",
      });
    }
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
    const user = await requireUser(ctx);
    const sub = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", user.subject))
      .unique();
    if (!sub) {
      throw new ConvexError({
        code: "no_subscription",
        message: "Subscribe to Basic or Pro before adding optional features.",
      });
    }
    const hostname = args.hostname?.trim() || undefined;
    const next = { ...(sub.addOns ?? {}), customDomain: hostname };
    await ctx.db.patch(sub._id, { addOns: next });
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
 * Demo-mode cancel: flips status to "canceled" and prunes any
 * over-cap collaborators (the workspace is now effectively free
 * tier). Real Stripe cancellations land via the webhook in
 * `syncWorkspaceSubscriptionFromWebhook`, which calls the same
 * prune.
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
    // Workspace is now effectively free tier — trim collaborators
    // back to the free cap so the next invite isn't immediately
    // blocked.
    await pruneSeatsToFreeCap(ctx, user.subject);
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
    cadence: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const key = normalizePlanKey(args.plan);
    if (key === "free") {
      throw new Error("Pick a paid plan to start checkout.");
    }
    const tier = TIERS[key];
    const cadence = args.cadence ?? "monthly";
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
        billingCadence: cadence,
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
      billingCadence: cadence,
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
    } else {
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
    }

    // If the new effective tier is free (sub canceled, status "none",
    // etc.), trim collaborators back to the free cap so the workspace
    // doesn't sit over its limit. Paid → paid transitions don't need
    // pruning since paid tiers allow overage.
    const owner = args.ownerClerkId ?? existing?.ownerClerkId;
    const effectivelyFree =
      statusUnion === "canceled" || statusUnion === "none";
    if (owner && effectivelyFree) {
      await pruneSeatsToFreeCap(ctx, owner);
    }
  },
});
