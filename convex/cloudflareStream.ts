"use node";

/**
 * Cloudflare Stream client.
 *
 * Live for the in-team REVIEW path: `videoActions.startEncoding` routes
 * new uploads here when `defaultPlaybackProvider(tier)` says Stream,
 * the `/webhooks/cf-stream` route (convex/http.ts →
 * cloudflareStreamActions) flips the row ready, and
 * `getPlaybackSession` builds videodelivery.net URLs for Stream rows.
 *
 * Routed by env (see convex/providers/playbackProvider.ts):
 *   • PLAYBACK_PROVIDER_DEFAULT=cloudflare_stream → all new uploads.
 *   • PLAYBACK_PROVIDER_BY_TIER=true → free-tier uploads only.
 *   • default (both unset/false) → Mux, no behavior change.
 *
 * Still on Mux (deliberate): paywalled, watermarked deliveries. That
 * preview is encoded from the S3 original, independent of which
 * provider does review playback, so it keeps working for Stream rows.
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

// External calls get an explicit timeout so an upstream stall can't
// hang the Convex action (and cascade into a stuck "processing" row).
const STREAM_HTTP_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_HTTP_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
  const response = await fetchWithTimeout(`${streamBaseUrl()}/copy`, {
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
  const response = await fetchWithTimeout(`${streamBaseUrl()}/${streamUid}/token`, {
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
  const response = await fetchWithTimeout(`${streamBaseUrl()}/${streamUid}`, {
    method: "DELETE",
    headers: authHeader(),
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    throw new Error(`Stream delete failed (${response.status}): ${text}`);
  }
}

// Webhook signature verification + processing lives in
// `convex/cloudflareStreamActions.ts` (node runtime — needs
// `node:crypto`). The HTTP route at `/webhooks/cf-stream` proxies to
// that action. See its `verifyStreamSignature` helper and
// `processWebhook` action for the implementation.
