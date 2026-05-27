"use node";

import { v } from "convex/values";
import Stripe from "stripe";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * Node-only side of workspace billing — Stripe Checkout creation +
 * subscription cancel. Lives here (and not in workspaceBilling.ts) because
 * the Stripe SDK needs the node runtime. The mutation that records the
 * pending checkout state stays in workspaceBilling.ts so it can run in the
 * V8 isolate.
 *
 * Real-Stripe only — if the deployment is missing STRIPE_SECRET_KEY or one
 * of STRIPE_PRICE_WORKSPACE_{STUDIO,PRO} the action throws a clear error
 * and the UI surfaces it. There's no demo/simulate fallback anymore; see
 * the inline error messages for what to set.
 */

const STUDIO_PRICE_ENV = "STRIPE_PRICE_WORKSPACE_STUDIO";
const PRO_PRICE_ENV = "STRIPE_PRICE_WORKSPACE_PRO";

export const createCheckout = action({
  args: {
    plan: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated.");
    }

    if (args.plan !== "studio" && args.plan !== "pro") {
      throw new Error(`Unknown plan: ${args.plan}`);
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const priceEnvName =
      args.plan === "studio" ? STUDIO_PRICE_ENV : PRO_PRICE_ENV;
    const priceId = process.env[priceEnvName];

    if (!stripeSecret || stripeSecret.trim().length === 0) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set on this Convex deployment. Set it to enable workspace checkout.",
      );
    }
    if (!priceId || priceId.trim().length === 0) {
      throw new Error(
        `${priceEnvName} is not set on Convex. Set it to the Stripe price ID for the ${args.plan === "studio" ? "Studio" : "Pro"} plan to enable real checkout.`,
      );
    }

    const stripe = new Stripe(stripeSecret);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      customer_email:
        typeof identity.email === "string" ? identity.email : undefined,
      metadata: {
        ownerClerkId: identity.subject,
        plan: args.plan,
      },
      subscription_data: {
        metadata: {
          ownerClerkId: identity.subject,
          plan: args.plan,
        },
      },
    });

    if (!session.url) {
      throw new Error("Stripe didn't return a checkout URL.");
    }

    await ctx.runMutation(api.workspaceBilling.recordPendingCheckout, {
      plan: args.plan,
      stripeCustomerId: session.customer
        ? String(session.customer)
        : undefined,
    });

    return { url: session.url };
  },
});

/**
 * Cancel the signed-in user's workspace subscription at the end of the
 * current billing period. Calls Stripe directly; the subscription stays
 * "active" until the period ends, then Stripe fires
 * customer.subscription.deleted and the webhook syncs the row.
 */
export const cancelSubscription = action({
  args: {},
  handler: async (ctx): Promise<{ status: "ok" | "noSubscription" }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated.");
    }
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret || stripeSecret.trim().length === 0) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set on this Convex deployment.",
      );
    }
    const sub = await ctx.runQuery(api.workspaceBilling.getMySubscription, {});
    if (!sub || !sub.stripeSubscriptionId) {
      return { status: "noSubscription" };
    }
    const stripe = new Stripe(stripeSecret);
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    return { status: "ok" };
  },
});
