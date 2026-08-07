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
import type { TimelinePresencePayload } from "../src/lib/timeline/types";
import {
  isTimelinePresencePayload,
  normalizeTimelinePresencePayload,
} from "../src/components/presence/model";
import { isFeatureEnabled } from "./featureFlags";

const http = httpRouter();

function getSubscriptionPriceId(subscription: Stripe.Subscription): string | undefined {
  return subscription.items.data[0]?.price?.id;
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

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response("OK", { status: 200 });
  }),
});

export default http;
