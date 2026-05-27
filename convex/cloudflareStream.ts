"use node";

/**
 * Cloudflare Stream client.
 *
 * Scaffolding only — the operations are stubbed where they call the
 * Cloudflare API. The migration path:
 *
 *   1. (this PR) — module exists, contract documented, schema field
 *      added on the `videos` row. Existing code still routes 100% to
 *      Mux because PLAYBACK_PROVIDER_DEFAULT is unset (Mux fallback).
 *   2. Wire one upload path (e.g. desktop drive uploads) through
 *      `createAssetFromInputUrl` here; dual-write tests in dev.
 *   3. Add webhook handler at `/cf-stream/webhook` mirroring
 *      `customer.subscription.*` style. Update video status when the
 *      `video.live_input.connected` or `stream.ready` event arrives.
 *   4. Flip PLAYBACK_PROVIDER_DEFAULT for new uploads on free tier.
 *   5. Watch margin metrics for ~30 days; flip paid tiers next.
 *   6. Backfill — only when paywalled + watermarked equivalence is
 *      proven on Stream (Mux Mosaic doesn't translate directly).
 *
 * Cost reference (May 2026 list):
 *   • Stream storage:  $1 per 1000 min stored / month
 *   • Stream delivery: $1 per 1000 min watched
 * vs Mux:
 *   • Encoding (basic): $0.04 / min source
 *   • Delivery (avg):   $0.001 / min watched
 *
 * For our typical Basic-tier customer (≈200 source-min/mo encoded,
 * 1000 min/mo delivered), Stream is ~$1.20 vs Mux ~$9 — a 7-8×
 * unit-cost reduction.
 */

import {
  CreateAssetResult,
  PlaybackUrls,
} from "./providers/playbackProvider";

function readEnv(...names: string[]): string | null {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.trim().length > 0) return v;
  }
  return null;
}

function requireEnv(...names: string[]): string {
  const v = readEnv(...names);
  if (!v) {
    throw new Error(
      `Cloudflare Stream is not configured: set one of ${names.join(" / ")}.`,
    );
  }
  return v;
}

/**
 * Returns true when the Stream API credentials are present in the
 * Convex deployment env. The webhook handler and the per-tier router
 * gate on this so half-configured deployments fall back to Mux instead
 * of throwing at upload time.
 */
export function isCloudflareStreamConfigured(): boolean {
  return Boolean(
    readEnv("CF_STREAM_ACCOUNT_ID") &&
      readEnv("CF_STREAM_API_TOKEN", "CLOUDFLARE_API_TOKEN"),
  );
}

function streamBaseUrl(): string {
  const accountId = requireEnv("CF_STREAM_ACCOUNT_ID");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`;
}

function authHeader(): Record<string, string> {
  const token = requireEnv("CF_STREAM_API_TOKEN", "CLOUDFLARE_API_TOKEN");
  return { Authorization: `Bearer ${token}` };
}

/**
 * Asks Stream to copy a public URL into its account. Mirrors
 * `createMuxAssetFromInputUrl` — async; the asset id comes back
 * immediately, encoding completes via webhook.
 *
 * Stream's "copy" endpoint:
 * POST /accounts/:account/stream/copy { url, meta? }
 */
export async function createStreamAssetFromInputUrl(
  videoId: string,
  inputUrl: string,
): Promise<CreateAssetResult> {
  const response = await fetch(`${streamBaseUrl()}/copy`, {
    method: "POST",
    headers: {
      ...authHeader(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: inputUrl,
      // Stream stores arbitrary meta on the asset; we mirror Mux's
      // `passthrough` for the videoId reference so the webhook can
      // map back without an extra lookup.
      meta: { videoId },
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Stream copy failed (${response.status}): ${text}`);
  }
  const json = (await response.json()) as {
    result?: { uid?: string; playback?: { hls?: string } };
  };
  const uid = json.result?.uid;
  if (!uid) {
    throw new Error("Stream copy returned no uid.");
  }
  // Stream uses `uid` for both the asset handle and the playback
  // identifier (the playback URL embeds it directly), so the two are
  // identical on this provider.
  return { assetId: uid, playbackId: uid };
}

/**
 * Returns adaptive HLS + thumbnail URLs for a Stream uid. These are
 * unsigned/public URLs — appropriate for in-team review. Signed
 * playback uses a separate `signed` URL with a JWT (see below).
 */
export function buildStreamPlaybackUrls(streamUid: string): PlaybackUrls {
  return {
    hlsUrl: `https://videodelivery.net/${streamUid}/manifest/video.m3u8`,
    thumbnailUrl: `https://videodelivery.net/${streamUid}/thumbnails/thumbnail.jpg`,
  };
}

/**
 * Mints a short-TTL signed playback URL. Stream's signing endpoint:
 * POST /accounts/:account/stream/:uid/token
 *
 * Stubbed until we wire signed playback equivalence. For the
 * unsigned-playback path (in-team review), use
 * `buildStreamPlaybackUrls` above.
 */
export async function signStreamPlaybackToken(
  streamUid: string,
  ttlSeconds = 3600,
): Promise<string> {
  const response = await fetch(`${streamBaseUrl()}/${streamUid}/token`, {
    method: "POST",
    headers: {
      ...authHeader(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Stream sign failed (${response.status}): ${text}`);
  }
  const json = (await response.json()) as { result?: { token?: string } };
  const token = json.result?.token;
  if (!token) {
    throw new Error("Stream sign returned no token.");
  }
  return token;
}

/**
 * Deletes a Stream asset. Mirrors `deleteMuxAsset`. Best-effort —
 * called from the video soft-delete cleanup path.
 */
export async function deleteStreamAsset(streamUid: string): Promise<void> {
  const response = await fetch(`${streamBaseUrl()}/${streamUid}`, {
    method: "DELETE",
    headers: authHeader(),
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(`Stream delete failed (${response.status}): ${text}`);
  }
}

/**
 * Verifies a Stream webhook signature. Stream uses a different scheme
 * than Mux — `Webhook-Signature: t=…,sig1=…` — and a separate signing
 * secret. Stubbed until the webhook handler at `/cf-stream/webhook`
 * gets wired in `convex/http.ts`.
 *
 * The validation algorithm is documented at:
 * https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/
 */
export function verifyStreamWebhookSignature(
  _rawBody: string,
  _signatureHeader: string | null,
): boolean {
  // TODO: implement when we wire the webhook route in convex/http.ts.
  // Returning false here so any test invocation fails closed.
  return false;
}
