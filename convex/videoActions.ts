"use node";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v } from "convex/values";
import { action, ActionCtx, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  addGeneratedSubtitles,
  buildMuxPlaybackUrl,
  buildMuxPreviewUrl,
  buildMuxRenditionDownloadUrl,
  buildMuxThumbnailUrl,
  createMuxAssetFromInputUrl,
  createPreviewMuxAsset,
  createPublicPlaybackId,
  createSignedPlaybackId,
  getMuxAsset,
  type ProxyResolution,
  requestStaticRenditions,
  signPlaybackToken,
  signThumbnailToken,
} from "./mux";
import { BUCKET_NAME, getS3Client } from "./s3";
import { isFeatureEnabled } from "./featureFlags";
import {
  buildStreamPlaybackUrls,
  createStreamAssetFromInputUrl,
  isCloudflareStreamConfigured,
} from "./cloudflareStream";
import { resolvePlaybackProvider, defaultPlaybackProvider } from "./providers/playbackProvider";

const GIBIBYTE = 1024 ** 3;
const MAX_PRESIGNED_PUT_FILE_SIZE_BYTES = 5 * GIBIBYTE;

// Mux ingest is gated by content type — only actual video types route to
// the Mux pipeline. Everything else (docs, images, audio, source-control
// archives, .prproj, etc.) uploads straight to object storage and shows
// up as a plain file in the project grid. This matches the
// Google-Drive-as-default-experience the team wants.
//
// ProRes / DNxHD / DNxHR are wrapped in QuickTime (.mov), so they arrive
// as video/quicktime and Mux ingests them natively. R3D / BRAW often
// arrive as application/octet-stream — those route to Mux via the
// extension fallback below.
const MUX_VIDEO_CONTENT_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/mp2t",
  "video/x-msvideo",
  "video/x-ms-wmv",
  "video/x-flv",
  "video/3gpp",
  "video/3gpp2",
  "video/ogg",
  "video/mxf",
  "application/mxf",
  "application/mp4",
  "video/mp4v-es",
  "video/iso.segment",
]);

// When the browser couldn't determine a real video MIME (common for ProRes,
// DNxHR, R3D, BRAW) the upload arrives as application/octet-stream. Fall
// back to extension sniffing so these still hit Mux.
const MUX_VIDEO_EXT_FALLBACKS = new Set([
  "mov",
  "mp4",
  "m4v",
  "mkv",
  "webm",
  "mxf",
  "ts",
  "m2ts",
  "mts",
  "avi",
  "flv",
  "wmv",
  "3gp",
  "3g2",
  "ogv",
  "r3d",
  "braw",
  "mpg",
  "mpeg",
]);

const AUDIO_CONTENT_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/x-m4a",
  "audio/mp4",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
  "audio/x-aiff",
  "audio/aiff",
  "audio/webm",
]);

function isMuxVideoType(contentType: string, filenameOrKey?: string): boolean {
  if (MUX_VIDEO_CONTENT_TYPES.has(normalizeContentType(contentType))) {
    return true;
  }
  const normalized = normalizeContentType(contentType);
  if (normalized === "application/octet-stream" || normalized === "") {
    if (filenameOrKey) {
      const ext = getExtensionFromKey(filenameOrKey, "");
      if (ext && MUX_VIDEO_EXT_FALLBACKS.has(ext)) return true;
    }
  }
  return false;
}

export function isAudioContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return AUDIO_CONTENT_TYPES.has(normalizeContentType(contentType));
}

function getExtensionFromKey(key: string, fallback = "mp4") {
  let source = key;
  if (key.startsWith("http://") || key.startsWith("https://")) {
    try {
      source = new URL(key).pathname;
    } catch {
      source = key;
    }
  }

  const ext = source.split(".").pop();
  if (!ext) return fallback;
  if (ext.length > 8 || /[^a-zA-Z0-9]/.test(ext)) return fallback;
  return ext.toLowerCase();
}

function sanitizeFilename(input: string) {
  const trimmed = input.trim();
  const base = trimmed.length > 0 ? trimmed : "video";
  const sanitized = base
    .replace(/["']/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_");
  return sanitized.slice(0, 120);
}

function buildDownloadFilename(title: string | undefined, key: string) {
  const ext = getExtensionFromKey(key);
  const safeTitle = sanitizeFilename(title ?? "video");
  return safeTitle.endsWith(`.${ext}`) ? safeTitle : `${safeTitle}.${ext}`;
}

async function buildDownloadResult(
  key: string,
  options: {
    title?: string;
    contentType?: string;
  },
): Promise<{ url: string; filename: string }> {
  const filename = buildDownloadFilename(options.title, key);

  return {
    url: await buildSignedBucketObjectUrl(key, {
      expiresIn: 600,
      filename,
      contentType: options.contentType ?? "video/mp4",
    }),
    filename,
  };
}

function getDownloadUnavailableMessage(status: string) {
  switch (status) {
    case "uploading":
      return "This video is still uploading and isn't ready to download yet.";
    case "processing":
      return "This video is still processing and isn't ready to download yet.";
    case "failed":
      return "This video couldn't be processed, so it isn't available to download.";
    default:
      return "This video isn't ready to download yet.";
  }
}

function normalizeBucketKey(key: string): string {
  if (key.startsWith("http://") || key.startsWith("https://")) {
    try {
      const pathname = new URL(key).pathname.replace(/^\/+/, "");
      const bucketPrefix = `${BUCKET_NAME}/`;
      return pathname.startsWith(bucketPrefix)
        ? pathname.slice(bucketPrefix.length)
        : pathname;
    } catch {
      return key;
    }
  }
  return key;
}

async function buildSignedBucketObjectUrl(
  key: string,
  options?: {
    expiresIn?: number;
    filename?: string;
    contentType?: string;
  },
): Promise<string> {
  const normalizedKey = normalizeBucketKey(key);
  const s3 = getS3Client();
  const filename = options?.filename;
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: normalizedKey,
    ResponseContentDisposition: filename
      ? `attachment; filename="${filename}"`
      : undefined,
    ResponseContentType: options?.contentType,
  });
  return await getSignedUrl(s3, command, { expiresIn: options?.expiresIn ?? 600 });
}

function getValueString(value: unknown, field: string): string | null {
  const raw = (value as Record<string, unknown>)[field];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function normalizeContentType(contentType: string | null | undefined): string {
  if (!contentType) return "";
  return contentType
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function validateUploadRequestOrThrow(args: { fileSize: number; contentType: string }) {
  if (!Number.isFinite(args.fileSize) || args.fileSize <= 0) {
    throw new Error("File size must be greater than zero.");
  }

  if (args.fileSize > MAX_PRESIGNED_PUT_FILE_SIZE_BYTES) {
    throw new Error("File is too large for direct upload (5 GiB max).");
  }

  // Accept any content type. Mux processing is gated separately on whether
  // the file actually looks like a video (see markUploadComplete).
  return normalizeContentType(args.contentType) || "application/octet-stream";
}

function shouldDeleteUploadedObjectOnFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("Unsupported video format") ||
    error.message.includes("Video file is too large") ||
    error.message.includes("Uploaded video file not found") ||
    error.message.includes("Storage limit reached")
  );
}

async function requireVideoMemberAccess(
  ctx: ActionCtx,
  videoId: Id<"videos">
) {
  const video = (await ctx.runQuery(api.videos.get, { videoId })) as
    | { role?: string }
    | null;
  if (!video || video.role === "viewer") {
    throw new Error("Requires member role or higher");
  }
}

/**
 * Best-effort egress metering. Called at signed-URL generation time —
 * a slight overcount because the user may abandon the download, but
 * cheaper than instrumenting actual byte transfer at the CDN. Silently
 * no-ops when we can't resolve the workspace owner or when fileSize is
 * unknown. Reported to Stripe by the daily PAYG cron.
 *
 * `hintBytes` lets the caller pass a known fileSize without an extra
 * lookup; when omitted we read it via the resolver query.
 */
async function recordEgressBytes(
  ctx: ActionCtx,
  videoId: Id<"videos">,
  hintBytes?: number,
): Promise<void> {
  try {
    const owner = await ctx.runQuery(
      internal.usageMeters.resolveVideoWorkspaceOwner,
      { videoId },
    );
    if (!owner) return;
    const bytes = hintBytes ?? owner.fileSize ?? 0;
    if (bytes <= 0) return;
    await ctx.runMutation(internal.usageMeters.internalIncrementEgress, {
      ownerClerkId: owner.ownerClerkId,
      bytes,
    });
  } catch (err) {
    // Never let metering break a real download.
    console.error("recordEgressBytes failed", err);
  }
}

function buildPublicPlaybackSession(
  playbackId: string,
): { url: string; posterUrl: string } {
  return {
    url: buildMuxPlaybackUrl(playbackId),
    posterUrl: buildMuxThumbnailUrl(playbackId),
  };
}

async function ensurePublicPlaybackId(
  ctx: ActionCtx,
  params: {
    videoId?: Id<"videos">;
    muxAssetId?: string | null;
    muxPlaybackId: string;
  },
): Promise<string> {
  const { videoId, muxAssetId, muxPlaybackId } = params;
  if (!muxAssetId) return muxPlaybackId;
  // Demo bypass: no Mux env → can't call the SDK. The video's
  // muxPlaybackId is already a public playback ID (seeded demo data uses
  // Mux's public test asset), so stream it directly.
  if (!isFeatureEnabled("muxIngest")) return muxPlaybackId;

  const asset = await getMuxAsset(muxAssetId);
  const playbackIds = (asset.playback_ids ?? []) as Array<{
    id?: string;
    policy?: string;
  }>;

  let publicPlaybackId = playbackIds.find((entry) => entry.policy === "public" && entry.id)?.id;
  if (!publicPlaybackId) {
    const created = await createPublicPlaybackId(muxAssetId);
    publicPlaybackId = created.id;
  }

  const resolvedPlaybackId = publicPlaybackId ?? muxPlaybackId;
  if (videoId && resolvedPlaybackId !== muxPlaybackId) {
    await ctx.runMutation(internal.videos.setMuxPlaybackId, {
      videoId,
      muxPlaybackId: resolvedPlaybackId,
      thumbnailUrl: buildMuxThumbnailUrl(resolvedPlaybackId),
    });
  }

  return resolvedPlaybackId;
}

export const getUploadUrl = action({
  args: {
    videoId: v.id("videos"),
    filename: v.string(),
    fileSize: v.number(),
    contentType: v.string(),
  },
  returns: v.object({
    url: v.string(),
    uploadId: v.string(),
  }),
  // Explicit return type: this handler now calls internal.videos.* (whose types
  // are inferred), so without this annotation the action's type recurses through
  // the api graph back into itself ("implicitly has type any"). See Convex docs.
  handler: async (ctx, args): Promise<{ url: string; uploadId: string }> => {
    await requireVideoMemberAccess(ctx, args.videoId);
    const normalizedContentType = validateUploadRequestOrThrow({
      fileSize: args.fileSize,
      contentType: args.contentType,
    });

    const s3 = getS3Client();
    const ext = getExtensionFromKey(args.filename);
    // Originals live under the project tree so the drive's full-res toggle can
    // surface them (proxies sit alongside under proxies/). One copy, no
    // duplication — Mux ingests via a signed URL by key, so the path is free to
    // change. Fall back to the legacy videos/ path if we can't resolve the
    // project, so an upload never breaks on a lookup miss.
    const loc = await ctx.runQuery(internal.videos.getProxyMirrorContext, {
      videoId: args.videoId,
    });
    const key =
      loc?.teamSlug && loc?.projectId
        ? `projects/${loc.teamSlug}/${loc.projectId}/originals/${args.videoId}/${Date.now()}.${ext}`
        : `videos/${args.videoId}/${Date.now()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: normalizedContentType,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    await ctx.runMutation(internal.videos.setUploadInfo, {
      videoId: args.videoId,
      s3Key: key,
      fileSize: args.fileSize,
      contentType: normalizedContentType,
    });

    return { url, uploadId: key };
  },
});

/**
 * Presigned PUT URL for a share bundle's cover image (Notion-style header).
 * Owner/member only — verified via shareBundles.get, which throws for
 * non-members. The client uploads the file to the returned URL, then calls
 * shareBundles.setHeader with the returned `key`.
 */
export const getBundleCoverUploadUrl = action({
  args: {
    bundleId: v.id("shareBundles"),
    filename: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
  },
  returns: v.object({
    url: v.string(),
    key: v.string(),
  }),
  handler: async (ctx, args): Promise<{ url: string; key: string }> => {
    // Throws "Bundle not found" / access error for non-members.
    await ctx.runQuery(api.shareBundles.get, { bundleId: args.bundleId });

    if (!args.contentType.startsWith("image/")) {
      throw new Error("Cover image must be an image file.");
    }
    if (args.fileSize > 10 * 1024 * 1024) {
      throw new Error("Cover image must be under 10 MB.");
    }

    const s3 = getS3Client();
    const ext = getExtensionFromKey(args.filename, "jpg");
    const key = `shareBundles/${args.bundleId}/cover-${Date.now()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ContentType: args.contentType,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return { url, key };
  },
});

/**
 * Grant-gated signed read URL for a bundle's cover image. Returns null when the
 * share has no cover. The S3 key is resolved server-side from the grant so a
 * viewer can never sign an arbitrary object.
 */
export const getSharedBundleCover = action({
  args: { grantToken: v.string() },
  returns: v.object({ url: v.union(v.string(), v.null()) }),
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const key = await ctx.runQuery(internal.videos.getBundleCoverKeyByGrant, {
      grantToken: args.grantToken,
    });
    if (!key) return { url: null };
    const url = await buildSignedBucketObjectUrl(key, { expiresIn: 3600 });
    return { url };
  },
});

export const markUploadComplete = action({
  args: {
    videoId: v.id("videos"),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireVideoMemberAccess(ctx, args.videoId);

    const video = await ctx.runQuery(api.videos.getVideoForPlayback, {
      videoId: args.videoId,
    });

    if (!video || !video.s3Key) {
      throw new Error("Original bucket file not found for this video");
    }

    try {
      const s3 = getS3Client();
      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: video.s3Key,
        }),
      );
      const contentLengthRaw = head.ContentLength;
      if (
        typeof contentLengthRaw !== "number" ||
        !Number.isFinite(contentLengthRaw) ||
        contentLengthRaw <= 0
      ) {
        throw new Error("Uploaded video file not found or empty.");
      }
      const contentLength = contentLengthRaw;
      if (contentLength > MAX_PRESIGNED_PUT_FILE_SIZE_BYTES) {
        throw new Error("Video file is too large for direct upload.");
      }

      const normalizedContentType =
        normalizeContentType(head.ContentType ?? video.contentType) ||
        "application/octet-stream";

      await ctx.runMutation(internal.videos.reconcileUploadedObjectMetadata, {
        videoId: args.videoId,
        fileSize: contentLength,
        contentType: normalizedContentType,
      });

      if (isMuxVideoType(normalizedContentType, video.s3Key)) {
        // Lazy encoding: when enabled, skip ingest and hold the video
        // in `encodingDeferred` state. The first watch triggers
        // `requestEncoding`, which runs the same pipeline. Cuts COGS
        // on the long tail of footage uploaded but never played.
        if (await shouldDeferEncoding(ctx, video.projectId)) {
          await ctx.runMutation(internal.videos.markAsEncodingDeferred, {
            videoId: args.videoId,
          });
        } else {
          await startEncoding(ctx, {
            videoId: args.videoId,
            s3Key: video.s3Key,
            projectId: video.projectId,
          });
        }
      } else {
        // Non-video path — file lives in object storage, no Mux processing.
        // We mark "ready" immediately so the grid + share links treat it as
        // available for download. The video player will detect the absence
        // of a playback ID and render a generic file viewer instead.
        await ctx.runMutation(internal.videos.markAsReadyAsFile, {
          videoId: args.videoId,
          fileSize: contentLength,
          contentType: normalizedContentType,
        });
      }
    } catch (error) {
      const shouldDeleteObject = shouldDeleteUploadedObjectOnFailure(error);
      if (shouldDeleteObject) {
        // Genuine bad-file rejection — drop the object and fail for real.
        const s3 = getS3Client();
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: video.s3Key,
            }),
          );
        } catch {
          // No-op: preserve original processing failure.
        }
        await ctx.runMutation(internal.videos.markAsFailed, {
          videoId: args.videoId,
          uploadError: error instanceof Error ? error.message : undefined,
        });
        throw error;
      }

      // The original is HEAD-verified intact above; this is a Mux ingest
      // problem (e.g. the free-tier "limited to 10 assets" cap, or a Mux
      // outage), not a bad upload. Keep the video playable from the original
      // — the players fall back to original-file playback — instead of
      // showing a misleading "failed". A later backfill can re-encode it.
      await ctx.runMutation(internal.videos.markAsReadyOriginalOnly, {
        videoId: args.videoId,
        muxError: error instanceof Error ? error.message : "Mux ingest failed.",
      });
      return { success: true };
    }

    return { success: true };
  },
});

/**
 * Backfill Mux auto-generated captions for ready videos whose asset was
 * created before `generated_subtitles` was requested at create time (those
 * have a Mux asset but no captions track). Requesting the track is all
 * that's needed: when Mux finishes, the existing `video.asset.track.ready`
 * webhook sets `muxCaptionsTrackId` AND indexes the transcript for search —
 * the backfill rides the same pipeline as fresh uploads. Dry-run unless
 * `apply` is true:
 * `npx convex run videoActions:backfillGeneratedCaptions '{"apply":true}'`
 */
export const backfillGeneratedCaptions = internalAction({
  args: {
    apply: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    candidates: v.number(),
    requested: v.number(),
    failed: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ candidates: number; requested: number; failed: number }> => {
    const rows: Array<{ videoId: Id<"videos">; muxAssetId: string; title: string }> =
      await ctx.runQuery(internal.videos.listCaptionBackfillCandidates, {
        limit: args.limit,
      });
    let requested = 0;
    let failed = 0;
    for (const row of rows) {
      if (!args.apply) continue;
      try {
        await addGeneratedSubtitles(row.muxAssetId);
        requested++;
      } catch (error) {
        // Most common benign failure: the asset already has a subtitle
        // track Mux won't duplicate, or the asset has no audio to
        // transcribe. Log + continue; nothing here is load-bearing.
        console.warn(
          `caption-backfill: ${row.title} (${row.muxAssetId}):`,
          error,
        );
        failed++;
      }
    }
    return { candidates: rows.length, requested, failed };
  },
});

/**
 * One-time backfill for videos stuck "failed" because Mux choked (most often
 * the free-tier 10-asset cap) even though the original upload is intact — the
 * "snip says failed but Finder plays it fine" case. HEAD-checks each failed
 * video's original object and flips the ones that are really present to
 * ready-from-original. Dry-run unless `apply` is true:
 *   npx convex run videoActions:reconcileFailedVideosToOriginal '{"apply":true}'
 */
export const reconcileFailedVideosToOriginal = internalAction({
  args: {
    apply: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    candidates: v.number(),
    recovered: v.number(),
    missing: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ candidates: number; recovered: number; missing: number }> => {
    const rows: Array<{ videoId: Id<"videos">; s3Key: string; title: string }> =
      await ctx.runQuery(internal.videos.listFailedVideosWithOriginal, {
        limit: args.limit,
      });
    const s3 = getS3Client();
    let recovered = 0;
    let missing = 0;
    for (const row of rows) {
      let present = false;
      try {
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: row.s3Key }),
        );
        present =
          typeof head.ContentLength === "number" && head.ContentLength > 0;
      } catch {
        present = false;
      }
      if (!present) {
        missing++;
        continue;
      }
      if (!args.apply) {
        recovered++;
        continue;
      }
      await ctx.runMutation(internal.videos.markAsReadyOriginalOnly, {
        videoId: row.videoId,
        muxError: "Recovered: original present, Mux ingest had failed.",
      });
      recovered++;
    }
    return { candidates: rows.length, recovered, missing };
  },
});

export const markUploadFailed = action({
  args: {
    videoId: v.id("videos"),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireVideoMemberAccess(ctx, args.videoId);

    await ctx.runMutation(internal.videos.markAsFailed, {
      videoId: args.videoId,
      uploadError: "Upload failed before Mux could process the asset.",
    });

    return { success: true };
  },
});

export const getPlaybackSession = action({
  args: { videoId: v.id("videos") },
  returns: v.object({
    url: v.string(),
    posterUrl: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; posterUrl: string }> => {
    const video = await ctx.runQuery(api.videos.getVideoForPlayback, {
      videoId: args.videoId,
    });

    if (!video || video.status !== "ready") {
      throw new Error("Video not found or not ready");
    }

    // Keep this video in the hot set (retention). Throttled write.
    await ctx.runMutation(internal.videos.recordPlayback, {
      videoId: args.videoId,
    });

    // Cloudflare Stream path — the stream uid is both the asset and
    // playback handle, so we build the videodelivery.net URLs
    // directly. No SDK round-trip like Mux's ensurePublicPlaybackId.
    if (resolvePlaybackProvider(video) === "cloudflare_stream") {
      if (!video.streamUid) {
        throw new Error("Stream video is missing its uid");
      }
      const urls = buildStreamPlaybackUrls(video.streamUid);
      return { url: urls.hlsUrl, posterUrl: urls.thumbnailUrl };
    }

    if (!video.muxPlaybackId) {
      throw new Error("Video not found or not ready");
    }
    const playbackId = await ensurePublicPlaybackId(ctx, {
      videoId: args.videoId,
      muxAssetId: video.muxAssetId,
      muxPlaybackId: video.muxPlaybackId,
    });
    return buildPublicPlaybackSession(playbackId);
  },
});

export const getPlaybackUrl = action({
  args: { videoId: v.id("videos") },
  returns: v.object({
    url: v.string(),
  }),
  handler: async (ctx, args): Promise<{ url: string }> => {
    const video = await ctx.runQuery(api.videos.getVideoForPlayback, {
      videoId: args.videoId,
    });

    if (!video || video.status !== "ready") {
      throw new Error("Video not found or not ready");
    }

    await ctx.runMutation(internal.videos.recordPlayback, {
      videoId: args.videoId,
    });

    if (resolvePlaybackProvider(video) === "cloudflare_stream") {
      if (!video.streamUid) {
        throw new Error("Stream video is missing its uid");
      }
      return { url: buildStreamPlaybackUrls(video.streamUid).hlsUrl };
    }

    if (!video.muxPlaybackId) {
      throw new Error("Video not found or not ready");
    }
    const playbackId = await ensurePublicPlaybackId(ctx, {
      videoId: args.videoId,
      muxAssetId: video.muxAssetId,
      muxPlaybackId: video.muxPlaybackId,
    });
    const session = buildPublicPlaybackSession(playbackId);
    return { url: session.url };
  },
});

export const getOriginalPlaybackUrl = action({
  args: { videoId: v.id("videos") },
  returns: v.object({
    url: v.string(),
    contentType: v.string(),
  }),
  handler: async (ctx, args): Promise<{ url: string; contentType: string }> => {
    const video = await ctx.runQuery(api.videos.getVideoForPlayback, {
      videoId: args.videoId,
    });

    if (!video || !video.s3Key) {
      throw new Error("Original bucket file not found for this video");
    }

    const contentType = video.contentType ?? "video/mp4";
    return {
      url: await buildSignedBucketObjectUrl(video.s3Key, {
        expiresIn: 600,
        contentType,
      }),
      contentType,
    };
  },
});

export const getPublicOriginalPlaybackUrl = action({
  args: { publicId: v.string() },
  returns: v.object({
    url: v.string(),
    contentType: v.string(),
  }),
  handler: async (ctx, args): Promise<{ url: string; contentType: string }> => {
    // Instant playback for a public video while Mux is still encoding: serve
    // the original uploaded file straight from the bucket. The same file is
    // already exposed via getPublicDownloadUrl, so playing it during
    // processing doesn't widen access. The /watch page swaps to the Mux
    // adaptive stream the moment muxPlaybackId lands.
    const result = await ctx.runQuery(api.videos.getByPublicIdForDownload, {
      publicId: args.publicId,
    });

    if (!result?.video?.s3Key) {
      throw new Error("Original bucket file not found for this video");
    }
    if (
      result.video.status === "uploading" ||
      result.video.status === "failed"
    ) {
      throw new Error("Video not available");
    }

    const contentType = result.video.contentType ?? "video/mp4";
    return {
      url: await buildSignedBucketObjectUrl(result.video.s3Key, {
        expiresIn: 600,
        contentType,
      }),
      contentType,
    };
  },
});

export const getPublicPlaybackSession = action({
  args: { publicId: v.string() },
  returns: v.object({
    url: v.string(),
    posterUrl: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; posterUrl: string }> => {
    const result = await ctx.runQuery(api.videos.getByPublicId, {
      publicId: args.publicId,
    });

    if (!result?.video?.muxPlaybackId) {
      throw new Error("Video not found or not ready");
    }

    await ctx.runMutation(internal.videos.recordPlayback, {
      videoId: result.video._id,
    });

    const playbackId = await ensurePublicPlaybackId(ctx, {
      videoId: result.video._id,
      muxAssetId: result.video.muxAssetId,
      muxPlaybackId: result.video.muxPlaybackId,
    });
    return buildPublicPlaybackSession(playbackId);
  },
});

export const getSharedPlaybackSession = action({
  args: { grantToken: v.string() },
  returns: v.object({
    url: v.string(),
    posterUrl: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; posterUrl: string }> => {
    const result = await ctx.runQuery(api.videos.getByShareGrant, {
      grantToken: args.grantToken,
    });

    if (!result?.video?.muxPlaybackId) {
      throw new Error("Video not found or not ready");
    }

    // Fail-closed: this path serves an UNSIGNED public Mux URL. A paywalled
    // share must never resolve here — even when paid, it has to go through
    // getSharedPaywalledPlayback so the stream is signed + short-TTL and the
    // token issuance is logged for forensics. Refuse loudly instead of
    // leaking full-res to anyone holding the grant token.
    if (result.paywall) {
      throw new Error(
        "This is a paywalled share — use getSharedPaywalledPlayback.",
      );
    }

    await ctx.runMutation(internal.videos.recordPlayback, {
      videoId: result.video._id,
    });

    const playbackId = await ensurePublicPlaybackId(ctx, {
      videoId: result.video._id,
      muxAssetId: result.video.muxAssetId,
      muxPlaybackId: result.video.muxPlaybackId,
    });
    return buildPublicPlaybackSession(playbackId);
  },
});

export const getDownloadUrl = action({
  args: { videoId: v.id("videos") },
  returns: v.object({
    url: v.string(),
    filename: v.string(),
  }),
  handler: async (ctx, args): Promise<{ url: string; filename: string }> => {
    const video = await ctx.runQuery(api.videos.getVideoForPlayback, {
      videoId: args.videoId,
    });

    if (!video) {
      throw new Error("Video not found");
    }

    if (video.status !== "ready") {
      throw new Error(getDownloadUnavailableMessage(video.status));
    }

    const key = getValueString(video, "s3Key");
    if (!key) {
      throw new Error("Original bucket file not found for this video");
    }

    await recordEgressBytes(ctx, args.videoId, video.fileSize);
    return await buildDownloadResult(key, {
      title: video.title,
      contentType: video.contentType,
    });
  },
});

export const getPublicDownloadUrl = action({
  args: { publicId: v.string() },
  returns: v.object({
    url: v.string(),
    filename: v.string(),
  }),
  handler: async (ctx, args): Promise<{ url: string; filename: string }> => {
    const result = await ctx.runQuery(api.videos.getByPublicIdForDownload, {
      publicId: args.publicId,
    });

    if (!result?.video) {
      throw new Error("Video not found");
    }

    if (result.video.status !== "ready") {
      throw new Error(getDownloadUnavailableMessage(result.video.status));
    }

    const key = getValueString(result.video, "s3Key");
    if (!key) {
      throw new Error("Original bucket file not found for this video");
    }

    await recordEgressBytes(ctx, result.video._id as Id<"videos">);
    return await buildDownloadResult(key, {
      title: result.video.title,
      contentType: result.video.contentType,
    });
  },
});

/**
 * Returns short-TTL signed URLs for every frame of an image sequence.
 * Used by the asset detail page to render the frame grid alongside the
 * stitched playback (when ready). Gated on team membership via the
 * existing video access check.
 */
export const getSequenceFrameUrls = action({
  args: { videoId: v.id("videos") },
  returns: v.array(v.object({ key: v.string(), url: v.string() })),
  handler: async (ctx, args): Promise<Array<{ key: string; url: string }>> => {
    await requireVideoMemberAccess(ctx, args.videoId);
    const video = await ctx.runQuery(api.videos.getVideoForPlayback, {
      videoId: args.videoId,
    });
    if (!video || video.kind !== "image_sequence") return [];
    const keys = (video as { sequenceFrameKeys?: string[] }).sequenceFrameKeys ?? [];
    if (keys.length === 0) return [];
    const out: Array<{ key: string; url: string }> = [];
    for (const key of keys) {
      const url = await buildSignedBucketObjectUrl(key, { expiresIn: 600 });
      out.push({ key, url });
    }
    return out;
  },
});

export const getSharedDownloadUrl = action({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
  },
  returns: v.object({
    url: v.string(),
    filename: v.string(),
  }),
  handler: async (ctx, args): Promise<{ url: string; filename: string }> => {
    const result = await ctx.runQuery(api.videos.getByShareGrantForDownload, {
      grantToken: args.grantToken,
      itemVideoId: args.itemVideoId,
    });

    if (!result?.video) {
      throw new Error("Video not found");
    }

    if (!result.allowDownload) {
      throw new Error("Downloads are disabled for this shared link.");
    }

    // Block downloads on paywalled grants until paid. The preview pipeline
    // already streams only 360p+watermark to unpaid clients via signed Mux;
    // this gate is the equivalent for direct downloads.
    if (result.paywall && !result.grantPaidAt) {
      throw new Error("This download is gated by payment. Pay first to unlock.");
    }

    if (result.video.status !== "ready") {
      throw new Error(getDownloadUnavailableMessage(result.video.status));
    }

    const key = getValueString(result.video, "s3Key");
    if (!key) {
      // Demo-mode fallback: seeded videos have no real upload. Hand the
      // client a public sample MP4 so they can exercise the download UX
      // end-to-end. Only when object storage isn't configured — a
      // misconfigured prod with missing s3Key still errors loudly.
      if (!isFeatureEnabled("objectStorage")) {
        return {
          url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
          filename: `${(result.video.title ?? "demo").replace(/[^a-zA-Z0-9._-]+/g, "_")}.mp4`,
        };
      }
      throw new Error("Original bucket file not found for this video");
    }

    await recordEgressBytes(ctx, result.video._id as Id<"videos">);
    return await buildDownloadResult(key, {
      title: result.video.title,
      contentType: result.video.contentType,
    });
  },
});

// All proxy resolutions Mux can generate. "highest" tracks the source (capped
// by the asset's max tier); the rest are explicit downscales.
const ALLOWED_PROXY_RESOLUTIONS: ProxyResolution[] = [
  "highest", "2160p", "1440p", "1080p", "720p", "540p", "480p", "360p", "270p", "audio-only",
];

/**
 * Kick off Mux static-rendition ("proxy") generation for a video. Member-gated
 * because each rendition is a paid re-encode. Idempotent: skips resolutions that
 * are already ready/preparing. Defaults to a single 720p — a solid offline edit
 * proxy and the cheapest useful default. The webhook flips entries to ready.
 * See plans/proxies-unified.md.
 */
export const requestProxies = action({
  args: {
    videoId: v.id("videos"),
    resolutions: v.optional(v.array(v.string())),
  },
  returns: v.object({
    requested: v.array(v.object({ name: v.string(), resolution: v.string() })),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ requested: Array<{ name: string; resolution: string }> }> => {
    await requireVideoMemberAccess(ctx, args.videoId);
    if (!isFeatureEnabled("muxIngest")) {
      throw new Error("Mux isn't configured, so proxies can't be generated.");
    }
    const video = await ctx.runQuery(api.videos.getVideoForPlayback, {
      videoId: args.videoId,
    });
    if (!video) throw new Error("Video not found");
    if (video.status !== "ready") {
      throw new Error("This video isn't ready for proxy generation yet.");
    }
    const assetId = getValueString(video, "muxAssetId");
    if (!assetId) throw new Error("This item has no Mux asset to proxy.");

    const requested = (args.resolutions?.length ? args.resolutions : ["720p"]).filter(
      (r): r is ProxyResolution =>
        (ALLOWED_PROXY_RESOLUTIONS as string[]).includes(r),
    );
    if (requested.length === 0) {
      throw new Error("No valid proxy resolutions requested.");
    }

    // De-dupe against renditions already ready or in flight.
    const existing = (video.staticRenditions ?? []) as Array<{
      resolution: string;
      status: string;
    }>;
    const inFlight = new Set(
      existing
        .filter((r) => r.status === "ready" || r.status === "preparing")
        .map((r) => r.resolution),
    );
    const todo = requested.filter((r) => !inFlight.has(r));
    if (todo.length === 0) return { requested: [] };

    const created = await requestStaticRenditions(assetId, todo);
    await ctx.runMutation(internal.videos.setStaticRenditionsRequested, {
      videoId: args.videoId,
      entries: created.map((c) => ({
        name: c.name,
        resolution: c.resolution,
        ext: c.ext,
      })),
    });
    return {
      requested: created.map((c) => ({ name: c.name, resolution: c.resolution })),
    };
  },
});

/**
 * Backfill proxies across an existing project: request a rendition for every
 * ready video that has a Mux asset but no proxy yet. Member+ gated (it spends
 * Mux re-encode money) and capped per run by the candidate query so one click
 * can't queue an unbounded bill. Idempotent — re-running skips videos already
 * ready/preparing. Default single 720p.
 */
export const backfillProxiesForProject = action({
  args: {
    projectId: v.id("projects"),
    resolutions: v.optional(v.array(v.string())),
  },
  returns: v.object({ requested: v.number(), candidates: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ requested: number; candidates: number }> => {
    const project = (await ctx.runQuery(api.projects.get, {
      projectId: args.projectId,
    })) as { role?: string } | null;
    if (!project || project.role === "viewer") {
      throw new Error("Requires member role or higher");
    }
    if (!isFeatureEnabled("muxIngest")) {
      throw new Error("Mux isn't configured, so proxies can't be generated.");
    }
    const resolutions = (
      args.resolutions?.length ? args.resolutions : ["720p"]
    ).filter((r): r is ProxyResolution =>
      (ALLOWED_PROXY_RESOLUTIONS as string[]).includes(r),
    );
    if (resolutions.length === 0) {
      throw new Error("No valid proxy resolutions requested.");
    }

    const candidates = await ctx.runQuery(
      internal.videos.listProxyBackfillCandidates,
      { projectId: args.projectId },
    );
    let requested = 0;
    for (const candidate of candidates) {
      try {
        const created = await requestStaticRenditions(
          candidate.muxAssetId,
          resolutions,
        );
        await ctx.runMutation(internal.videos.setStaticRenditionsRequested, {
          videoId: candidate.videoId,
          entries: created.map((c) => ({
            name: c.name,
            resolution: c.resolution,
            ext: c.ext,
          })),
        });
        requested += 1;
      } catch (err) {
        // Don't let one bad asset abort the whole backfill.
        console.error("backfillProxies: rendition request failed", {
          videoId: candidate.videoId,
          error: err,
        });
      }
    }
    return { requested, candidates: candidates.length };
  },
});

/**
 * Signed download URL for a ready Mux static-rendition proxy. Two entry paths,
 * each reusing the SAME gates as the original-file download:
 *  - dashboard:  { videoId }            → viewer access (like getDownloadUrl)
 *  - share page: { grantToken, item? }  → allowDownload + paywall/grantPaidAt
 * Shared downloads use a short-TTL signed Mux JWT when the asset has a signed
 * playback id (paywalled videos must); otherwise the public id (non-paywalled).
 */
export const getProxyDownloadUrl = action({
  args: {
    videoId: v.optional(v.id("videos")),
    grantToken: v.optional(v.string()),
    itemVideoId: v.optional(v.id("videos")),
    renditionName: v.string(),
  },
  returns: v.object({ url: v.string(), filename: v.string() }),
  handler: async (ctx, args): Promise<{ url: string; filename: string }> => {
    if (!args.renditionName) throw new Error("renditionName is required.");

    type Rendition = {
      name: string;
      resolution: string;
      status: string;
      ext: string;
      filesizeBytes?: number;
    };
    let title: string | undefined;
    let videoId: Id<"videos">;
    let publicPlaybackId: string | undefined;
    let signedPlaybackId: string | undefined;
    let renditions: Rendition[];
    let useSigned = false;

    if (args.grantToken) {
      const result = await ctx.runQuery(api.videos.getByShareGrantForDownload, {
        grantToken: args.grantToken,
        itemVideoId: args.itemVideoId,
      });
      if (!result?.video) throw new Error("Video not found");
      if (!result.allowDownload) {
        throw new Error("Downloads are disabled for this shared link.");
      }
      if (result.paywall && !result.grantPaidAt) {
        throw new Error("This download is gated by payment. Pay first to unlock.");
      }
      if (result.video.status !== "ready") {
        throw new Error(getDownloadUnavailableMessage(result.video.status));
      }
      title = result.video.title;
      videoId = result.video._id as Id<"videos">;
      publicPlaybackId = getValueString(result.video, "muxPlaybackId") ?? undefined;
      signedPlaybackId =
        getValueString(result.video, "muxSignedPlaybackId") ?? undefined;
      renditions = (result.video.staticRenditions ?? []) as Rendition[];
      // Paywalled content must go through a signed (short-lived) URL.
      if (result.paywall && !signedPlaybackId) {
        throw new Error("Proxy isn't available for this protected video yet.");
      }
      useSigned = Boolean(signedPlaybackId);
    } else if (args.videoId) {
      const video = await ctx.runQuery(api.videos.getVideoForPlayback, {
        videoId: args.videoId,
      });
      if (!video) throw new Error("Video not found");
      if (video.status !== "ready") {
        throw new Error(getDownloadUnavailableMessage(video.status));
      }
      title = video.title;
      videoId = args.videoId;
      publicPlaybackId = getValueString(video, "muxPlaybackId") ?? undefined;
      signedPlaybackId = getValueString(video, "muxSignedPlaybackId") ?? undefined;
      renditions = (video.staticRenditions ?? []) as Rendition[];
      useSigned = false; // member/dashboard context — public id is fine
    } else {
      throw new Error("Provide videoId or grantToken.");
    }

    const rendition = renditions.find(
      (r) => r.name === args.renditionName && r.status === "ready",
    );
    if (!rendition) {
      throw new Error("That proxy isn't ready (or doesn't exist) for this video.");
    }

    const playbackId = useSigned
      ? signedPlaybackId
      : publicPlaybackId ?? signedPlaybackId;
    if (!playbackId) {
      throw new Error("No Mux playback id available for this video.");
    }
    const token =
      useSigned && signedPlaybackId
        ? await signPlaybackToken(signedPlaybackId, "1h")
        : undefined;

    await recordEgressBytes(ctx, videoId, rendition.filesizeBytes);
    const base = sanitizeFilename(title ?? "video");
    return {
      url: buildMuxRenditionDownloadUrl(playbackId, rendition.name, token),
      filename: `${base} (${rendition.resolution}).${rendition.ext}`,
    };
  },
});

// Largest proxy we'll buffer through a Convex action to mirror into R2. Bigger
// renditions (GB-scale feature proxies) stay download-only here and should be
// mirrored by the desktop app / a worker instead. See plans/proxies-unified.md.
const PROXY_MIRROR_MAX_BYTES = 300 * 1024 * 1024;

/**
 * Drive add-on: copy a READY Mux static-rendition MP4 into R2 at the project
 * proxy path so the mounted LucidLink-style drive serves it as a file. Scheduled
 * from the `video.asset.static_rendition.ready` webhook. Download proxies work
 * via Mux regardless of this — the mirror only feeds the drive. Idempotent
 * (skips if already mirrored) and size-guarded (skips GB-scale buffers).
 */
export const mirrorRenditionToR2 = internalAction({
  args: { videoId: v.id("videos"), name: v.string() },
  returns: v.object({ mirrored: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (
    ctx,
    args,
  ): Promise<{ mirrored: boolean; reason?: string }> => {
    if (!isFeatureEnabled("objectStorage")) {
      return { mirrored: false, reason: "no_storage" };
    }
    const cxt = await ctx.runQuery(internal.videos.getProxyMirrorContext, {
      videoId: args.videoId,
    });
    if (!cxt) return { mirrored: false, reason: "no_context" };
    if (!cxt.muxPlaybackId) return { mirrored: false, reason: "no_playback_id" };

    const renditions = cxt.staticRenditions as Array<{
      name: string;
      status: string;
      ext: string;
      filesizeBytes?: number;
      r2Key?: string;
    }>;
    const rendition = renditions.find((r) => r.name === args.name);
    if (!rendition || rendition.status !== "ready") {
      return { mirrored: false, reason: "not_ready" };
    }
    if (rendition.r2Key) return { mirrored: true, reason: "already" };

    const size = rendition.filesizeBytes ?? 0;
    if (size > PROXY_MIRROR_MAX_BYTES) {
      console.warn("Skipping R2 proxy mirror — exceeds action buffer ceiling", {
        videoId: args.videoId,
        name: args.name,
        size,
      });
      return { mirrored: false, reason: "too_large" };
    }

    // The main asset is public, so the rendition URL needs no token.
    const srcUrl = buildMuxRenditionDownloadUrl(cxt.muxPlaybackId, args.name);
    const resp = await fetch(srcUrl);
    if (!resp.ok) return { mirrored: false, reason: `fetch_${resp.status}` };
    const body = Buffer.from(await resp.arrayBuffer());

    const key = `projects/${cxt.teamSlug}/${cxt.projectId}/proxies/${args.videoId}/${args.name}`;
    const s3 = getS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: rendition.ext === "m4a" ? "audio/mp4" : "video/mp4",
      }),
    );
    await ctx.runMutation(internal.videos.setStaticRenditionR2Key, {
      videoId: args.videoId,
      name: args.name,
      r2Key: key,
    });
    console.log("Mirrored proxy to R2 for the drive", {
      videoId: args.videoId,
      name: args.name,
      key,
      bytes: body.byteLength,
    });
    return { mirrored: true };
  },
});

/**
 * Generic file access for share-page items that aren't video or image —
 * PDFs, audio, docs, archives. Returns a signed S3 URL when authorized
 * (no paywall, or paywall + paid grant). Pre-payment we return mode:
 * "locked" with no URL — the share page shows a file tile with a "Pay to
 * view/download" CTA. Page-1-only PDF previews are a future enhancement
 * (requires pdf-poppler or similar; sharp doesn't read PDF natively).
 */
export const getSharedFileAccess = action({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
  },
  returns: v.object({
    mode: v.union(
      v.literal("public"),
      v.literal("full"),
      v.literal("locked"),
      v.literal("unsupported"),
    ),
    kind: v.union(
      v.literal("pdf"),
      v.literal("audio"),
      v.literal("text"),
      v.literal("file"),
    ),
    url: v.string(),
    contentType: v.union(v.string(), v.null()),
    fileName: v.union(v.string(), v.null()),
    tokenExpiresAt: v.union(v.number(), v.null()),
    paywall: v.union(
      v.object({
        priceCents: v.number(),
        currency: v.string(),
        description: v.optional(v.string()),
      }),
      v.null(),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    mode: "public" | "full" | "locked" | "unsupported";
    kind: "pdf" | "audio" | "text" | "file";
    url: string;
    contentType: string | null;
    fileName: string | null;
    tokenExpiresAt: number | null;
    paywall: { priceCents: number; currency: string; description?: string } | null;
  }> => {
    const resolved = await ctx.runQuery(api.videos.getByShareGrantWithPaywall, {
      grantToken: args.grantToken,
      itemVideoId: args.itemVideoId,
    });
    if (!resolved) throw new Error("Share grant invalid or expired.");
    const { video, shareLink, grant } = resolved;

    const contentType = video.contentType ?? null;
    const fileName = video.title ?? null;

    const kind: "pdf" | "audio" | "text" | "file" = !contentType
      ? "file"
      : contentType === "application/pdf"
        ? "pdf"
        : contentType.startsWith("audio/")
          ? "audio"
          : contentType.startsWith("text/") || contentType === "application/json"
            ? "text"
            : "file";

    if (!video.s3Key) {
      return {
        mode: "unsupported" as const,
        kind,
        url: "",
        contentType,
        fileName,
        tokenExpiresAt: null,
        paywall: shareLink.paywall,
      };
    }

    const TTL_SECONDS = 600;
    const paid = Boolean(grant.paidAt);

    if (!shareLink.paywall) {
      return {
        mode: "public" as const,
        kind,
        url: await buildSignedBucketObjectUrl(video.s3Key, {
          expiresIn: TTL_SECONDS,
          contentType: contentType ?? undefined,
        }),
        contentType,
        fileName,
        tokenExpiresAt: Date.now() + TTL_SECONDS * 1000,
        paywall: null,
      };
    }

    if (paid) {
      return {
        mode: "full" as const,
        kind,
        url: await buildSignedBucketObjectUrl(video.s3Key, {
          expiresIn: TTL_SECONDS,
          contentType: contentType ?? undefined,
        }),
        contentType,
        fileName,
        tokenExpiresAt: Date.now() + TTL_SECONDS * 1000,
        paywall: shareLink.paywall,
      };
    }

    return {
      mode: "locked" as const,
      kind,
      url: "",
      contentType,
      fileName,
      tokenExpiresAt: null,
      paywall: shareLink.paywall,
    };
  },
});

/**
 * Image variant of getSharedPaywalledPlayback. For image/gif items the share
 * page asks for a short-TTL signed URL — to the watermarked preview if the
 * grant hasn't paid yet, to the original if it has. Lazy-triggers the sharp
 * watermark gen the first time the item is viewed.
 */
export const getSharedImagePreview = action({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
    // Owner-only bypass; see getSharedPaywalledPlayback for full rationale.
    viewAs: v.optional(v.union(v.literal("client"), v.literal("owner"))),
  },
  returns: v.object({
    mode: v.union(
      v.literal("preview"),
      v.literal("preview_pending"),
      v.literal("full"),
      v.literal("public"),
      v.literal("unsupported"),
    ),
    url: v.string(),
    contentType: v.union(v.string(), v.null()),
    tokenExpiresAt: v.union(v.number(), v.null()),
    paywall: v.union(
      v.object({
        priceCents: v.number(),
        currency: v.string(),
        description: v.optional(v.string()),
      }),
      v.null(),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    mode: "preview" | "preview_pending" | "full" | "public" | "unsupported";
    url: string;
    contentType: string | null;
    tokenExpiresAt: number | null;
    paywall: { priceCents: number; currency: string; description?: string } | null;
  }> => {
    const resolved = await ctx.runQuery(api.videos.getByShareGrantWithPaywall, {
      grantToken: args.grantToken,
      itemVideoId: args.itemVideoId,
    });
    if (!resolved) throw new Error("Share grant invalid or expired.");
    const { video, shareLink, grant } = resolved;

    const contentType = video.contentType ?? null;
    if (!contentType || !contentType.startsWith("image/")) {
      return {
        mode: "unsupported" as const,
        url: "",
        contentType,
        tokenExpiresAt: null,
        paywall: shareLink.paywall,
      };
    }
    if (!video.s3Key) {
      throw new Error("Original file missing from bucket.");
    }

    const TTL_SECONDS = 300;
    const identity = await ctx.auth.getUserIdentity();
    const isOwner =
      identity?.subject != null &&
      identity.subject === shareLink.createdByClerkId;
    const viewAsOwner = isOwner && args.viewAs === "owner";
    const paid = Boolean(grant.paidAt) || viewAsOwner;

    // No paywall — hand over the original directly.
    if (!shareLink.paywall) {
      return {
        mode: "public" as const,
        url: await buildSignedBucketObjectUrl(video.s3Key, {
          expiresIn: TTL_SECONDS,
        }),
        contentType,
        tokenExpiresAt: Date.now() + TTL_SECONDS * 1000,
        paywall: null,
      };
    }

    if (paid) {
      return {
        mode: "full" as const,
        url: await buildSignedBucketObjectUrl(video.s3Key, {
          expiresIn: TTL_SECONDS,
        }),
        contentType,
        tokenExpiresAt: Date.now() + TTL_SECONDS * 1000,
        paywall: shareLink.paywall,
      };
    }

    // GIFs: a burned-in static webp would kill the animation (the whole point
    // of a gif), and generating it makes the first view wait. Serve the
    // original animated file directly — the share page lays its CSS watermark
    // overlay on top for paywalled views — so gifs play and load instantly.
    if ((contentType ?? "").toLowerCase() === "image/gif") {
      return {
        mode: "preview" as const,
        url: await buildSignedBucketObjectUrl(video.s3Key, {
          expiresIn: TTL_SECONDS,
        }),
        contentType,
        tokenExpiresAt: Date.now() + TTL_SECONDS * 1000,
        paywall: shareLink.paywall,
      };
    }

    // Pre-payment: serve the sharp-rendered watermarked preview if ready.
    // Otherwise lazy-trigger gen and return a pending placeholder.
    if (!video.imagePreviewS3Key || video.imagePreviewStatus !== "ready") {
      if (video.imagePreviewStatus !== "pending") {
        await ctx.scheduler.runAfter(
          0,
          internal.imagePreview.generateForVideoItem,
          {
            videoId: video._id,
            shareLinkId: shareLink._id,
            primaryLabel:
              shareLink.clientEmail ??
              shareLink.clientLabel ??
              `share/${shareLink._id.toString().slice(-8)}`,
            secondaryLabel: "PREVIEW — DO NOT REDISTRIBUTE",
          },
        );
      }
      return {
        mode: "preview_pending" as const,
        url: "",
        contentType,
        tokenExpiresAt: null,
        paywall: shareLink.paywall,
      };
    }

    return {
      mode: "preview" as const,
      url: await buildSignedBucketObjectUrl(video.imagePreviewS3Key, {
        expiresIn: TTL_SECONDS,
        contentType: "image/webp",
      }),
      contentType: "image/webp",
      tokenExpiresAt: Date.now() + TTL_SECONDS * 1000,
      paywall: shareLink.paywall,
    };
  },
});

/**
 * Shared playback for paywalled share links. Returns the watermarked 360p
 * preview before payment and the full-res signed stream after. Always uses
 * JWT-signed playback IDs with short TTL — the URL alone is not enough.
 */
export const getSharedPaywalledPlayback = action({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
    // Owner verification toggle. The owner of a paywalled share link can
    // pass "owner" to bypass the paywall entirely and stream the full-res
    // signed asset; non-owners passing it get the standard client-view path
    // (the owner check is server-side via Clerk identity). Defaults to
    // "client" so anonymous + recipient viewers exercise the real
    // watermarked-preview pipeline.
    viewAs: v.optional(v.union(v.literal("client"), v.literal("owner"))),
  },
  returns: v.object({
    mode: v.union(
      v.literal("preview"),
      v.literal("preview_pending"),
      v.literal("preview_unavailable"),
      v.literal("full"),
      v.literal("public"),
    ),
    url: v.string(),
    posterUrl: v.string(),
    tokenExpiresAt: v.union(v.number(), v.null()),
    paywall: v.union(
      v.object({
        priceCents: v.number(),
        currency: v.string(),
        description: v.optional(v.string()),
      }),
      v.null(),
    ),
    previewError: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    mode: "preview" | "preview_pending" | "preview_unavailable" | "full" | "public";
    url: string;
    posterUrl: string;
    tokenExpiresAt: number | null;
    paywall: { priceCents: number; currency: string; description?: string } | null;
    previewError: string | null;
  }> => {
    const resolved = await ctx.runQuery(api.videos.getByShareGrantWithPaywall, {
      grantToken: args.grantToken,
      itemVideoId: args.itemVideoId,
    });
    if (!resolved) throw new Error("Share grant invalid or expired.");
    const { video, shareLink, grant } = resolved;

    if (video.status !== "ready" || !video.muxPlaybackId) {
      throw new Error("Video is not ready yet.");
    }

    await ctx.runMutation(internal.videos.recordPlayback, {
      videoId: video._id,
    });

    // Owner detection. The viewer is the owner iff their Clerk subject
    // matches the share link's creator. When they explicitly ask for
    // viewAs="owner", we serve full-res signed playback regardless of
    // grant.paidAt. The default viewAs="client" goes through the real
    // watermarked-preview pipeline so an owner browsing their own link
    // still proves the pipeline works.
    const identity = await ctx.auth.getUserIdentity();
    const isOwner =
      identity?.subject != null &&
      identity.subject === shareLink.createdByClerkId;
    const viewAsOwner = isOwner && args.viewAs === "owner";

    // Per-recipient forensic log line. The preview asset itself is reused
    // across every paywalled share link for this video (so it can be
    // pre-baked at upload time for instant playback), which means the
    // burned-in pixels no longer carry per-link identifiers. The
    // attribution channel instead is this structured log line on every
    // signed-token issuance: `grantId` and `shareLinkId` tie a Mux
    // playback session (Mux Data logs the JWT's expiry + asset id) back
    // to a specific recipient. `grantToken` itself is the bearer
    // credential that grants access to the paywalled stream — it is
    // deliberately NOT logged so anyone with read access to the Convex
    // logs cannot replay it. `grantId` is the stable, non-secret join
    // key for forensic correlation.
    const logTokenIssue = (
      mode: "preview" | "full",
      playbackId: string,
      tokenExpiresAt: number,
    ) => {
      console.info("playback_token_issued", {
        videoId: video._id,
        shareLinkId: shareLink._id,
        grantId: grant._id,
        clientEmail: shareLink.clientEmail ?? null,
        clientLabel: shareLink.clientLabel ?? null,
        recipientClerkId: identity?.subject ?? null,
        playbackId,
        mode,
        viewAsOwner,
        tokenExpiresAt,
        issuedAt: Date.now(),
      });
    };

    // No paywall → behave like the existing public flow.
    if (!shareLink.paywall) {
      const playbackId = await ensurePublicPlaybackId(ctx, {
        videoId: video._id,
        muxAssetId: video.muxAssetId,
        muxPlaybackId: video.muxPlaybackId,
      });
      return {
        mode: "public" as const,
        url: buildMuxPlaybackUrl(playbackId),
        posterUrl: buildMuxThumbnailUrl(playbackId),
        tokenExpiresAt: null,
        paywall: null,
        previewError: null,
      };
    }

    const paid = Boolean(grant.paidAt) || viewAsOwner;
    const TTL_SECONDS = 300; // 5 minutes — refreshed via heartbeat.

    // Demo bypass: paywall set but no signed-playback keys. Fall back to
    // the public playback URL so the share page is testable end-to-end.
    // This is GATED behind explicit DEMO_MODE so a misconfigured prod
    // deployment (missing MUX_SIGNING_KEY/MUX_PRIVATE_KEY) can't silently
    // serve full-res to unpaid viewers — refuse loudly instead.
    if (!isFeatureEnabled("muxSignedPlayback")) {
      if (!isFeatureEnabled("demoMode")) {
        throw new Error(
          "Paywalled playback requires Mux signed playback keys. Set MUX_SIGNING_KEY + MUX_PRIVATE_KEY, or set DEMO_MODE=1 to allow unsigned previews.",
        );
      }
      const playbackId = video.muxPlaybackId;
      return {
        mode: paid ? ("full" as const) : ("preview" as const),
        url: buildMuxPlaybackUrl(playbackId),
        posterUrl: buildMuxThumbnailUrl(playbackId),
        tokenExpiresAt: null,
        paywall: shareLink.paywall,
        previewError: null,
      };
    }

    if (paid) {
      // Full-res, signed.
      let fullSignedId = video.muxSignedPlaybackId;
      if (!fullSignedId && video.muxAssetId) {
        const created = await createSignedPlaybackId(video.muxAssetId);
        fullSignedId = created.id;
        await ctx.runMutation(internal.videos.setMuxSignedPlaybackId, {
          videoId: video._id,
          muxSignedPlaybackId: fullSignedId,
        });
      }
      if (!fullSignedId) {
        throw new Error("Could not provision signed full-res playback.");
      }
      const videoToken = await signPlaybackToken(fullSignedId, `${TTL_SECONDS}s`);
      const thumbToken = await signThumbnailToken(fullSignedId, `${TTL_SECONDS}s`);
      const tokenExpiresAt = Date.now() + TTL_SECONDS * 1000;
      logTokenIssue("full", fullSignedId, tokenExpiresAt);
      return {
        mode: "full" as const,
        url: buildMuxPlaybackUrl(fullSignedId, videoToken),
        posterUrl: buildMuxThumbnailUrl(fullSignedId, thumbToken),
        tokenExpiresAt,
        paywall: shareLink.paywall,
        previewError: null,
      };
    }

    // Preview — watermarked 360p signed asset. If it hasn't finished ingesting
    // yet, return a "pending" mode so the share page can still render the
    // paywall CTA + a waiting state. Lazy-triggers preview gen for share
    // links that pre-dated the auto-schedule on create, and for each item
    // in a bundle share on its first view.
    if (!video.muxPreviewPlaybackId) {
      const pending = {
        mode: "preview_pending" as const,
        url: "",
        posterUrl: "",
        tokenExpiresAt: null,
        paywall: shareLink.paywall,
        previewError: null,
      };
      const unavailable = {
        mode: "preview_unavailable" as const,
        url: "",
        posterUrl: "",
        tokenExpiresAt: null,
        paywall: shareLink.paywall,
        previewError: video.muxPreviewAssetError ?? null,
      };

      // A prior poll or webhook already saw Mux fail this preview asset.
      // Stop pretending it's still rendering — paying still works and
      // unlocks the full-res stream, which doesn't need the preview.
      if (video.muxPreviewAssetStatus === "errored") {
        return unavailable;
      }

      if (!video.muxPreviewAssetId) {
        // Steady state: this branch only fires for legacy videos that
        // uploaded before the per-video pre-warm shipped. The per-video
        // action is idempotent and reuses the global overlay.
        await ctx.scheduler.runAfter(
          0,
          api.videoActions.ensurePreviewAssetForVideo,
          { videoId: video._id },
        );
        return pending;
      }

      // The preview asset exists but has no playback id yet. Normally the
      // Mux `video.asset.ready` webhook fills this in — but if that webhook
      // never reaches this deployment (misconfigured endpoint, wrong env,
      // dropped delivery) the share page would spin forever. Poll Mux
      // directly so playback self-heals with zero webhook dependency.
      try {
        const asset = await getMuxAsset(video.muxPreviewAssetId);
        if (asset.status === "ready") {
          const signedId =
            (asset.playback_ids ?? []).find(
              (entry) => entry.policy === "signed" && entry.id,
            )?.id ??
            (await createSignedPlaybackId(video.muxPreviewAssetId)).id;
          await ctx.runMutation(internal.videos.setMuxPreviewPlaybackId, {
            videoId: video._id,
            muxPreviewPlaybackId: signedId,
            expectedAssetId: video.muxPreviewAssetId,
          });
          const videoToken = await signPlaybackToken(signedId, `${TTL_SECONDS}s`);
          const thumbToken = await signThumbnailToken(signedId, `${TTL_SECONDS}s`);
          const tokenExpiresAt = Date.now() + TTL_SECONDS * 1000;
          logTokenIssue("preview", signedId, tokenExpiresAt);
          return {
            mode: "preview" as const,
            url: buildMuxPreviewUrl(signedId, videoToken),
            posterUrl: buildMuxThumbnailUrl(signedId, thumbToken),
            tokenExpiresAt,
            paywall: shareLink.paywall,
            previewError: null,
          };
        }
        if (asset.status === "errored") {
          const muxErrors = (asset as { errors?: { messages?: string[] } })
            .errors;
          const reason = `mux_asset_errored:${
            muxErrors?.messages?.[0] ?? "unknown"
          }`;
          await ctx.runMutation(internal.videos.setMuxPreviewAssetErrored, {
            videoId: video._id,
            reason,
            expectedAssetId: video.muxPreviewAssetId,
          });
          return { ...unavailable, previewError: reason };
        }

        // Stall detection: Mux still reports preparing, but we've been
        // waiting more than 5 minutes since the asset reference was
        // written. Either Mux is stuck or our webhook is being dropped
        // AND the asset never reached ready. Mark it errored so the
        // share page surfaces a real failure instead of a spinner. The
        // 5-minute ceiling is well above Mux's typical sub-minute ingest
        // for 360p basic transcodes.
        const updatedAt = video.muxPreviewAssetUpdatedAt ?? null;
        if (updatedAt != null && Date.now() - updatedAt > 5 * 60 * 1000) {
          const reason = "mux_ingest_timeout";
          await ctx.runMutation(internal.videos.setMuxPreviewAssetErrored, {
            videoId: video._id,
            reason,
            expectedAssetId: video.muxPreviewAssetId,
          });
          return { ...unavailable, previewError: reason };
        }
      } catch (err) {
        // Transient Mux lookup failure — keep showing the pending state;
        // the client polls and we'll try again on the next tick.
        console.error("Mux preview asset poll failed", {
          videoId: video._id,
          muxPreviewAssetId: video.muxPreviewAssetId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return pending;
    }
    const videoToken = await signPlaybackToken(video.muxPreviewPlaybackId, `${TTL_SECONDS}s`);
    const thumbToken = await signThumbnailToken(video.muxPreviewPlaybackId, `${TTL_SECONDS}s`);
    const tokenExpiresAt = Date.now() + TTL_SECONDS * 1000;
    logTokenIssue("preview", video.muxPreviewPlaybackId, tokenExpiresAt);
    return {
      mode: "preview" as const,
      url: buildMuxPreviewUrl(video.muxPreviewPlaybackId, videoToken),
      posterUrl: buildMuxThumbnailUrl(video.muxPreviewPlaybackId, thumbToken),
      tokenExpiresAt,
      paywall: shareLink.paywall,
      previewError: null,
    };
  },
});

/**
 * Owner-only: clears the preview asset state and re-schedules the watermark
 * pipeline for a paywalled share link. Lets the owner kick a stuck preview
 * after fixing env without recreating the share link.
 */
export const retryPreviewAssetForShareLink = action({
  args: {
    grantToken: v.string(),
    itemVideoId: v.optional(v.id("videos")),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("notOwner"),
      v.literal("invalidGrant"),
      v.literal("noPaywall"),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "ok" | "notOwner" | "invalidGrant" | "noPaywall";
  }> => {
    const resolved = await ctx.runQuery(api.videos.getByShareGrantWithPaywall, {
      grantToken: args.grantToken,
      itemVideoId: args.itemVideoId,
    });
    if (!resolved) return { status: "invalidGrant" as const };
    const { video, shareLink } = resolved;
    if (!shareLink.paywall) return { status: "noPaywall" as const };

    const identity = await ctx.auth.getUserIdentity();
    if (
      !identity?.subject ||
      identity.subject !== shareLink.createdByClerkId
    ) {
      return { status: "notOwner" as const };
    }

    await ctx.runMutation(internal.videos.clearMuxPreviewAsset, {
      videoId: video._id,
    });
    await ctx.scheduler.runAfter(
      0,
      api.videoActions.ensurePreviewAssetForVideo,
      { videoId: video._id },
    );
    return { status: "ok" as const };
  },
});

/**
 * Pre-warm the watermarked Mux preview asset for a video. Scheduled the
 * moment `markAsReady` flips a video to ready — by the time anyone creates
 * a paywalled share link, the preview asset is already ingesting (and
 * usually finished). Uses a single global overlay PNG; per-recipient
 * forensic attribution rides in the signed playback JWT + Convex logs
 * issued at viewing time, not burned into the pixels. Idempotent.
 */
export const ensurePreviewAssetForVideo = action({
  args: {
    videoId: v.id("videos"),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("alreadyExists"),
      v.literal("disabled"),
      v.literal("missingSourceVideo"),
      v.literal("notReady"),
    ),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status:
      | "ok"
      | "alreadyExists"
      | "disabled"
      | "missingSourceVideo"
      | "notReady";
    reason?: string;
  }> => {
    const recordError = async (reason: string, error?: unknown) => {
      console.error("Preview asset pipeline failure", {
        videoId: args.videoId,
        reason,
        error: error instanceof Error ? error.message : error,
      });
      await ctx.runMutation(internal.videos.setMuxPreviewAssetErrored, {
        videoId: args.videoId,
        reason,
      });
    };

    if (!isFeatureEnabled("watermarkPipeline")) {
      await recordError("watermark_pipeline_disabled");
      return {
        status: "disabled" as const,
        reason: "Watermark/Mux ingest not configured.",
      };
    }

    const video = await ctx.runQuery(api.videos.getForPreviewGen, {
      videoId: args.videoId,
    });
    if (!video?.s3Key || !video.contentType) {
      await recordError("missing_source_video");
      return {
        status: "missingSourceVideo" as const,
        reason: "Original upload missing for this video.",
      };
    }
    if (video.muxPreviewAssetId) {
      return { status: "alreadyExists" as const };
    }
    // Only video uploads can go through the Mux ingest pipeline. Image
    // and file paywalled shares are handled elsewhere — guard against a
    // stray scheduler firing for a non-video record. Also require the
    // upload to be fully done (status: "ready"); kicking off preview
    // ingest while the source is still uploading would race the signed
    // S3 URL against the upload itself.
    if (!video.contentType.startsWith("video/")) {
      return {
        status: "notReady" as const,
        reason: "Not a video upload — preview pipeline only runs for video/*.",
      };
    }
    if (video.status !== "ready") {
      return {
        status: "notReady" as const,
        reason: `Source upload not finished (status=${video.status}). markAsReady will reschedule once Mux finishes the full asset.`,
      };
    }

    // Atomic claim — fences concurrent schedulers so only one of them
    // actually calls Mux. Without this, the upload-complete scheduler
    // and the legacy-video safety net in `shareLinks.create` could both
    // start an ingest for the same video and double-bill Mux storage.
    const claim = await ctx.runMutation(
      internal.videos.claimPreviewGeneration,
      { videoId: video._id },
    );
    if (!claim.claimed) {
      if (claim.reason === "already_has_asset") {
        return { status: "alreadyExists" as const };
      }
      return {
        status: "alreadyExists" as const,
        reason:
          claim.reason === "in_flight"
            ? "Another scheduler is already running this preview generation."
            : "Could not claim preview generation.",
      };
    }

    let overlayKey: string;
    let overlayFetchUrl: string;
    try {
      const overlay = await ctx.runAction(
        internal.watermark.ensureGenericPreviewOverlay,
        {},
      );
      if (
        overlay.status === "disabled" ||
        !overlay.publicUrl ||
        !overlay.s3Key
      ) {
        await recordError("watermark_storage_unavailable");
        return {
          status: "disabled" as const,
          reason: overlay.reason ?? "Watermark generation unavailable.",
        };
      }
      overlayKey = overlay.s3Key;
      overlayFetchUrl = overlay.publicUrl;
    } catch (err) {
      await recordError(
        `watermark_gen_failed:${err instanceof Error ? err.message : String(err)}`,
        err,
      );
      throw err;
    }

    try {
      const ingestUrl = await buildSignedBucketObjectUrl(video.s3Key, {
        expiresIn: 60 * 60 * 6,
      });
      const previewAsset = await createPreviewMuxAsset(
        video._id,
        ingestUrl,
        overlayFetchUrl,
      );
      if (!previewAsset.id) {
        await recordError("mux_create_failed:no_asset_id");
        throw new Error("Mux did not return an asset id for the preview.");
      }
      await ctx.runMutation(internal.videos.setMuxPreviewAssetReference, {
        videoId: video._id,
        muxPreviewAssetId: previewAsset.id,
        watermarkOverlayKey: overlayKey,
      });
    } catch (err) {
      await recordError(
        `mux_create_failed:${err instanceof Error ? err.message : String(err)}`,
        err,
      );
      throw err;
    }

    return { status: "ok" as const };
  },
});

/**
 * Kicked off when an agency attaches a paywall to a share link. Generates a
 * per-link watermark and creates the matching Mux preview asset. Idempotent
 * — if a preview asset already exists for this video, returns early.
 *
 * Kept for backward compatibility with existing scheduler jobs and for
 * paywalled shares created on videos that uploaded before the per-video
 * pre-warm shipped. New code paths should call `ensurePreviewAssetForVideo`
 * directly.
 */
export const ensurePreviewAssetForShareLink = action({
  args: {
    shareLinkId: v.id("shareLinks"),
    // For bundle share links the caller must pass the specific item video
    // to generate a preview for. Omitted for single-video links — we use
    // link.videoId. Bundle items share the same watermark label (the link's
    // clientEmail/clientLabel) but each video gets its own Mux preview
    // asset stored on its own row.
    itemVideoId: v.optional(v.id("videos")),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("alreadyExists"),
      v.literal("disabled"),
      v.literal("missingSourceVideo"),
    ),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "ok" | "alreadyExists" | "disabled" | "missingSourceVideo";
    reason?: string;
  }> => {
    // Resolve the target video id up front so every failure path can persist
    // a terminal `errored` status on the video. Without this, a misconfigured
    // pipeline left the share page polling forever — no status field ever
    // flipped, so the spinner never resolved.
    const link = await ctx.runQuery(internal.shareLinks.getInternal, {
      shareLinkId: args.shareLinkId,
    });
    if (!link) throw new Error("Share link not found");
    const targetVideoId = args.itemVideoId ?? link.videoId;

    const recordError = async (reason: string, error?: unknown) => {
      console.error("Preview asset pipeline failure", {
        videoId: targetVideoId,
        shareLinkId: args.shareLinkId,
        reason,
        error: error instanceof Error ? error.message : error,
      });
      if (targetVideoId) {
        await ctx.runMutation(internal.videos.setMuxPreviewAssetErrored, {
          videoId: targetVideoId,
          reason,
        });
      }
    };

    if (!isFeatureEnabled("watermarkPipeline")) {
      await recordError("watermark_pipeline_disabled");
      return {
        status: "disabled" as const,
        reason: "Watermark/Mux ingest not configured.",
      };
    }

    if (!targetVideoId) {
      // No video to record against (bundle link with no itemVideoId). The
      // caller already validated this — surface the reason for logs.
      console.error("Preview asset pipeline failure", {
        shareLinkId: args.shareLinkId,
        reason: "missing_item_video_id",
      });
      return {
        status: "missingSourceVideo" as const,
        reason: "Bundle share links require itemVideoId.",
      };
    }

    const video = await ctx.runQuery(api.videos.getForPreviewGen, {
      videoId: targetVideoId,
    });
    if (!video?.s3Key || !video.contentType) {
      await recordError("missing_source_video");
      return {
        status: "missingSourceVideo" as const,
        reason: "Original upload missing for this video.",
      };
    }
    if (video.muxPreviewAssetId) {
      return { status: "alreadyExists" as const };
    }

    const primaryLabel =
      link.clientEmail ?? link.clientLabel ?? `share/${link.token.slice(0, 8)}`;

    let watermarkS3Key: string;
    let watermarkFetchUrl: string;
    try {
      const watermark = await ctx.runAction(
        internal.watermark.generateForShareLink,
        {
          shareLinkId: args.shareLinkId,
          primaryLabel,
          secondaryLabel: "PREVIEW — DO NOT REDISTRIBUTE",
        },
      );
      if (
        watermark.status === "disabled" ||
        !watermark.publicUrl ||
        !watermark.s3Key
      ) {
        await recordError("watermark_storage_unavailable");
        return {
          status: "disabled" as const,
          reason: watermark.reason ?? "Watermark generation unavailable.",
        };
      }
      watermarkS3Key = watermark.s3Key;
      watermarkFetchUrl = watermark.publicUrl;
    } catch (err) {
      await recordError(
        `watermark_gen_failed:${err instanceof Error ? err.message : String(err)}`,
        err,
      );
      throw err;
    }

    try {
      const ingestUrl = await buildSignedBucketObjectUrl(video.s3Key, {
        expiresIn: 60 * 60 * 6,
      });
      const previewAsset = await createPreviewMuxAsset(
        video._id,
        ingestUrl,
        watermarkFetchUrl,
      );
      if (!previewAsset.id) {
        await recordError("mux_create_failed:no_asset_id");
        throw new Error("Mux did not return an asset id for the preview.");
      }
      await ctx.runMutation(internal.videos.setMuxPreviewAssetReference, {
        videoId: video._id,
        muxPreviewAssetId: previewAsset.id,
        watermarkOverlayKey: watermarkS3Key,
      });
    } catch (err) {
      await recordError(
        `mux_create_failed:${err instanceof Error ? err.message : String(err)}`,
        err,
      );
      throw err;
    }

    return { status: "ok" as const };
  },
});

// ─── Lazy encoding ───────────────────────────────────────────────────────────
//
// We defer Mux ingest on upload when the workspace tier qualifies — the
// "long tail of unwatched footage" is a real COGS line and the encoding
// cost is wasted for clips no one ever opens. The first watch triggers
// `requestEncoding` below, which runs the normal pipeline.
//
// Decision is driven by env: LAZY_ENCODE_DEFAULT={never|free|always}.
//   never   — default; existing behavior, encode on upload.
//   free    — defer for free-tier workspaces only.
//   always  — defer everywhere (use during a Cloudflare Stream cutover,
//             since Stream's storage is so cheap that delaying encode
//             is essentially free).

/**
 * Kicks off encoding for a video, routing to the provider chosen by
 * `defaultPlaybackProvider(tier)`. Shared by the upload flow and the
 * lazy-encode `requestEncoding` trigger so the routing logic lives in
 * one place.
 *
 * Falls back to Mux if Stream is selected but not configured on the
 * deployment — better to encode somewhere than to fail the upload.
 */
async function startEncoding(
  ctx: ActionCtx,
  params: { videoId: Id<"videos">; s3Key: string; projectId: Id<"projects"> },
): Promise<void> {
  const tier = await ctx.runQuery(
    internal.workspaceBilling.getProjectOwnerTier,
    { projectId: params.projectId },
  );
  let provider = defaultPlaybackProvider(tier);
  if (provider === "cloudflare_stream" && !isCloudflareStreamConfigured()) {
    provider = "mux";
  }

  await ctx.runMutation(internal.videos.markAsProcessing, {
    videoId: params.videoId,
  });

  const ingestUrl = await buildSignedBucketObjectUrl(params.s3Key, {
    expiresIn: 60 * 60 * 24,
  });

  if (provider === "cloudflare_stream") {
    const asset = await createStreamAssetFromInputUrl(
      params.videoId,
      ingestUrl,
    );
    await ctx.runMutation(internal.videos.setStreamRefs, {
      videoId: params.videoId,
      streamUid: asset.assetId,
    });
    return;
  }

  const asset = await createMuxAssetFromInputUrl(params.videoId, ingestUrl);
  if (asset.id) {
    await ctx.runMutation(internal.videos.setMuxAssetReference, {
      videoId: params.videoId,
      muxAssetId: asset.id,
    });
  }
}

async function shouldDeferEncoding(
  ctx: ActionCtx,
  projectId: Id<"projects">,
): Promise<boolean> {
  const policy = await ctx.runQuery(
    internal.workspaceBilling.getProjectStoragePolicy,
    { projectId },
  );
  // Drive-first workspaces never eagerly encode — the cloud ladder only
  // materializes on the first watch (re-encode) or for paid delivery.
  if (policy.driveFirst) return true;

  const mode = (process.env.LAZY_ENCODE_DEFAULT ?? "never")
    .trim()
    .toLowerCase();
  if (mode === "never" || mode === "off" || mode === "false" || mode === "") {
    return false;
  }
  if (mode === "always" || mode === "all" || mode === "true") {
    return true;
  }
  if (mode !== "free") return false;
  return policy.tier === "free";
}

/**
 * Public surface the video player calls when it loads a video that
 * has `encodingDeferred: true` and no `muxPlaybackId` yet. Kicks off
 * the same Mux ingest path the upload flow would have, transitioning
 * the row to "processing". Idempotent.
 */
export const requestEncoding = action({
  args: { videoId: v.id("videos") },
  returns: v.object({
    status: v.union(
      v.literal("encoding_started"),
      v.literal("already_encoding"),
      v.literal("already_ready"),
      v.literal("not_a_video"),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    status:
      | "encoding_started"
      | "already_encoding"
      | "already_ready"
      | "not_a_video";
  }> => {
    await requireVideoMemberAccess(ctx, args.videoId);
    const video = await ctx.runQuery(api.videos.getVideoForPlayback, {
      videoId: args.videoId,
    });
    if (!video) throw new Error("Video not found");

    // Stable-property pre-checks (won't change concurrently).
    if (video.muxPlaybackId || video.status === "ready") {
      return { status: "already_ready" };
    }
    if (!video.s3Key) {
      return { status: "not_a_video" };
    }
    if (
      !isMuxVideoType(video.contentType ?? "application/octet-stream", video.s3Key)
    ) {
      return { status: "not_a_video" };
    }

    // Atomic claim — only the winner of a concurrent race proceeds to
    // ingest, so two viewers opening the same deferred video at once
    // can't both start a (paid) encode. A loser sees claimed=false.
    const claimed = await ctx.runMutation(
      internal.videos.claimDeferredEncoding,
      { videoId: args.videoId },
    );
    if (!claimed) {
      return { status: "already_encoding" };
    }

    try {
      await startEncoding(ctx, {
        videoId: args.videoId,
        s3Key: video.s3Key,
        projectId: video.projectId,
      });
      return { status: "encoding_started" };
    } catch (error) {
      // Restore the deferred state so the next viewer can retry —
      // otherwise the row is stuck "processing" with the claim
      // consumed and no asset behind it.
      await ctx.runMutation(internal.videos.releaseDeferredEncoding, {
        videoId: args.videoId,
      });
      throw error;
    }
  },
});
