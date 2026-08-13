import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Plan keys. Three tiers post-collapse:
 *   • `free`  — no Stripe subscription required (25 GB)
 *   • `basic` — $25/mo, 500 GB
 *   • `pro`   — $50/mo, 2 TB
 *
 * The canonical tier table lives in `convex/workspaceBilling.ts`
 * (TIERS). The constants below mirror that for callers that still
 * need a plain map. Keep them in sync if you change TIERS.
 */
export type TeamPlan = "free" | "basic" | "pro";

const GIBIBYTE = 1024 ** 3;

const LEGACY_WORKSPACE_STORAGE_LIMIT_BYTES: Partial<Record<TeamPlan, number>> = {
  basic: 2 * 1024 * GIBIBYTE,
  pro: 5 * 1024 * GIBIBYTE,
};

/**
 * The commercial truth for every plan, and the ONLY place these numbers live.
 *
 * They were previously duplicated in src/lib/storagePricing.ts, and the two
 * copies had drifted badly: the pricing page and the in-app planner sold
 * 100 GB / 1 TB / 5 TB at $0 / $49 / $149 while this file enforced
 * 25 GB / 500 GB / 2 TB and reported $0 / $25 / $50. Because this map feeds
 * both the storage bar's denominator and the upload gate, a free workspace
 * was cut off at a quarter of the advertised allowance, and the "Adjust plan"
 * dialog showed both numbers at once. storagePricing.ts now derives from here
 * so the two cannot diverge again.
 */
export const TEAM_PLAN_MONTHLY_PRICE_USD: Record<TeamPlan, number> = {
  free: 0,
  basic: 49,
  pro: 149,
};

export const TEAM_PLAN_STORAGE_GB: Record<TeamPlan, number> = {
  free: 100,
  basic: 1024,
  pro: 5120,
};

export const TEAM_PLAN_STORAGE_LIMIT_BYTES: Record<TeamPlan, number> = {
  free: TEAM_PLAN_STORAGE_GB.free * GIBIBYTE,
  basic: TEAM_PLAN_STORAGE_GB.basic * GIBIBYTE,
  pro: TEAM_PLAN_STORAGE_GB.pro * GIBIBYTE,
};

function hasText(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeStoredTeamPlan(plan: string): TeamPlan {
  // Pre-collapse data: "team" was the old top tier (now Pro), and
  // workspaceBilling.ts briefly used "studio" for the entry paid tier
  // (now Basic). Map both to the current keys so old rows don't
  // resolve to free by accident.
  if (plan === "pro" || plan === "team") return "pro";
  if (plan === "basic" || plan === "studio") return "basic";
  if (plan === "free") return "free";
  return "free";
}

export function resolvePlanFromStripePriceId(
  stripePriceId: string | undefined | null,
): TeamPlan | null {
  if (!hasText(stripePriceId)) return null;

  const basicPriceId = process.env.STRIPE_PRICE_BASIC_MONTHLY;
  const proPriceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
  const basicV2PriceId = process.env.STRIPE_PRICE_BASIC_MONTHLY_V2;
  const proV2PriceId = process.env.STRIPE_PRICE_PRO_MONTHLY_V2;
  const basicAnnualPriceId = process.env.STRIPE_PRICE_BASIC_ANNUAL;
  const proAnnualPriceId = process.env.STRIPE_PRICE_PRO_ANNUAL;

  if (
    (hasText(basicPriceId) && stripePriceId === basicPriceId) ||
    (hasText(basicV2PriceId) && stripePriceId === basicV2PriceId) ||
    (hasText(basicAnnualPriceId) && stripePriceId === basicAnnualPriceId)
  ) {
    return "basic";
  }
  if (
    (hasText(proPriceId) && stripePriceId === proPriceId) ||
    (hasText(proV2PriceId) && stripePriceId === proV2PriceId) ||
    (hasText(proAnnualPriceId) && stripePriceId === proAnnualPriceId)
  ) {
    return "pro";
  }
  return null;
}

export function getStripePriceIdForPlan(plan: TeamPlan): string {
  if (plan === "free") {
    throw new Error("Free plan has no Stripe price ID — no checkout needed.");
  }
  const variableName =
    plan === "basic" ? "STRIPE_PRICE_BASIC_MONTHLY" : "STRIPE_PRICE_PRO_MONTHLY";
  const value = process.env[variableName];
  if (!hasText(value)) {
    throw new Error(`${variableName} is not configured`);
  }
  return value;
}

export function hasActiveTeamSubscriptionStatus(
  status: string | undefined | null,
): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

type BillingCtx = QueryCtx | MutationCtx;

export async function getTeamSubscriptionByOrgId(
  ctx: BillingCtx,
  teamId: Id<"teams">,
) {
  return await ctx.runQuery(components.stripe.public.getSubscriptionByOrgId, {
    orgId: teamId,
  });
}

export async function getTeamSubscriptionState(
  ctx: BillingCtx,
  teamId: Id<"teams">,
) {
  const team = await ctx.db.get(teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  const subscription = await getTeamSubscriptionByOrgId(ctx, teamId);
  const hasActiveSubscription = hasActiveTeamSubscriptionStatus(
    subscription?.status,
  );

  // When the subscription isn't live, treat the team as free-tier
  // for quota/limit purposes. The Stripe component may still hold
  // a stale priceId from a past sub — ignore it unless the status
  // is active/trialing/past_due.
  let plan: TeamPlan;
  if (hasActiveSubscription) {
    plan =
      resolvePlanFromStripePriceId(subscription?.priceId) ??
      normalizeStoredTeamPlan(team.plan);
  } else {
    plan = "free";
  }

  return { team, subscription, plan, hasActiveSubscription };
}

export async function getTeamStorageUsedBytes(
  ctx: BillingCtx,
  teamId: Id<"teams">,
) {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .collect();

  const videosByProject = await Promise.all(
    projects.map((project) =>
      ctx.db
        .query("videos")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect(),
    ),
  );

  let total = 0;
  for (const videos of videosByProject) {
    for (const video of videos) {
      if (video.status === "failed") continue;
      // The connected drive is backed by the same managed object-storage
      // bucket. Drive-first avoids eager Mux encoding, but the source bytes
      // still cost Snip money and therefore count against the storage plan.
      if (typeof video.fileSize === "number" && Number.isFinite(video.fileSize)) {
        total += video.fileSize;
      }
    }
  }

  return total;
}

async function getOwnerWorkspaceStorageUsedBytes(
  ctx: BillingCtx,
  ownerClerkId: string,
) {
  const ownedTeams = await ctx.db
    .query("teams")
    .withIndex("by_owner", (q) => q.eq("ownerClerkId", ownerClerkId))
    .collect();
  const totals = await Promise.all(
    ownedTeams.map((team) => getTeamStorageUsedBytes(ctx, team._id)),
  );
  return totals.reduce((sum, bytes) => sum + bytes, 0);
}

/**
 * Storage usage split by lifecycle, for the billing UI's "active vs
 * archived" readout. All sizes are source bytes (`videos.fileSize`):
 *   • hotBytes   — live encoded ladder; instant playback.
 *   • coldBytes  — evicted/deferred (no live ladder); re-encodes on watch.
 *   • driveBytes — drive-first sources; served off the connected drive.
 *
 * `billedBytes` = hot + cold + drive. Drive-first reduces processing and
 * egress, not storage capacity.
 */
export async function getTeamStorageBreakdown(
  ctx: BillingCtx,
  teamId: Id<"teams">,
) {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .collect();

  const videosByProject = await Promise.all(
    projects.map((project) =>
      ctx.db
        .query("videos")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect(),
    ),
  );

  let hotBytes = 0;
  let coldBytes = 0;
  let driveBytes = 0;
  for (const videos of videosByProject) {
    for (const video of videos) {
      if (video.status === "failed") continue;
      const size =
        typeof video.fileSize === "number" && Number.isFinite(video.fileSize)
          ? video.fileSize
          : 0;
      if (size <= 0) continue;
      if (video.storageClass === "drive") {
        driveBytes += size;
      } else if (video.encodingDeferred || video.renditionEvictedAt) {
        coldBytes += size;
      } else {
        hotBytes += size;
      }
    }
  }

  return {
    hotBytes,
    coldBytes,
    driveBytes,
    billedBytes: hotBytes + coldBytes + driveBytes,
  };
}

/**
 * Demo / self-host bypass. When STRIPE_SECRET_KEY is absent we treat the
 * deployment as unmonetized — anyone can create projects and upload up to
 * the basic-plan storage limit. This makes the fork actually usable as a
 * single-tenant tool without standing up Stripe just to demo.
 */
function isBillingEnforced(): boolean {
  const secret = process.env.STRIPE_SECRET_KEY;
  return typeof secret === "string" && secret.trim().length > 0;
}

/**
 * Effective subscription state for quota purposes.
 *
 * Never throws. Resolves the team's plan in this order:
 *   1. Workspace-level subscription on the team owner — preferred,
 *      since one Stripe customer covers all of the owner's teams.
 *   2. Legacy per-team Stripe subscription (component-backed).
 *   3. Otherwise → free tier (25 GB).
 *
 * The function used to throw when no subscription existed, which forced
 * users into Stripe before they could create their first project. That
 * gate is gone: free tier is real and enforced via the storage quota
 * check below.
 */
export async function assertTeamHasActiveSubscription(
  ctx: BillingCtx,
  teamId: Id<"teams">,
) {
  const state = await getTeamSubscriptionState(ctx, teamId);
  if (!isBillingEnforced()) {
    return state;
  }

  const team = state.team;
  if (team?.ownerClerkId) {
    const workspaceSub = await ctx.db
      .query("workspaceSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerClerkId", team.ownerClerkId))
      .unique();
    if (
      workspaceSub &&
      (workspaceSub.status === "active" ||
        workspaceSub.status === "trialing")
    ) {
      const plan = normalizeStoredTeamPlan(workspaceSub.plan);
      return {
        ...state,
        plan,
        hasActiveSubscription: true,
        storageLimitBytes:
          workspaceSub.storageLimitBytes ??
          LEGACY_WORKSPACE_STORAGE_LIMIT_BYTES[plan] ??
          TEAM_PLAN_STORAGE_LIMIT_BYTES[plan],
      };
    }
  }

  if (state.hasActiveSubscription) {
    return state;
  }

  // No active sub anywhere. Free tier; quota check downstream will
  // decide whether the next upload fits.
  return { ...state, plan: "free" as const, hasActiveSubscription: false };
}

/**
 * Throws a typed `ConvexError` when the next upload would push the
 * team past its plan's storage limit. The payload is structured so the
 * client can render a friendly upgrade prompt instead of the raw error
 * string.
 */
export async function assertTeamCanStoreBytes(
  ctx: BillingCtx,
  teamId: Id<"teams">,
  incomingBytes: number,
) {
  const state = await assertTeamHasActiveSubscription(ctx, teamId);
  // Workspace subscriptions are pooled across every team the owner owns.
  // Enforce the same aggregate shown on the Billing page so creating a
  // second team cannot multiply the storage allowance.
  const storageUsedBytes = state.team.ownerClerkId
    ? await getOwnerWorkspaceStorageUsedBytes(ctx, state.team.ownerClerkId)
    : await getTeamStorageUsedBytes(ctx, teamId);
  const storageLimitBytes =
    "storageLimitBytes" in state &&
    typeof state.storageLimitBytes === "number"
      ? state.storageLimitBytes
      : TEAM_PLAN_STORAGE_LIMIT_BYTES[state.plan];
  const requestedBytes = Number.isFinite(incomingBytes)
    ? Math.max(0, incomingBytes)
    : 0;

  if (
    isBillingEnforced() &&
    storageUsedBytes + requestedBytes > storageLimitBytes
  ) {
    throw new ConvexError({
      code: "storage_quota_exceeded",
      plan: state.plan,
      usedBytes: storageUsedBytes,
      limitBytes: storageLimitBytes,
      requestedBytes,
      message: `Storage limit reached on the ${state.plan} plan. Upgrade in Billing & usage to keep uploading.`,
    });
  }

  return {
    ...state,
    storageUsedBytes,
    storageLimitBytes,
  };
}
