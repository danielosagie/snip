import { v } from "convex/values";
import {
  mutation,
  action,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getIdentity, identityName } from "./auth";

/**
 * Zero-setup desktop pairing (Clerk sign-in token relay).
 *
 *   1. Desktop generates a 128-bit `code`, calls `createPairing` (no auth),
 *      opens https://<web>/connect-desktop?code=… and starts polling.
 *   2. The signed-in web user lands on /connect-desktop and approves —
 *      `approvePairing` (Clerk-authed) mints a single-use Clerk sign-in
 *      token for that user and stashes it on the row.
 *   3. Desktop's next `pollPairing` returns the sign-in token + the
 *      storage bootstrap exactly once (then the token is nulled). The
 *      desktop redeems the ticket with Clerk JS → its own durable session.
 *
 * The user never types a URL, token, or bucket credential.
 */

const PAIRING_TTL_MS = 10 * 60 * 1000;
const MIN_CODE_LEN = 24; // desktop sends crypto-random hex; reject weak codes
const SIGN_IN_TOKEN_TTL_SEC = 600;

// ─── Storage bootstrap ───────────────────────────────────────────────────────
//
// Mirrors convex/s3.ts provider detection. The desktop needs the raw
// bucket creds to run `rclone mount` — there is one shared global bucket
// per deployment (accepted tradeoff; scoped per-user tokens are a tracked
// follow-up). Returned only to a desktop that completed an authenticated
// pairing approval.

type StorageBootstrap = {
  provider: "r2" | "railway";
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

function readStorageBootstrap(): StorageBootstrap | null {
  const env = process.env;
  if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return {
      provider: "r2",
      bucket: env.R2_BUCKET_NAME ?? "",
      endpoint: env.R2_ENDPOINT ?? "",
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      region: env.R2_REGION ?? "auto",
    };
  }
  if (env.RAILWAY_ACCESS_KEY_ID && env.RAILWAY_SECRET_ACCESS_KEY) {
    return {
      provider: "railway",
      bucket: env.RAILWAY_BUCKET_NAME ?? "",
      endpoint: env.RAILWAY_ENDPOINT ?? "",
      accessKeyId: env.RAILWAY_ACCESS_KEY_ID,
      secretAccessKey: env.RAILWAY_SECRET_ACCESS_KEY,
      region: env.RAILWAY_REGION ?? "us-east-1",
    };
  }
  return null;
}

// ─── Step 1: desktop starts a pairing ────────────────────────────────────────

export const createPairing = mutation({
  args: { code: v.string(), deviceLabel: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const code = args.code.trim();
    if (code.length < MIN_CODE_LEN) {
      throw new Error("Pairing code too weak.");
    }
    // Don't allow a second active pairing to reuse a live code.
    const existing = await ctx.db
      .query("desktopPairings")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (existing && existing.status === "pending" && existing.expiresAt > Date.now()) {
      return { ok: true as const, expiresAt: existing.expiresAt };
    }
    const now = Date.now();
    const expiresAt = now + PAIRING_TTL_MS;
    await ctx.db.insert("desktopPairings", {
      code,
      status: "pending",
      createdAt: now,
      expiresAt,
      deviceLabel: args.deviceLabel,
    });
    return { ok: true as const, expiresAt };
  },
});

// ─── Step 2: web user approves (Clerk-authenticated) ─────────────────────────

export const lookupPending = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("desktopPairings")
      .withIndex("by_code", (q) => q.eq("code", args.code.trim()))
      .unique();
    if (!row) return null;
    return {
      _id: row._id,
      status: row.status,
      expiresAt: row.expiresAt,
      deviceLabel: row.deviceLabel ?? null,
    };
  },
});

export const markApproved = internalMutation({
  args: {
    code: v.string(),
    userClerkId: v.string(),
    userName: v.string(),
    signInToken: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("desktopPairings")
      .withIndex("by_code", (q) => q.eq("code", args.code.trim()))
      .unique();
    if (!row) throw new Error("Pairing not found.");
    if (row.status !== "pending") {
      throw new Error("This pairing was already used or is no longer valid.");
    }
    if (row.expiresAt < Date.now()) {
      await ctx.db.patch(row._id, { status: "expired" });
      throw new Error("This pairing request expired. Restart it from the app.");
    }
    await ctx.db.patch(row._id, {
      status: "approved",
      userClerkId: args.userClerkId,
      userName: args.userName,
      signInToken: args.signInToken,
    });
  },
});

export const approvePairing = action({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; deviceLabel: string | null }> => {
    const identity = await getIdentity(ctx);
    const userId = identity.subject;

    const pending = await ctx.runQuery(internal.desktopAuth.lookupPending, {
      code: args.code,
    });
    if (!pending) throw new Error("Unknown pairing code.");
    if (pending.status !== "pending") {
      throw new Error("This device was already connected.");
    }
    if (pending.expiresAt < Date.now()) {
      throw new Error("This pairing request expired. Restart it from the app.");
    }

    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) throw new Error("Clerk is not configured on the server.");

    const resp = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        expires_in_seconds: SIGN_IN_TOKEN_TTL_SEC,
      }),
    });
    if (!resp.ok) {
      throw new Error(
        `Could not mint a sign-in token (Clerk HTTP ${resp.status}).`,
      );
    }
    const body = (await resp.json()) as { token?: string };
    if (!body.token) throw new Error("Clerk returned no sign-in token.");

    await ctx.runMutation(internal.desktopAuth.markApproved, {
      code: args.code,
      userClerkId: userId,
      userName: identityName(identity),
      signInToken: body.token,
    });

    return { ok: true as const, deviceLabel: pending.deviceLabel };
  },
});

// ─── Step 3: desktop collects the ticket + bootstrap (once) ──────────────────

export const pollPairing = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("desktopPairings")
      .withIndex("by_code", (q) => q.eq("code", args.code.trim()))
      .unique();
    if (!row) return { status: "unknown" as const };

    if (row.status === "pending" && row.expiresAt < Date.now()) {
      await ctx.db.patch(row._id, { status: "expired" });
      return { status: "expired" as const };
    }
    if (row.status === "pending") return { status: "pending" as const };
    if (row.status === "expired") return { status: "expired" as const };
    if (row.status === "consumed") return { status: "consumed" as const };

    // approved → hand the ticket + bootstrap over exactly once.
    const signInToken = row.signInToken ?? null;
    await ctx.db.patch(row._id, { status: "consumed", signInToken: undefined });
    if (!signInToken) return { status: "consumed" as const };

    const storage = readStorageBootstrap();
    return {
      status: "approved" as const,
      signInToken,
      userName: row.userName ?? null,
      storage,
    };
  },
});
