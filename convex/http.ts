import { registerRoutes } from "@convex-dev/stripe";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import type Stripe from "stripe";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

function getSubscriptionPriceId(subscription: Stripe.Subscription): string | undefined {
  return subscription.items.data[0]?.price?.id;
}

function getSubscriptionOrgId(subscription: Stripe.Subscription): string | undefined {
  const orgId = subscription.metadata.orgId;
  return typeof orgId === "string" && orgId.length > 0 ? orgId : undefined;
}

function stripeSubscriptionPeriodEnd(
  subscription: Stripe.Subscription,
): number | undefined {
  const sub = subscription as unknown as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const fromItems = sub.items?.data?.[0]?.current_period_end;
  const value = sub.current_period_end ?? fromItems;
  return typeof value === "number" ? value * 1000 : undefined;
}

function deriveConnectStatusFromAccount(
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

async function syncSubscription(
  ctx: Parameters<Parameters<typeof registerRoutes>[2]["events"]["customer.subscription.created"]>[0],
  subscription: Stripe.Subscription,
) {
  // Team-level billing (teams.plan, teams.stripeSubscriptionId).
  await ctx.runMutation(internal.billing.syncTeamSubscriptionFromWebhook, {
    orgId: getSubscriptionOrgId(subscription),
    stripeCustomerId:
      typeof subscription.customer === "string"
        ? subscription.customer
        : undefined,
    stripeSubscriptionId: subscription.id,
    stripePriceId: getSubscriptionPriceId(subscription),
    status: subscription.status,
  });
  // Workspace-level billing (workspaceSubscriptions). createCheckout in
  // convex/workspaceBillingActions.ts stamps ownerClerkId + plan onto the
  // subscription metadata so we can find the right row here. Without this
  // call the row stays at "trialing" forever even after a successful
  // Stripe payment, which is the bug that previously forced the
  // simulateActivate workaround.
  const meta = (subscription.metadata ?? {}) as Record<string, string>;
  const ownerClerkId = meta.ownerClerkId;
  const plan = meta.plan;
  if (ownerClerkId && plan) {
    await ctx.runMutation(
      internal.workspaceBilling.syncWorkspaceSubscriptionFromWebhook,
      {
        ownerClerkId,
        plan,
        status: subscription.status,
        stripeCustomerId:
          typeof subscription.customer === "string"
            ? subscription.customer
            : undefined,
        stripeSubscriptionId: subscription.id,
        // Stripe API 2025+ moved period boundaries onto the subscription
        // items level. Read both shapes so we keep working across SDK
        // versions; the runtime value is present in either case.
        currentPeriodEnd: stripeSubscriptionPeriodEnd(subscription),
        canceledAt: subscription.canceled_at
          ? subscription.canceled_at * 1000
          : undefined,
      },
    );
  }
}

registerRoutes(http, components.stripe, {
  webhookPath: "/stripe/webhook",
  events: {
    "customer.subscription.created": async (ctx, event) =>
      syncSubscription(ctx, event.data.object as Stripe.Subscription),
    "customer.subscription.updated": async (ctx, event) =>
      syncSubscription(ctx, event.data.object as Stripe.Subscription),
    "customer.subscription.deleted": async (ctx, event) =>
      syncSubscription(ctx, event.data.object as Stripe.Subscription),
    // Stripe Connect — agency's Connect account state changes.
    "account.updated": async (
      ctx,
      event: Stripe.Event & { type: "account.updated" },
    ) => {
      const account = event.data.object as Stripe.Account;
      await ctx.runMutation(internal.stripeConnect.syncAccountFromWebhook, {
        stripeAccountId: account.id,
        status: deriveConnectStatusFromAccount(account),
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
      });
    },
    // Client paid for a paywalled share link.
    "checkout.session.completed": async (
      ctx,
      event: Stripe.Event & { type: "checkout.session.completed" },
    ) => {
      const session = event.data.object as Stripe.Checkout.Session;
      // Subscriptions are handled separately by customer.subscription.created above.
      if (session.mode !== "payment") return;
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      await ctx.runMutation(internal.payments.recordPaymentSucceeded, {
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
      });
    },
    // Refunds — revoke unlock on the related grant.
    "charge.refunded": async (
      ctx,
      event: Stripe.Event & { type: "charge.refunded" },
    ) => {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
      if (!paymentIntentId) return;
      await ctx.runMutation(internal.payments.recordPaymentRefunded, {
        stripePaymentIntentId: paymentIntentId,
      });
    },
  },
});

/**
 * Resolve / Premiere plugin → snip snapshot ingest.
 *
 * Auth: Bearer pluginToken from the team. Plugin POSTs a JSON body with
 * domain-split timeline payloads + project pointer. We verify the token,
 * confirm the project belongs to the matching team, then insert a row.
 */
http.route({
  path: "/timelines/snapshot",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = request.headers.get("authorization");
    if (!auth?.toLowerCase().startsWith("bearer ")) {
      return new Response("Missing bearer token", { status: 401 });
    }
    const token = auth.slice(7).trim();
    const team = (await ctx.runQuery(
      internal.timelines.findTeamByPluginToken,
      { token },
    )) as { _id: string; name: string; slug: string } | null;
    if (!team) return new Response("Invalid plugin token", { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response("Body must be JSON", { status: 400 });
    }

    const required = [
      "projectId",
      "cuts",
      "color",
      "audio",
      "effects",
      "markers",
      "metadata",
      "message",
      "createdByName",
      "source",
    ];
    for (const key of required) {
      if (typeof body[key] !== "string") {
        return new Response(`Missing or non-string field: ${key}`, {
          status: 400,
        });
      }
    }
    const source = body["source"] as string;
    if (source !== "resolve" && source !== "premiere" && source !== "manual") {
      return new Response("source must be 'resolve' | 'premiere' | 'manual'", {
        status: 400,
      });
    }

    try {
      const snapshotId = await ctx.runMutation(
        internal.timelines.recordSnapshot,
        {
          teamId: team._id as Id<"teams">,
          projectId: body["projectId"] as Id<"projects">,
          versionId: body["versionId"] as Id<"projectVersions"> | undefined,
          cuts: body["cuts"] as string,
          color: body["color"] as string,
          audio: body["audio"] as string,
          effects: body["effects"] as string,
          markers: body["markers"] as string,
          metadata: body["metadata"] as string,
          fcpxml:
            typeof body["fcpxml"] === "string"
              ? (body["fcpxml"] as string)
              : undefined,
          branch:
            typeof body["branch"] === "string"
              ? (body["branch"] as string)
              : undefined,
          parentSnapshotId:
            typeof body["parentSnapshotId"] === "string"
              ? (body["parentSnapshotId"] as Id<"timelineSnapshots">)
              : undefined,
          message: body["message"] as string,
          sourceProjectId:
            typeof body["sourceProjectId"] === "string"
              ? (body["sourceProjectId"] as string)
              : undefined,
          sourceTimelineId:
            typeof body["sourceTimelineId"] === "string"
              ? (body["sourceTimelineId"] as string)
              : undefined,
          createdByName: body["createdByName"] as string,
          source,
        },
      );
      return new Response(
        JSON.stringify({ ok: true, snapshotId, team: team.slug }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Snapshot rejected";
      return new Response(JSON.stringify({ ok: false, error: message }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  }),
});

http.route({
  path: "/webhooks/mux",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const signature = request.headers.get("mux-signature") ?? undefined;

    try {
      const result = await ctx.runAction(internal.muxActions.processWebhook, {
        rawBody,
        signature,
      });

      return new Response(result.message, { status: result.status });
    } catch (error) {
      console.error("Mux webhook proxy failed", error);
      return new Response("Webhook processing failed", { status: 500 });
    }
  }),
});

// ─── Public signing endpoints (token-authed, real server IP) ─────────────────
//
// The signing ceremony posts here instead of calling Convex mutations directly,
// so the IP recorded in the audit trail is the one OUR server observed (not a
// value the browser self-reports, which a signer could spoof). The underlying
// mutations are internal — these endpoints are the only way in. CORS-open
// because the signer is an external party on the public sign page.
const SIGN_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function signerIp(request: Request): string | undefined {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined
  );
}

function signJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...SIGN_CORS },
  });
}

const signPreflight = httpAction(
  async () => new Response(null, { status: 204, headers: SIGN_CORS }),
);
for (const path of [
  "/contracts/sign",
  "/contracts/sign-view",
  "/contracts/sign-decline",
  "/contracts/sign-otp",
]) {
  http.route({ path, method: "OPTIONS", handler: signPreflight });
}

http.route({
  path: "/contracts/sign-view",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    if (typeof body.token !== "string") return signJson({ ok: false, error: "token required" }, 400);
    await ctx.runMutation(internal.contractsTable.recordSigningView, {
      token: body.token,
      ip: signerIp(request),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return signJson({ ok: true });
  }),
});

http.route({
  path: "/contracts/sign-otp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    if (typeof body.token !== "string") return signJson({ ok: false, error: "token required" }, 400);
    const issued = await ctx.runMutation(internal.contractsTable.issueSignOtp, {
      token: body.token,
    });
    if (!issued) return signJson({ ok: false, error: "Invalid or closed signing link." }, 400);
    const { sent } = await ctx.runAction(internal.email.sendContractOtp, {
      email: issued.email,
      code: issued.code,
      contractTitle: issued.contractTitle,
    });
    // Mask the address so the UI can say "sent to a•••@x.com" without leaking it.
    const masked = issued.email.replace(/^(.).*(@.*)$/, "$1•••$2");
    return signJson({ ok: true, sent, email: masked });
  }),
});

http.route({
  path: "/contracts/sign",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      typedSignatureName?: string;
      signatureDataUrl?: string;
      consented?: boolean;
      otpCode?: string;
      fieldValues?: Array<{ fieldId: string; value: string }>;
    };
    if (typeof body.token !== "string") return signJson({ ok: false, error: "token required" }, 400);
    try {
      const result = await ctx.runMutation(internal.contractsTable.sign, {
        token: body.token,
        typedSignatureName: body.typedSignatureName,
        signatureDataUrl: body.signatureDataUrl,
        consented: Boolean(body.consented),
        otpCode: body.otpCode,
        // Convex validates the id strings at the mutation boundary.
        fieldValues: body.fieldValues as never,
        ip: signerIp(request),
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      return signJson({ ok: true, ...result });
    } catch (e) {
      return signJson({ ok: false, error: e instanceof Error ? e.message : "Failed to sign." }, 400);
    }
  }),
});

http.route({
  path: "/contracts/sign-decline",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      reason?: string;
    };
    if (typeof body.token !== "string") return signJson({ ok: false, error: "token required" }, 400);
    try {
      await ctx.runMutation(internal.contractsTable.decline, {
        token: body.token,
        reason: body.reason,
        ip: signerIp(request),
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      return signJson({ ok: true });
    } catch (e) {
      return signJson({ ok: false, error: e instanceof Error ? e.message : "Failed to decline." }, 400);
    }
  }),
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response("OK", { status: 200 });
  }),
});

export default http;
