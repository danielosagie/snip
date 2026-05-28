"use node";

import { createHmac, timingSafeEqual } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildStreamPlaybackUrls } from "./cloudflareStream";

/**
 * Cloudflare Stream webhook processor.
 *
 * Stream emits events on the lifecycle of an asset — created,
 * encoding-ready, error. The route in `convex/http.ts` proxies the
 * raw body + signature header here; this action verifies and applies.
 *
 * Signature scheme (different from Mux's HMAC):
 *   Header: Webhook-Signature: time=<unix>,sig1=<hex>
 *   Payload: `${time}.${rawBody}`
 *   HMAC-SHA256 with CF_STREAM_WEBHOOK_SECRET → hex
 *
 * Per Cloudflare's docs:
 * https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/
 */

const READY_STATE = "ready";
const ERROR_STATE = "error";

function verifyStreamSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  // Header format: "time=1671476703,sig1=abcdef…"
  const parts = signatureHeader.split(",").map((p) => p.trim());
  let time: string | null = null;
  let sig1: string | null = null;
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === "time") time = v;
    else if (k === "sig1") sig1 = v;
  }
  if (!time || !sig1) return false;

  // Reject events older than 5 minutes — bounds replay attacks even
  // if the secret leaks briefly.
  const ageSec = Math.abs(Date.now() / 1000 - Number(time));
  if (!Number.isFinite(ageSec) || ageSec > 300) return false;

  const expected = createHmac("sha256", secret)
    .update(`${time}.${rawBody}`)
    .digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig1, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type StreamEventBody = {
  uid?: string;
  status?: { state?: string };
  duration?: number;
  meta?: { videoId?: string };
  thumbnail?: string;
};

/**
 * Public webhook entry. Returns { status, message } so the HTTP route
 * can shape the response without knowing internals — same pattern as
 * Mux's `processWebhook`.
 */
export const processWebhook = internalAction({
  args: {
    rawBody: v.string(),
    signature: v.optional(v.string()),
  },
  returns: v.object({ status: v.number(), message: v.string() }),
  handler: async (ctx, args): Promise<{ status: number; message: string }> => {
    const secret = process.env.CF_STREAM_WEBHOOK_SECRET;
    if (!secret) {
      // Don't 500 — we'd lose Stream's retries on a misconfigured
      // deployment. 200-but-noop so Cloudflare stops retrying and an
      // operator can fix the env.
      console.warn("Stream webhook ignored — CF_STREAM_WEBHOOK_SECRET not set");
      return { status: 200, message: "ignored: not configured" };
    }
    if (!verifyStreamSignature(args.rawBody, args.signature ?? null, secret)) {
      return { status: 401, message: "invalid signature" };
    }

    let body: StreamEventBody;
    try {
      body = JSON.parse(args.rawBody) as StreamEventBody;
    } catch {
      return { status: 400, message: "invalid json" };
    }

    const uid = body.uid;
    const state = body.status?.state;
    if (!uid || !state) {
      return { status: 200, message: "noop: missing uid/state" };
    }

    // Resolve the video row from either the explicit meta.videoId we
    // set on copy, or by streamUid index lookup. The meta path is
    // faster + survives an import.
    const videoId = await ctx.runQuery(
      internal.videos.resolveVideoFromStreamRefs,
      { uid, metaVideoId: body.meta?.videoId },
    );
    if (!videoId) {
      return { status: 200, message: "noop: no matching video" };
    }

    if (state === READY_STATE) {
      const urls = buildStreamPlaybackUrls(uid);
      // Stream-specific ready path — skips the Mux watermarked-preview
      // pre-warm that markAsReady fires (which would be a broken Mux
      // job against a Stream-hosted video). See markStreamReady.
      await ctx.runMutation(internal.videos.markStreamReady, {
        videoId,
        streamUid: uid,
        duration:
          typeof body.duration === "number" && body.duration > 0
            ? body.duration
            : undefined,
        thumbnailUrl: body.thumbnail ?? urls.thumbnailUrl,
      });
      return { status: 200, message: "ok" };
    }

    if (state === ERROR_STATE) {
      await ctx.runMutation(internal.videos.markAsFailed, {
        videoId,
        uploadError: "Cloudflare Stream reported an encoding error.",
      });
      return { status: 200, message: "ok: error recorded" };
    }

    // pending / queued / inprogress — Stream sends these for visibility
    // but our row already shows "processing"; nothing to do.
    return { status: 200, message: "noop: transient state" };
  },
});
