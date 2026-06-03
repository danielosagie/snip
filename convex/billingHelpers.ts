import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Plan keys. Three tiers post-collapse:
 *   • `free`  — no Stripe subscription required (50 GB)
 *   • `basic` — $20/mo, 2 TB
 *   • `pro`   — $50/mo, 5 TB
 *
 * The canonical tier table lives in `convex/workspaceBilling.ts`
 * (TIERS). The constants below mirror that for callers that still
 * need a plain map. Keep them in sync if you change TIERS.
 */
export type TeamPlan = "free" | "basic" | "pro";

const GIBIBYTE = 1024 ** 3;

export const TEAM_PLAN_MONTHLY_PRICE_USD: Record<TeamPlan, number> = {
  free: 0,
  basic: 20,
  pro: 50,
};

export const TEAM_PLAN_STORAGE_LIMIT_BYTES: Record<TeamPlan, number> = {
  free: 50 * GIBIBYTE,
  basic: 2 * 1024 * GIBIBYTE,
  pro: 5 * 1024 * GIBIBYTE,
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

  if (hasText(basicPriceId) && stripePriceId === basicPriceId) return "basic";
  if (hasText(proPriceId) && stripePriceId === proPriceId) return "pro";
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
      // Drive-first sources live on the connected drive, not in our
      // object store, so they don't count against the cloud cap.
      if (video.storageClass === "drive") continue;
      if (typeof video.fileSize === "number" && Number.isFinite(video.fileSize)) {
        total += video.fileSize;
      }
    }
  }

  return total;
}

/**
 * Storage usage split by lifecycle, for the billing UI's "active vs
 * archived" readout. All sizes are source bytes (`videos.fileSize`):
 *   • hotBytes   — live encoded ladder; instant playback.
 *   • coldBytes  — evicted/deferred (no live ladder); re-encodes on watch.
 *   • driveBytes — drive-first sources; served off the connected drive.
 *
 * `billedBytes` = hot + cold (what counts against the cap). driveBytes is
 * tracked for display but excluded from the cap.
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
    billedBytes: hotBytes + coldBytes,
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
 *   3. Otherwise → free tier (50 GB).
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
      return { ...state, plan, hasActiveSubscription: true };
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
  const storageUsedBytes = await getTeamStorageUsedBytes(ctx, teamId);
  const storageLimitBytes = TEAM_PLAN_STORAGE_LIMIT_BYTES[state.plan];
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
