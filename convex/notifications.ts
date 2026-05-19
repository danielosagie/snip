import { v } from "convex/values";
import {
  mutation,
  query,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { requireUser } from "./auth";

/**
 * Email notification preferences (Settings → Notifications) + the
 * helpers the event sites use to decide whether to send.
 *
 * No row for a user = defaults below (matches the original UI toggle
 * defaults: comment replies + contract-signed on, upload completion
 * off). All sends are still gated by RESEND_API_KEY/APP_URL in
 * email.ts, so this is purely opt-in delivery on top of that.
 */

export type PrefKey = "commentReply" | "contractSigned" | "uploadFinished";

const DEFAULTS: Record<PrefKey, boolean> = {
  commentReply: true,
  contractSigned: true,
  uploadFinished: false,
};

type Ctx = QueryCtx | MutationCtx;

/** Is `key` enabled for this user? (default-aware, no-row safe) */
export async function prefEnabled(
  ctx: Ctx,
  userClerkId: string,
  key: PrefKey,
): Promise<boolean> {
  const row = await ctx.db
    .query("notificationPrefs")
    .withIndex("by_user", (q) => q.eq("userClerkId", userClerkId))
    .unique();
  return row ? row[key] : DEFAULTS[key];
}

/** Resolve a user's email from any team membership (teamMembers carries
 *  userEmail). Returns null if we can't — caller then just skips email. */
export async function resolveUserEmail(
  ctx: Ctx,
  userClerkId: string,
): Promise<string | null> {
  const m = await ctx.db
    .query("teamMembers")
    .withIndex("by_user", (q) => q.eq("userClerkId", userClerkId))
    .first();
  return m?.userEmail ?? null;
}

export const getMyPrefs = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q) => q.eq("userClerkId", user.subject))
      .unique();
    return {
      commentReply: row?.commentReply ?? DEFAULTS.commentReply,
      contractSigned: row?.contractSigned ?? DEFAULTS.contractSigned,
      uploadFinished: row?.uploadFinished ?? DEFAULTS.uploadFinished,
    };
  },
});

export const updateMyPrefs = mutation({
  args: {
    commentReply: v.optional(v.boolean()),
    contractSigned: v.optional(v.boolean()),
    uploadFinished: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("notificationPrefs")
      .withIndex("by_user", (q) => q.eq("userClerkId", user.subject))
      .unique();
    const next = {
      userClerkId: user.subject,
      commentReply:
        args.commentReply ?? existing?.commentReply ?? DEFAULTS.commentReply,
      contractSigned:
        args.contractSigned ??
        existing?.contractSigned ??
        DEFAULTS.contractSigned,
      uploadFinished:
        args.uploadFinished ??
        existing?.uploadFinished ??
        DEFAULTS.uploadFinished,
    };
    if (existing) {
      await ctx.db.patch(existing._id, next);
    } else {
      await ctx.db.insert("notificationPrefs", next);
    }
  },
});
