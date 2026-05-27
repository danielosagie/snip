import { components } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

export type TeamPlan = "basic" | "pro";

const GIBIBYTE = 1024 ** 3;

export const TEAM_PLAN_MONTHLY_PRICE_USD: Record<TeamPlan, number> = {
  basic: 5,
  pro: 25,
};

export const TEAM_PLAN_STORAGE_LIMIT_BYTES: Record<TeamPlan, number> = {
  basic: 100 * GIBIBYTE,
  pro: 1024 * GIBIBYTE,
};

function hasText(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeStoredTeamPlan(plan: string): TeamPlan {
  if (plan === "pro" || plan === "team") return "pro";
  return "basic";
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
  const subscriptionPlan = resolvePlanFromStripePriceId(subscription?.priceId);
  const plan = subscriptionPlan ?? normalizeStoredTeamPlan(team.plan);
  const hasActiveSubscription = hasActiveTeamSubscriptionStatus(
    subscription?.status,
  );

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
      if (typeof video.fileSize === "number" && Number.isFinite(video.fileSize)) {
        total += video.fileSize;
      }
    }
  }

  return total;
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
 * Active subscription gate, post-workspace-billing.
 *
 * Order of checks:
 *   1. Stripe not configured on this deployment → don't enforce. Lets a
 *      fresh fork run end-to-end while the operator is still wiring keys;
 *      once STRIPE_SECRET_KEY is set the gate becomes load-bearing.
 *   2. Team owner has an active workspace subscription → pass.
 *      (Workspace subs replaced per-team subs; one Stripe customer
 *      covers every team the owner runs.)
 *   3. Legacy per-team subscription still active → pass.
 *      (Keeps existing customers from breaking during the migration.)
 *   4. Otherwise → throw.
 */
export async function assertTeamHasActiveSubscription(
  ctx: BillingCtx,
  teamId: Id<"teams">,
) {
  const state = await getTeamSubscriptionState(ctx, teamId);
  if (!isBillingEnforced()) {
    return state;
  }

  // Workspace-level subscription check (preferred).
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
      return state;
    }
  }

  // Legacy per-team subscription path (only triggers for accounts that
  // signed up before workspace billing landed).
  if (state.hasActiveSubscription) {
    return state;
  }

  throw new Error(
    "No active workspace subscription. Pick a plan in Billing & usage to keep creating projects and uploading.",
  );
}

export async function assertTeamCanStoreBytes(
  ctx: BillingCtx,
  teamId: Id<"teams">,
  incomingBytes: number,
) {
  const state = await assertTeamHasActiveSubscription(ctx, teamId);
  const storageUsedBytes = await getTeamStorageUsedBytes(ctx, teamId);
  const storageLimitBytes = TEAM_PLAN_STORAGE_LIMIT_BYTES[state.plan];
  const requestedBytes = Number.isFinite(incomingBytes) ? Math.max(0, incomingBytes) : 0;

  if (
    isBillingEnforced() &&
    storageUsedBytes + requestedBytes > storageLimitBytes
  ) {
    throw new Error(
      `Storage limit reached for the ${state.plan} plan. Upgrade to continue uploading.`,
    );
  }

  return {
    ...state,
    storageUsedBytes,
    storageLimitBytes,
  };
}
