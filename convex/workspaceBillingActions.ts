"use node";

import { v } from "convex/values";
import Stripe from "stripe";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";

/**
 * Node-only side of workspace billing: Stripe Checkout and Customer
 * Portal session creation.
 * Lives here (and not in workspaceBilling.ts) because the Stripe SDK
 * needs the node runtime. Subscription access is granted only by a
 * verified Stripe webhook, never when Checkout is merely opened.
 *
 * Returns one of:
 *   • { kind: "redirect", url } when Stripe is fully configured →
 *     the client redirects to that URL.
 *   • { kind: "simulate", reason } when Stripe keys / prices are
 *     missing → the client may fall back to `simulateActivate` and
 *     surfaces the reason so the operator knows what to set.
 */

// Stripe price IDs. We reuse the legacy env var names so existing
// Stripe products keep working without rotation. Mapping:
//   STRIPE_PRICE_BASIC_MONTHLY → "basic" plan ($25 / 500 GB) — monthly
//   STRIPE_PRICE_PRO_MONTHLY   → "pro"   plan ($50 / 2 TB) — monthly
//   STRIPE_PRICE_BASIC_ANNUAL  → "basic" plan, billed annually (17% off)
//   STRIPE_PRICE_PRO_ANNUAL    → "pro"   plan, billed annually (17% off)
const PRICE_ENV: Record<"basic" | "pro", Record<"monthly" | "annual", string>> = {
  basic: {
    monthly: "STRIPE_PRICE_BASIC_MONTHLY",
    annual: "STRIPE_PRICE_BASIC_ANNUAL",
  },
  pro: {
    monthly: "STRIPE_PRICE_PRO_MONTHLY",
    annual: "STRIPE_PRICE_PRO_ANNUAL",
  },
};

const V2_MONTHLY_PRICE_ENV: Record<"basic" | "pro", string> = {
  basic: "STRIPE_PRICE_BASIC_MONTHLY_V2",
  pro: "STRIPE_PRICE_PRO_MONTHLY_V2",
};

type AddOnKey = "whiteLabel" | "customDomain" | "apiTier";

const ADD_ON_PRICE_CENTS: Record<AddOnKey, number> = {
  whiteLabel: 2000,
  customDomain: 1000,
  apiTier: 3000,
};

const ADD_ON_PRICE_ENV: Record<
  AddOnKey,
  Record<"monthly" | "annual", string>
> = {
  whiteLabel: {
    monthly: "STRIPE_PRICE_ADDON_WHITE_LABEL_MONTHLY",
    annual: "STRIPE_PRICE_ADDON_WHITE_LABEL_ANNUAL",
  },
  customDomain: {
    monthly: "STRIPE_PRICE_ADDON_CUSTOM_DOMAIN_MONTHLY",
    annual: "STRIPE_PRICE_ADDON_CUSTOM_DOMAIN_ANNUAL",
  },
  apiTier: {
    monthly: "STRIPE_PRICE_ADDON_API_TIER_MONTHLY",
    annual: "STRIPE_PRICE_ADDON_API_TIER_ANNUAL",
  },
};

function normalizeHostname(value: string | undefined): string | undefined {
  const hostname = value?.trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) return undefined;
  if (
    hostname.length > 253 ||
    !hostname.includes(".") ||
    !/^[a-z0-9.-]+$/.test(hostname) ||
    hostname.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))
  ) {
    throw new Error("Enter a valid custom-domain hostname.");
  }
  return hostname;
}

function validatedReturnUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Billing return URLs must use HTTP or HTTPS.");
  }

  const configuredAppUrl = process.env.APP_URL;
  if (configuredAppUrl) {
    const allowed = new URL(configuredAppUrl);
    const isLocalhost =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    // Treat apex and www as the same site. APP_URL was set to the apex while
    // the app is served from www, so every billing return URL failed this
    // check and BOTH checkout and the portal were dead. A redirect pair is
    // not a security boundary, and one character of config drift should not
    // be able to take payments offline.
    const bare = (host: string) => host.replace(/^www\./, "");
    const sameSite =
      url.protocol === allowed.protocol && bare(url.host) === bare(allowed.host);
    if (!sameSite && !isLocalhost) {
      throw new Error(
        `Billing return URL ${url.origin} is not ${allowed.origin} (APP_URL). ` +
          `Set APP_URL to the origin the app is served from.`,
      );
    }
  }
  return url.toString();
}

export const createCheckout = action({
  args: {
    plan: v.string(),
    successUrl: v.string(),
    cancelUrl: v.string(),
    // Defaults to monthly so existing call sites that don't pass
    // cadence keep their current behavior. Pass "annual" to use the
    // 17%-off yearly price.
    cadence: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
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
    const cadence = args.cadence ?? "monthly";

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const legacyPriceEnvName = PRICE_ENV[requestedPlan][cadence];
    const v2PriceEnvName = V2_MONTHLY_PRICE_ENV[requestedPlan];
    const priceEnvName = cadence === "monthly" ? v2PriceEnvName : legacyPriceEnvName;
    const priceId =
      process.env[priceEnvName] ?? process.env[legacyPriceEnvName];

    if (!stripeSecret || stripeSecret.trim().length === 0) {
      return {
        kind: "simulate",
        reason:
          "STRIPE_SECRET_KEY is not set on this Convex deployment. Activation will run in demo mode.",
      };
    }
    if (!priceId || priceId.trim().length === 0) {
      throw new Error(
        `${priceEnvName} is not configured. Checkout was not started.`,
      );
    }

    const stripe = new Stripe(stripeSecret);
    const tier = await ctx.runQuery(api.workspaceBilling.getTier, {
      plan: requestedPlan,
    });
    const current = await ctx.runQuery(
      api.workspaceBilling.getMySubscription,
      {},
    );
    if (
      current?.stripeSubscriptionId &&
      (current.status === "active" ||
        current.status === "trialing" ||
        current.status === "past_due")
    ) {
      throw new Error(
        "This workspace already has a Stripe subscription. Manage it in the billing portal.",
      );
    }

    const price = await stripe.prices.retrieve(priceId);
    const expectedAmount =
      cadence === "monthly" ? tier.baseCents : tier.baseCents * 10;
    const expectedInterval = cadence === "monthly" ? "month" : "year";
    if (
      !price.active ||
      price.currency !== tier.currency ||
      price.unit_amount !== expectedAmount ||
      price.recurring?.interval !== expectedInterval
    ) {
      // Name both sides. "does not match" told nobody which number to change,
      // and this guard sits between the user and paying us.
      const dollars = (cents: number | null) =>
        cents == null ? "unset" : `$${(cents / 100).toFixed(2)}`;
      throw new Error(
        `${priceEnvName} (${priceId}) is ${dollars(price.unit_amount)} ` +
          `${price.currency}/${price.recurring?.interval ?? "one-time"}` +
          `${price.active ? "" : ", inactive"}, but the ${tier.label} ${cadence} ` +
          `plan expects ${dollars(expectedAmount)} ${tier.currency}/${expectedInterval}. ` +
          `Fix the Stripe price or the tier in convex/workspaceBilling.ts.`,
      );
    }

    const successUrl = validatedReturnUrl(args.successUrl);
    const cancelUrl = validatedReturnUrl(args.cancelUrl);
    const customer = current?.stripeCustomerId;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer: customer || undefined,
      customer_email:
        !customer && typeof identity.email === "string"
          ? identity.email
          : undefined,
      metadata: {
        ownerClerkId: identity.subject,
        plan: requestedPlan,
        cadence,
      },
      subscription_data: {
        metadata: {
          ownerClerkId: identity.subject,
          plan: requestedPlan,
          cadence,
        },
      },
    });

    if (!session.url) {
      throw new Error("Stripe didn't return a checkout URL.");
    }

    return { kind: "redirect", url: session.url };
  },
});

export const createPortal = action({
  args: { returnUrl: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) throw new Error("Stripe is not configured.");

    const current = await ctx.runQuery(
      api.workspaceBilling.getMySubscription,
      {},
    );
    if (!current?.stripeCustomerId) {
      throw new Error("No Stripe customer exists for this workspace yet.");
    }

    const stripe = new Stripe(stripeSecret);
    const session = await stripe.billingPortal.sessions.create({
      customer: current.stripeCustomerId,
      return_url: validatedReturnUrl(args.returnUrl),
    });
    return { url: session.url };
  },
});

/**
 * Row shape for the billing history table. Declared explicitly because the
 * handler calls ctx.runQuery(api.*), and `api` is generated from this
 * file's own exports — inferring the return type from the body is
 * self-referential and collapses to `any` under convex typecheck.
 */
type InvoiceRow = {
  id: string;
  createdAt: number;
  description: string;
  status: string;
  amountPaidCents: number;
  currency: string;
  hostedInvoiceUrl: string | null;
};

/** Recent subscription invoices for the compact billing history table. */
export const listRecentInvoices = action({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      id: v.string(),
      createdAt: v.number(),
      description: v.string(),
      status: v.string(),
      amountPaidCents: v.number(),
      currency: v.string(),
      hostedInvoiceUrl: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args): Promise<InvoiceRow[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");

    const current = await ctx.runQuery(api.workspaceBilling.getMySubscription, {});
    const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
    if (!stripeSecret || !current?.stripeCustomerId) return [];

    const stripe = new Stripe(stripeSecret);
    const invoices = await stripe.invoices.list({
      customer: current.stripeCustomerId,
      limit: Math.max(1, Math.min(args.limit ?? 6, 24)),
    });

    return invoices.data.map((invoice: Stripe.Invoice): InvoiceRow => ({
      id: invoice.id,
      createdAt: invoice.created * 1000,
      description:
        invoice.lines.data[0]?.description ??
        `${current.plan.charAt(0).toUpperCase()}${current.plan.slice(1)} plan`,
      status: invoice.status ?? "open",
      amountPaidCents: invoice.amount_paid,
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    }));
  },
});

/**
 * Add/remove a recurring Stripe SubscriptionItem, then persist the feature
 * state. Stripe is authoritative in production; local toggles are used only
 * when the deployment has no Stripe key (demo/self-host mode).
 */
export const updateAddOn = action({
  args: {
    addOn: v.union(
      v.literal("whiteLabel"),
      v.literal("customDomain"),
      v.literal("apiTier"),
    ),
    enabled: v.boolean(),
    customDomain: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ enabled: boolean; billed: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const current = await ctx.runQuery(api.workspaceBilling.getMySubscription, {});
    if (
      !current ||
      !["active", "trialing"].includes(current.status) ||
      current.plan === "free"
    ) {
      throw new Error("Subscribe to Basic or Pro before adding optional features.");
    }
    const hostname =
      args.addOn === "customDomain" && args.enabled
        ? normalizeHostname(args.customDomain)
        : undefined;
    if (args.addOn === "customDomain" && args.enabled && !hostname) {
      throw new Error("Enter the custom-domain hostname to enable this add-on.");
    }

    const stripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
    if (!stripeSecret) {
      if (args.addOn === "customDomain") {
        await ctx.runMutation(api.workspaceBilling.setCustomDomain, {
          hostname: args.enabled ? (hostname ?? null) : null,
        });
      } else {
        await ctx.runMutation(api.workspaceBilling.toggleAddOn, {
          addOn: args.addOn,
          enabled: args.enabled,
        });
      }
      return { enabled: args.enabled, billed: false };
    }
    if (!current.stripeSubscriptionId) {
      throw new Error("Stripe has not attached a subscription ID to this workspace yet.");
    }

    const cadence = current.billingCadence === "annual" ? "annual" : "monthly";
    const priceEnvName = ADD_ON_PRICE_ENV[args.addOn][cadence];
    const priceId = process.env[priceEnvName]?.trim();
    if (!priceId) {
      throw new Error(`${priceEnvName} is not configured. The add-on was not changed.`);
    }
    const stripe = new Stripe(stripeSecret);
    const subscription = await stripe.subscriptions.retrieve(
      current.stripeSubscriptionId,
      { expand: ["items.data.price"] },
    );
    if (!["active", "trialing"].includes(subscription.status)) {
      throw new Error("The Stripe subscription is not active.");
    }
    const storedItemId = current.stripeAddOnItemIds?.[args.addOn];
    const existingItem = subscription.items.data.find(
      (item) =>
        item.id === storedItemId ||
        item.price.id === priceId ||
        item.metadata?.snip_add_on === args.addOn,
    );

    let itemId: string | undefined;
    if (args.enabled) {
      const price = await stripe.prices.retrieve(priceId);
      const expectedAmount =
        cadence === "annual"
          ? ADD_ON_PRICE_CENTS[args.addOn] * 10
          : ADD_ON_PRICE_CENTS[args.addOn];
      const expectedInterval = cadence === "annual" ? "year" : "month";
      if (
        !price.active ||
        price.currency !== "usd" ||
        price.unit_amount !== expectedAmount ||
        price.recurring?.interval !== expectedInterval
      ) {
        throw new Error(`${priceEnvName} does not match the configured add-on price.`);
      }
      const metadata = {
        snip_add_on: args.addOn,
        ...(hostname ? { custom_domain_hostname: hostname } : {}),
      };
      if (existingItem) {
        const updated = await stripe.subscriptionItems.update(existingItem.id, {
          ...(existingItem.price.id !== priceId ? { price: priceId } : {}),
          metadata,
          proration_behavior: "create_prorations",
        });
        itemId = updated.id;
      } else {
        const created = await stripe.subscriptionItems.create({
          subscription: subscription.id,
          price: priceId,
          quantity: 1,
          metadata,
          proration_behavior: "create_prorations",
        });
        itemId = created.id;
      }
    } else if (existingItem) {
      await stripe.subscriptionItems.del(existingItem.id, {
        proration_behavior: "create_prorations",
      });
    }

    await ctx.runMutation(internal.workspaceBilling.recordAddOnBillingState, {
      ownerClerkId: identity.subject,
      stripeSubscriptionId: subscription.id,
      addOn: args.addOn,
      enabled: args.enabled,
      stripeSubscriptionItemId: itemId,
      customDomain: hostname,
    });
    return { enabled: args.enabled, billed: true };
  },
});
