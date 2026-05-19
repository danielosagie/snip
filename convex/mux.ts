"use node";

import Mux from "@mux/mux-node";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  return null;
}

function normalizePrivateKey(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function getMuxJwtCredentials(): { keyId: string; keySecret: string } {
  const keyId = readEnv(
    "MUX_SIGNING_KEY",
    "MUX_SIGNING_KEY_ID",
  );
  if (!keyId) {
    throw new Error(
      "Missing required environment variable: MUX_SIGNING_KEY (or legacy MUX_SIGNING_KEY_ID)",
    );
  }

  const keySecret = readEnv(
    "MUX_PRIVATE_KEY",
    "MUX_SIGNING_PRIVATE_KEY",
  );
  if (!keySecret) {
    throw new Error(
      "Missing required environment variable: MUX_PRIVATE_KEY (or legacy MUX_SIGNING_PRIVATE_KEY)",
    );
  }

  return { keyId, keySecret: normalizePrivateKey(keySecret) };
}

let cachedMux: Mux | null = null;

export function getMuxClient(): Mux {
  if (cachedMux) return cachedMux;

  cachedMux = new Mux({
    tokenId: requireEnv("MUX_TOKEN_ID"),
    tokenSecret: requireEnv("MUX_TOKEN_SECRET"),
  });

  return cachedMux;
}

export async function createMuxAssetFromInputUrl(videoId: string, inputUrl: string) {
  const mux = getMuxClient();
  return await mux.video.assets.create({
    inputs: [
      { url: inputUrl },
      // Mux auto-transcribes the audio into a WebVTT text track so the
      // *spoken content* of the video becomes searchable (indexed via
      // the video.asset.track.ready webhook). Part of Mux — no extra API.
      {
        generated_subtitles: [
          { language_code: "en", name: "English (auto)" },
        ],
      },
    ],
    playback_policies: ["public"],
    video_quality: "basic",
    // Mux currently supports 1080p as the lowest adaptive streaming max tier.
    max_resolution_tier: "1080p",
    mp4_support: "none",
    passthrough: videoId,
  });
}

/**
 * Add a Mux auto-generated English subtitle/transcript track to an
 * already-ingested asset. Used to backfill transcription for videos that
 * predate generated_subtitles being requested at create time.
 */
export async function addGeneratedSubtitles(assetId: string) {
  // The SDK's AssetCreateTrackParams (v12) has no `generated_subtitles`
  // field even though the REST endpoint supports it, so call the API
  // directly with Basic auth.
  const auth = btoa(
    `${requireEnv("MUX_TOKEN_ID")}:${requireEnv("MUX_TOKEN_SECRET")}`,
  );
  const resp = await fetch(
    `https://api.mux.com/video/v1/assets/${assetId}/tracks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        generated_subtitles: [
          { language_code: "en", name: "English (auto)" },
        ],
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(
      `Mux addGeneratedSubtitles ${resp.status}: ${(await resp.text()).slice(0, 200)}`,
    );
  }
  return await resp.json();
}

/**
 * Creates a separate Mux asset that's used as the "preview" version on
 * paywalled share links. Capped at 360p and burns in a per-client
 * watermark image at ingest time so screen-recordings carry identifying
 * marks. Playback policy is "signed" so the URL itself isn't enough —
 * the client must hold a short-TTL JWT we issue per session.
 */
export async function createPreviewMuxAsset(
  videoId: string,
  inputUrl: string,
  watermarkUrl: string,
) {
  const mux = getMuxClient();
  return await mux.video.assets.create({
    inputs: [
      { url: inputUrl },
      {
        url: watermarkUrl,
        overlay_settings: {
          width: "100%",
          height: "100%",
          horizontal_align: "center",
          vertical_align: "middle",
          opacity: "70%",
        },
      },
    ],
    playback_policies: ["signed"],
    video_quality: "basic",
    max_resolution_tier: "1080p",
    mp4_support: "none",
    passthrough: `${videoId}:preview`,
  });
}

/**
 * Adds a signed-policy playback ID to an existing Mux asset. Used to upgrade
 * the original (public) playback path on a video that gets paywalled —
 * post-payment we issue JWTs against this signed ID.
 */
export async function createSignedPlaybackId(assetId: string) {
  const mux = getMuxClient();
  return await mux.video.assets.createPlaybackId(assetId, {
    policy: "signed",
  });
}

/**
 * Build a 360p preview URL — the manifest is forced down to the lowest
 * tier even though the asset includes higher renditions.
 */
export function buildMuxPreviewUrl(playbackId: string, token?: string): string {
  const url = new URL(`https://stream.mux.com/${playbackId}.m3u8`);
  url.searchParams.set("max_resolution", "360p");
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

export async function getMuxAsset(assetId: string) {
  const mux = getMuxClient();
  return await mux.video.assets.retrieve(assetId);
}

export async function deleteMuxAsset(assetId: string) {
  const mux = getMuxClient();
  await mux.video.assets.delete(assetId);
}

export async function createPublicPlaybackId(assetId: string) {
  const mux = getMuxClient();
  return await mux.video.assets.createPlaybackId(assetId, {
    policy: "public",
  });
}

export async function deletePlaybackId(assetId: string, playbackId: string) {
  const mux = getMuxClient();
  await mux.video.assets.deletePlaybackId(assetId, playbackId);
}

export function buildMuxPlaybackUrl(playbackId: string, token?: string): string {
  const url = new URL(`https://stream.mux.com/${playbackId}.m3u8`);
  // Force a single 720p delivery profile in the playback manifest.
  url.searchParams.set("min_resolution", "720p");
  url.searchParams.set("max_resolution", "720p");
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

export function buildMuxThumbnailUrl(playbackId: string, token?: string): string {
  const base = `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0`;
  if (!token) return base;
  return `${base}&token=${encodeURIComponent(token)}`;
}

export async function signPlaybackToken(playbackId: string, expiration = "1h") {
  const mux = getMuxClient();
  const credentials = getMuxJwtCredentials();
  return await mux.jwt.signPlaybackId(playbackId, {
    keyId: credentials.keyId,
    keySecret: credentials.keySecret,
    type: "video",
    expiration,
  });
}

export async function signThumbnailToken(playbackId: string, expiration = "1h") {
  const mux = getMuxClient();
  const credentials = getMuxJwtCredentials();
  return await mux.jwt.signPlaybackId(playbackId, {
    keyId: credentials.keyId,
    keySecret: credentials.keySecret,
    type: "thumbnail",
    expiration,
  });
}

export function verifyMuxWebhookSignature(rawBody: string, signature: string | null) {
  if (!signature) {
    throw new Error("Missing mux-signature header");
  }

  const mux = getMuxClient();
  const webhookSecret = requireEnv("MUX_WEBHOOK_SECRET");

  mux.webhooks.verifySignature(rawBody, {
    "mux-signature": signature,
  }, webhookSecret);
}
