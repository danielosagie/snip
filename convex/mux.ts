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
      // Mux auto-transcribes the audio into a WebVTT text track so the
      // *spoken content* of the video becomes searchable (indexed via
      // the video.asset.track.ready webhook). Part of Mux — no extra API.
      // Per Mux's API, generated_subtitles must live on the *first* input
      // alongside the URL; a separate generated_subtitles-only input is
      // rejected as "invalid additional input".
      {
        url: inputUrl,
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
 * Static-rendition ("proxy") resolutions Mux can generate. `highest` follows the
 * source resolution (capped by the asset's max tier); the rest are explicit.
 */
export type ProxyResolution =
  | "highest"
  | "2160p"
  | "1440p"
  | "1080p"
  | "720p"
  | "540p"
  | "480p"
  | "360p"
  | "270p"
  | "audio-only";

/**
 * Mux names a static rendition deterministically from its resolution, e.g.
 * `720p` → `720p.mp4`, `audio-only` → `audio.m4a`. We derive it here so the
 * "preparing" row and the download URL agree before the webhook lands.
 */
export function renditionNameForResolution(
  resolution: ProxyResolution,
): { name: string; ext: "mp4" | "m4a" } {
  if (resolution === "audio-only") return { name: "audio.m4a", ext: "m4a" };
  return { name: `${resolution}.mp4`, ext: "mp4" };
}

/**
 * Request one MP4 static rendition per resolution for an existing asset. Each is
 * an async re-encode (costs money) — callers should de-dupe against already
 * requested/ready renditions. Returns the derived name/ext/resolution per entry.
 * Idempotent-ish on Mux's side: re-requesting an existing resolution 409s, which
 * we swallow so a retry doesn't fail the whole batch.
 */
export async function requestStaticRenditions(
  assetId: string,
  resolutions: ProxyResolution[],
): Promise<Array<{ name: string; ext: "mp4" | "m4a"; resolution: ProxyResolution }>> {
  const mux = getMuxClient();
  const out: Array<{ name: string; ext: "mp4" | "m4a"; resolution: ProxyResolution }> = [];
  for (const resolution of resolutions) {
    const { name, ext } = renditionNameForResolution(resolution);
    try {
      await mux.video.assets.createStaticRendition(assetId, { resolution });
    } catch (err) {
      // Already-exists (409) is fine — we still track it. Rethrow anything else.
      const status = (err as { status?: number })?.status;
      if (status !== 409) throw err;
    }
    out.push({ name, ext, resolution });
  }
  return out;
}

/**
 * Direct-download URL for a ready static rendition. `name` is the Mux file name
 * (e.g. "720p.mp4"). Append a signed JWT (audience "video") for signed-policy
 * playback ids; omit `token` for public ones.
 */
export function buildMuxRenditionDownloadUrl(
  playbackId: string,
  name: string,
  token?: string,
): string {
  const url = new URL(`https://stream.mux.com/${playbackId}/${name}`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
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
