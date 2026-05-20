"use node";

import { v } from "convex/values";
import Stripe from "stripe";
import { action, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { isFeatureEnabled } from "./featureFlags";

/**
 * Node-only side of payments. Lives here (and not in payments.ts) because
 * the Stripe Node SDK isn't allowed in Convex V8 isolates — Convex requires
 * files with "use node" to only export actions.
 *
 * Platform fee: 0% for v1. Configurable via VIDEOINFRA_PLATFORM_FEE_BASIS_POINTS
 * (e.g. 100 = 1%) if you decide to take a cut later.
 */

const PLATFORM_FEE_BASIS_POINTS = (() => {
  const raw = process.env.VIDEOINFRA_PLATFORM_FEE_BASIS_POINTS;
  if (!raw) return 0;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5000) return 0;
  return parsed;
})();

function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  return new Stripe(secret);
}

function computeApplicationFee(amountCents: number): number {
  if (PLATFORM_FEE_BASIS_POINTS <= 0) return 0;
  const fee = Math.floor((amountCents * PLATFORM_FEE_BASIS_POINTS) / 10000);
  return Math.max(0, fee);
}

// Mirror of stripeConnectActions.deriveConnectStatus — duplicated because
// Convex "use node" files can only export actions, so the helper can't be
// shared across them (http.ts keeps its own copy for the same reason).
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

/**
 * The cached `stripeConnectStatus` only flips to "active" via the
 * `account.updated` webhook (or a manual refresh on the payouts page). If
 * that webhook never reaches this deployment — wrong endpoint, env, or a
 * dropped delivery — a fully-onboarded team is permanently treated as
 * "not connected" and clients can never pay. Before blocking checkout,
 * ask Stripe for the live account state and sync it back. Returns the
 * effective status after reconciliation.
 */
async function reconcileConnectStatus(
  ctx: ActionCtx,
  stripe: Stripe,
  team: { _id: Id<"teams">; stripeConnectAccountId: string },
): Promise<"pending" | "active" | "restricted" | "disabled"> {
  try {
    const account = await stripe.accounts.retrieve(
      team.stripeConnectAccountId,
    );
    const status = deriveConnectStatus(account);
    await ctx.runMutation(internal.stripeConnect.recordAccountStatus, {
      teamId: team._id,
      status,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
    });
    return status;
  } catch (err) {
    console.error("Stripe Connect live status refresh failed", {
      teamId: team._id,
      stripeConnectAccountId: team.stripeConnectAccountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "pending";
  }
}

export const createCheckoutForGrant = action({
  args: {
    grantToken: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
    clientEmail: v.optional(v.string()),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("disabled"),
      v.literal("noPaywall"),
      v.literal("alreadyPaid"),
      v.literal("teamNotConnected"),
      v.literal("invalidGrant"),
    ),
    url: v.union(v.string(), v.null()),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status:
      | "ok"
      | "disabled"
      | "noPaywall"
      | "alreadyPaid"
      | "teamNotConnected"
      | "invalidGrant";
    url: string | null;
    reason?: string;
  }> => {
    if (!isFeatureEnabled("stripeConnect")) {
      return {
        status: "disabled",
        url: null,
        reason: "Stripe is not configured on this deployment.",
      };
    }
    const stripe = getStripe();
    if (!stripe) {
      return { status: "disabled", url: null, reason: "Stripe not configured." };
    }

    const lookup = await ctx.runQuery(internal.payments.lookupGrantForCheckout, {
      grantToken: args.grantToken,
    });
    if (!lookup) {
      return { status: "invalidGrant", url: null };
    }

    if (lookup.grant.paidAt) {
      return { status: "alreadyPaid", url: null };
    }
    if (!lookup.shareLink.paywall) {
      return { status: "noPaywall", url: null };
    }
    if (!lookup.team.stripeConnectAccountId) {
      return {
        status: "teamNotConnected",
        url: null,
        reason: "This team hasn't connected Stripe yet.",
      };
    }
    let connectStatus: "pending" | "active" | "restricted" | "disabled" =
      lookup.team.stripeConnectStatus ?? "pending";
    if (connectStatus !== "active") {
      connectStatus = await reconcileConnectStatus(ctx, stripe, {
        _id: lookup.team._id,
        stripeConnectAccountId: lookup.team.stripeConnectAccountId,
      });
    }
    if (connectStatus !== "active") {
      return {
        status: "teamNotConnected",
        url: null,
        reason: "This team's Stripe account isn't ready to accept payments yet.",
      };
    }

    const paywall = lookup.shareLink.paywall;
    const amountCents = paywall.priceCents;
    const currency = paywall.currency;
    const productName =
      paywall.description ??
      (lookup.bundleName
        ? `Final delivery: ${lookup.bundleName}`
        : `Final delivery: ${lookup.video.title}`);
    const applicationFeeAmount = computeApplicationFee(amountCents);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: productName },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      customer_email: args.clientEmail ?? lookup.shareLink.clientEmail,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      payment_intent_data: {
        ...(applicationFeeAmount > 0
          ? { application_fee_amount: applicationFeeAmount }
          : {}),
        transfer_data: { destination: lookup.team.stripeConnectAccountId },
        metadata: {
          grantId: lookup.grant._id,
          shareLinkId: lookup.shareLink._id,
          videoId: lookup.video._id,
          teamId: lookup.team._id,
        },
      },
      metadata: {
        grantId: lookup.grant._id,
        shareLinkId: lookup.shareLink._id,
        videoId: lookup.video._id,
        teamId: lookup.team._id,
      },
    });

    await ctx.runMutation(internal.payments.recordCheckoutCreated, {
      grantId: lookup.grant._id,
      shareLinkId: lookup.shareLink._id,
      teamId: lookup.team._id,
      videoId: lookup.video._id,
      clientEmail: args.clientEmail ?? lookup.shareLink.clientEmail,
      amountCents,
      currency,
      stripeCheckoutSessionId: session.id,
      stripeConnectAccountId: lookup.team.stripeConnectAccountId,
      applicationFeeAmountCents: applicationFeeAmount,
    });

    return { status: "ok", url: session.url };
  },
});

/**
 * Canva-style per-video checkout. Doesn't require a share grant — the
 * client just hits "Download — $X" on the video and we send them straight
 * to Stripe. clientEmail identifies the buyer (Stripe Checkout collects it
 * if not provided up-front).
 */
export const createCheckoutForVideo = action({
  args: {
    videoId: v.id("videos"),
    clientEmail: v.optional(v.string()),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("disabled"),
      v.literal("noPaywall"),
      v.literal("teamNotConnected"),
      v.literal("videoNotFound"),
    ),
    url: v.union(v.string(), v.null()),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status:
      | "ok"
      | "disabled"
      | "noPaywall"
      | "teamNotConnected"
      | "videoNotFound";
    url: string | null;
    reason?: string;
  }> => {
    if (!isFeatureEnabled("stripeConnect")) {
      return {
        status: "disabled",
        url: null,
        reason: "Stripe is not configured on this deployment.",
      };
    }
    const stripe = getStripe();
    if (!stripe) {
      return { status: "disabled", url: null, reason: "Stripe not configured." };
    }

    const lookup = await ctx.runQuery(internal.payments.lookupVideoForCheckout, {
      videoId: args.videoId,
    });
    if (!lookup) return { status: "videoNotFound", url: null };
    if (!lookup.video.paywall) return { status: "noPaywall", url: null };
    if (!lookup.team.stripeConnectAccountId) {
      return {
        status: "teamNotConnected",
        url: null,
        reason: "This team hasn't connected Stripe yet.",
      };
    }
    let connectStatus: "pending" | "active" | "restricted" | "disabled" =
      lookup.team.stripeConnectStatus ?? "pending";
    if (connectStatus !== "active") {
      connectStatus = await reconcileConnectStatus(ctx, stripe, {
        _id: lookup.team._id,
        stripeConnectAccountId: lookup.team.stripeConnectAccountId,
      });
    }
    if (connectStatus !== "active") {
      return {
        status: "teamNotConnected",
        url: null,
        reason: "This team's Stripe account isn't ready to accept payments yet.",
      };
    }

    const paywall = lookup.video.paywall;
    const productName =
      paywall.description ?? `Download: ${lookup.video.title}`;
    const applicationFeeAmount = computeApplicationFee(paywall.priceCents);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: paywall.currency,
            product_data: { name: productName },
            unit_amount: paywall.priceCents,
          },
          quantity: 1,
        },
      ],
      customer_email: args.clientEmail,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      payment_intent_data: {
        ...(applicationFeeAmount > 0
          ? { application_fee_amount: applicationFeeAmount }
          : {}),
        transfer_data: { destination: lookup.team.stripeConnectAccountId },
        metadata: {
          videoId: lookup.video._id,
          teamId: lookup.team._id,
        },
      },
      metadata: {
        videoId: lookup.video._id,
        teamId: lookup.team._id,
        kind: "video",
      },
    });

    await ctx.runMutation(internal.payments.recordVideoCheckoutCreated, {
      teamId: lookup.team._id,
      videoId: lookup.video._id,
      clientEmail: args.clientEmail,
      amountCents: paywall.priceCents,
      currency: paywall.currency,
      stripeCheckoutSessionId: session.id,
      stripeConnectAccountId: lookup.team.stripeConnectAccountId,
      applicationFeeAmountCents: applicationFeeAmount,
    });

    return { status: "ok", url: session.url };
  },
});
