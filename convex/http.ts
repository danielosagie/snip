import { registerRoutes } from "@convex-dev/stripe";
import { Presence } from "@convex-dev/presence";
import { httpRouter, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  httpAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import type Stripe from "stripe";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type {
  RenderCacheResult,
  RenderWorkerSpec,
  TimelinePresencePayload,
} from "../src/lib/timeline/types";
import {
  isTimelinePresencePayload,
  normalizeTimelinePresencePayload,
} from "../src/components/presence/model";
import { isFeatureEnabled } from "./featureFlags";
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
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;

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
      // Fresh branches are immediately presence-ready. The scheduled FCPXML
      // import replaces this empty document once conversion completes.
      await ctx.runMutation(ensureNleTimelineDocRef, {
        teamId: team._id,
        projectId: body["projectId"] as Id<"projects">,
        branch:
          typeof body["branch"] === "string"
            ? (body["branch"] as string)
            : undefined,
        sequenceName:
          typeof body["sourceTimelineId"] === "string"
            ? (body["sourceTimelineId"] as string)
            : undefined,
      });
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

// -----------------------------------------------------------------------------
// Agent E review: thin plugin-token HTTP surface for native NLE panels.
//
// These functions intentionally live beside their HTTP routes so Agent A can
// move them into the timeline hub once timelineDocs.ts and the OTIO importer
// land. They do not change the existing snapshot POST route.
// -----------------------------------------------------------------------------

const nlePresence = new Presence(components.presence);
const NLE_PRESENCE_INTERVAL_MS = 5_000;

const nleTimelineTimeValidator = v.object({
  value: v.number(),
  rate: v.number(),
});

const nleTimelineRangeValidator = v.object({
  start: nleTimelineTimeValidator,
  duration: nleTimelineTimeValidator,
});

const nleTimelinePresenceValidator = v.object({
  playheadPosition: nleTimelineTimeValidator,
  selectedClipIds: v.array(v.string()),
  viewportRange: nleTimelineRangeValidator,
  softLocks: v.array(
    v.object({
      target: v.union(
        v.object({ kind: v.literal("sequence"), sequenceId: v.string() }),
        v.object({ kind: v.literal("file"), path: v.string() }),
      ),
      holder: v.string(),
      claimedAt: v.number(),
    }),
  ),
});

const nleSurfaceValidator = v.union(
  v.literal("browser"),
  v.literal("desktop"),
  v.literal("premiere"),
  v.literal("resolve"),
);

type NleSurface = "browser" | "desktop" | "premiere" | "resolve";

type NlePresenceData = {
  actorId: string;
  displayName: string;
  avatarUrl?: string;
  updatedAt: number;
  payload: TimelinePresencePayload;
  sessionId?: string;
  surface?: NleSurface;
  sourceProjectId?: string;
  sourceTimelineId?: string;
  timelineName?: string;
};

type NlePresenceListItem = {
  id: string;
  actorId: string;
  sessionId?: string;
  displayName: string;
  avatarUrl?: string;
  surface: NleSurface;
  sourceTimelineId?: string;
  timelineName?: string;
  payload: TimelinePresencePayload;
  updatedAt: number;
};

type PluginTeam = { _id: Id<"teams">; name: string; slug: string };

function isNlePresenceData(value: unknown): value is NlePresenceData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<NlePresenceData>;
  return (
    typeof data.actorId === "string" &&
    typeof data.displayName === "string" &&
    typeof data.updatedAt === "number" &&
    Number.isFinite(data.updatedAt) &&
    isTimelinePresencePayload(data.payload)
  );
}

async function authenticateNlePlugin(
  ctx: ActionCtx,
  request: Request,
): Promise<PluginTeam | Response> {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) {
    return new Response("Missing bearer token", { status: 401 });
  }
  const token = auth.slice(7).trim();
  const team = (await ctx.runQuery(internal.timelines.findTeamByPluginToken, {
    token,
  })) as PluginTeam | null;
  return team ?? new Response("Invalid plugin token", { status: 401 });
}

function nleJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const agentEHeartbeatNlePresence = internalMutation({
  args: {
    timelineDocId: v.id("timelineDocs"),
    sessionId: v.string(),
    displayName: v.string(),
    surface: nleSurfaceValidator,
    sourceProjectId: v.string(),
    sourceTimelineId: v.string(),
    timelineName: v.string(),
    payload: nleTimelinePresenceValidator,
  },
  returns: v.object({ roomToken: v.string() }),
  handler: async (ctx, args) => {
    const roomId = `timeline-doc:${args.timelineDocId}`;
    const userId = `nle:${args.surface}:${args.sessionId}`;
    const now = Date.now();
    const payload = normalizeTimelinePresencePayload(args.payload, userId, now);
    if (!payload) throw new Error("Invalid timeline presence.");
    const result = await nlePresence.heartbeat(
      ctx,
      roomId,
      userId,
      args.sessionId,
      NLE_PRESENCE_INTERVAL_MS,
    );
    await nlePresence.updateRoomUser(ctx, roomId, userId, {
      actorId: userId,
      sessionId: args.sessionId,
      displayName: args.displayName,
      surface: args.surface,
      sourceProjectId: args.sourceProjectId,
      sourceTimelineId: args.sourceTimelineId,
      timelineName: args.timelineName,
      payload,
      updatedAt: now,
    } satisfies NlePresenceData);
    return { roomToken: result.roomToken };
  },
});

export const agentEListNlePresence = internalQuery({
  args: { roomToken: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      actorId: v.string(),
      sessionId: v.optional(v.string()),
      displayName: v.string(),
      avatarUrl: v.optional(v.string()),
      surface: nleSurfaceValidator,
      sourceTimelineId: v.optional(v.string()),
      timelineName: v.optional(v.string()),
      payload: nleTimelinePresenceValidator,
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const entries = await nlePresence.list(ctx, args.roomToken);
    return entries
      .filter((entry) => entry.online && isNlePresenceData(entry.data))
      .map((entry) => {
        const data = entry.data as NlePresenceData;
        return {
          id: entry.userId,
          actorId: data.actorId,
          sessionId: data.sessionId,
          displayName: data.displayName,
          avatarUrl: data.avatarUrl,
          surface: data.surface ?? "browser",
          sourceTimelineId: data.sourceTimelineId,
          timelineName: data.timelineName,
          payload: data.payload,
          updatedAt: data.updatedAt,
        };
      });
  },
});

export const agentEListNleSnapshots = internalQuery({
  args: {
    projectId: v.id("projects"),
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.teamId !== args.teamId) {
      throw new Error("Project not found for this team.");
    }
    const snapshots = await ctx.db
      .query("timelineSnapshots")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
    return snapshots.map((snapshot) => ({
      id: snapshot._id,
      branch: snapshot.branch,
      message: snapshot.message,
      createdAt: snapshot._creationTime,
      createdByName: snapshot.createdByName,
      source: snapshot.source,
      sourceProjectId: snapshot.sourceProjectId,
      sourceTimelineId: snapshot.sourceTimelineId,
    }));
  },
});

export const agentEGetNleSnapshot = internalQuery({
  args: {
    projectId: v.id("projects"),
    snapshotId: v.id("timelineSnapshots"),
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    if (
      !snapshot ||
      snapshot.projectId !== args.projectId ||
      snapshot.teamId !== args.teamId
    ) {
      return null;
    }
    return {
      id: snapshot._id,
      branch: snapshot.branch,
      message: snapshot.message,
      createdAt: snapshot._creationTime,
      createdByName: snapshot.createdByName,
      source: snapshot.source,
      sourceProjectId: snapshot.sourceProjectId,
      sourceTimelineId: snapshot.sourceTimelineId,
      fcpxml: snapshot.fcpxml ?? null,
    };
  },
});

const heartbeatNlePresenceRef = makeFunctionReference<
  "mutation",
  {
    timelineDocId: Id<"timelineDocs">;
    sessionId: string;
    displayName: string;
    surface: NleSurface;
    sourceProjectId: string;
    sourceTimelineId: string;
    timelineName: string;
    payload: TimelinePresencePayload;
  },
  { roomToken: string }
>("http:agentEHeartbeatNlePresence");

const listNlePresenceRef = makeFunctionReference<
  "query",
  { roomToken: string },
  NlePresenceListItem[]
>("http:agentEListNlePresence");

const ensureNleTimelineDocRef = makeFunctionReference<
  "mutation",
  {
    projectId: Id<"projects">;
    teamId: Id<"teams">;
    branch?: string;
    sequenceName?: string;
  },
  { id: Id<"timelineDocs">; branch: string; created: boolean }
>("timelineDocs:ensureForPlugin");

type ExternalTimelineIngestHttpResult = {
  status: "created" | "duplicate";
  snapshotId: Id<"timelineSnapshots">;
  timelineDocId: Id<"timelineDocs">;
  branch: string;
  revision: number;
};

const ingestExternalTimelineRef = makeFunctionReference<
  "mutation",
  {
    teamId: Id<"teams">;
    projectId: Id<"projects">;
    branch?: string;
    sourceFileHash: string;
    sourceFile?: string;
    sourceFormat: {
      name: string;
      version?: string;
      extension?: string;
      mimeType?: string;
    };
    sourceMetadata?: unknown;
    timeline?: unknown;
    otio?: unknown;
    message?: string;
    createdByName?: string;
    sourceProjectId?: string;
    sourceTimelineId?: string;
  },
  ExternalTimelineIngestHttpResult
>("timelineDocs:ingestExternalTimeline");

type PreparedStaticRenditionSource = {
  projectId: Id<"projects">;
  renditionName: string;
  destinationKey: string;
  expectedBytes?: number;
  contentType: string;
  r2Key?: string;
  claimToken?: string;
  sourceUrl?: string;
  sourceExpiresAt?: number;
};

const prepareStaticRenditionSourceRef = makeFunctionReference<
  "action",
  {
    teamId: Id<"teams">;
    videoId: Id<"videos">;
    renditionName: string;
  },
  PreparedStaticRenditionSource
>("staticRenditionMirrorActions:prepareClaim");

type StaticRenditionClaimHttpResult =
  | { status: "already_mirrored"; r2Key: string }
  | { status: "busy"; retryAfterMs: number }
  | {
      status: "claimed";
      jobId: Id<"staticRenditionMirrorJobs">;
      claimToken: string;
      leaseExpiresAt: number;
      destinationKey: string;
    };

const claimStaticRenditionRef = makeFunctionReference<
  "mutation",
  {
    teamId: Id<"teams">;
    videoId: Id<"videos">;
    renditionName: string;
    workerId: string;
    claimToken: string;
  },
  StaticRenditionClaimHttpResult
>("staticRenditionMirrorJobs:claim");

const completeStaticRenditionRef = makeFunctionReference<
  "mutation",
  {
    teamId: Id<"teams">;
    jobId: Id<"staticRenditionMirrorJobs">;
    workerId: string;
    claimToken: string;
    outcome: "completed" | "failed";
    r2Key?: string;
    outputBytes?: number;
    error?: string;
  },
  | { status: "completed"; r2Key: string }
  | { status: "failed"; error: string }
>("staticRenditionMirrorJobs:complete");

const listNleSnapshotsRef = makeFunctionReference<
  "query",
  { projectId: Id<"projects">; teamId: Id<"teams"> }
>("http:agentEListNleSnapshots");

const getNleSnapshotRef = makeFunctionReference<
  "query",
  {
    projectId: Id<"projects">;
    snapshotId: Id<"timelineSnapshots">;
    teamId: Id<"teams">;
  }
>("http:agentEGetNleSnapshot");

type RenderClaimResponse = {
  jobId: Id<"renderJobs">;
  claimToken: string;
  workerId: string;
  attempt: number;
  spec: RenderWorkerSpec;
} | null;

type RenderWriteResponse = {
  accepted: boolean;
  cancellationRequested: boolean;
  usage?: { renderMinutes: number; cacheHitSavingsMinutes: number };
};

const claimRenderJobRef = makeFunctionReference<
  "mutation",
  { teamId: Id<"teams">; workerId: string; leaseMs: number },
  RenderClaimResponse
>("renderJobs:claim");

const heartbeatRenderJobRef = makeFunctionReference<
  "mutation",
  {
    teamId: Id<"teams">;
    jobId: Id<"renderJobs">;
    workerId: string;
    claimToken: string;
    phase: "claimed" | "downloading" | "probing" | "rendering" | "uploading" | "complete";
    progress: number;
    message?: string;
    leaseMs: number;
  },
  RenderWriteResponse
>("renderJobs:heartbeat");

const progressRenderJobRef = makeFunctionReference<
  "mutation",
  {
    teamId: Id<"teams">;
    jobId: Id<"renderJobs">;
    workerId: string;
    claimToken: string;
    phase: "claimed" | "downloading" | "probing" | "rendering" | "uploading" | "complete";
    progress: number;
    message?: string;
  },
  RenderWriteResponse
>("renderJobs:progress");

const completeRenderJobRef = makeFunctionReference<
  "mutation",
  {
    teamId: Id<"teams">;
    jobId: Id<"renderJobs">;
    workerId: string;
    claimToken: string;
    outputObjectKey: string;
    manifestObjectKey: string;
    outputBytes: number;
    cache: RenderCacheResult;
  },
  RenderWriteResponse
>("renderJobs:complete");

const failRenderJobRef = makeFunctionReference<
  "mutation",
  {
    teamId: Id<"teams">;
    jobId: Id<"renderJobs">;
    workerId: string;
    claimToken: string;
    failure: {
      code: string;
      retryable: boolean;
      message?: string;
      detail?: Record<string, string>;
    };
  },
  boolean
>("renderJobs:fail");

const releaseRenderJobRef = makeFunctionReference<
  "mutation",
  {
    teamId: Id<"teams">;
    jobId: Id<"renderJobs">;
    workerId: string;
    claimToken: string;
    reason: string;
  },
  boolean
>("renderJobs:release");

http.route({
  path: "/timelines/presence",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return nleJson({ ok: false, error: "Body must be JSON." }, 400);

    const stringFields = [
      "projectId",
      "branch",
      "sessionId",
      "displayName",
      "surface",
      "sourceProjectId",
      "sourceTimelineId",
      "timelineName",
    ];
    if (stringFields.some((field) => typeof body[field] !== "string")) {
      return nleJson({ ok: false, error: "Presence fields are invalid." }, 400);
    }
    if (body.surface !== "resolve" && body.surface !== "premiere") {
      return nleJson({ ok: false, error: "NLE surface is invalid." }, 400);
    }
    if (
      !(body.sessionId as string).trim() ||
      (body.sessionId as string).length > 128 ||
      !(body.branch as string).trim() ||
      (body.branch as string).length > 100 ||
      (body.displayName as string).trim().length > 80 ||
      !(body.displayName as string).trim() ||
      [body.sourceProjectId, body.sourceTimelineId, body.timelineName].some(
        (value) => !(value as string).trim() || (value as string).length > 256,
      ) ||
      !body.payload ||
      typeof body.payload !== "object"
    ) {
      return nleJson({ ok: false, error: "Presence identity is invalid." }, 400);
    }

    const projectId = body.projectId as Id<"projects">;
    try {
      const timelineDoc = await ctx.runMutation(ensureNleTimelineDocRef, {
        projectId,
        teamId: team._id,
        branch: (body.branch as string).trim(),
        sequenceName: body.timelineName as string,
      });
      const { roomToken } = await ctx.runMutation(heartbeatNlePresenceRef, {
        timelineDocId: timelineDoc.id,
        sessionId: body.sessionId as string,
        displayName: (body.displayName as string).trim(),
        surface: body.surface,
        sourceProjectId: body.sourceProjectId as string,
        sourceTimelineId: body.sourceTimelineId as string,
        timelineName: body.timelineName as string,
        payload: body.payload as TimelinePresencePayload,
      });
      const teammates = await ctx.runQuery(listNlePresenceRef, { roomToken });
      return nleJson({ ok: true, timelineDocId: timelineDoc.id, teammates });
    } catch (error) {
      return nleJson({ ok: false, error: error instanceof Error ? error.message : "Presence rejected." }, 400);
    }
  }),
});

http.route({
  path: "/desktop/timelines/ingest",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return nleJson({ ok: false, error: "Body must be JSON." }, 400);
    if (
      typeof body.projectId !== "string" ||
      typeof body.sourceFileHash !== "string" ||
      !body.sourceFormat ||
      typeof body.sourceFormat !== "object" ||
      typeof (body.sourceFormat as Record<string, unknown>).name !== "string"
    ) {
      return nleJson(
        {
          ok: false,
          error: "projectId, sourceFileHash, and sourceFormat.name are required.",
        },
        400,
      );
    }
    if ((body.timeline === undefined) === (body.otio === undefined)) {
      return nleJson(
        { ok: false, error: "Provide exactly one of timeline or otio." },
        400,
      );
    }

    const parseEmbeddedJson = (value: unknown) => {
      if (typeof value !== "string") return value;
      return JSON.parse(value) as unknown;
    };
    try {
      const format = body.sourceFormat as Record<string, unknown>;
      const result = await ctx.runMutation(ingestExternalTimelineRef, {
        teamId: team._id,
        projectId: body.projectId as Id<"projects">,
        branch: typeof body.branch === "string" ? body.branch : undefined,
        sourceFileHash: body.sourceFileHash,
        sourceFile:
          typeof body.sourceFile === "string" ? body.sourceFile : undefined,
        sourceFormat: {
          name: format.name as string,
          version:
            typeof format.version === "string" ? format.version : undefined,
          extension:
            typeof format.extension === "string" ? format.extension : undefined,
          mimeType:
            typeof format.mimeType === "string" ? format.mimeType : undefined,
        },
        sourceMetadata: body.sourceMetadata,
        timeline:
          body.timeline === undefined
            ? undefined
            : parseEmbeddedJson(body.timeline),
        otio:
          body.otio === undefined ? undefined : parseEmbeddedJson(body.otio),
        message: typeof body.message === "string" ? body.message : undefined,
        createdByName:
          typeof body.createdByName === "string"
            ? body.createdByName
            : undefined,
        sourceProjectId:
          typeof body.sourceProjectId === "string"
            ? body.sourceProjectId
            : undefined,
        sourceTimelineId:
          typeof body.sourceTimelineId === "string"
            ? body.sourceTimelineId
            : undefined,
      });
      return nleJson({ ok: true, ...result });
    } catch (error) {
      return nleJson(
        {
          ok: false,
          error:
            error instanceof Error ? error.message : "Timeline ingest rejected.",
        },
        400,
      );
    }
  }),
});

http.route({
  path: "/desktop/renditions/mirror/claim",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    if (!isFeatureEnabled("usingR2") || !isFeatureEnabled("muxSignedPlayback")) {
      return nleJson(
        {
          ok: false,
          error: "Signed Mux playback and R2 storage must be configured.",
        },
        503,
      );
    }
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !body ||
      typeof body.videoId !== "string" ||
      typeof body.renditionName !== "string" ||
      typeof body.workerId !== "string"
    ) {
      return nleJson(
        { ok: false, error: "videoId, renditionName, and workerId are required." },
        400,
      );
    }

    try {
      const bucket = process.env.R2_BUCKET_NAME?.trim();
      const endpoint = process.env.R2_ENDPOINT?.trim();
      if (!bucket || !endpoint) {
        throw new Error("R2 destination is not configured.");
      }
      const videoId = body.videoId as Id<"videos">;
      const context = await ctx.runAction(prepareStaticRenditionSourceRef, {
        teamId: team._id,
        videoId,
        renditionName: body.renditionName,
      });
      if (context.r2Key) {
        return nleJson({
          ok: true,
          status: "already_mirrored",
          r2Key: context.r2Key,
        });
      }
      if (!context.claimToken || !context.sourceUrl || !context.sourceExpiresAt) {
        throw new Error("Signed rendition source could not be prepared.");
      }
      const claim = await ctx.runMutation(claimStaticRenditionRef, {
        teamId: team._id,
        videoId,
        renditionName: context.renditionName,
        workerId: body.workerId,
        claimToken: context.claimToken,
      });
      if (claim.status !== "claimed") return nleJson({ ok: true, ...claim });
      return nleJson({
        ok: true,
        status: "claimed",
        jobId: claim.jobId,
        claimToken: claim.claimToken,
        leaseExpiresAt: claim.leaseExpiresAt,
        source: {
          url: context.sourceUrl,
          expiresAt: context.sourceExpiresAt,
          expectedBytes: context.expectedBytes,
        },
        destination: {
          provider: "r2",
          bucket,
          endpoint,
          region: process.env.R2_REGION?.trim() || "auto",
          key: claim.destinationKey,
          contentType: context.contentType,
        },
      });
    } catch (error) {
      return nleJson(
        {
          ok: false,
          error:
            error instanceof Error ? error.message : "Mirror claim rejected.",
        },
        400,
      );
    }
  }),
});

http.route({
  path: "/desktop/renditions/mirror/complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !body ||
      typeof body.jobId !== "string" ||
      typeof body.workerId !== "string" ||
      typeof body.claimToken !== "string" ||
      (body.outcome !== "completed" && body.outcome !== "failed")
    ) {
      return nleJson(
        {
          ok: false,
          error: "jobId, workerId, claimToken, and a valid outcome are required.",
        },
        400,
      );
    }
    try {
      const result = await ctx.runMutation(completeStaticRenditionRef, {
        teamId: team._id,
        jobId: body.jobId as Id<"staticRenditionMirrorJobs">,
        workerId: body.workerId,
        claimToken: body.claimToken,
        outcome: body.outcome,
        r2Key: typeof body.r2Key === "string" ? body.r2Key : undefined,
        outputBytes:
          typeof body.outputBytes === "number" ? body.outputBytes : undefined,
        error: typeof body.error === "string" ? body.error : undefined,
      });
      return nleJson({ ok: true, ...result });
    } catch (error) {
      return nleJson(
        {
          ok: false,
          error:
            error instanceof Error ? error.message : "Mirror completion rejected.",
        },
        400,
      );
    }
  }),
});

http.route({
  path: "/timelines/snapshots",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return nleJson({ ok: false, error: "Project ID is required." }, 400);
    try {
      const snapshots = await ctx.runQuery(listNleSnapshotsRef, {
        projectId: projectId as Id<"projects">,
        teamId: team._id,
      });
      return nleJson({ ok: true, snapshots });
    } catch (error) {
      return nleJson({ ok: false, error: error instanceof Error ? error.message : "Snapshots rejected." }, 400);
    }
  }),
});

http.route({
  path: "/timelines/snapshot",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const params = new URL(request.url).searchParams;
    const projectId = params.get("projectId");
    const snapshotId = params.get("snapshotId");
    if (!projectId || !snapshotId) {
      return nleJson({ ok: false, error: "Project ID and snapshot ID are required." }, 400);
    }
    try {
      const snapshot = await ctx.runQuery(getNleSnapshotRef, {
        projectId: projectId as Id<"projects">,
        snapshotId: snapshotId as Id<"timelineSnapshots">,
        teamId: team._id,
      });
      if (!snapshot) return nleJson({ ok: false, error: "Snapshot not found." }, 404);
      if (!snapshot.fcpxml) {
        return nleJson({ ok: false, error: "Snapshot has no FCPXML." }, 409);
      }
      return nleJson({ ok: true, snapshot });
    } catch (error) {
      return nleJson({ ok: false, error: error instanceof Error ? error.message : "Snapshot rejected." }, 400);
    }
  }),
});

// Render fleet HTTP adapter. These routes deliberately reuse the NLE panel's
// team pluginToken Bearer authentication. Every internal mutation also receives
// that resolved teamId, preventing a token from operating another team's job.
async function renderWorkerBody(request: Request): Promise<Record<string, unknown> | null> {
  return await request.json().catch(() => null) as Record<string, unknown> | null;
}

function renderWorkerError(error: unknown): Response {
  return nleJson(
    { ok: false, error: error instanceof Error ? error.message : "Render worker request rejected." },
    400,
  );
}

http.route({
  path: "/render-jobs/claim",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const body = await renderWorkerBody(request);
    if (!body) return nleJson({ ok: false, error: "Body must be JSON." }, 400);
    try {
      const claim = await ctx.runMutation(claimRenderJobRef, {
        teamId: team._id,
        workerId: body.workerId as string,
        leaseMs: body.leaseMs as number,
      });
      return nleJson({ ok: true, claim });
    } catch (error) {
      return renderWorkerError(error);
    }
  }),
});

http.route({
  path: "/render-jobs/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const body = await renderWorkerBody(request);
    if (!body) return nleJson({ ok: false, error: "Body must be JSON." }, 400);
    try {
      const result = await ctx.runMutation(heartbeatRenderJobRef, {
        teamId: team._id,
        jobId: body.jobId as Id<"renderJobs">,
        workerId: body.workerId as string,
        claimToken: body.claimToken as string,
        phase: body.phase as "claimed" | "downloading" | "probing" | "rendering" | "uploading" | "complete",
        progress: body.progress as number,
        message: body.message as string | undefined,
        leaseMs: body.leaseMs as number,
      });
      return nleJson({ ok: true, ...result });
    } catch (error) {
      return renderWorkerError(error);
    }
  }),
});

http.route({
  path: "/render-jobs/progress",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const body = await renderWorkerBody(request);
    if (!body) return nleJson({ ok: false, error: "Body must be JSON." }, 400);
    try {
      const result = await ctx.runMutation(progressRenderJobRef, {
        teamId: team._id,
        jobId: body.jobId as Id<"renderJobs">,
        workerId: body.workerId as string,
        claimToken: body.claimToken as string,
        phase: body.phase as "claimed" | "downloading" | "probing" | "rendering" | "uploading" | "complete",
        progress: body.progress as number,
        message: body.message as string | undefined,
      });
      return nleJson({ ok: true, ...result });
    } catch (error) {
      return renderWorkerError(error);
    }
  }),
});

http.route({
  path: "/render-jobs/complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const body = await renderWorkerBody(request);
    if (!body) return nleJson({ ok: false, error: "Body must be JSON." }, 400);
    try {
      const result = await ctx.runMutation(completeRenderJobRef, {
        teamId: team._id,
        jobId: body.jobId as Id<"renderJobs">,
        workerId: body.workerId as string,
        claimToken: body.claimToken as string,
        outputObjectKey: body.outputObjectKey as string,
        manifestObjectKey: body.manifestObjectKey as string,
        outputBytes: body.outputBytes as number,
        cache: body.cache as RenderCacheResult,
      });
      return nleJson({ ok: true, ...result });
    } catch (error) {
      return renderWorkerError(error);
    }
  }),
});

http.route({
  path: "/render-jobs/fail",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const body = await renderWorkerBody(request);
    if (!body) return nleJson({ ok: false, error: "Body must be JSON." }, 400);
    try {
      const accepted = await ctx.runMutation(failRenderJobRef, {
        teamId: team._id,
        jobId: body.jobId as Id<"renderJobs">,
        workerId: body.workerId as string,
        claimToken: body.claimToken as string,
        failure: body.failure as {
          code: string;
          retryable: boolean;
          message?: string;
          detail?: Record<string, string>;
        },
      });
      return nleJson({ ok: true, accepted });
    } catch (error) {
      return renderWorkerError(error);
    }
  }),
});

http.route({
  path: "/render-jobs/release",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const team = await authenticateNlePlugin(ctx, request);
    if (team instanceof Response) return team;
    const body = await renderWorkerBody(request);
    if (!body) return nleJson({ ok: false, error: "Body must be JSON." }, 400);
    try {
      const accepted = await ctx.runMutation(releaseRenderJobRef, {
        teamId: team._id,
        jobId: body.jobId as Id<"renderJobs">,
        workerId: body.workerId as string,
        claimToken: body.claimToken as string,
        reason: body.reason as string,
      });
      return nleJson({ ok: true, accepted });
    } catch (error) {
      return renderWorkerError(error);
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
