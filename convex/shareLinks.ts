import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { identityName, requireProjectAccess, requireVideoAccess } from "./auth";
import { generateUniqueToken, hashPassword, verifyPassword } from "./security";
import {
  findShareLinkByToken,
  issueShareAccessGrant,
  type ShareRole,
} from "./shareAccess";

const shareLinkStatusValidator = v.union(
  v.literal("missing"),
  v.literal("expired"),
  v.literal("requiresPassword"),
  v.literal("requiresAccess"),
  v.literal("ok"),
);

const shareRoleValidator = v.union(
  v.literal("viewer"),
  v.literal("commenter"),
  v.literal("editor"),
);

/**
 * Resolves whether the current viewer may open a link and at what role.
 * Owner (link creator) is always allowed as editor. For "anyone" links every
 * viewer is allowed at the link's default role. For "invite" links only the
 * owner or a signed-in user whose email is in shareInvites is allowed.
 */
async function resolveViewerAccess(
  ctx: QueryCtx | MutationCtx,
  link: Doc<"shareLinks">,
): Promise<{ allowed: boolean; role: ShareRole; isOwner: boolean }> {
  const identity = await ctx.auth.getUserIdentity();
  const isOwner =
    identity?.subject != null && identity.subject === link.createdByClerkId;
  if (isOwner) return { allowed: true, role: "editor", isOwner: true };

  const generalAccess = link.generalAccess ?? "anyone";
  if (generalAccess === "anyone") {
    return { allowed: true, role: link.defaultRole ?? "commenter", isOwner: false };
  }

  const email =
    typeof identity?.email === "string" ? identity.email.toLowerCase() : null;
  if (!email) return { allowed: false, role: "viewer", isOwner: false };

  const invite = await ctx.db
    .query("shareInvites")
    .withIndex("by_link_and_email", (q) =>
      q.eq("shareLinkId", link._id).eq("email", email),
    )
    .unique();
  if (!invite) return { allowed: false, role: "viewer", isOwner: false };
  return { allowed: true, role: invite.role, isOwner: false };
}

/** Throws unless the caller can manage (member role) the link's target. */
async function requireShareLinkManageAccess(
  ctx: MutationCtx | QueryCtx,
  link: Doc<"shareLinks">,
) {
  if (link.videoId) {
    await requireVideoAccess(ctx, link.videoId, "member");
  } else if (link.bundleId) {
    const bundle = await ctx.db.get(link.bundleId);
    if (!bundle) throw new Error("Bundle not found");
    await requireProjectAccess(ctx, bundle.projectId, "member");
  } else {
    throw new Error("Share link has no target");
  }
}

const MAX_SHARE_PASSWORD_LENGTH = 256;
const PASSWORD_MAX_FAILED_ATTEMPTS = 5;
const PASSWORD_LOCKOUT_MS = 10 * MINUTE;

const shareLinkRateLimiter = new RateLimiter(components.rateLimiter, {
  grantGlobal: {
    kind: "fixed window",
    rate: 600,
    period: MINUTE,
    shards: 8,
  },
  grantByToken: {
    kind: "fixed window",
    rate: 120,
    period: MINUTE,
  },
  passwordFailuresByToken: {
    kind: "fixed window",
    rate: 10,
    period: MINUTE,
  },
});

function hasPasswordProtection(
  link: Pick<Doc<"shareLinks">, "password" | "passwordHash">,
) {
  return Boolean(link.passwordHash || link.password);
}

function normalizeProvidedPassword(password: string | null | undefined) {
  if (password === undefined || password === null || password.length === 0) {
    return undefined;
  }

  if (password.length > MAX_SHARE_PASSWORD_LENGTH) {
    throw new Error("Password is too long");
  }

  return password;
}

async function generateShareToken(ctx: MutationCtx) {
  return await generateUniqueToken(
    32,
    async (candidate) =>
      (await ctx.db
        .query("shareLinks")
        .withIndex("by_token", (q) => q.eq("token", candidate))
        .unique()) !== null,
    5,
  );
}

async function deleteShareAccessGrantsForLink(
  ctx: MutationCtx,
  shareLinkId: Id<"shareLinks">,
) {
  const grants = await ctx.db
    .query("shareAccessGrants")
    .withIndex("by_share_link", (q) => q.eq("shareLinkId", shareLinkId))
    .collect();

  for (const grant of grants) {
    await ctx.db.delete(grant._id);
  }
}

function sanitizeCurrency(code: string | undefined): string {
  if (!code) return "usd";
  const cleaned = code.trim().toLowerCase();
  return cleaned.length >= 3 && cleaned.length <= 5 ? cleaned : "usd";
}

function sanitizePaywallInput(
  paywall:
    | { priceCents: number; currency?: string; description?: string }
    | undefined,
):
  | { priceCents: number; currency: string; description?: string }
  | undefined {
  if (!paywall) return undefined;
  if (!Number.isFinite(paywall.priceCents) || paywall.priceCents < 50) {
    throw new Error("Paywall price must be at least 50 cents.");
  }
  return {
    priceCents: Math.floor(paywall.priceCents),
    currency: sanitizeCurrency(paywall.currency),
    description: paywall.description?.trim() || undefined,
  };
}

/**
 * Paywalled share links must carry a recipient identifier — that's the
 * label burned into the watermarked preview. Without it the burn-in falls
 * back to a token-prefix that's useless for leak attribution. We accept
 * EITHER clientEmail (preferred — Stripe Checkout also pre-fills it) OR a
 * free-form clientLabel for cases where the agency only has a name.
 */
function requireRecipientIdentityForPaywall(
  paywall: { priceCents: number } | undefined,
  clientEmail: string | undefined,
  clientLabel: string | undefined,
) {
  if (!paywall) return;
  const email = clientEmail?.trim();
  const label = clientLabel?.trim();
  if (!email && !label) {
    throw new Error(
      "Paywalled share links require a client email or label so the watermark + checkout know who they're for.",
    );
  }
}

export const create = mutation({
  args: {
    // Exactly one of these must be set. Validated below — Convex args don't
    // let us express XOR at the schema layer.
    videoId: v.optional(v.id("videos")),
    bundleId: v.optional(v.id("shareBundles")),
    expiresInDays: v.optional(v.number()),
    allowDownload: v.optional(v.boolean()),
    password: v.optional(v.string()),
    paywall: v.optional(
      v.object({
        priceCents: v.number(),
        currency: v.optional(v.string()),
        description: v.optional(v.string()),
      }),
    ),
    clientLabel: v.optional(v.string()),
    clientEmail: v.optional(v.string()),
    generalAccess: v.optional(v.union(v.literal("anyone"), v.literal("invite"))),
    defaultRole: v.optional(shareRoleValidator),
    commentsEnabled: v.optional(v.boolean()),
    showAllVersions: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
      if (Boolean(args.videoId) === Boolean(args.bundleId)) {
        throw new Error("Share link must reference exactly one of videoId or bundleId.");
      }

      let creatorSubject: string;
      let creatorName: string;
      if (args.videoId) {
        const { user } = await requireVideoAccess(ctx, args.videoId, "member");
        creatorSubject = user.subject;
        creatorName = identityName(user);
      } else {
        const bundle = await ctx.db.get(args.bundleId!);
        if (!bundle) throw new Error("Bundle not found");
        const { user } = await requireProjectAccess(ctx, bundle.projectId, "member");
        creatorSubject = user.subject;
        creatorName = identityName(user);
      }

      const token = await generateShareToken(ctx);
      const expiresAt = args.expiresInDays
        ? Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000
        : undefined;
      const normalizedPassword = normalizeProvidedPassword(args.password);
      const passwordHash = normalizedPassword
        ? await hashPassword(normalizedPassword)
        : undefined;
      const paywall = sanitizePaywallInput(args.paywall);
      requireRecipientIdentityForPaywall(
        paywall,
        args.clientEmail,
        args.clientLabel,
      );

      const shareLinkId = await ctx.db.insert("shareLinks", {
        videoId: args.videoId,
        bundleId: args.bundleId,
        token,
        createdByClerkId: creatorSubject,
        createdByName: creatorName,
        expiresAt,
        allowDownload: args.allowDownload ?? false,
        password: undefined,
        passwordHash,
        failedAccessAttempts: 0,
        lockedUntil: undefined,
        viewCount: 0,
        paywall,
        clientLabel: args.clientLabel?.trim() || undefined,
        clientEmail: args.clientEmail?.trim() || undefined,
        generalAccess: args.generalAccess ?? "anyone",
        defaultRole: args.defaultRole ?? "commenter",
        commentsEnabled: args.commentsEnabled ?? true,
        showAllVersions: args.showAllVersions ?? false,
      });

      // Paywalled links need their watermarked preview pre-baked so the first
      // client view is instant instead of waiting on generation. Videos get a
      // Mux 360p preview asset; still images get a sharp-rendered webp; GIFs
      // are served live (original + CSS overlay) so we skip generation for
      // them entirely. Bundle links defer to first-view (arbitrary contents).
      if (paywall && args.videoId) {
        const item = await ctx.db.get(args.videoId);
        const ct = (item?.contentType ?? "").toLowerCase();
        if (ct.startsWith("image/")) {
          if (ct !== "image/gif") {
            await ctx.scheduler.runAfter(
              0,
              internal.imagePreview.generateForVideoItem,
              {
                videoId: args.videoId,
                shareLinkId,
                primaryLabel:
                  args.clientEmail ??
                  args.clientLabel ??
                  `share/${shareLinkId.toString().slice(-8)}`,
                secondaryLabel: "PREVIEW — DO NOT REDISTRIBUTE",
              },
            );
          }
        } else {
          await ctx.scheduler.runAfter(
            0,
            api.videoActions.ensurePreviewAssetForVideo,
            { videoId: args.videoId },
          );
        }
      }

      return { token };
    } catch (err) {
      // Surface the actual cause in the Convex dashboard logs instead of
      // letting the generic "Server Error" wrapper swallow it on the
      // client. Re-throws so the client still gets the failure.
      console.error("shareLinks.create failed", {
        videoId: args.videoId,
        bundleId: args.bundleId,
        hasPassword: Boolean(args.password),
        hasPaywall: Boolean(args.paywall),
        hasClientEmail: Boolean(args.clientEmail),
        hasClientLabel: Boolean(args.clientLabel),
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  },
});

export const list = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    await requireVideoAccess(ctx, args.videoId);

    const links = await ctx.db
      .query("shareLinks")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();

    const linksWithCreator = links.map((link) => ({
      _id: link._id,
      _creationTime: link._creationTime,
      videoId: link.videoId,
      token: link.token,
      createdByClerkId: link.createdByClerkId,
      createdByName: link.createdByName,
      expiresAt: link.expiresAt,
      allowDownload: link.allowDownload,
      viewCount: link.viewCount,
      hasPassword: hasPasswordProtection(link),
      creatorName: link.createdByName,
      isExpired: link.expiresAt ? link.expiresAt < Date.now() : false,
      paywall: link.paywall ?? null,
      clientLabel: link.clientLabel ?? null,
      clientEmail: link.clientEmail ?? null,
      generalAccess: link.generalAccess ?? "anyone",
    }));

    return linksWithCreator;
  },
});

/**
 * Every share link for a folder. `shareLinks.list` is video-only; folder
 * bundles are addressed by bundleId, so we resolve the folder's bundles
 * (createForFolder mints a fresh bundle row per share, so there can be
 * several) and flatten their links. Newest first.
 */
export const listForFolder = query({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) return [];
    await requireProjectAccess(ctx, folder.projectId);

    const bundles = await ctx.db
      .query("shareBundles")
      .withIndex("by_folder", (q) => q.eq("folderId", args.folderId))
      .collect();
    const folderBundleIds = bundles
      .filter((b) => b.kind === "folder")
      .map((b) => b._id);
    if (folderBundleIds.length === 0) return [];

    const linkArrays = await Promise.all(
      folderBundleIds.map((bundleId) =>
        ctx.db
          .query("shareLinks")
          .withIndex("by_bundle", (q) => q.eq("bundleId", bundleId))
          .collect(),
      ),
    );

    return linkArrays
      .flat()
      .map((link) => ({
        _id: link._id,
        _creationTime: link._creationTime,
        bundleId: link.bundleId ?? null,
        token: link.token,
        createdByName: link.createdByName,
        expiresAt: link.expiresAt,
        allowDownload: link.allowDownload,
        viewCount: link.viewCount,
        hasPassword: hasPasswordProtection(link),
        creatorName: link.createdByName,
        isExpired: link.expiresAt ? link.expiresAt < Date.now() : false,
        paywall: link.paywall ?? null,
        clientLabel: link.clientLabel ?? null,
        clientEmail: link.clientEmail ?? null,
        generalAccess: link.generalAccess ?? "anyone",
      }))
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const remove = mutation({
  args: { linkId: v.id("shareLinks") },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new Error("Share link not found");

    if (link.videoId) {
      await requireVideoAccess(ctx, link.videoId, "member");
    } else if (link.bundleId) {
      const bundle = await ctx.db.get(link.bundleId);
      if (!bundle) throw new Error("Bundle not found");
      await requireProjectAccess(ctx, bundle.projectId, "member");
    } else {
      throw new Error("Share link has no target");
    }

    await deleteShareAccessGrantsForLink(ctx, args.linkId);
    const invites = await ctx.db
      .query("shareInvites")
      .withIndex("by_share_link", (q) => q.eq("shareLinkId", args.linkId))
      .collect();
    for (const invite of invites) {
      await ctx.db.delete(invite._id);
    }
    await ctx.db.delete(args.linkId);
  },
});

/** Internal lookup used by background actions (preview-asset prep). */
export const getInternal = internalQuery({
  args: { shareLinkId: v.id("shareLinks") },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.shareLinkId);
    if (!link) return null;
    return {
      _id: link._id,
      videoId: link.videoId ?? null,
      bundleId: link.bundleId ?? null,
      token: link.token,
      paywall: link.paywall ?? null,
      clientEmail: link.clientEmail ?? null,
      clientLabel: link.clientLabel ?? null,
    };
  },
});

export const update = mutation({
  args: {
    linkId: v.id("shareLinks"),
    expiresInDays: v.optional(v.union(v.number(), v.null())),
    allowDownload: v.optional(v.boolean()),
    password: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new Error("Share link not found");

    if (link.videoId) {
      await requireVideoAccess(ctx, link.videoId, "member");
    } else if (link.bundleId) {
      const bundle = await ctx.db.get(link.bundleId);
      if (!bundle) throw new Error("Bundle not found");
      await requireProjectAccess(ctx, bundle.projectId, "member");
    } else {
      throw new Error("Share link has no target");
    }

    const updates: Partial<Doc<"shareLinks">> = {};

    if (args.expiresInDays !== undefined) {
      updates.expiresAt = args.expiresInDays
        ? Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000
        : undefined;
    }

    if (args.allowDownload !== undefined) {
      updates.allowDownload = args.allowDownload;
    }

    if (args.password !== undefined) {
      const normalizedPassword = normalizeProvidedPassword(args.password ?? undefined);
      if (normalizedPassword) {
        updates.passwordHash = await hashPassword(normalizedPassword);
        updates.password = undefined;
      } else {
        updates.passwordHash = undefined;
        updates.password = undefined;
      }
      updates.failedAccessAttempts = 0;
      updates.lockedUntil = undefined;
    }

    await ctx.db.patch(args.linkId, updates);
  },
});

export const getByToken = query({
  args: { token: v.string() },
  returns: v.object({
    status: shareLinkStatusValidator,
  }),
  handler: async (ctx, args) => {
    const link = await findShareLinkByToken(ctx, args.token);

    if (!link) {
      return { status: "missing" as const };
    }

    if (link.expiresAt && link.expiresAt < Date.now()) {
      return { status: "expired" as const };
    }

    // Single-video links require the referenced video to be in the ready
    // state. Bundle links are valid as long as the bundle row exists — the
    // share page itself handles empty/in-progress items gracefully.
    if (link.videoId) {
      const video = await ctx.db.get(link.videoId);
      if (!video || video.status !== "ready") {
        return { status: "missing" as const };
      }
    } else if (link.bundleId) {
      const bundle = await ctx.db.get(link.bundleId);
      if (!bundle) {
        return { status: "missing" as const };
      }
    } else {
      return { status: "missing" as const };
    }

    // Invite-only links gate before the password screen: a viewer who isn't
    // the owner and isn't on the invite list can't proceed at all. Note the
    // result is reactive on the viewer's Clerk identity, so signing in with an
    // invited email flips this to "ok" without a manual reload.
    if ((link.generalAccess ?? "anyone") === "invite") {
      const access = await resolveViewerAccess(ctx, link);
      if (!access.allowed) {
        return { status: "requiresAccess" as const };
      }
    }

    if (hasPasswordProtection(link)) {
      return { status: "requiresPassword" as const };
    }

    return { status: "ok" as const };
  },
});

export const issueAccessGrant = mutation({
  args: {
    token: v.string(),
    password: v.optional(v.string()),
    // Forensic capture for leak attribution. The share page proxies the
    // viewer's IP from the request edge (already hashed client-side or by
    // a downstream edge function — we never store raw IPs) and UA. None of
    // these are required to issue the grant; we want anonymous viewers to
    // still be able to pay and view.
    viewerIpHash: v.optional(v.string()),
    viewerUserAgent: v.optional(v.string()),
    viewerReferrer: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    grantToken: v.union(v.string(), v.null()),
    reason: v.optional(
      v.union(v.literal("notInvited"), v.literal("rateLimited")),
    ),
  }),
  handler: async (ctx, args) => {
    const globalAccessLimit = await shareLinkRateLimiter.limit(ctx, "grantGlobal");
    if (!globalAccessLimit.ok) {
      return { ok: false, grantToken: null, reason: "rateLimited" as const };
    }

    const accessLimit = await shareLinkRateLimiter.limit(ctx, "grantByToken", {
      key: args.token,
    });
    if (!accessLimit.ok) {
      return { ok: false, grantToken: null };
    }

    const link = await findShareLinkByToken(ctx, args.token);

    if (!link) {
      return { ok: false, grantToken: null };
    }

    const now = Date.now();

    if (link.expiresAt && link.expiresAt <= now) {
      return { ok: false, grantToken: null };
    }

    if (link.videoId) {
      const video = await ctx.db.get(link.videoId);
      if (!video || video.status !== "ready") {
        return { ok: false, grantToken: null };
      }
    } else if (link.bundleId) {
      const bundle = await ctx.db.get(link.bundleId);
      if (!bundle) {
        return { ok: false, grantToken: null };
      }
    } else {
      return { ok: false, grantToken: null };
    }

    if (hasPasswordProtection(link)) {
      if (link.lockedUntil && link.lockedUntil > now) {
        return { ok: false, grantToken: null };
      }

      const password = args.password ?? "";
      let passwordMatches = false;
      if (link.passwordHash) {
        passwordMatches = await verifyPassword(password, link.passwordHash);
      } else if (link.password) {
        passwordMatches = password === link.password;
      }

      if (!passwordMatches) {
        await shareLinkRateLimiter.limit(ctx, "passwordFailuresByToken", {
          key: args.token,
        });

        const failedAccessAttempts = (link.failedAccessAttempts ?? 0) + 1;
        const updates: Partial<Doc<"shareLinks">> = {
          failedAccessAttempts,
        };
        if (failedAccessAttempts >= PASSWORD_MAX_FAILED_ATTEMPTS) {
          updates.failedAccessAttempts = 0;
          updates.lockedUntil = now + PASSWORD_LOCKOUT_MS;
        }

        await ctx.db.patch(link._id, updates);
        return { ok: false, grantToken: null };
      }

      const successUpdates: Partial<Doc<"shareLinks">> = {};
      if ((link.failedAccessAttempts ?? 0) > 0) {
        successUpdates.failedAccessAttempts = 0;
      }
      if (link.lockedUntil !== undefined) {
        successUpdates.lockedUntil = undefined;
      }
      if (link.password && !link.passwordHash) {
        successUpdates.passwordHash = await hashPassword(link.password);
        successUpdates.password = undefined;
      }

      if (Object.keys(successUpdates).length > 0) {
        await ctx.db.patch(link._id, successUpdates);
      }
    }

    // Enforce invite-only access and resolve the viewer's role. This is the
    // real security boundary (getByToken's requiresAccess is only a UI hint).
    const access = await resolveViewerAccess(ctx, link);
    if (!access.allowed) {
      return { ok: false, grantToken: null, reason: "notInvited" as const };
    }

    // Capture viewer identity for leak forensics. Clerk identity (if any)
    // comes from the Convex auth context — that's the most reliable signal
    // when a recipient is signed in. The IP hash + UA + referrer are caller-
    // provided since the V8 isolate doesn't see request headers directly.
    const identity = await ctx.auth.getUserIdentity();
    const viewerEmail =
      typeof identity?.email === "string" && identity.email.length > 0
        ? identity.email
        : undefined;
    const grantToken = await issueShareAccessGrant(
      ctx,
      link._id,
      undefined,
      {
        viewerClerkId: identity?.subject,
        viewerEmail,
        viewerIpHash: args.viewerIpHash?.trim() || undefined,
        viewerUserAgent: args.viewerUserAgent?.slice(0, 512) || undefined,
        viewerReferrer: args.viewerReferrer?.slice(0, 512) || undefined,
      },
      access.role,
    );

    await ctx.db.patch(link._id, {
      viewCount: link.viewCount + 1,
    });

    return {
      ok: true,
      grantToken,
    };
  },
});

/**
 * Updates a link's general access, default role, and permission toggles.
 * Owner/member only.
 */
export const setAccess = mutation({
  args: {
    linkId: v.id("shareLinks"),
    generalAccess: v.optional(v.union(v.literal("anyone"), v.literal("invite"))),
    defaultRole: v.optional(shareRoleValidator),
    commentsEnabled: v.optional(v.boolean()),
    showAllVersions: v.optional(v.boolean()),
    allowDownload: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new Error("Share link not found");
    await requireShareLinkManageAccess(ctx, link);

    const updates: Partial<Doc<"shareLinks">> = {};
    if (args.generalAccess !== undefined) updates.generalAccess = args.generalAccess;
    if (args.defaultRole !== undefined) updates.defaultRole = args.defaultRole;
    if (args.commentsEnabled !== undefined) updates.commentsEnabled = args.commentsEnabled;
    if (args.showAllVersions !== undefined) updates.showAllVersions = args.showAllVersions;
    if (args.allowDownload !== undefined) updates.allowDownload = args.allowDownload;
    await ctx.db.patch(args.linkId, updates);
    return null;
  },
});

/** Adds (or updates the role of) a per-email invite on an invite-capable link. */
export const addInvite = mutation({
  args: {
    linkId: v.id("shareLinks"),
    email: v.string(),
    role: shareRoleValidator,
  },
  returns: v.id("shareInvites"),
  handler: async (ctx, args): Promise<Id<"shareInvites">> => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new Error("Share link not found");
    await requireShareLinkManageAccess(ctx, link);
    const identity = (await ctx.auth.getUserIdentity())!;

    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("Enter a valid email address.");
    }

    const existing = await ctx.db
      .query("shareInvites")
      .withIndex("by_link_and_email", (q) =>
        q.eq("shareLinkId", args.linkId).eq("email", email),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role });
      return existing._id;
    }

    return await ctx.db.insert("shareInvites", {
      shareLinkId: args.linkId,
      email,
      role: args.role,
      invitedByClerkId: identity.subject,
      invitedByName: identityName(identity),
      createdAt: Date.now(),
    });
  },
});

export const updateInviteRole = mutation({
  args: { inviteId: v.id("shareInvites"), role: shareRoleValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new Error("Invite not found");
    const link = await ctx.db.get(invite.shareLinkId);
    if (!link) throw new Error("Share link not found");
    await requireShareLinkManageAccess(ctx, link);
    await ctx.db.patch(args.inviteId, { role: args.role });
    return null;
  },
});

export const removeInvite = mutation({
  args: { inviteId: v.id("shareInvites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) return null;
    const link = await ctx.db.get(invite.shareLinkId);
    if (!link) throw new Error("Share link not found");
    await requireShareLinkManageAccess(ctx, link);
    await ctx.db.delete(args.inviteId);
    return null;
  },
});

/** The people invited to a link + its access config. Owner/member only. */
export const getAccessConfig = query({
  args: { linkId: v.id("shareLinks") },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) return null;
    await requireShareLinkManageAccess(ctx, link);

    const invites = await ctx.db
      .query("shareInvites")
      .withIndex("by_share_link", (q) => q.eq("shareLinkId", args.linkId))
      .collect();

    return {
      generalAccess: link.generalAccess ?? "anyone",
      defaultRole: link.defaultRole ?? "commenter",
      commentsEnabled: link.commentsEnabled !== false,
      showAllVersions: link.showAllVersions === true,
      allowDownload: link.allowDownload,
      invites: invites
        .map((i) => ({
          _id: i._id,
          email: i.email,
          role: i.role,
          invitedByName: i.invitedByName,
          createdAt: i.createdAt,
        }))
        .sort((a, b) => a.email.localeCompare(b.email)),
    };
  },
});
