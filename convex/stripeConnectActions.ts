"use node";

import { v } from "convex/values";
import Stripe from "stripe";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getIdentity } from "./auth";
import { isFeatureEnabled } from "./featureFlags";
import { extractConnectRequirements } from "./stripeConnect";

/**
 * Stripe Connect actions (Node side). Creates Express accounts on demand,
 * mints onboarding links, and refreshes account status. The V8 side
 * (`convex/stripeConnect.ts`) holds the query + internal mutations.
 *
 * Demo mode: when STRIPE_SECRET_KEY is absent, every action returns
 * `{ status: "disabled", reason }` rather than throwing — the UI shows a
 * "configure Stripe to enable payouts" CTA on the payouts settings page.
 */

const connectStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("restricted"),
  v.literal("disabled"),
);

function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  return new Stripe(secret);
}

function deriveConnectStatus(
  account: Stripe.Account,
): "pending" | "active" | "restricted" {
  const detailsSubmitted = account.details_submitted === true;
  const chargesEnabled = account.charges_enabled === true;
  const requirements = account.requirements;
  const hasOverdue =
    Boolean(requirements?.currently_due?.length) ||
    Boolean(requirements?.past_due?.length) ||
    Boolean(requirements?.disabled_reason);

  if (chargesEnabled && detailsSubmitted && !hasOverdue) return "active";
  if (detailsSubmitted && hasOverdue) return "restricted";
  return "pending";
}

export const createConnectAccount = action({
  args: { teamId: v.id("teams") },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("disabled"),
      v.literal("exists"),
      v.literal("configuration_required"),
    ),
    accountId: v.union(v.string(), v.null()),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "ok" | "disabled" | "exists" | "configuration_required";
    accountId: string | null;
    reason?: string;
  }> => {
    if (!isFeatureEnabled("stripeConnect")) {
      return {
        status: "disabled",
        accountId: null,
        reason: "STRIPE_SECRET_KEY is not configured on this deployment.",
      };
    }
    const stripe = getStripe();
    if (!stripe) {
      return { status: "disabled", accountId: null, reason: "Stripe not configured." };
    }

    const identity = await getIdentity(ctx);
    const team = await ctx.runQuery(api.teams.get, { teamId: args.teamId });
    if (!team) throw new Error("Team not found");
    if (team.role !== "owner") {
      throw new Error("Only the team owner can connect Stripe payouts.");
    }

    if (team.stripeConnectAccountId) {
      return { status: "exists", accountId: team.stripeConnectAccountId };
    }

    const ownerEmail =
      typeof identity.email === "string" && identity.email.length > 0
        ? identity.email
        : undefined;

    let account: Stripe.Account;
    try {
      account = await stripe.accounts.create({
        type: "express",
        email: ownerEmail,
        business_profile: { name: team.name },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { teamId: team._id, teamSlug: team.slug },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message.includes("responsibilities of managing losses") ||
        message.includes("connect/platform-profile")
      ) {
        return {
          status: "configuration_required",
          accountId: null,
          reason:
            "The Snip platform must finish its Stripe Connect profile before Express accounts can be created.",
        };
      }
      throw error;
    }

    await ctx.runMutation(internal.stripeConnect.recordAccountCreated, {
      teamId: args.teamId,
      accountId: account.id,
      status: "pending",
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
    });

    return { status: "ok", accountId: account.id };
  },
});

export const createOnboardingLink = action({
  args: {
    teamId: v.id("teams"),
    returnUrl: v.string(),
    refreshUrl: v.string(),
  },
  returns: v.object({
    status: v.union(v.literal("ok"), v.literal("disabled")),
    url: v.union(v.string(), v.null()),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "ok" | "disabled"; url: string | null; reason?: string }> => {
    if (!isFeatureEnabled("stripeConnect")) {
      return {
        status: "disabled",
        url: null,
        reason: "STRIPE_SECRET_KEY is not configured.",
      };
    }
    const stripe = getStripe();
    if (!stripe) {
      return { status: "disabled", url: null, reason: "Stripe not configured." };
    }

    const team = await ctx.runQuery(api.teams.get, { teamId: args.teamId });
    if (!team) throw new Error("Team not found");
    if (team.role !== "owner") {
      throw new Error("Only the team owner can manage payouts.");
    }
    if (!team.stripeConnectAccountId) {
      throw new Error("No Connect account yet. Run createConnectAccount first.");
    }

    const link = await stripe.accountLinks.create({
      account: team.stripeConnectAccountId,
      refresh_url: args.refreshUrl,
      return_url: args.returnUrl,
      type: "account_onboarding",
    });

    return { status: "ok", url: link.url };
  },
});

export const refreshAccountStatus = action({
  args: { teamId: v.id("teams") },
  returns: v.object({
    status: v.union(v.literal("ok"), v.literal("disabled"), v.literal("noAccount")),
    accountStatus: v.union(connectStatusValidator, v.null()),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "ok" | "disabled" | "noAccount";
    accountStatus: "pending" | "active" | "restricted" | "disabled" | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    reason?: string;
  }> => {
    if (!isFeatureEnabled("stripeConnect")) {
      return {
        status: "disabled",
        accountStatus: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        reason: "STRIPE_SECRET_KEY is not configured.",
      };
    }
    const stripe = getStripe();
    if (!stripe) {
      return {
        status: "disabled",
        accountStatus: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        reason: "Stripe not configured.",
      };
    }

    const team = await ctx.runQuery(api.teams.get, { teamId: args.teamId });
    if (!team) throw new Error("Team not found");
    if (!team.stripeConnectAccountId) {
      return {
        status: "noAccount",
        accountStatus: null,
        chargesEnabled: false,
        payoutsEnabled: false,
      };
    }

    const account = await stripe.accounts.retrieve(team.stripeConnectAccountId);
    const accountStatus = deriveConnectStatus(account);

    await ctx.runMutation(internal.stripeConnect.recordAccountStatus, {
      teamId: args.teamId,
      status: accountStatus,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      requirements: extractConnectRequirements(account),
    });

    return {
      status: "ok",
      accountStatus,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
    };
  },
});
