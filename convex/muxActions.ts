"use node";

import { v } from "convex/values";
import { internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  buildMuxThumbnailUrl,
  getMuxAsset,
  verifyMuxWebhookSignature,
} from "./mux";

type MuxData = {
  id?: string;
  upload_id?: string;
  asset_id?: string;
  passthrough?: string;
  duration?: number;
  // Track events (video.asset.track.ready) — `id` is the track id.
  type?: string;
  text_type?: string;
  status?: string;
  errors?: Array<{ message?: string }>;
  error?: { message?: string };
  playback_ids?: Array<{ id?: string; policy?: string }>;
};

function summarizePlaybackIds(playbackIds: MuxData["playback_ids"]) {
  if (!playbackIds || playbackIds.length === 0) return [];
  return playbackIds.slice(0, 5).map((item) => ({
    id: asString(item?.id),
    policy: asString(item?.policy),
  }));
}

function summarizeMuxData(data: MuxData) {
  return {
    id: asString(data.id),
    assetId: asString(data.asset_id),
    uploadId: asString(data.upload_id),
    passthrough: asString(data.passthrough),
    duration: typeof data.duration === "number" ? data.duration : undefined,
    playbackIds: summarizePlaybackIds(data.playback_ids),
    errorMessage: getErrorMessage(data),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getErrorMessage(data: MuxData): string | undefined {
  // Mux sends `errors` as an array on some events but omits it / sends a
  // non-array shape on others — `?.` only guards null/undefined, so a
  // bare `.find` throws "is not a function". Guard the shape explicitly.
  const errors = data.errors;
  const nested = Array.isArray(errors)
    ? errors.find((item) => typeof item?.message === "string")?.message
    : undefined;
  if (nested) return nested;
  return asString(data.error?.message);
}

function getPreferredPlaybackId(playbackIds: MuxData["playback_ids"]): string | undefined {
  if (!playbackIds || playbackIds.length === 0) return undefined;

  const publicPlayback = playbackIds.find((item) => item.policy === "public" && item.id);
  if (publicPlayback?.id) return publicPlayback.id;

  const signedPlayback = playbackIds.find((item) => item.policy === "signed" && item.id);
  if (signedPlayback?.id) return signedPlayback.id;

  return playbackIds.find((item) => typeof item.id === "string")?.id;
}

async function resolveVideoIdFromMuxRefs(
  ctx: ActionCtx,
  data: MuxData,
): Promise<{ videoId: Id<"videos">; isPreview: boolean } | null> {
  const uploadId = asString(data.upload_id);
  if (uploadId) {
    const fromUpload = (await ctx.runQuery(internal.videos.getVideoByMuxUploadId, {
      muxUploadId: uploadId,
    })) as { videoId?: Id<"videos"> } | null;
    if (fromUpload?.videoId) {
      return { videoId: fromUpload.videoId, isPreview: false };
    }
  }

  const assetId = asString(data.asset_id);
  if (assetId) {
    const fromAsset = (await ctx.runQuery(internal.videos.getVideoByMuxAssetId, {
      muxAssetId: assetId,
    })) as { videoId?: Id<"videos"> } | null;
    if (fromAsset?.videoId) {
      return { videoId: fromAsset.videoId, isPreview: false };
    }
    const fromPreview = (await ctx.runQuery(
      internal.videos.getVideoByMuxPreviewAssetId,
      { muxPreviewAssetId: assetId },
    )) as { videoId?: Id<"videos"> } | null;
    if (fromPreview?.videoId) {
      return { videoId: fromPreview.videoId, isPreview: true };
    }
  }

  const passthrough = asString(data.passthrough);
  if (passthrough) {
    // Preview assets pass `${videoId}:preview` as passthrough.
    if (passthrough.endsWith(":preview")) {
      const id = passthrough.slice(0, -":preview".length);
      return { videoId: id as Id<"videos">, isPreview: true };
    }
    return { videoId: passthrough as Id<"videos">, isPreview: false };
  }

  return null;
}

export const processWebhook = internalAction({
  args: {
    rawBody: v.string(),
    signature: v.optional(v.string()),
  },
  returns: v.object({
    status: v.number(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    try {
      verifyMuxWebhookSignature(args.rawBody, args.signature ?? null);
    } catch (error) {
      console.error("Mux webhook signature verification failed", {
        signaturePresent: Boolean(args.signature),
        rawBodyBytes: args.rawBody.length,
        error,
      });
      return { status: 401, message: "Invalid signature" };
    }

    let event: { type?: string; data?: MuxData };
    try {
      event = JSON.parse(args.rawBody) as { type?: string; data?: MuxData };
    } catch (error) {
      console.error("Mux webhook payload is not valid JSON", {
        rawBodyBytes: args.rawBody.length,
        error,
      });
      return { status: 400, message: "Invalid payload" };
    }

    const eventType = asString(event.type);
    const data = event.data ?? {};
    const eventSummary = summarizeMuxData(data);

    console.log("Mux webhook received", {
      eventType: eventType ?? "unknown",
      ...eventSummary,
    });

    try {
      switch (eventType) {
        case "video.asset.created": {
          const assetId = asString(data.id) ?? asString(data.asset_id);
          if (!assetId) {
            console.error("Mux asset.created missing asset id");
            break;
          }

          const resolved = await resolveVideoIdFromMuxRefs(ctx, {
            ...data,
            asset_id: assetId,
          });

          if (!resolved) {
            console.error("Could not resolve video for Mux asset.created", {
              eventType,
              ...eventSummary,
            });
            break;
          }

          // Preview assets don't go through setMuxAssetReference — the asset
          // ID is recorded by ensurePreviewAssetForShareLink before ingest,
          // so the asset.ready handler is the one that matters there.
          if (resolved.isPreview) {
            console.log("Skipping setMuxAssetReference for preview asset", {
              videoId: resolved.videoId,
              assetId,
            });
            break;
          }

          await ctx.runMutation(internal.videos.setMuxAssetReference, {
            videoId: resolved.videoId,
            muxAssetId: assetId,
          });
          console.log("Mapped Mux asset to video", {
            eventType,
            videoId: resolved.videoId,
            assetId,
          });
          break;
        }

        case "video.asset.ready": {
          const assetId = asString(data.id) ?? asString(data.asset_id);
          if (!assetId) {
            console.error("Mux asset.ready missing asset id");
            break;
          }

          let resolvedPassthrough = asString(data.passthrough);
          let playbackId = getPreferredPlaybackId(data.playback_ids);
          let duration =
            typeof data.duration === "number" ? data.duration : undefined;

          if (!resolvedPassthrough || !playbackId || duration === undefined) {
            const asset = await getMuxAsset(assetId);
            const assetPlaybackIds = asset.playback_ids as MuxData["playback_ids"];

            resolvedPassthrough = resolvedPassthrough ?? asString(asset.passthrough);
            playbackId = playbackId ?? getPreferredPlaybackId(assetPlaybackIds);
            duration =
              duration ??
              (typeof asset.duration === "number" ? asset.duration : undefined);
          }

          if (!playbackId) {
            console.error("Mux asset.ready missing playback id", {
              eventType,
              assetId,
              dataPlaybackIds: summarizePlaybackIds(data.playback_ids),
            });
            break;
          }

          const resolved = await resolveVideoIdFromMuxRefs(ctx, {
            ...data,
            asset_id: assetId,
            upload_id: asString(data.upload_id),
            passthrough: resolvedPassthrough,
          });

          if (!resolved) {
            console.error("Could not resolve video for Mux asset.ready", {
              eventType,
              assetId,
              uploadId: asString(data.upload_id),
              passthrough: resolvedPassthrough,
            });
            break;
          }

          if (resolved.isPreview) {
            // Preview asset is ready — store its (signed) playback ID. The
            // full asset's status is already "ready" from its earlier event.
            const signedPlaybackId = (data.playback_ids ?? []).find(
              (entry) => entry.policy === "signed" && entry.id,
            )?.id ?? playbackId;
            await ctx.runMutation(internal.videos.setMuxPreviewPlaybackId, {
              videoId: resolved.videoId,
              muxPreviewPlaybackId: signedPlaybackId,
            });
            console.log("Preview asset ready", {
              videoId: resolved.videoId,
              assetId,
              signedPlaybackId,
            });
            break;
          }

          await ctx.runMutation(internal.videos.markAsReady, {
            videoId: resolved.videoId,
            muxAssetId: assetId,
            muxPlaybackId: playbackId,
            duration,
            thumbnailUrl: buildMuxThumbnailUrl(playbackId),
          });
          // Visual search: caption sampled frames so "describe a person /
          // scene" finds this video. No-ops if the Gemini key is unset.
          await ctx.scheduler.runAfter(
            0,
            internal.frameCaptions.captionVideo,
            { videoId: resolved.videoId },
          );
          console.log("Marked video ready from Mux webhook", {
            eventType,
            videoId: resolved.videoId,
            assetId,
            playbackId,
          });

          break;
        }

        case "video.asset.track.ready": {
          // Mux finished auto-transcribing the audio. Index the spoken
          // content so the *actual content* of the video is searchable.
          const trackType = asString(data.type);
          if (trackType !== "text") break;
          const trackId = asString(data.id);
          const assetId = asString(data.asset_id);
          if (!trackId || !assetId) {
            console.error("Mux track.ready missing track/asset id", {
              ...eventSummary,
            });
            break;
          }
          const resolved = await resolveVideoIdFromMuxRefs(ctx, {
            ...data,
            asset_id: assetId,
            id: assetId,
          });
          if (!resolved || resolved.isPreview) break;
          await ctx.scheduler.runAfter(
            0,
            internal.transcripts.indexTranscript,
            { videoId: resolved.videoId, trackId },
          );
          console.log("Scheduled transcript indexing", {
            eventType,
            videoId: resolved.videoId,
            assetId,
            trackId,
          });
          break;
        }

        case "video.asset.errored": {
          const assetId = asString(data.id) ?? asString(data.asset_id);
          const resolved = await resolveVideoIdFromMuxRefs(ctx, {
            ...data,
            asset_id: assetId,
          });

          if (!resolved) {
            console.error("Could not resolve video for Mux asset.errored", {
              eventType,
              ...eventSummary,
              assetId,
            });
            break;
          }

          const errorMessage =
            getErrorMessage(data) ?? "Mux failed to process this asset.";
          console.error("Marking video failed from Mux asset.errored", {
            eventType,
            videoId: resolved.videoId,
            assetId,
            errorMessage,
            isPreview: resolved.isPreview,
          });
          // For a failed preview, don't poison the main video — the original
          // playback path still works, just the paywalled preview is broken.
          // Record the terminal status so the share page can stop spinning
          // and surface "preview unavailable" instead of waiting forever.
          if (resolved.isPreview) {
            await ctx.runMutation(internal.videos.setMuxPreviewAssetErrored, {
              videoId: resolved.videoId,
              reason: `mux_asset_errored:${errorMessage}`,
            });
            break;
          }
          await ctx.runMutation(internal.videos.markAsFailed, {
            videoId: resolved.videoId,
            uploadError: errorMessage,
          });
          break;
        }

        case "video.asset.non_standard_input_detected": {
          const assetId = asString(data.id) ?? asString(data.asset_id);
          console.warn("Mux reported non-standard input", {
            eventType,
            ...eventSummary,
            assetId,
          });
          break;
        }

        case "video.upload.cancelled":
        case "video.upload.errored": {
          const uploadId = asString(data.id) ?? asString(data.upload_id);
          const resolved = await resolveVideoIdFromMuxRefs(ctx, {
            ...data,
            upload_id: uploadId,
          });

          if (!resolved) {
            console.error("Could not resolve video for Mux upload failure", {
              eventType,
              ...eventSummary,
              uploadId,
            });
            break;
          }

          const errorMessage =
            getErrorMessage(data) ?? "Mux upload failed or was cancelled.";
          console.error("Marking video failed from Mux upload failure", {
            eventType,
            videoId: resolved.videoId,
            uploadId,
            errorMessage,
          });
          await ctx.runMutation(internal.videos.markAsFailed, {
            videoId: resolved.videoId,
            uploadError: errorMessage,
          });
          break;
        }

        default:
          console.log("Ignoring unsupported Mux webhook event", {
            eventType: eventType ?? "unknown",
            ...eventSummary,
          });
      }
    } catch (error) {
      console.error("Mux webhook handler failed", {
        eventType: eventType ?? "unknown",
        ...eventSummary,
        error,
      });
      return { status: 500, message: "Webhook processing failed" };
    }

    return { status: 200, message: "OK" };
  },
});
