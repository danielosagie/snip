"use node";

import { v } from "convex/values";
import Stripe from "stripe";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * Node-only side of workspace billing — Stripe Checkout creation.
 * Lives here (and not in workspaceBilling.ts) because the Stripe SDK
 * needs the node runtime. The mutation that records the pending
 * checkout state stays in workspaceBilling.ts so it can run in the
 * V8 isolate.
 *
 * Returns one of:
 *   • { kind: "redirect", url } when Stripe is fully configured →
 *     the client redirects to that URL.
 *   • { kind: "simulate", reason } when Stripe keys / prices are
 *     missing → the client falls back to `simulateActivate` and
 *     surfaces the reason so the operator knows what to set.
 */

// Stripe price IDs. We reuse the legacy env var names so existing
// Stripe products keep working without rotation. Mapping:
//   STRIPE_PRICE_BASIC_MONTHLY → "basic" plan ($20 / 2 TB)
//   STRIPE_PRICE_PRO_MONTHLY   → "pro"   plan ($50 / 5 TB)
const BASIC_PRICE_ENV = "STRIPE_PRICE_BASIC_MONTHLY";
const PRO_PRICE_ENV = "STRIPE_PRICE_PRO_MONTHLY";

export const createCheckout = action({
  args: {
    plan: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { kind: "redirect"; url: string }
    | { kind: "simulate"; reason: string }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated.");
    }

    // Back-compat: any pre-rename "studio" requests get routed to
    // the new "basic" plan.
    const requestedPlan =
      args.plan === "studio" ? "basic" : args.plan;
    if (requestedPlan !== "basic" && requestedPlan !== "pro") {
      throw new Error(`Unknown plan: ${args.plan}`);
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const priceEnvName =
      requestedPlan === "basic" ? BASIC_PRICE_ENV : PRO_PRICE_ENV;
    const priceId = process.env[priceEnvName];

    if (!stripeSecret || stripeSecret.trim().length === 0) {
      return {
        kind: "simulate",
        reason:
          "STRIPE_SECRET_KEY is not set on this Convex deployment. Activation will run in demo mode.",
      };
    }
    if (!priceId || priceId.trim().length === 0) {
      return {
        kind: "simulate",
        reason: `${priceEnvName} is not set on Convex. Set it to the Stripe price ID for the ${requestedPlan === "basic" ? "Basic" : "Pro"} plan to enable real checkout.`,
      };
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
        plan: requestedPlan,
      },
      subscription_data: {
        metadata: {
          ownerClerkId: identity.subject,
          plan: requestedPlan,
        },
      },
    });

    if (!session.url) {
      throw new Error("Stripe didn't return a checkout URL.");
    }

    await ctx.runMutation(api.workspaceBilling.recordPendingCheckout, {
      plan: requestedPlan,
      stripeCustomerId: session.customer
        ? String(session.customer)
        : undefined,
    });

    return { kind: "redirect", url: session.url };
  },
});
