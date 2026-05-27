/**
 * Playback provider abstraction.
 *
 * Today every video goes through Mux. The unit COGS shows that's the
 * single largest line item per paid customer — for typical creative
 * teams, encoding alone is roughly 50% of the gross cost of revenue.
 * Cloudflare Stream is ~10–15× cheaper for the same encode + delivery
 * profile, so the long-term plan is to route paid-tier traffic to
 * Stream while keeping Mux on the free tier and on watermarked
 * paywalled deliveries (Mux's signed-playback story is more mature).
 *
 * This file is the *contract* every provider has to satisfy. The
 * `convex/mux.ts` module covers most of the Mux side already; the new
 * `convex/cloudflareStream.ts` (created alongside this file) is the
 * Stream-side stub. The actual cutover is multi-week work — schema
 * dual-write, webhook unification, watermarking equivalence — but
 * codifying the contract first lets us migrate incrementally per
 * surface without an "everything at once" PR.
 *
 * Surfaces a provider must cover (mapped to the existing Mux uses):
 *
 *   • createAssetFromInputUrl   — accept a public URL, return an asset
 *                                 id + initial playback id pair. Async
 *                                 encoding completes via webhook.
 *   • createPreviewAsset        — watermarked preview for paywalled
 *                                 deliveries. Mux has Mosaic; Stream
 *                                 needs a custom watermark pipeline.
 *   • signPlaybackToken         — short-TTL token for signed delivery.
 *   • buildPlaybackUrl          — adaptive-stream manifest URL.
 *   • buildThumbnailUrl         — poster image URL.
 *   • requestStaticRenditions   — generate MP4 download proxies.
 *   • deleteAsset               — cleanup on delete.
 *   • verifyWebhookSignature    — distinguish real provider callbacks.
 *
 * Adapters that mirror this shape live next to this file:
 *   • convex/mux.ts                 — existing Mux integration
 *   • convex/cloudflareStream.ts    — new Stream stub (scaffolding)
 *
 * The eventual dispatcher (`getProviderForVideo(video)`) reads the
 * `playbackProvider` field added to the videos schema in this PR.
 */

export type PlaybackProviderKey = "mux" | "cloudflare_stream";

/**
 * Returns the default provider for new uploads. Reads
 * `PLAYBACK_PROVIDER_DEFAULT` from env, falls back to `"mux"` so
 * existing deployments keep their behavior until they opt in.
 *
 * Per-tier routing (e.g. free → stream, paid → mux) can layer on top
 * by passing `plan` here; left as a future hook.
 */
export function defaultPlaybackProvider(): PlaybackProviderKey {
  const raw = process.env.PLAYBACK_PROVIDER_DEFAULT?.trim().toLowerCase();
  if (raw === "cloudflare_stream" || raw === "stream") {
    return "cloudflare_stream";
  }
  return "mux";
}

/**
 * Returns the playback provider key for an existing video. Stored on
 * the row so we can mix providers in the same workspace during the
 * migration. Defaults to "mux" because every pre-migration row was
 * Mux-only and the column is optional.
 */
export function resolvePlaybackProvider(
  video: { playbackProvider?: string | null },
): PlaybackProviderKey {
  const raw = video.playbackProvider?.toLowerCase();
  if (raw === "cloudflare_stream") return "cloudflare_stream";
  return "mux";
}

/**
 * Shape every adapter must return when starting an ingest. Both Mux
 * and Stream produce an id pair that we persist on the video row —
 * the "asset id" is the upstream-side handle for management calls,
 * the "playback id" is what we use to build watch URLs.
 */
export interface CreateAssetResult {
  assetId: string;
  /** Public, unsigned playback id used for in-team review. */
  playbackId: string;
  /** When the provider returns an upload-handle distinct from the
   *  asset (Mux does; Stream uses TUS resumable URLs), surface it
   *  here for the client. */
  uploadId?: string;
}

/**
 * Generic upload-vs-playback URL shape. Adapters convert from their
 * native object to this when reporting status / building UI URLs.
 */
export interface PlaybackUrls {
  hlsUrl: string;
  thumbnailUrl: string;
  /** MP4 download is a static rendition Mux generates on request; on
   *  Stream it's the original-file proxy URL. Optional because we
   *  request it lazily, not at upload. */
  mp4Url?: string;
}
