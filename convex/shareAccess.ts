import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";
import { generateUniqueToken } from "./security";

type ReadCtx = QueryCtx | MutationCtx;

export const SHARE_ACCESS_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export async function findShareLinkByToken(ctx: ReadCtx, token: string) {
  return await ctx.db
    .query("shareLinks")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

export async function cleanupExpiredShareAccessGrantsForLink(
  ctx: MutationCtx,
  shareLinkId: Id<"shareLinks">,
) {
  const grants = await ctx.db
    .query("shareAccessGrants")
    .withIndex("by_share_link", (q) => q.eq("shareLinkId", shareLinkId))
    .collect();

  const now = Date.now();
  for (const grant of grants) {
    if (grant.expiresAt <= now) {
      await ctx.db.delete(grant._id);
    }
  }
}

export type ShareRole = "viewer" | "commenter" | "editor";

export async function issueShareAccessGrant(
  ctx: MutationCtx,
  shareLinkId: Id<"shareLinks">,
  ttlMs: number = SHARE_ACCESS_GRANT_TTL_MS,
  forensics?: {
    viewerClerkId?: string;
    viewerEmail?: string;
    viewerIpHash?: string;
    viewerUserAgent?: string;
    viewerReferrer?: string;
  },
  role?: ShareRole,
) {
  await cleanupExpiredShareAccessGrantsForLink(ctx, shareLinkId);

  const token = await generateUniqueToken(
    40,
    async (candidate) =>
      (await ctx.db
        .query("shareAccessGrants")
        .withIndex("by_token", (q) => q.eq("token", candidate))
        .unique()) !== null,
    5,
  );

  const now = Date.now();
  await ctx.db.insert("shareAccessGrants", {
    shareLinkId,
    token,
    createdAt: now,
    expiresAt: now + ttlMs,
    viewerClerkId: forensics?.viewerClerkId,
    viewerEmail: forensics?.viewerEmail,
    viewerIpHash: forensics?.viewerIpHash,
    viewerUserAgent: forensics?.viewerUserAgent,
    viewerReferrer: forensics?.viewerReferrer,
    role,
  });

  return token;
}

/**
 * Shared capability helper. Given a grant's role and the link's permission
 * flags, derives what the viewer may do. A missing role is treated as
 * "commenter" so legacy grants keep working.
 */
export function shareCapabilities(
  role: ShareRole | undefined,
  link: { commentsEnabled?: boolean },
): { canComment: boolean; role: ShareRole } {
  const resolved: ShareRole = role ?? "commenter";
  const commentsOn = link.commentsEnabled !== false;
  return {
    role: resolved,
    canComment: commentsOn && (resolved === "commenter" || resolved === "editor"),
  };
}

export async function resolveActiveShareGrant(
  ctx: ReadCtx,
  grantToken: string,
): Promise<
  | {
      grant: Doc<"shareAccessGrants">;
      shareLink: Doc<"shareLinks">;
    }
  | null
> {
  const grant = await ctx.db
    .query("shareAccessGrants")
    .withIndex("by_token", (q) => q.eq("token", grantToken))
    .unique();

  if (!grant || grant.expiresAt <= Date.now()) {
    return null;
  }

  const shareLink = await ctx.db.get(grant.shareLinkId);
  if (!shareLink) {
    return null;
  }

  if (shareLink.expiresAt && shareLink.expiresAt <= Date.now()) {
    return null;
  }

  return { grant, shareLink };
}
