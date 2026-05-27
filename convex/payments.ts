import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { shareCapabilities } from "./shareAccess";

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
 * them to Stripe Checkout. On Stripe success, the webhook in
 * convex/http.ts calls recordPaymentSucceeded which sets grant.paidAt —
 * Convex reactivity then flips the player to full-res automatically.
 * If Stripe isn't configured the action returns status:"disabled" and the
 * share page surfaces "Payments aren't configured on this deployment"
 * rather than silently flipping the grant — no simulation path.
 */

const paymentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("refunded"),
  v.literal("failed"),
);

/**
 * Compose the per-video paywall with a share-link's own paywall.
 *
 * Per the schema (videos.paywall, shareLinks.paywall): both can be set on the
 * same delivery and "they compose with this one." Real-world: the video owner
 * sets a base price ("this clip costs $40 to download"), the share link
 * optionally layers an agency markup or client-specific override on top.
 *
 *  - share-link paywall only → use it (the historical behavior)
 *  - video paywall only      → use it (this is the bug we're fixing)
 *  - both, same currency     → sum priceCents into a single combined charge
 *  - both, currency mismatch → fall back to the share-link paywall (the
 *    more client-specific override) and warn — we never invent a third
 *    currency or guess at FX.
 *
 * Returning `null` means "no paywall — the customer can download freely."
 */
export type ComposablePaywall = {
  priceCents: number;
  currency: string;
  description?: string;
};

export function composePaywall(
  shareLinkPaywall: ComposablePaywall | null | undefined,
  videoPaywall: ComposablePaywall | null | undefined,
): ComposablePaywall | null {
  if (!shareLinkPaywall && !videoPaywall) return null;
  if (!shareLinkPaywall) return videoPaywall ?? null;
  if (!videoPaywall) return shareLinkPaywall;
  if (shareLinkPaywall.currency !== videoPaywall.currency) {
    console.warn(
      `composePaywall: currency mismatch (${shareLinkPaywall.currency} vs ${videoPaywall.currency}) — falling back to share-link paywall.`,
    );
    return shareLinkPaywall;
  }
  return {
    priceCents: shareLinkPaywall.priceCents + videoPaywall.priceCents,
    currency: shareLinkPaywall.currency,
    description: shareLinkPaywall.description ?? videoPaywall.description,
  };
}

export const lookupGrantForCheckout = internalQuery({
  args: { grantToken: v.string() },
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("shareAccessGrants")
      .withIndex("by_token", (q) => q.eq("token", args.grantToken))
      .unique();
    if (!grant || grant.expiresAt <= Date.now()) return null;
    const shareLink = await ctx.db.get(grant.shareLinkId);
    if (!shareLink) return null;

    // For bundle links we need a representative video so the existing
    // payments-row shape (payments.videoId required) keeps working. We use
    // the first non-deleted item in the bundle. All bundle items share a
    // project + team by construction, so the team lookup downstream stays
    // valid regardless of which item we pick.
    let video: Awaited<ReturnType<typeof ctx.db.get<"videos">>> | null = null;
    let bundleName: string | null = null;
    if (shareLink.videoId) {
      video = await ctx.db.get(shareLink.videoId);
    } else if (shareLink.bundleId) {
      const bundle = await ctx.db.get(shareLink.bundleId);
      if (bundle) {
        bundleName = bundle.name;
        const items =
          bundle.kind === "folder"
            ? bundle.folderId
              ? await ctx.db
                  .query("videos")
                  .withIndex("by_folder", (q) => q.eq("folderId", bundle.folderId))
                  .collect()
              : []
            : await Promise.all((bundle.videoIds ?? []).map((id) => ctx.db.get(id)));
        const firstReady = items.find(
          (v): v is NonNullable<typeof v> => Boolean(v && !v.deletedAt),
        );
        video = firstReady ?? null;
      }
    }
    if (!video) return null;

    const project = await ctx.db.get(video.projectId);
    if (!project) return null;
    const team = await ctx.db.get(project.teamId);
    if (!team) return null;
    return { grant, shareLink, video, project, team, bundleName };
  },
});

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
    stripeConnectAccountId: v.string(),
    applicationFeeAmountCents: v.optional(v.number()),
  },
  returns: v.id("payments"),
  handler: async (ctx, args): Promise<Id<"payments">> => {
    return await ctx.db.insert("payments", {
      teamId: args.teamId,
      videoId: args.videoId,
      clientEmail: args.clientEmail,
      amountCents: args.amountCents,
      currency: args.currency,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeConnectAccountId: args.stripeConnectAccountId,
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
    stripeConnectAccountId: v.string(),
    applicationFeeAmountCents: v.optional(v.number()),
  },
  returns: v.id("payments"),
  handler: async (ctx, args): Promise<Id<"payments">> => {
    return await ctx.db.insert("payments", {
      grantId: args.grantId,
      shareLinkId: args.shareLinkId,
      teamId: args.teamId,
      videoId: args.videoId,
      clientEmail: args.clientEmail,
      amountCents: args.amountCents,
      currency: args.currency,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeConnectAccountId: args.stripeConnectAccountId,
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
    await ctx.db.patch(payment._id, {
      status: "succeeded",
      paidAt: now,
      stripePaymentIntentId:
        args.stripePaymentIntentId ?? payment.stripePaymentIntentId,
    });

    if (payment.grantId) {
      const grant = await ctx.db.get(payment.grantId);
      if (grant) {
        // Extend grant TTL on payment so the client keeps access without
        // needing to revisit the share link.
        const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
        await ctx.db.patch(payment.grantId, {
          paidAt: now,
          paymentId: payment._id,
          expiresAt: Math.max(grant.expiresAt, now + NINETY_DAYS_MS),
        });
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
    await ctx.db.patch(payment._id, {
      status: "refunded",
      refundedAt: now,
    });

    if (payment.grantId) {
      // Revoke unlock — clear paidAt. Player falls back to preview asset.
      await ctx.db.patch(payment.grantId, {
        paidAt: undefined,
        paymentId: undefined,
      });
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
  args: { grantToken: v.string() },
  returns: v.object({
    valid: v.boolean(),
    paid: v.boolean(),
    expiresAt: v.union(v.number(), v.null()),
    paywall: v.union(
      v.object({
        priceCents: v.number(),
        currency: v.string(),
        description: v.optional(v.string()),
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
    // Compose the share-link paywall with the per-video paywall so a video
    // priced by its owner still gates the download when shared via a link
    // that itself isn't paywalled. See composePaywall above for the rules.
    let videoPaywall: ComposablePaywall | null = null;
    if (shareLink.videoId) {
      const video = await ctx.db.get(shareLink.videoId);
      videoPaywall = video?.paywall ?? null;
    }
    // Bundle links: a per-video paywall on any single item would be
    // surprising at the bundle level (you'd pay for one clip and unlock the
    // rest), so we deliberately only honor the share-link paywall for
    // bundles. Per-video pricing for bundle deliveries can be designed later.
    const composedPaywall = composePaywall(shareLink.paywall, videoPaywall);

    const identity = await ctx.auth.getUserIdentity();
    const isOwner =
      identity?.subject != null &&
      identity.subject === shareLink.createdByClerkId;
    const { role, canComment } = shareCapabilities(grant.role, shareLink);
    const paid = Boolean(grant.paidAt);
    const paywalled = Boolean(composedPaywall);
    return {
      valid: true,
      paid,
      expiresAt: grant.expiresAt,
      paywall: composedPaywall,
      isOwner,
      role: isOwner ? "editor" : role,
      canComment: isOwner ? true : canComment,
      // Downloads require the link to allow them and, when paywalled, payment.
      canDownload:
        isOwner || (shareLink.allowDownload && (!paywalled || paid)),
    };
  },
});
