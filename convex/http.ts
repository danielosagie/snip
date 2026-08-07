import { registerRoutes } from "@convex-dev/stripe";
import { httpRouter, makeFunctionReference } from "convex/server";
import { httpAction } from "./_generated/server";
import type Stripe from "stripe";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { resolvePlanFromStripePriceId } from "./billingHelpers";
import { extractConnectRequirements } from "./stripeConnect";

const http = httpRouter();

const recordMilestonePaymentSucceeded = makeFunctionReference<
  "mutation",
  {
    stripeCheckoutSessionId: string;
    stripePaymentIntentId?: string;
  },
  null
>("invoices:recordMilestonePaymentSucceeded");

const recordMilestonePaymentRefunded = makeFunctionReference<
  "mutation",
  { stripePaymentIntentId: string },
  null
>("invoices:recordMilestonePaymentRefunded");

type ShareUnfurlImageItem = {
  title: string;
  kind: "video" | "image" | "document";
  imageUrl: string | null;
};

type PreparedShareUnfurlImage =
  | { status: "notFound" }
  | {
      status: "ok";
      fingerprint: string;
      kind: "single" | "bundle";
      title: string;
      items: ShareUnfurlImageItem[];
    };

function escapeSvgText(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchImageDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (!contentType?.startsWith("image/")) return null;
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > 15 * 1024 * 1024) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 15 * 1024 * 1024) return null;
    return `data:${contentType};base64,${bytesToBase64(bytes)}`;
  } catch {
    return null;
  }
}

function renderUnfurlCard(params: {
  item: ShareUnfurlImageItem;
  imageDataUri: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}): string {
  const { item, imageDataUri, x, y, width, height, index } = params;
  const captionHeight = 48;
  const mediaHeight = height - captionHeight;
  const title = escapeSvgText(
    item.title.length > 34 ? `${item.title.slice(0, 33)}…` : item.title,
  );
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="#FFFFFF" stroke="#E8E8EC"/>
      <clipPath id="media-${index}">
        <path d="M ${x + 14} ${y} H ${x + width - 14} Q ${x + width} ${y} ${x + width} ${y + 14} V ${y + mediaHeight} H ${x} V ${y + 14} Q ${x} ${y} ${x + 14} ${y} Z"/>
      </clipPath>
      ${
        imageDataUri
          ? `<image href="${imageDataUri}" x="${x}" y="${y}" width="${width}" height="${mediaHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#media-${index})"/>`
          : `<rect x="${x}" y="${y}" width="${width}" height="${mediaHeight}" fill="#F1F1F3" clip-path="url(#media-${index})"/>
             <text x="${x + width / 2}" y="${y + mediaHeight / 2 + 7}" text-anchor="middle" font-family="Geist Mono, ui-monospace, monospace" font-size="18" letter-spacing="2" fill="#A0A0A5">${item.kind.toUpperCase()}</text>`
      }
      <line x1="${x}" y1="${y + mediaHeight}" x2="${x + width}" y2="${y + mediaHeight}" stroke="#F1F1F3"/>
      <text x="${x + 16}" y="${y + mediaHeight + 30}" font-family="Inter Tight, Arial, sans-serif" font-size="18" font-weight="600" fill="#131315">${title}</text>
    </g>`;
}

function renderShareUnfurlSvg(params: {
  kind: "single" | "bundle";
  title: string;
  items: ShareUnfurlImageItem[];
  inlineImages: Array<string | null>;
}): string {
  const { kind, title, items, inlineImages } = params;
  const singleItem = items[0];
  if (kind === "single" && singleItem?.kind === "image") {
    const image = inlineImages[0];
    if (!image) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
        <rect width="1200" height="630" fill="#FAFAFA"/>
        <rect x="48" y="48" width="1104" height="534" rx="14" fill="#FFFFFF" stroke="#E8E8EC"/>
        <text x="600" y="320" text-anchor="middle" font-family="Geist Mono, ui-monospace, monospace" font-size="18" letter-spacing="2" fill="#A0A0A5">IMAGE</text>
      </svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <rect width="1200" height="630" fill="#FAFAFA"/>
      <image href="${image}" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/>
    </svg>`;
  }

  const columns = items.length > 4 ? 3 : 2;
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const gap = 18;
  const left = 48;
  const top = 116;
  const availableWidth = 1200 - left * 2;
  const availableHeight = 630 - top - 42;
  const cardWidth = (availableWidth - gap * (columns - 1)) / columns;
  const cardHeight = (availableHeight - gap * (rows - 1)) / rows;
  const cards = items
    .map((item, index) =>
      renderUnfurlCard({
        item,
        imageDataUri: inlineImages[index] ?? null,
        x: left + (index % columns) * (cardWidth + gap),
        y: top + Math.floor(index / columns) * (cardHeight + gap),
        width: cardWidth,
        height: cardHeight,
        index,
      }),
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#FAFAFA"/>
    <rect x="48" y="40" width="36" height="36" rx="10" fill="#FF6600"/>
    <text x="66" y="65" text-anchor="middle" font-family="Inter Tight, Arial, sans-serif" font-size="20" font-weight="700" fill="#FFFFFF">S</text>
    <text x="100" y="65" font-family="Inter Tight, Arial, sans-serif" font-size="24" font-weight="650" fill="#131315">${escapeSvgText(title.slice(0, 62))}</text>
    <text x="1152" y="64" text-anchor="end" font-family="Geist Mono, ui-monospace, monospace" font-size="15" letter-spacing="1.8" fill="#A0A0A5">SNIP.FILM</text>
    ${cards}
  </svg>`;
}

/**
 * Versioned OG image endpoint. Source URLs come from the Node action only
 * after its privacy gate. The HTTP action fetches and inlines the image bytes
 * so crawler rendering never depends on remote SVG subresource requests.
 */
http.route({
  pathPrefix: "/share-unfurl/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== "share-unfurl") {
      return new Response("Not found", { status: 404 });
    }
    const token = decodeURIComponent(parts[1]);
    const requestedFingerprint = parts[2].replace(/\.svg$/, "");
    const prepared = (await ctx.runAction(
      internal.videoActions.prepareShareUnfurlImage,
      { token, requestedFingerprint },
    )) as PreparedShareUnfurlImage;
    if (prepared.status === "notFound") {
      return new Response("Not found", { status: 404 });
    }
    if (
      request.headers.get("if-none-match") === `"${prepared.fingerprint}"`
    ) {
      return new Response(null, {
        status: 304,
        headers: { ETag: `"${prepared.fingerprint}"` },
      });
    }

    const inlineImages = await Promise.all(
      prepared.items.map((item) =>
        item.imageUrl
          ? fetchImageDataUri(item.imageUrl)
          : Promise.resolve(null),
      ),
    );
    const svg = renderShareUnfurlSvg({
      kind: prepared.kind,
      title: prepared.title,
      items: prepared.items,
      inlineImages,
    });
    return new Response(svg, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=31536000, immutable",
        ETag: `"${prepared.fingerprint}"`,
        "x-content-type-options": "nosniff",
      },
    });
  }),
});

function getSubscriptionPriceId(subscription: Stripe.Subscription): string | undefined {
  return subscription.items.data.find((item) =>
    Boolean(resolvePlanFromStripePriceId(item.price?.id)),
  )?.price?.id;
}

type AddOnKey = "whiteLabel" | "customDomain" | "apiTier";

const ADD_ON_PRICE_ENV: Record<AddOnKey, readonly string[]> = {
  whiteLabel: [
    "STRIPE_PRICE_ADDON_WHITE_LABEL_MONTHLY",
    "STRIPE_PRICE_ADDON_WHITE_LABEL_ANNUAL",
  ],
  customDomain: [
    "STRIPE_PRICE_ADDON_CUSTOM_DOMAIN_MONTHLY",
    "STRIPE_PRICE_ADDON_CUSTOM_DOMAIN_ANNUAL",
  ],
  apiTier: [
    "STRIPE_PRICE_ADDON_API_TIER_MONTHLY",
    "STRIPE_PRICE_ADDON_API_TIER_ANNUAL",
  ],
};

function getSubscriptionAddOnItems(subscription: Stripe.Subscription) {
  const result: {
    whiteLabel?: string;
    customDomain?: string;
    customDomainHostname?: string;
    apiTier?: string;
  } = {};
  let configuredOrFound = false;
  for (const addOn of Object.keys(ADD_ON_PRICE_ENV) as AddOnKey[]) {
    const configuredPrices = ADD_ON_PRICE_ENV[addOn]
      .map((name) => process.env[name]?.trim())
      .filter((id): id is string => Boolean(id));
    if (configuredPrices.length) configuredOrFound = true;
    const item = subscription.items.data.find(
      (candidate) =>
        candidate.metadata?.snip_add_on === addOn ||
        configuredPrices.includes(candidate.price.id),
    );
    if (!item) continue;
    configuredOrFound = true;
    result[addOn] = item.id;
    if (addOn === "customDomain") {
      const hostname = item.metadata?.custom_domain_hostname;
      if (hostname) result.customDomainHostname = hostname;
    }
  }
  return configuredOrFound ? result : undefined;
}

function getSubscriptionOrgId(subscription: Stripe.Subscription): string | undefined {
  const orgId = subscription.metadata.orgId;
  return typeof orgId === "string" && orgId.length > 0 ? orgId : undefined;
}

function getSubscriptionOwnerClerkId(
  subscription: Stripe.Subscription,
): string | undefined {
  const ownerClerkId = subscription.metadata.ownerClerkId;
  return typeof ownerClerkId === "string" && ownerClerkId.length > 0
    ? ownerClerkId
    : undefined;
}

function getSubscriptionPlanMetadata(
  subscription: Stripe.Subscription,
): string | undefined {
  const plan = subscription.metadata.plan;
  return typeof plan === "string" && plan.length > 0 ? plan : undefined;
}

function getSubscriptionCadence(
  subscription: Stripe.Subscription,
): "monthly" | "annual" | undefined {
  return subscription.metadata.cadence === "annual"
    ? "annual"
    : subscription.metadata.cadence === "monthly"
      ? "monthly"
      : undefined;
}

function getSubscriptionPeriodEnd(
  subscription: Stripe.Subscription,
): number | undefined {
  const item = subscription.items.data[0];
  const periodEnd = item?.current_period_end;
  return typeof periodEnd === "number" ? periodEnd * 1000 : undefined;
}

type WebhookMutationCtx = {
  // The Stripe component event handlers receive an action-shaped ctx
  // that exposes runMutation. The full Convex types live inside the
  // generated component bindings; this loose shape is enough for us
  // to dispatch into two internal mutations side-by-side.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMutation: (mutation: any, args: any) => Promise<unknown>;
};

async function syncBothBillingSurfaces(
  ctx: WebhookMutationCtx,
  subscription: Stripe.Subscription,
) {
  // Same Stripe event might map to a legacy per-team sub OR a new
  // workspace-level sub. Both sync mutations are idempotent and ignore
  // events that don't match their schema (legacy needs `orgId`,
  // workspace needs `ownerClerkId`), so calling both is safe.
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : undefined;
  await Promise.all([
    ctx.runMutation(internal.billing.syncTeamSubscriptionFromWebhook, {
      orgId: getSubscriptionOrgId(subscription),
      stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: getSubscriptionPriceId(subscription),
      status: subscription.status,
    }),
    ctx.runMutation(
      internal.workspaceBilling.syncWorkspaceSubscriptionFromWebhook,
      {
        ownerClerkId: getSubscriptionOwnerClerkId(subscription),
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: getSubscriptionPriceId(subscription),
        plan: getSubscriptionPlanMetadata(subscription),
        status: subscription.status,
        currentPeriodEnd: getSubscriptionPeriodEnd(subscription),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        billingCadence: getSubscriptionCadence(subscription),
        addOnItems: getSubscriptionAddOnItems(subscription),
      },
    ),
  ]);
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

registerRoutes(http, components.stripe, {
  webhookPath: "/stripe/webhook",
  events: {
    "customer.subscription.created": async (
      ctx,
      event: Stripe.Event & { type: "customer.subscription.created" },
    ) => {
      await syncBothBillingSurfaces(ctx, event.data.object as Stripe.Subscription);
    },
    "customer.subscription.updated": async (
      ctx,
      event: Stripe.Event & { type: "customer.subscription.updated" },
    ) => {
      await syncBothBillingSurfaces(ctx, event.data.object as Stripe.Subscription);
    },
    "customer.subscription.deleted": async (
      ctx,
      event: Stripe.Event & { type: "customer.subscription.deleted" },
    ) => {
      await syncBothBillingSurfaces(ctx, event.data.object as Stripe.Subscription);
    },
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
        requirements: extractConnectRequirements(account),
      });
    },
    // Client payment fulfillment. New kinds route explicitly; sessions that
    // predate metadata.kind continue through the legacy payment path.
    "checkout.session.completed": async (
      ctx,
      event: Stripe.Event & { type: "checkout.session.completed" },
    ) => {
      const session = event.data.object as Stripe.Checkout.Session;
      // Subscriptions are handled separately by customer.subscription.created above.
      if (session.mode !== "payment") return;
      if (session.payment_status !== "paid") return;
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      switch (session.metadata?.kind) {
        case "invoice_milestone":
          await ctx.runMutation(recordMilestonePaymentSucceeded, {
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
          });
          break;
        case "share_item":
        case "share_all":
        case "video":
        default:
          // Fulfillment is driven by the server-recorded payment kind. The
          // default keeps metadata-less legacy Checkout Sessions working.
          break;
      }
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
      await ctx.runMutation(
        recordMilestonePaymentRefunded,
        { stripePaymentIntentId: paymentIntentId },
      );
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

// Cloudflare Stream webhook — parallel to /webhooks/mux. Stream uses a
// different signature scheme + event shape, so the processor in
// cloudflareStreamActions handles its own verification + parsing. The
// route stays no-op if CF_STREAM_WEBHOOK_SECRET isn't configured.
http.route({
  path: "/webhooks/cf-stream",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const signature = request.headers.get("webhook-signature") ?? undefined;
    try {
      const result = await ctx.runAction(
        internal.cloudflareStreamActions.processWebhook,
        { rawBody, signature },
      );
      return new Response(result.message, { status: result.status });
    } catch (error) {
      console.error("Cloudflare Stream webhook proxy failed", error);
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
