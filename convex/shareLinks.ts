import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
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
import { resolveBundleVideos } from "./shareBundles";
import { MAX_LINE_ITEM_AMOUNT_CENTS } from "./paymentsPolicy";

const shareLinkStatusValidator = v.union(
  v.literal("missing"),
  v.literal("expired"),
  // The link is valid but its video is still encoding. Distinct from
  // "missing" so the share page can say "still processing" instead of
  // "expired or invalid".
  v.literal("processing"),
  v.literal("requiresPassword"),
  v.literal("requiresAccess"),
  v.literal("ok"),
);

const shareRoleValidator = v.union(
  v.literal("viewer"),
  v.literal("commenter"),
  v.literal("editor"),
);

type ShareCoverKind = "video" | "image" | "document";

function shareCoverKind(video: Doc<"videos">): ShareCoverKind {
  const contentType = video.contentType?.toLowerCase() ?? "";
  if (contentType.startsWith("video/") || video.muxPlaybackId) return "video";
  if (contentType.startsWith("image/")) return "image";
  return "document";
}

function hasUsableShareCover(video: Doc<"videos">): boolean {
  if (video.status !== "ready") return false;
  const kind = shareCoverKind(video);
  if (kind === "video") {
    return Boolean(
      video.muxPreviewPlaybackId || video.muxPlaybackId || video.thumbnailUrl,
    );
  }
  if (kind === "image") {
    return Boolean(
      video.imagePreviewS3Key || video.s3Key || video.thumbnailUrl,
    );
  }
  return Boolean(video.thumbnailUrl);
}

const SHARE_COVER_KIND_PRIORITY: Record<ShareCoverKind, number> = {
  video: 0,
  image: 1,
  document: 2,
};

function compareShareCoverItems(
  left: Doc<"videos">,
  right: Doc<"videos">,
): number {
  const kindDifference =
    SHARE_COVER_KIND_PRIORITY[shareCoverKind(left)] -
    SHARE_COVER_KIND_PRIORITY[shareCoverKind(right)];
  if (kindDifference !== 0) return kindDifference;
  if (left._creationTime !== right._creationTime) {
    return left._creationTime - right._creationTime;
  }
  return left._id.localeCompare(right._id);
}

/**
 * Single source of truth for cover selection. An explicit cover wins while it
 * remains in the share. Automatic covers prefer video, then image, then
 * document, with immutable Convex creation time and id as stable tie-breakers.
 */
function resolveShareCover(
  videos: Doc<"videos">[],
  coverVideoId?: Id<"videos">,
): Doc<"videos"> | null {
  if (coverVideoId) {
    const explicit = videos.find((video) => video._id === coverVideoId);
    if (explicit) return explicit;
  }
  return videos
    .filter(hasUsableShareCover)
    .sort(compareShareCoverItems)[0] ?? null;
}

const COVER_STRIP_LIMIT = 24;

/**
 * Deterministic strip order, chosen cover first, capped at
 * COVER_STRIP_LIMIT so a huge folder cannot flood the picker or the
 * unfurl payload (the cover always survives the cap because it sorts
 * first). Every caller inherits the bound by construction.
 */
function orderShareCoverItems(
  videos: Doc<"videos">[],
  coverVideoId?: Id<"videos">,
): Doc<"videos">[] {
  const cover = resolveShareCover(videos, coverVideoId);
  const ordered = [...videos].sort(compareShareCoverItems);
  const withCoverFirst = cover
    ? [cover, ...ordered.filter((video) => video._id !== cover._id)]
    : ordered;
  return withCoverFirst.slice(0, COVER_STRIP_LIMIT);
}

function serializeShareCoverItem(video: Doc<"videos">) {
  return {
    _id: video._id,
    title: video.title,
    kind: shareCoverKind(video),
    contentType: video.contentType ?? null,
    thumbnailUrl: video.thumbnailUrl ?? null,
    s3Key: video.s3Key ?? null,
    muxPlaybackId: video.muxPlaybackId ?? null,
    muxPreviewAssetId: video.muxPreviewAssetId ?? null,
    muxPreviewPlaybackId: video.muxPreviewPlaybackId ?? null,
    muxPreviewReady: video.muxPreviewAssetStatus === "ready",
    imagePreviewS3Key: video.imagePreviewS3Key ?? null,
    imagePreviewReady: video.imagePreviewStatus === "ready",
  };
}

async function resolveFolderCoverVideos(
  ctx: QueryCtx | MutationCtx,
  folderId: Id<"folders">,
): Promise<Doc<"videos">[]> {
  const folder = await ctx.db.get(folderId);
  if (!folder) throw new Error("Folder not found");
  await requireProjectAccess(ctx, folder.projectId);

  const visited = new Set<string>([folderId]);
  const queue: Id<"folders">[] = [folderId];
  const videos: Doc<"videos">[] = [];
  // Tripwire, not a target: covers only need the first deterministic
  // handful of items. A drive-synced .app bundle can hold hundreds of
  // nested folders; walking all of them costs real queries and once froze
  // the share dialog rendering the result.
  const MAX_COVER_VIDEOS = 60;
  const MAX_COVER_FOLDERS = 120;
  let visitedFolders = 0;
  while (queue.length > 0) {
    if (videos.length >= MAX_COVER_VIDEOS || visitedFolders >= MAX_COVER_FOLDERS) break;
    visitedFolders += 1;
    const currentFolderId = queue.shift()!;
    const [children, folderVideos] = await Promise.all([
      ctx.db
        .query("folders")
        .withIndex("by_project_and_parent", (q) =>
          q
            .eq("projectId", folder.projectId)
            .eq("parentFolderId", currentFolderId),
        )
        .collect(),
      ctx.db
        .query("videos")
        .withIndex("by_folder", (q) => q.eq("folderId", currentFolderId))
        .collect(),
    ]);
    videos.push(
      ...folderVideos.filter(
        (video) => !video.deletedAt && video.isCurrentVersion !== false,
      ),
    );
    for (const child of children) {
      if (visited.has(child._id)) continue;
      visited.add(child._id);
      queue.push(child._id);
    }
  }
  return videos;
}

async function validateCoverForTarget(
  ctx: QueryCtx | MutationCtx,
  target: {
    videoId?: Id<"videos">;
    bundleId?: Id<"shareBundles">;
  },
  coverVideoId: Id<"videos">,
) {
  if (target.videoId) {
    if (target.videoId !== coverVideoId) {
      throw new Error("Cover must be the shared item.");
    }
    const video = await ctx.db.get(coverVideoId);
    if (!video || video.deletedAt) throw new Error("Cover item not found.");
    return;
  }
  if (!target.bundleId) throw new Error("Share link has no target");
  const bundle = await ctx.db.get(target.bundleId);
  if (!bundle) throw new Error("Bundle not found");
  const videos = await resolveBundleVideos(ctx, bundle);
  if (!videos.some((video) => video._id === coverVideoId)) {
    throw new Error("Cover must belong to the shared bundle.");
  }
}

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

  // Invite-only. Workspace members of the link's owning team get in by default
  // — they already have dashboard access to the underlying project — at the
  // link's default role. The owner can turn this off (allowTeamAccess=false),
  // hence "team members get access unless told not".
  if (link.allowTeamAccess !== false && identity?.subject) {
    const teamId = await resolveLinkTeamId(ctx, link);
    if (teamId) {
      const membership = await ctx.db
        .query("teamMembers")
        .withIndex("by_team_and_user", (q) =>
          q.eq("teamId", teamId).eq("userClerkId", identity.subject),
        )
        .unique();
      if (membership) {
        return {
          allowed: true,
          role: link.defaultRole ?? "commenter",
          isOwner: false,
        };
      }
    }
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

/** The team that owns a share link's target (via video→project or bundle→project). */
async function resolveLinkTeamId(
  ctx: QueryCtx | MutationCtx,
  link: Doc<"shareLinks">,
): Promise<Id<"teams"> | null> {
  if (link.videoId) {
    const video = await ctx.db.get(link.videoId);
    if (!video) return null;
    const project = await ctx.db.get(video.projectId);
    return project?.teamId ?? null;
  }
  if (link.bundleId) {
    const bundle = await ctx.db.get(link.bundleId);
    if (!bundle) return null;
    const project = await ctx.db.get(bundle.projectId);
    return project?.teamId ?? null;
  }
  return null;
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
    | {
        priceCents: number;
        currency?: string;
        description?: string;
        mode?: "all" | "per_item";
      }
    | undefined,
):
  | {
      priceCents: number;
      currency: string;
      description?: string;
      mode?: "all" | "per_item";
    }
  | undefined {
  if (!paywall) return undefined;
  if (
    !Number.isSafeInteger(paywall.priceCents) ||
    paywall.priceCents < 50 ||
    paywall.priceCents > MAX_LINE_ITEM_AMOUNT_CENTS
  ) {
    throw new Error(
      `Paywall price must be an integer from 50 to ${MAX_LINE_ITEM_AMOUNT_CENTS} cents.`,
    );
  }
  const currency = sanitizeCurrency(paywall.currency);
  if (paywall.mode === "per_item" && currency !== "usd") {
    throw new Error("Per-item pricing currently supports USD only.");
  }
  return {
    priceCents: paywall.priceCents,
    currency,
    description: paywall.description?.trim() || undefined,
    mode: paywall.mode,
  };
}

function sanitizeItemPrices(
  itemPrices: Array<{ videoId: Id<"videos">; priceCents: number }> | undefined,
  shareItems: Doc<"videos">[],
): Array<{ videoId: Id<"videos">; priceCents: number }> | undefined {
  if (itemPrices === undefined) return undefined;
  if (itemPrices.length === 0 || itemPrices.length > 200) {
    throw new Error("Per-item pricing requires 1 to 200 priced items.");
  }
  const allowedIds = new Set(shareItems.map((item) => item._id));
  const seen = new Set<string>();
  return itemPrices.map((item) => {
    if (!allowedIds.has(item.videoId)) {
      throw new Error("Every item price must belong to this share.");
    }
    if (seen.has(item.videoId)) {
      throw new Error("Each shared item may have only one price.");
    }
    seen.add(item.videoId);
    if (
      !Number.isSafeInteger(item.priceCents) ||
      item.priceCents <= 0 ||
      item.priceCents > MAX_LINE_ITEM_AMOUNT_CENTS
    ) {
      throw new Error(
        `Item prices must be positive integer cents up to ${MAX_LINE_ITEM_AMOUNT_CENTS}.`,
      );
    }
    return { videoId: item.videoId, priceCents: item.priceCents };
  });
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
    coverVideoId: v.optional(v.id("videos")),
    coverImageS3Key: v.optional(v.string()),
    headerTitle: v.optional(v.string()),
    headerDescription: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
    allowDownload: v.optional(v.boolean()),
    password: v.optional(v.string()),
    paywall: v.optional(
      v.object({
        priceCents: v.number(),
        currency: v.optional(v.string()),
        description: v.optional(v.string()),
        mode: v.optional(v.union(v.literal("all"), v.literal("per_item"))),
      }),
    ),
    itemPrices: v.optional(
      v.array(
        v.object({
          videoId: v.id("videos"),
          priceCents: v.number(),
        }),
      ),
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
      let shareItems: Doc<"videos">[];
      if (args.videoId) {
        const { user, video } = await requireVideoAccess(
          ctx,
          args.videoId,
          "member",
        );
        creatorSubject = user.subject;
        creatorName = identityName(user);
        shareItems = [video];
      } else {
        const bundle = await ctx.db.get(args.bundleId!);
        if (!bundle) throw new Error("Bundle not found");
        const { user } = await requireProjectAccess(ctx, bundle.projectId, "member");
        creatorSubject = user.subject;
        creatorName = identityName(user);
        shareItems = await resolveBundleVideos(ctx, bundle);
      }

      if (args.coverVideoId) {
        await validateCoverForTarget(
          ctx,
          { videoId: args.videoId, bundleId: args.bundleId },
          args.coverVideoId,
        );
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
      const itemPrices = sanitizeItemPrices(args.itemPrices, shareItems);
      if (paywall?.mode === "per_item" && !itemPrices) {
        throw new Error("Per-item paywalls require stored item prices.");
      }
      if (paywall?.mode !== "per_item" && itemPrices) {
        throw new Error("Item prices require paywall mode per_item.");
      }
      requireRecipientIdentityForPaywall(
        paywall,
        args.clientEmail,
        args.clientLabel,
      );

      const shareLinkId = await ctx.db.insert("shareLinks", {
        videoId: args.videoId,
        bundleId: args.bundleId,
        coverVideoId: args.coverVideoId,
        coverImageS3Key: args.coverImageS3Key,
        headerTitle: args.headerTitle?.trim() || undefined,
        headerDescription: args.headerDescription?.trim() || undefined,
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
        itemPrices,
        clientLabel: args.clientLabel?.trim() || undefined,
        clientEmail: args.clientEmail?.trim() || undefined,
        generalAccess: args.generalAccess ?? "anyone",
        defaultRole: args.defaultRole ?? "commenter",
        commentsEnabled: args.commentsEnabled ?? true,
        showAllVersions: args.showAllVersions ?? false,
      });

      // The first six deterministic collage items include the cover and are
      // enough for either supported grid. Video preview generation is generic
      // and idempotent, so warming it here also makes ordinary video shares
      // eligible for private-safe rich unfurls. Paid single-image shares and
      // every bundle image need a per-link rendered preview for the crawler.
      const previewItems = orderShareCoverItems(
        shareItems,
        args.coverVideoId,
      ).slice(0, 6);
      for (const item of previewItems) {
        const ct = (item?.contentType ?? "").toLowerCase();
        if (ct.startsWith("video/")) {
          await ctx.scheduler.runAfter(
            0,
            internal.videoActions.ensurePreviewAssetForVideo,
            { videoId: item._id },
          );
        } else if (
          (paywall || args.bundleId) &&
          ct.startsWith("image/") &&
          ct !== "image/gif"
        ) {
          await ctx.scheduler.runAfter(
            0,
            internal.imagePreview.generateForVideoItem,
            {
              videoId: item._id,
              shareLinkId,
              primaryLabel:
                args.clientEmail ??
                args.clientLabel ??
                `share/${shareLinkId.toString().slice(-8)}`,
              secondaryLabel: "Preview. Do not redistribute.",
            },
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
        coverVideoId: args.coverVideoId,
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
      coverVideoId: link.coverVideoId ?? null,
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
      itemPrices: link.itemPrices ?? null,
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
        coverVideoId: link.coverVideoId ?? null,
        token: link.token,
        createdByName: link.createdByName,
        expiresAt: link.expiresAt,
        allowDownload: link.allowDownload,
        viewCount: link.viewCount,
        hasPassword: hasPasswordProtection(link),
        creatorName: link.createdByName,
        isExpired: link.expiresAt ? link.expiresAt < Date.now() : false,
        paywall: link.paywall ?? null,
        itemPrices: link.itemPrices ?? null,
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
    // The uploaded cover belongs to this link and nothing else points at it,
    // so it goes with the link. Scheduled rather than awaited: a storage
    // hiccup must not leave the link undeletable.
    if (link.coverImageS3Key) {
      await ctx.scheduler.runAfter(0, internal.videoActions.deleteStorageObject, {
        key: link.coverImageS3Key,
      });
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
      coverVideoId: link.coverVideoId ?? null,
      token: link.token,
      paywall: link.paywall ?? null,
      itemPrices: link.itemPrices ?? null,
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
    coverVideoId: v.optional(v.union(v.id("videos"), v.null())),
    // Pass null to clear. The object itself is swept by retention alongside
    // the link, so clearing here only detaches it.
    coverImageS3Key: v.optional(v.union(v.string(), v.null())),
    headerTitle: v.optional(v.union(v.string(), v.null())),
    headerDescription: v.optional(v.union(v.string(), v.null())),
    paywall: v.optional(
      v.union(
        v.object({
          priceCents: v.number(),
          currency: v.optional(v.string()),
          description: v.optional(v.string()),
          mode: v.optional(v.union(v.literal("all"), v.literal("per_item"))),
        }),
        v.null(),
      ),
    ),
    itemPrices: v.optional(
      v.union(
        v.array(
          v.object({
            videoId: v.id("videos"),
            priceCents: v.number(),
          }),
        ),
        v.null(),
      ),
    ),
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

    if (args.coverVideoId !== undefined) {
      if (args.coverVideoId) {
        await validateCoverForTarget(
          ctx,
          { videoId: link.videoId, bundleId: link.bundleId },
          args.coverVideoId,
        );
      }
      updates.coverVideoId = args.coverVideoId ?? undefined;
    }

    if (args.coverImageS3Key !== undefined) {
      updates.coverImageS3Key = args.coverImageS3Key ?? undefined;
    }
    if (args.headerTitle !== undefined) {
      updates.headerTitle = args.headerTitle?.trim() || undefined;
    }
    if (args.headerDescription !== undefined) {
      updates.headerDescription = args.headerDescription?.trim() || undefined;
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

    if (args.paywall !== undefined || args.itemPrices !== undefined) {
      const shareItems = link.videoId
        ? [await ctx.db.get(link.videoId)].filter(
            (item): item is Doc<"videos"> => Boolean(item && !item.deletedAt),
          )
        : link.bundleId
          ? await (async () => {
              const bundle = await ctx.db.get(link.bundleId!);
              if (!bundle) throw new Error("Bundle not found");
              return await resolveBundleVideos(ctx, bundle);
            })()
          : [];
      const paywall =
        args.paywall === undefined
          ? link.paywall
          : sanitizePaywallInput(args.paywall ?? undefined);
      const itemPrices =
        args.itemPrices === undefined && args.paywall !== null
          ? link.itemPrices
          : sanitizeItemPrices(args.itemPrices ?? undefined, shareItems);
      if (paywall?.mode === "per_item" && !itemPrices) {
        throw new Error("Per-item paywalls require stored item prices.");
      }
      if (paywall?.mode !== "per_item" && itemPrices) {
        throw new Error("Item prices require paywall mode per_item.");
      }
      requireRecipientIdentityForPaywall(
        paywall,
        link.clientEmail,
        link.clientLabel,
      );
      updates.paywall = paywall;
      updates.itemPrices = itemPrices;
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

    // Single-video links: distinguish a genuinely broken link (deleted /
    // missing video) from one whose video is simply still encoding. The
    // latter is a valid link the owner just created right after upload —
    // surfacing it as "processing" lets the share page say "check back
    // shortly" instead of the alarming "expired or invalid". This query is
    // reactive, so it flips to "ok" on its own once Mux finishes. Bundle
    // links are valid as long as the bundle row exists — the share page
    // handles empty/in-progress items gracefully.
    if (link.videoId) {
      const video = await ctx.db.get(link.videoId);
      if (!video || video.deletedAt) {
        return { status: "missing" as const };
      }
      if (video.status !== "ready") {
        return { status: "processing" as const };
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

/**
 * Title (+ description) for link-unfurl cards — OG/Twitter meta — resolved from
 * the token ALONE, with no access grant issued and no side effects. Used by the
 * /share route's `head` loader.
 *
 * Privacy-gated: only openly accessible ("anyone") links without a password
 * reveal their title. Password- and invite-protected links return null so a
 * leaked URL can't expose the content's name in a chat preview. Paywalled links
 * ARE "anyone" access (pay-to-watch, not hidden), so they unfurl normally.
 */
export const getUnfurlByToken = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({
      title: v.string(),
      description: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const link = await findShareLinkByToken(ctx, args.token);
    if (!link) return null;
    if (link.expiresAt && link.expiresAt < Date.now()) return null;
    if ((link.generalAccess ?? "anyone") !== "anyone") return null;
    if (hasPasswordProtection(link)) return null;

    if (link.videoId) {
      const video = await ctx.db.get(link.videoId);
      if (!video || video.deletedAt) return null;
      return { title: video.title, description: video.description ?? null };
    }
    if (link.bundleId) {
      const bundle = await ctx.db.get(link.bundleId);
      if (!bundle) return null;
      return {
        title: bundle.headerTitle ?? bundle.name,
        description: bundle.headerDescription ?? null,
      };
    }
    return null;
  },
});

/**
 * Authenticated media source for the three share composers. The browser never
 * reimplements cover resolution: it receives the deterministic server choice
 * plus the same ordered item records used by getUnfurlMedia.
 */
export const getCoverPickerMedia = internalQuery({
  args: {
    videoId: v.optional(v.id("videos")),
    bundleId: v.optional(v.id("shareBundles")),
    folderId: v.optional(v.id("folders")),
    videoIds: v.optional(v.array(v.id("videos"))),
    coverVideoId: v.optional(v.id("videos")),
  },
  handler: async (ctx, args) => {
    const sourceCount = [
      args.videoId,
      args.bundleId,
      args.folderId,
      args.videoIds,
    ].filter((value) => value !== undefined).length;
    if (sourceCount !== 1) {
      throw new Error("Cover picker requires exactly one share source.");
    }

    let videos: Doc<"videos">[];
    if (args.videoId) {
      const { video } = await requireVideoAccess(ctx, args.videoId, "member");
      videos = video.deletedAt ? [] : [video];
    } else if (args.bundleId) {
      const bundle = await ctx.db.get(args.bundleId);
      if (!bundle) throw new Error("Bundle not found");
      await requireProjectAccess(ctx, bundle.projectId, "member");
      videos = await resolveBundleVideos(ctx, bundle);
    } else if (args.folderId) {
      videos = await resolveFolderCoverVideos(ctx, args.folderId);
    } else {
      const videoIds = args.videoIds ?? [];
      if (videoIds.length === 0 || videoIds.length > 200) {
        throw new Error("Cover picker requires 1 to 200 items.");
      }
      const resolved = await Promise.all(
        videoIds.map(async (videoId) => {
          const { video } = await requireVideoAccess(ctx, videoId, "member");
          return video;
        }),
      );
      const projectIds = new Set(resolved.map((video) => video.projectId));
      if (projectIds.size !== 1) {
        throw new Error("All cover items must belong to the same project.");
      }
      videos = resolved.filter((video) => !video.deletedAt);
    }

    const resolvedCover = resolveShareCover(videos, args.coverVideoId);
    return {
      resolvedCoverVideoId: resolvedCover?._id ?? null,
      items: orderShareCoverItems(videos, args.coverVideoId).map(
        serializeShareCoverItem,
      ),
    };
  },
});

/**
 * Privacy-gated media source for all share unfurls and the collage HTTP action.
 * Password and invite links return before title or media resolution. The
 * internal item fields are used only to mint safe signed URLs or inline image
 * bytes; they are never returned directly to a crawler.
 */
export const getUnfurlMedia = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const link = await findShareLinkByToken(ctx, args.token);
    if (!link) return null;
    if (link.expiresAt && link.expiresAt < Date.now()) return null;
    if ((link.generalAccess ?? "anyone") !== "anyone") return null;
    if (hasPasswordProtection(link)) return null;

    if (link.videoId) {
      const video = await ctx.db.get(link.videoId);
      if (!video || video.deletedAt) return null;
      const resolvedCover = resolveShareCover([video], link.coverVideoId);
      return {
        kind: "single" as const,
        shareLinkId: link._id,
        title: link.headerTitle ?? video.title,
        description: link.headerDescription ?? video.description ?? null,
        uploadedCoverKey: link.coverImageS3Key ?? null,
        isPaywalled: Boolean(link.paywall),
        storedCoverVideoId: link.coverVideoId ?? null,
        resolvedCoverVideoId: resolvedCover?._id ?? null,
        items: orderShareCoverItems([video], link.coverVideoId).map(
          serializeShareCoverItem,
        ),
      };
    }

    if (link.bundleId) {
      const bundle = await ctx.db.get(link.bundleId);
      if (!bundle) return null;
      const videos = await resolveBundleVideos(ctx, bundle);
      const resolvedCover = resolveShareCover(videos, link.coverVideoId);
      return {
        kind: "bundle" as const,
        shareLinkId: link._id,
        // Link-level header beats the bundle's, so two links to the same
        // bundle can be addressed to two different clients.
        title: link.headerTitle ?? bundle.headerTitle ?? bundle.name,
        description:
          link.headerDescription ?? bundle.headerDescription ?? null,
        uploadedCoverKey:
          link.coverImageS3Key ?? bundle.coverImageS3Key ?? null,
        isPaywalled: Boolean(link.paywall),
        storedCoverVideoId: link.coverVideoId ?? null,
        resolvedCoverVideoId: resolvedCover?._id ?? null,
        items: orderShareCoverItems(videos, link.coverVideoId).map(
          serializeShareCoverItem,
        ),
      };
    }

    return null;
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
    allowTeamAccess: v.optional(v.boolean()),
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
    if (args.allowTeamAccess !== undefined) updates.allowTeamAccess = args.allowTeamAccess;
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
      allowTeamAccess: link.allowTeamAccess !== false,
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
