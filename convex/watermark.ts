"use node";

import { v } from "convex/values";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { internalAction } from "./_generated/server";
import { BUCKET_NAME, getS3Client, isStorageConfigured } from "./s3";
import { isFeatureEnabled } from "./featureFlags";

/**
 * Forensic watermark generator. Produces a transparent 1920x1080 PNG with
 * the client's email/label burned in at multiple positions so cropping or
 * masking a single overlay still leaves identifying marks elsewhere.
 *
 * Used by the preview-asset pipeline (videoActions.ts) to create a Mux
 * overlay that's applied at ingest time on the 360p preview asset. The
 * full-res asset never gets a watermark.
 *
 * Sharp is bundled in node_modules but loaded lazily so that environments
 * without it can still bundle the rest of the Convex deployment.
 */

const OVERLAY_BUCKET_PREFIX = "watermarks";
// One global generic preview overlay reused across every paywalled video.
// The per-recipient identifier no longer travels in burned-in pixels — it
// rides in the signed playback JWT + Convex log line so the preview asset
// itself can be pre-ingested at upload time and served instantly.
const GENERIC_OVERLAY_KEY = `${OVERLAY_BUCKET_PREFIX}/_global/preview-v1.png`;

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildWatermarkSvg(label: string, secondaryLabel: string | undefined): string {
  const primary = escapeSvgText(label);
  const secondary = escapeSvgText(secondaryLabel ?? "PREVIEW — DO NOT REDISTRIBUTE");

  // Aggressive watermark: a diagonal repeating pattern across the
  // whole frame plus four corner stamps. Cropping any single tile
  // still leaves the pattern intact elsewhere on the frame, and the
  // diagonal orientation defeats simple horizontal-band crop attacks.
  //
  // Opacity is bumped to ~0.4 so the mark is unmistakable on dark
  // and bright shots alike without nuking review usability.
  const tiles: string[] = [];
  const stepX = 320;
  const stepY = 220;
  for (let y = -40; y < 1180; y += stepY) {
    for (let x = -100; x < 2020; x += stepX) {
      tiles.push(
        `<text class="tile" transform="translate(${x},${y}) rotate(-22)">${primary}</text>`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <style>
      .primary { font: bold 56px sans-serif; fill: #ffffff; fill-opacity: 0.65; }
      .secondary { font: bold 28px sans-serif; fill: #ffffff; fill-opacity: 0.55; }
      .corner { font: bold 32px sans-serif; fill: #ffffff; fill-opacity: 0.75; }
      .tile { font: bold 38px sans-serif; fill: #ffffff; fill-opacity: 0.18; }
    </style>
  </defs>
  ${tiles.join("\n  ")}
  <text class="corner" x="40" y="60">${primary}</text>
  <text class="corner" x="1880" y="60" text-anchor="end">${secondary}</text>
  <text class="primary" x="960" y="540" text-anchor="middle">${primary}</text>
  <text class="secondary" x="960" y="585" text-anchor="middle">${secondary}</text>
  <text class="corner" x="40" y="1050">${secondary}</text>
  <text class="corner" x="1880" y="1050" text-anchor="end">${primary}</text>
</svg>`;
}

async function renderPng(svg: string): Promise<Buffer> {
  // Lazy-load sharp so the module bundle stays small until needed.
  const sharpModule = (await import("sharp")) as
    | typeof import("sharp")
    | { default: typeof import("sharp") };
  const sharp =
    (sharpModule as { default?: typeof import("sharp") }).default ??
    (sharpModule as typeof import("sharp"));
  return await sharp(Buffer.from(svg))
    .resize(1920, 1080, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/**
 * Generates a watermark PNG for a given share link and uploads to S3.
 * Returns the bucket key (relative) and a public URL Mux can fetch.
 */
export const generateForShareLink = internalAction({
  args: {
    shareLinkId: v.id("shareLinks"),
    primaryLabel: v.string(),
    secondaryLabel: v.optional(v.string()),
  },
  returns: v.object({
    status: v.union(v.literal("ok"), v.literal("disabled")),
    s3Key: v.union(v.string(), v.null()),
    publicUrl: v.union(v.string(), v.null()),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!isFeatureEnabled("watermarkPipeline") || !isStorageConfigured()) {
      return {
        status: "disabled" as const,
        s3Key: null,
        publicUrl: null,
        reason: "Watermark pipeline requires Mux + object storage env vars.",
      };
    }

    const svg = buildWatermarkSvg(args.primaryLabel, args.secondaryLabel);
    const png = await renderPng(svg);

    const key = `${OVERLAY_BUCKET_PREFIX}/${args.shareLinkId}/${Date.now()}.png`;
    const s3 = getS3Client();
    // No public-read ACL: R2 silently ignores object ACLs (public access is a
    // bucket-level setting), and a misconfigured bucket would 403 Mux when
    // it tries to fetch the overlay. We sign a long-lived GET URL below
    // instead so Mux can fetch the overlay regardless of bucket policy.
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: png,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    // 7-day TTL is the SigV4 ceiling. Mux fetches the overlay at ingest
    // time so the URL only needs to outlive the ingest queue.
    const fetchUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
      { expiresIn: 60 * 60 * 24 * 7 },
    );

    return {
      status: "ok" as const,
      s3Key: key,
      publicUrl: fetchUrl,
    };
  },
});

/**
 * Idempotently uploads (or finds) the single global preview overlay PNG
 * and returns a freshly-signed 7-day GET URL Mux can fetch. Used by the
 * per-video preview-asset pipeline so every paywalled video reuses the
 * same pre-rendered overlay — no per-link ingest required.
 */
export const ensureGenericPreviewOverlay = internalAction({
  args: {},
  returns: v.object({
    status: v.union(v.literal("ok"), v.literal("disabled")),
    s3Key: v.union(v.string(), v.null()),
    publicUrl: v.union(v.string(), v.null()),
    reason: v.optional(v.string()),
  }),
  handler: async () => {
    if (!isFeatureEnabled("watermarkPipeline") || !isStorageConfigured()) {
      return {
        status: "disabled" as const,
        s3Key: null,
        publicUrl: null,
        reason: "Watermark pipeline requires Mux + object storage env vars.",
      };
    }

    const s3 = getS3Client();
    let exists = false;
    try {
      await s3.send(
        new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: GENERIC_OVERLAY_KEY }),
      );
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      const svg = buildWatermarkSvg("PREVIEW", "DO NOT REDISTRIBUTE");
      const png = await renderPng(svg);
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: GENERIC_OVERLAY_KEY,
          Body: png,
          ContentType: "image/png",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    }

    const fetchUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: GENERIC_OVERLAY_KEY }),
      { expiresIn: 60 * 60 * 24 * 7 },
    );
    return {
      status: "ok" as const,
      s3Key: GENERIC_OVERLAY_KEY,
      publicUrl: fetchUrl,
    };
  },
});
