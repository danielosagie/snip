import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireTeamAccess } from "./auth";
import { isFeatureEnabled } from "./featureFlags";

/**
 * Stripe Connect — V8 isolate side (status query + internal mutations).
 *
 * The actions that actually talk to the Stripe SDK live in
 * convex/stripeConnectActions.ts because Convex requires "use node" files
 * to only export actions.
 */

const connectStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("restricted"),
  v.literal("disabled"),
);

export const connectRequirementsValidator = v.object({
  currentlyDue: v.array(v.string()),
  pastDue: v.array(v.string()),
  disabledReason: v.union(v.string(), v.null()),
});

/**
 * Flatten `account.requirements` into the shape we persist. Both writers
 * (the refresh action and the account.updated webhook) go through this so
 * the two paths can't drift. Type-only Stripe import keeps this callable
 * from the V8 isolate.
 */
export function extractConnectRequirements(
  account: Pick<import("stripe").Stripe.Account, "requirements">,
) {
  const r = account.requirements;
  return {
    currentlyDue: r?.currently_due ?? [],
    pastDue: r?.past_due ?? [],
    disabledReason: r?.disabled_reason ?? null,
  };
}

export const getOnboardingStatus = query({
  args: { teamId: v.id("teams") },
  returns: v.object({
    available: v.boolean(),
    stripeAccountId: v.union(v.string(), v.null()),
    status: v.union(connectStatusValidator, v.null()),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    canManageBilling: v.boolean(),
    requirements: v.union(connectRequirementsValidator, v.null()),
  }),
  handler: async (ctx, args) => {
    const { membership } = await requireTeamAccess(ctx, args.teamId);
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    return {
      available: isFeatureEnabled("stripeConnect"),
      stripeAccountId: team.stripeConnectAccountId ?? null,
      status: team.stripeConnectStatus ?? null,
      chargesEnabled: team.stripeConnectChargesEnabled ?? false,
      payoutsEnabled: team.stripeConnectPayoutsEnabled ?? false,
      canManageBilling: membership.role === "owner",
      // null means "we have never refreshed this account", which the UI
      // must not render as "nothing outstanding".
      requirements: team.stripeConnectRequirements ?? null,
    };
  },
});

export const recordAccountCreated = internalMutation({
  args: {
    teamId: v.id("teams"),
    accountId: v.string(),
    status: connectStatusValidator,
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.teamId, {
      stripeConnectAccountId: args.accountId,
      stripeConnectStatus: args.status,
      stripeConnectChargesEnabled: args.chargesEnabled,
      stripeConnectPayoutsEnabled: args.payoutsEnabled,
    });
    return null;
  },
});

export const recordAccountStatus = internalMutation({
  args: {
    teamId: v.id("teams"),
    status: connectStatusValidator,
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    requirements: v.optional(connectRequirementsValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.teamId, {
      stripeConnectStatus: args.status,
      stripeConnectChargesEnabled: args.chargesEnabled,
      stripeConnectPayoutsEnabled: args.payoutsEnabled,
      ...(args.requirements ? { stripeConnectRequirements: args.requirements } : {}),
    });
    return null;
  },
});

/**
 * Called by the Stripe webhook handler in http.ts on `account.updated` events.
 * Looks up the team by Connect account ID and syncs status/capabilities.
 */
export const syncAccountFromWebhook = internalMutation({
  args: {
    stripeAccountId: v.string(),
    status: connectStatusValidator,
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    requirements: v.optional(connectRequirementsValidator),
  },
  returns: v.union(v.id("teams"), v.null()),
  handler: async (ctx, args): Promise<Id<"teams"> | null> => {
    const team = await ctx.db
      .query("teams")
      .withIndex("by_stripe_connect_account", (q) =>
        q.eq("stripeConnectAccountId", args.stripeAccountId),
      )
      .unique();
    if (!team) return null;

    await ctx.db.patch(team._id, {
      stripeConnectStatus: args.status,
      stripeConnectChargesEnabled: args.chargesEnabled,
      stripeConnectPayoutsEnabled: args.payoutsEnabled,
      ...(args.requirements ? { stripeConnectRequirements: args.requirements } : {}),
    });
    return team._id;
  },
});
