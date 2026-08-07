"use node";

import { v } from "convex/values";
import Stripe from "stripe";
import { makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { action, ActionCtx } from "./_generated/server";
import { isFeatureEnabled } from "./featureFlags";
import {
  computeApplicationFee,
  computeBuyerTotal,
} from "./paymentsPolicy";

function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY;
  return secret ? new Stripe(secret) : null;
}

function deriveConnectStatus(
  account: Stripe.Account,
): "pending" | "active" | "restricted" {
  const requirements = account.requirements;
  const hasOverdue =
    Boolean(requirements?.currently_due?.length) ||
    Boolean(requirements?.past_due?.length) ||
    Boolean(requirements?.disabled_reason);
  if (
    account.charges_enabled === true &&
    account.details_submitted === true &&
    !hasOverdue
  ) {
    return "active";
  }
  return account.details_submitted === true && hasOverdue
    ? "restricted"
    : "pending";
}

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
  } catch (error) {
    console.error("Invoice Connect status refresh failed", {
      teamId: team._id,
      error: error instanceof Error ? error.message : String(error),
    });
    return "pending";
  }
}

async function resolveSettlement(
  ctx: ActionCtx,
  stripe: Stripe,
  team: Doc<"teams">,
): Promise<{ mode: "connect"; accountId: string } | { mode: "platform" }> {
  if (!team.stripeConnectAccountId) return { mode: "platform" };
  let status = team.stripeConnectStatus ?? "pending";
  if (status !== "active") {
    status = await reconcileConnectStatus(ctx, stripe, {
      _id: team._id,
      stripeConnectAccountId: team.stripeConnectAccountId,
    });
  }
  return status === "active"
    ? { mode: "connect", accountId: team.stripeConnectAccountId }
    : { mode: "platform" };
}

type CheckoutLookup = {
  invoice: Doc<"invoices">;
  milestone: Doc<"invoices">["milestones"][number];
  team: Doc<"teams">;
};

const lookupMilestoneForCheckout = makeFunctionReference<
  "query",
  { payToken: string; milestoneId: string },
  CheckoutLookup | null
>("invoices:lookupMilestoneForCheckout");

const recordMilestoneCheckoutCreated = makeFunctionReference<
  "mutation",
  {
    invoiceId: Id<"invoices">;
    milestoneId: string;
    previousCheckoutSessionId?: string;
    stripeCheckoutSessionId: string;
    stripeConnectAccountId?: string;
    settlement: "connect" | "platform";
  },
  Id<"payments">
>("invoices:recordMilestoneCheckoutCreated");

export const createMilestoneCheckout = action({
  args: {
    payToken: v.string(),
    milestoneId: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("disabled"),
      v.literal("notPayable"),
      v.literal("processing"),
    ),
    url: v.union(v.string(), v.null()),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "ok" | "disabled" | "notPayable" | "processing";
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

    const lookup: CheckoutLookup | null = await ctx.runQuery(
      lookupMilestoneForCheckout,
      { payToken: args.payToken, milestoneId: args.milestoneId },
    );
    if (!lookup) return { status: "notPayable", url: null };

    const priorSessionId = lookup.milestone.stripeCheckoutSessionId;
    if (priorSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(priorSessionId);
        if (existing.status === "open" && existing.url) {
          return { status: "ok", url: existing.url };
        }
        if (existing.status === "complete") {
          return {
            status: "processing",
            url: null,
            reason: "Payment is complete and fulfillment is processing.",
          };
        }
      } catch (error) {
        console.warn("Could not verify invoice Checkout Session", {
          invoiceId: lookup.invoice._id,
          milestoneId: args.milestoneId,
          sessionId: priorSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          status: "processing",
          url: null,
          reason: "The existing checkout could not be verified. Try again shortly.",
        };
      }
    }

    const settlement = await resolveSettlement(ctx, stripe, lookup.team);
    const subtotalCents = lookup.milestone.amountCents;
    const feeCents = computeApplicationFee(subtotalCents);
    const buyerTotalCents = computeBuyerTotal(subtotalCents);
    const buyerFeeCents = buyerTotalCents - subtotalCents;

    const metadata = {
      kind: "invoice_milestone",
      invoiceId: lookup.invoice._id,
      milestoneId: lookup.milestone.id,
      teamId: lookup.team._id,
    };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        submit_type: "pay",
        client_reference_id: lookup.invoice._id,
        customer_email: lookup.invoice.clientEmail,
        success_url: args.successUrl,
        cancel_url: args.cancelUrl,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${lookup.invoice.title}: ${lookup.milestone.label}`,
              },
              unit_amount: subtotalCents,
            },
            quantity: 1,
          },
          ...(buyerFeeCents > 0
            ? [
                {
                  price_data: {
                    currency: "usd",
                    product_data: { name: "Snip platform fee" },
                    unit_amount: buyerFeeCents,
                  },
                  quantity: 1,
                },
              ]
            : []),
        ],
        payment_intent_data: {
          ...(settlement.mode === "connect"
            ? {
                application_fee_amount: feeCents,
                transfer_data: { destination: settlement.accountId },
              }
            : {}),
          metadata,
        },
        metadata,
      },
      {
        idempotencyKey: `invoice:${lookup.invoice._id}:${lookup.milestone.id}:${priorSessionId ?? "initial"}`,
      },
    );

    await ctx.runMutation(
      recordMilestoneCheckoutCreated,
      {
        invoiceId: lookup.invoice._id,
        milestoneId: lookup.milestone.id,
        previousCheckoutSessionId: priorSessionId,
        stripeCheckoutSessionId: session.id,
        stripeConnectAccountId:
          settlement.mode === "connect" ? settlement.accountId : undefined,
        settlement: settlement.mode,
      },
    );
    return { status: "ok", url: session.url };
  },
});
