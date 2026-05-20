"use node";

import { v } from "convex/values";
import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { BUCKET_NAME, getS3Client, isStorageConfigured } from "./s3";

/**
 * Sharp-based watermarked preview for image-class share items (jpg/png/webp/gif).
 * Mirrors the Mux preview pipeline used for video: shown pre-payment, swapped
 * for the original on paid grants. For animated GIFs we render a static
 * still — once the viewer pays they get the original animated file back.
 *
 * The watermark label is per-share-link (link.clientEmail/clientLabel) but
 * the rendered preview is stored on the video row to match how Mux preview
 * assets are cached. First-link-wins for the label on a given video. We can
 * refactor to per-grant later if leak forensics demands it.
 */

const PREVIEW_BUCKET_PREFIX = "previews/images";
const MAX_PREVIEW_PIXELS = 1200;

const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
  "image/x-tiff",
  "image/bmp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export function isImageContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return IMAGE_CONTENT_TYPES.has(contentType.toLowerCase());
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildImageWatermarkSvg(
  width: number,
  height: number,
  primaryLabel: string,
  secondaryLabel: string,
): string {
  const primary = escapeSvgText(primaryLabel);
  const secondary = escapeSvgText(secondaryLabel);
  const fontSize = Math.max(18, Math.round(Math.min(width, height) / 28));
  const stepX = Math.max(180, Math.round(width / 4));
  const stepY = Math.max(140, Math.round(height / 4));
  const tiles: string[] = [];
  for (let y = -fontSize; y < height + fontSize; y += stepY) {
    for (let x = -fontSize; x < width + fontSize; x += stepX) {
      tiles.push(
        `<text class="tile" transform="translate(${x},${y}) rotate(-22)">${primary}</text>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <style>
        .tile { font: bold ${fontSize}px sans-serif; fill: #ffffff; fill-opacity: 0.20; }
        .corner { font: bold ${Math.round(fontSize * 0.9)}px sans-serif; fill: #ffffff; fill-opacity: 0.75; }
        .center-primary { font: bold ${Math.round(fontSize * 1.4)}px sans-serif; fill: #ffffff; fill-opacity: 0.65; }
        .center-secondary { font: bold ${Math.round(fontSize * 0.8)}px sans-serif; fill: #ffffff; fill-opacity: 0.55; }
      </style>
    </defs>
    ${tiles.join("\n    ")}
    <text class="corner" x="${Math.round(width * 0.02)}" y="${Math.round(height * 0.05) + fontSize}">${primary}</text>
    <text class="corner" x="${Math.round(width * 0.98)}" y="${Math.round(height * 0.05) + fontSize}" text-anchor="end">${secondary}</text>
    <text class="center-primary" x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" text-anchor="middle">${primary}</text>
    <text class="center-secondary" x="${Math.round(width / 2)}" y="${Math.round(height / 2) + Math.round(fontSize * 1.6)}" text-anchor="middle">${secondary}</text>
  </svg>`;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const generateForVideoItem = internalAction({
  args: {
    videoId: v.id("videos"),
    shareLinkId: v.id("shareLinks"),
    primaryLabel: v.string(),
    secondaryLabel: v.optional(v.string()),
  },
  returns: v.object({
    status: v.union(
      v.literal("ok"),
      v.literal("notImage"),
      v.literal("disabled"),
      v.literal("missingSource"),
      v.literal("error"),
    ),
    s3Key: v.union(v.string(), v.null()),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!isStorageConfigured()) {
      return {
        status: "disabled" as const,
        s3Key: null,
        reason: "Object storage not configured.",
      };
    }

    const video = await ctx.runQuery(internal.videos.getForImagePreview, {
      videoId: args.videoId,
    });
    if (!video) {
      return {
        status: "missingSource" as const,
        s3Key: null,
        reason: "Video row missing.",
      };
    }
    if (!video.s3Key || !video.contentType) {
      return {
        status: "missingSource" as const,
        s3Key: null,
        reason: "Source file not in bucket.",
      };
    }
    if (!isImageContentType(video.contentType)) {
      return { status: "notImage" as const, s3Key: null };
    }

    await ctx.runMutation(internal.videos.setImagePreview, {
      videoId: args.videoId,
      imagePreviewStatus: "pending",
      imagePreviewS3Key: undefined,
    });

    try {
      const s3 = getS3Client();
      const original = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: video.s3Key,
        }),
      );
      if (!original.Body) throw new Error("S3 response had no body.");
      const originalBytes = await streamToBuffer(original.Body as Readable);

      const sharpModule = (await import("sharp")) as
        | typeof import("sharp")
        | { default: typeof import("sharp") };
      const sharp =
        (sharpModule as { default?: typeof import("sharp") }).default ??
        (sharpModule as typeof import("sharp"));

      // For GIFs we lock to the first frame so the preview is a static still.
      // sharp's animated() input would let us preserve motion in WebP, but a
      // static frame is the right "preview" UX (animation is the paid value).
      const pipeline = sharp(originalBytes, { animated: false }).rotate();
      const meta = await pipeline.metadata();
      const width = meta.width ?? MAX_PREVIEW_PIXELS;
      const height = meta.height ?? MAX_PREVIEW_PIXELS;
      const scale = Math.min(1, MAX_PREVIEW_PIXELS / Math.max(width, height));
      const targetWidth = Math.max(64, Math.round(width * scale));
      const targetHeight = Math.max(64, Math.round(height * scale));

      const resized = await pipeline
        .resize({ width: targetWidth, height: targetHeight, fit: "inside" })
        .toBuffer();

      const svg = buildImageWatermarkSvg(
        targetWidth,
        targetHeight,
        args.primaryLabel,
        args.secondaryLabel ?? "PREVIEW — DO NOT REDISTRIBUTE",
      );

      const watermarked = await sharp(resized)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .webp({ quality: 70 })
        .toBuffer();

      const key = `${PREVIEW_BUCKET_PREFIX}/${args.videoId}/${args.shareLinkId}.webp`;
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: watermarked,
          ContentType: "image/webp",
          ACL: "private",
          CacheControl: "private, max-age=3600",
        }),
      );

      await ctx.runMutation(internal.videos.setImagePreview, {
        videoId: args.videoId,
        imagePreviewStatus: "ready",
        imagePreviewS3Key: key,
      });

      return { status: "ok" as const, s3Key: key };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.videos.setImagePreview, {
        videoId: args.videoId,
        imagePreviewStatus: "errored",
        imagePreviewS3Key: undefined,
      });
      return { status: "error" as const, s3Key: null, reason };
    }
  },
});
