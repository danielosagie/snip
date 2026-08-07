import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  isShareVideoUnlocked,
  shareCapabilities,
} from "./shareAccess";
import { requireTeamAccess } from "./auth";
import { resolveBundleVideos } from "./shareBundles";
import { MAX_LINE_ITEM_AMOUNT_CENTS } from "./paymentsPolicy";

/**
 * Per-delivery payments — V8 isolate side (queries, internal mutations).
 *
 * The actual Stripe Checkout Session creation lives in convex/paymentsActions.ts
 * because it uses the Stripe Node SDK. Convex requires that files with
 * "use node" only export actions, hence the split.
 *
 * Flow: a client lands on a paywalled share link, gets issued a
 * shareAccessGrant token, sees a 360p watermarked preview, and clicks
 * "Pay $X." The paymentsActions.createCheckoutForGrant action redirects
 * them to Stripe Checkout (or, in demo mode, demoSeed.simulatePaymentForGrant
 * flips the grant directly). On Stripe success, the webhook in
 * convex/http.ts calls recordPaymentSucceeded which sets grant.paidAt —
 * Convex reactivity then flips the player to full-res automatically.
 */

const paymentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("refunded"),
  v.literal("failed"),
);

export const lookupGrantForCheckout = internalQuery({
  args: {
    grantToken: v.string(),
    itemVideoIds: v.optional(v.array(v.id("videos"))),
  },
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("shareAccessGrants")
      .withIndex("by_token", (q) => q.eq("token", args.grantToken))
      .unique();
    if (!grant || grant.expiresAt <= Date.now()) return null;
    const shareLink = await ctx.db.get(grant.shareLinkId);
    if (!shareLink) return null;

    // Bundle payments retain a representative video for legacy earnings/UI
    // consumers. All bundle items share a project + team by construction.
    let video: Awaited<ReturnType<typeof ctx.db.get<"videos">>> | null = null;
    let shareItems: Doc<"videos">[] = [];
    let bundleName: string | null = null;
    if (shareLink.videoId) {
      video = await ctx.db.get(shareLink.videoId);
      if (video && !video.deletedAt) shareItems = [video];
    } else if (shareLink.bundleId) {
      const bundle = await ctx.db.get(shareLink.bundleId);
      if (bundle) {
        bundleName = bundle.name;
        shareItems = await resolveBundleVideos(ctx, bundle);
        const firstReady = shareItems.find((item) => !item.deletedAt);
        video = firstReady ?? null;
      }
    }
    if (!video) return null;

    const project = await ctx.db.get(video.projectId);
    if (!project) return null;
    const team = await ctx.db.get(project.teamId);
    if (!team) return null;

    const requestedIds = args.itemVideoIds ?? [];
    const uniqueIds = new Set(requestedIds);
    if (requestedIds.length > 10 || uniqueIds.size !== requestedIds.length) {
      return null;
    }
    const shareItemById = new Map(shareItems.map((item) => [item._id, item]));
    const priceById = new Map(
      (shareLink.itemPrices ?? []).map((price) => [price.videoId, price.priceCents]),
    );
    const selectedItems = requestedIds.map((videoId) => {
      const item = shareItemById.get(videoId);
      const priceCents = priceById.get(videoId);
      if (!item || priceCents === undefined) return null;
      if (
        !Number.isSafeInteger(priceCents) ||
        priceCents <= 0 ||
        priceCents > MAX_LINE_ITEM_AMOUNT_CENTS
      ) {
        return null;
      }
      if (isShareVideoUnlocked(grant, shareLink, videoId)) return null;
      return { videoId, title: item.title, priceCents };
    });
    if (selectedItems.some((item) => item === null)) return null;
    return {
      grant,
      shareLink,
      video,
      project,
      team,
      bundleName,
      selectedItems: selectedItems as Array<{
        videoId: Id<"videos">;
        title: string;
        priceCents: number;
      }>,
    };
  },
});

function assertPaymentAmounts(subtotalCents: number, amountCents: number) {
  if (
    !Number.isSafeInteger(subtotalCents) ||
    subtotalCents <= 0 ||
    !Number.isSafeInteger(amountCents) ||
    amountCents < subtotalCents
  ) {
    throw new Error("Payment amounts must be positive integer cents.");
  }
}

export const lookupVideoForCheckout = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return null;
    const project = await ctx.db.get(video.projectId);
    if (!project) return null;
    const team = await ctx.db.get(project.teamId);
    if (!team) return null;
    return { video, project, team };
  },
});

export const recordVideoCheckoutCreated = internalMutation({
  args: {
    teamId: v.id("teams"),
    videoId: v.id("videos"),
    clientEmail: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    stripeCheckoutSessionId: v.string(),
    stripeConnectAccountId: v.optional(v.string()),
    settlement: v.optional(
      v.union(v.literal("connect"), v.literal("platform")),
    ),
    applicationFeeAmountCents: v.optional(v.number()),
    subtotalCents: v.optional(v.number()),
  },
  returns: v.id("payments"),
  handler: async (ctx, args): Promise<Id<"payments">> => {
    assertPaymentAmounts(args.subtotalCents ?? args.amountCents, args.amountCents);
    return await ctx.db.insert("payments", {
      teamId: args.teamId,
      videoId: args.videoId,
      kind: "video",
      clientEmail: args.clientEmail,
      subtotalCents: args.subtotalCents,
      amountCents: args.amountCents,
      currency: args.currency,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeConnectAccountId: args.stripeConnectAccountId,
      settlement: args.settlement,
      applicationFeeAmountCents: args.applicationFeeAmountCents,
      status: "pending",
    });
  },
});

export const recordCheckoutCreated = internalMutation({
  args: {
    grantId: v.id("shareAccessGrants"),
    shareLinkId: v.id("shareLinks"),
    teamId: v.id("teams"),
    videoId: v.id("videos"),
    clientEmail: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    stripeCheckoutSessionId: v.string(),
    stripeConnectAccountId: v.optional(v.string()),
    settlement: v.optional(
      v.union(v.literal("connect"), v.literal("platform")),
    ),
    applicationFeeAmountCents: v.optional(v.number()),
    subtotalCents: v.optional(v.number()),
    kind: v.optional(v.union(v.literal("share_all"), v.literal("share_item"))),
    itemVideoIds: v.optional(v.array(v.id("videos"))),
  },
  returns: v.id("payments"),
  handler: async (ctx, args): Promise<Id<"payments">> => {
    assertPaymentAmounts(args.subtotalCents ?? args.amountCents, args.amountCents);
    if (args.kind === "share_item" && !args.itemVideoIds?.length) {
      throw new Error("Per-item payments require item ids.");
    }
    return await ctx.db.insert("payments", {
      grantId: args.grantId,
      shareLinkId: args.shareLinkId,
      teamId: args.teamId,
      videoId: args.videoId,
      kind: args.kind,
      itemVideoIds: args.itemVideoIds,
      clientEmail: args.clientEmail,
      subtotalCents: args.subtotalCents,
      amountCents: args.amountCents,
      currency: args.currency,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeConnectAccountId: args.stripeConnectAccountId,
      settlement: args.settlement,
      applicationFeeAmountCents: args.applicationFeeAmountCents,
      status: "pending",
    });
  },
});

export const recordPaymentSucceeded = internalMutation({
  args: {
    stripeCheckoutSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId),
      )
      .unique();
    if (!payment) return null;

    const now = Date.now();
    // Terminal transitions are idempotent. A delayed completion must also
    // never resurrect a payment already refunded.
    if (payment.status === "succeeded" || payment.status === "refunded") {
      return null;
    }
    await ctx.db.patch(payment._id, {
      status: "succeeded",
      paidAt: now,
      stripePaymentIntentId:
        args.stripePaymentIntentId ?? payment.stripePaymentIntentId,
    });
    await applyEarningsDelta(ctx, payment, 1);

    if (payment.grantId) {
      const grant = await ctx.db.get(payment.grantId);
      if (grant) {
        // Extend grant TTL on payment so the client keeps access without
        // needing to revisit the share link.
        const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
        if (payment.kind === "share_item") {
          const unlockedVideoIds = Array.from(
            new Set([
              ...(grant.unlockedVideoIds ?? []),
              ...(payment.itemVideoIds ?? []),
            ]),
          );
          await ctx.db.patch(payment.grantId, {
            unlockedVideoIds,
            expiresAt: Math.max(grant.expiresAt, now + NINETY_DAYS_MS),
          });
        } else {
          await ctx.db.patch(payment.grantId, {
            paidAt: now,
            paymentId: payment._id,
            unlockedVideoIds: undefined,
            expiresAt: Math.max(grant.expiresAt, now + NINETY_DAYS_MS),
          });
        }
      }
    }
    return null;
  },
});

export const recordPaymentRefunded = internalMutation({
  args: {
    stripePaymentIntentId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
      )
      .unique();
    if (!payment) return null;

    const now = Date.now();
    if (payment.status === "succeeded") {
      await applyEarningsDelta(ctx, payment, -1);
    }
    await ctx.db.patch(payment._id, {
      status: "refunded",
      refundedAt: now,
    });

    if (payment.grantId) {
      if (payment.kind === "share_item") {
        // Rebuild from the other succeeded item payments so overlapping
        // purchases cannot revoke access another charge still grants.
        const succeeded = await ctx.db
          .query("payments")
          .withIndex("by_grant", (q) => q.eq("grantId", payment.grantId))
          .collect();
        const unlockedVideoIds = Array.from(
          new Set(
            succeeded
              .filter(
                (candidate) =>
                  candidate._id !== payment._id &&
                  candidate.status === "succeeded" &&
                  candidate.kind === "share_item",
              )
              .flatMap((candidate) => candidate.itemVideoIds ?? []),
          ),
        );
        await ctx.db.patch(payment.grantId, { unlockedVideoIds });
      } else {
        // Revoke the full-share unlock while preserving any separately
        // purchased items on this grant.
        const succeeded = await ctx.db
          .query("payments")
          .withIndex("by_grant", (q) => q.eq("grantId", payment.grantId))
          .collect();
        const unlockedVideoIds = Array.from(
          new Set(
            succeeded
              .filter(
                (candidate) =>
                  candidate.status === "succeeded" &&
                  candidate.kind === "share_item",
              )
              .flatMap((candidate) => candidate.itemVideoIds ?? []),
          ),
        );
        await ctx.db.patch(payment.grantId, {
          paidAt: undefined,
          paymentId: undefined,
          unlockedVideoIds:
            unlockedVideoIds.length > 0 ? unlockedVideoIds : undefined,
        });
      }
    }
    return null;
  },
});

export const getPaymentByCheckoutSession = query({
  args: { stripeCheckoutSessionId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("payments"),
      status: paymentStatusValidator,
      amountCents: v.number(),
      currency: v.string(),
      paidAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId),
      )
      .unique();
    if (!payment) return null;
    return {
      _id: payment._id,
      status: payment.status,
      amountCents: payment.amountCents,
      currency: payment.currency,
      paidAt: payment.paidAt,
    };
  },
});

export const getPaymentsForShareLink = query({
  args: { shareLinkId: v.id("shareLinks") },
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_share_link", (q) => q.eq("shareLinkId", args.shareLinkId))
      .collect();
    return payments
      .map((p) => ({
        _id: p._id,
        status: p.status,
        amountCents: p.amountCents,
        currency: p.currency,
        clientEmail: p.clientEmail,
        paidAt: p.paidAt,
        refundedAt: p.refundedAt,
      }))
      .sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
  },
});

/**
 * Helper for the share player. Returns the unlock state for a grant token —
 * what the client needs to know to decide preview vs full-res.
 */
export const getGrantUnlockState = query({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
  },
  returns: v.object({
    valid: v.boolean(),
    paid: v.boolean(),
    expiresAt: v.union(v.number(), v.null()),
    paywall: v.union(
      v.object({
        priceCents: v.number(),
        currency: v.string(),
        description: v.optional(v.string()),
        mode: v.optional(v.union(v.literal("all"), v.literal("per_item"))),
      }),
      v.null(),
    ),
    // True when the authenticated viewer is the share link's creator.
    // The share page uses this to render the owner-verification banner
    // (toggle between client-view watermarked preview and full-res).
    isOwner: v.boolean(),
    // Drive-style access info (Phase 3): the viewer's resolved role, whether
    // they can comment, and whether downloads are permitted on the link.
    role: v.union(
      v.literal("viewer"),
      v.literal("commenter"),
      v.literal("editor"),
    ),
    canComment: v.boolean(),
    canDownload: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("shareAccessGrants")
      .withIndex("by_token", (q) => q.eq("token", args.grantToken))
      .unique();
    if (!grant || grant.expiresAt <= Date.now()) {
      return {
        valid: false,
        paid: false,
        expiresAt: null,
        paywall: null,
        isOwner: false,
        role: "viewer" as const,
        canComment: false,
        canDownload: false,
      };
    }
    const shareLink = await ctx.db.get(grant.shareLinkId);
    if (!shareLink) {
      return {
        valid: false,
        paid: false,
        expiresAt: null,
        paywall: null,
        isOwner: false,
        role: "viewer" as const,
        canComment: false,
        canDownload: false,
      };
    }
    const identity = await ctx.auth.getUserIdentity();
    const isOwner =
      identity?.subject != null &&
      identity.subject === shareLink.createdByClerkId;
    const { role, canComment } = shareCapabilities(grant.role, shareLink);
    const paid = args.itemVideoId
      ? isShareVideoUnlocked(grant, shareLink, args.itemVideoId)
      : shareLink.paywall?.mode === "per_item"
        ? Boolean(grant.paidAt && grant.unlockedVideoIds === undefined)
        : Boolean(grant.paidAt);
    const paywalled = Boolean(shareLink.paywall);
    return {
      valid: true,
      paid,
      expiresAt: grant.expiresAt,
      paywall: shareLink.paywall ?? null,
      isOwner,
      role: isOwner ? "editor" : role,
      canComment: isOwner ? true : canComment,
      // Downloads require the link to allow them and, when paywalled, payment.
      canDownload:
        isOwner || (shareLink.allowDownload && (!paywalled || paid)),
    };
  },
});

/**
 * Earnings rollup for the Billing & Invoices page: what clients paid this
 * team through paywalled links, net of the platform fee.
 *
 * `settlement` matters here and is not cosmetic. "connect" rows went
 * straight to the team's Stripe account. "platform" rows were collected
 * by the platform because Connect onboarding wasn't finished, so the
 * operator still owes that money manually — the UI must not present it as
 * paid out. Legacy rows (settlement absent) were always Connect charges.
 */
/**
 * Earnings for the Billing & Invoices page.
 *
 * Reads a maintained aggregate plus an indexed slice of recent sales, so
 * cost is O(limit) rather than O(all payments this team has ever taken).
 * A team whose aggregate has never been built returns `totals: null` —
 * the UI must render that as unknown rather than as zero, because zero
 * and "not yet computed" are very different numbers to show a seller.
 */
export const getTeamEarnings = query({
  args: {
    teamId: v.id("teams"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireTeamAccess(ctx, args.teamId);
    const limit = Math.max(1, Math.min(args.limit ?? 10, 50));

    const aggregate = await ctx.db
      .query("teamEarnings")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .unique();

    const rows = await ctx.db
      .query("payments")
      .withIndex("by_team_status_paid", (q) =>
        q.eq("teamId", args.teamId).eq("status", "succeeded"),
      )
      .order("desc")
      .take(limit);

    const recent = await Promise.all(
      rows.map(async (r) => {
      const fee = r.applicationFeeAmountCents ?? 0;
      const video = r.videoId ? await ctx.db.get(r.videoId) : null;
      const invoice = r.invoiceId ? await ctx.db.get(r.invoiceId) : null;
      return {
        id: r._id,
        videoId: r.videoId ?? null,
        invoiceId: r.invoiceId ?? null,
        kind: r.kind ?? null,
        fileName:
          invoice?.title ??
          (r.kind === "share_item" && r.itemVideoIds
            ? `${r.itemVideoIds.length} purchased item${r.itemVideoIds.length === 1 ? "" : "s"}`
            : video?.title ?? "Deleted file"),
        paidAt: r.paidAt ?? r._creationTime,
        grossCents: r.amountCents,
        feeCents: fee,
        netCents: r.amountCents - fee,
        currency: r.currency,
        clientEmail: r.clientEmail ?? null,
        // Not a Stripe state: we collected on the platform account
        // because this team cannot receive payouts yet.
        routedTo:
          r.settlement === "platform" ? ("held" as const) : ("connect" as const),
      };
      }),
    );

    return {
      totals: aggregate
        ? {
            saleCount: aggregate.saleCount,
            grossCents: aggregate.grossCents,
            feeCents: aggregate.feeCents,
            netCents: aggregate.grossCents - aggregate.feeCents,
            owedByPlatformCents: aggregate.owedByPlatformCents,
            currency: aggregate.currency,
          }
        : null,
      recent,
    };
  },
});

/**
 * Apply one payment's contribution to its team's running totals.
 * `sign` is +1 when a payment succeeds and -1 when it refunds.
 */
async function applyEarningsDelta(
  ctx: MutationCtx,
  payment: Doc<"payments">,
  sign: 1 | -1,
) {
  const fee = payment.applicationFeeAmountCents ?? 0;
  const owed =
    payment.settlement === "platform" ? payment.amountCents - fee : 0;

  const existing = await ctx.db
    .query("teamEarnings")
    .withIndex("by_team", (q) => q.eq("teamId", payment.teamId))
    .unique();

  if (!existing) {
    // Only seed from a positive delta. Seeding from a refund would
    // record negative lifetime totals for a team we never aggregated.
    if (sign < 0) return;
    await ctx.db.insert("teamEarnings", {
      teamId: payment.teamId,
      saleCount: 1,
      grossCents: payment.amountCents,
      feeCents: fee,
      owedByPlatformCents: owed,
      currency: payment.currency,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    saleCount: Math.max(0, existing.saleCount + sign),
    grossCents: Math.max(0, existing.grossCents + sign * payment.amountCents),
    feeCents: Math.max(0, existing.feeCents + sign * fee),
    owedByPlatformCents: Math.max(0, existing.owedByPlatformCents + sign * owed),
    currency: existing.currency || payment.currency,
  });
}

/**
 * Build or continue a team's earnings aggregate from historical rows.
 *
 * Paginated on purpose: a team with a long payment history cannot be
 * summed in one transaction, which is the very limit this aggregate
 * exists to avoid. Call repeatedly until `done` is true. Idempotent per
 * page via `computedThroughCreationTime`.
 */
export const backfillTeamEarnings = internalMutation({
  args: {
    teamId: v.id("teams"),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    done: v.boolean(),
    scanned: v.number(),
    throughCreationTime: v.number(),
  }),
  handler: async (ctx, args) => {
    const batch = Math.max(1, Math.min(args.batchSize ?? 200, 500));
    const existing = await ctx.db
      .query("teamEarnings")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .unique();
    const cursor = existing?.computedThroughCreationTime ?? 0;

    const page = await ctx.db
      .query("payments")
      .withIndex("by_team_status_paid", (q) =>
        q.eq("teamId", args.teamId).eq("status", "succeeded"),
      )
      .order("asc")
      .filter((q) => q.gt(q.field("_creationTime"), cursor))
      .take(batch);

    let saleCount = existing?.saleCount ?? 0;
    let grossCents = existing?.grossCents ?? 0;
    let feeCents = existing?.feeCents ?? 0;
    let owedByPlatformCents = existing?.owedByPlatformCents ?? 0;
    let currency = existing?.currency ?? "usd";
    let through = cursor;

    for (const r of page) {
      const fee = r.applicationFeeAmountCents ?? 0;
      saleCount += 1;
      grossCents += r.amountCents;
      feeCents += fee;
      if (r.settlement === "platform") owedByPlatformCents += r.amountCents - fee;
      currency = r.currency || currency;
      through = Math.max(through, r._creationTime);
    }

    const patch = {
      teamId: args.teamId,
      saleCount,
      grossCents,
      feeCents,
      owedByPlatformCents,
      currency,
      computedThroughCreationTime: through,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("teamEarnings", patch);
    }

    return {
      done: page.length < batch,
      scanned: page.length,
      throughCreationTime: through,
    };
  },
});

/**
 * Resolve a payment row to the Stripe PaymentIntent behind it, for the
 * seller-facing receipt link.
 *
 * NOTE: reconstructed from its call site in paymentsActions.getReceiptUrl
 * after an accidental overwrite — verify it matches what you intended.
 * Access is enforced here because the calling action does not check it
 * itself; a receipt URL exposes buyer details and must not be reachable
 * by anyone outside the selling team.
 */
export const lookupReceiptForPayment = internalQuery({
  args: { paymentId: v.id("payments") },
  returns: v.union(
    v.object({ stripePaymentIntentId: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return null;
    await requireTeamAccess(ctx, payment.teamId);
    if (!payment.stripePaymentIntentId) return null;
    return { stripePaymentIntentId: payment.stripePaymentIntentId };
  },
});
