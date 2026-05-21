"use node";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { v } from "convex/values";
import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { BUCKET_NAME, getS3Client, isStorageConfigured } from "./s3";
import { createMuxAssetFromInputUrl } from "./mux";
import { isFeatureEnabled } from "./featureFlags";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Image sequence stitcher. Downloads the frame R2 objects to /tmp,
 * runs ffmpeg to produce an MP4 at the sequence's chosen fps, uploads
 * the MP4 to R2, then kicks off Mux ingest using the existing
 * createMuxAssetFromInputUrl flow so the sequence plays through the
 * normal HLS pipeline.
 *
 * Best-effort: if the runtime can't locate ffmpeg or any frame is
 * missing, we patch sequenceStitchStatus to "errored" and the frame
 * grid in the UI remains the only preview. The stitched MP4 is purely
 * a quality-of-life upgrade for scrubbing.
 *
 * Caps:
 *   - 600 frames max (above this we'd blow past Convex's 10-min action
 *     timeout on a typical 4K stream).
 *   - Output is yuv420p H.264 in MP4. Mux re-encodes from there.
 */

const MAX_SEQUENCE_FRAMES = 600;

async function ensureFfmpegBinary(): Promise<string> {
  // ffmpeg-static ships a prebuilt ffmpeg binary keyed to the runtime
  // platform. On Convex's runtime the binary may not be executable; we
  // surface a clear error rather than a cryptic spawn EACCES.
  //
  // The module specifier is assembled at runtime so esbuild (Convex's
  // bundler) can't statically resolve it and choke at bundle time on
  // the prebuilt binary. Convex installs the package at runtime via
  // node.externalPackages in convex.json. If it's missing the import
  // rejects and the caller falls back to the frame-grid preview.
  const specifier = ["ffmpeg", "static"].join("-");
  const mod = (await import(specifier)) as { default?: string } | string;
  const binaryPath =
    (mod as { default?: string }).default ?? (mod as unknown as string);
  if (!binaryPath || typeof binaryPath !== "string") {
    throw new Error("ffmpeg-static did not resolve a binary path.");
  }
  try {
    await fs.access(binaryPath, fs.constants.X_OK);
  } catch {
    throw new Error(
      "ffmpeg binary is not executable on this runtime. Sequence will fall back to frame-grid preview.",
    );
  }
  return binaryPath;
}

function getExtensionFromKey(key: string, fallback = "png"): string {
  const ext = key.split("?")[0].split(".").pop();
  if (!ext) return fallback;
  if (ext.length > 8 || /[^a-zA-Z0-9]/.test(ext)) return fallback;
  return ext.toLowerCase();
}

async function downloadFrame(
  key: string,
  destPath: string,
): Promise<void> {
  const s3 = getS3Client();
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
  );
  if (!resp.Body) {
    throw new Error(`Frame ${key} returned an empty body.`);
  }
  const body = resp.Body as Readable;
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on("data", (c) => chunks.push(Buffer.from(c)));
    body.on("end", () => resolve(Buffer.concat(chunks)));
    body.on("error", reject);
  });
  await fs.writeFile(destPath, buf);
}

function runFfmpeg(binaryPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      // Truncate to last 4KB so we don't blow memory on a long run.
      if (stderr.length > 4096) {
        stderr = stderr.slice(stderr.length - 4096);
      }
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-512)}`));
    });
  });
}

export const stitchSequenceAndIngest = internalAction({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const video = await ctx.runQuery(internal.videos.internalGet, {
      videoId: args.videoId,
    });
    if (!video || video.kind !== "image_sequence") return;
    if (!video.sequenceFrameKeys || video.sequenceFrameKeys.length < 3) {
      return;
    }
    if (video.sequenceFrameKeys.length > MAX_SEQUENCE_FRAMES) {
      await ctx.runMutation(internal.videos.setSequenceStitchError, {
        videoId: args.videoId,
        error: `Sequence too long (${video.sequenceFrameKeys.length} > ${MAX_SEQUENCE_FRAMES}).`,
      });
      return;
    }
    if (!isStorageConfigured()) {
      await ctx.runMutation(internal.videos.setSequenceStitchError, {
        videoId: args.videoId,
        error: "S3/R2 storage is not configured.",
      });
      return;
    }

    await ctx.runMutation(internal.videos.setSequenceStitchStatus, {
      videoId: args.videoId,
      status: "preparing",
    });

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "snip-seq-"));
    try {
      const ext = video.sequenceFrameExt
        ?? getExtensionFromKey(video.sequenceFrameKeys[0]);
      // Download all frames into a numbered sequence ffmpeg can consume.
      for (let i = 0; i < video.sequenceFrameKeys.length; i++) {
        const key = video.sequenceFrameKeys[i];
        const idx = String(i + 1).padStart(6, "0");
        await downloadFrame(key, path.join(workDir, `frame_${idx}.${ext}`));
      }

      const binaryPath = await ensureFfmpegBinary();
      const fps = video.sequenceFps ?? 24;
      const outPath = path.join(workDir, "out.mp4");
      await runFfmpeg(binaryPath, [
        "-y",
        "-framerate", String(fps),
        "-i", path.join(workDir, `frame_%06d.${ext}`),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        outPath,
      ]);

      const outBytes = await fs.readFile(outPath);
      const mp4Key = `sequences/${args.videoId}/stitched-${Date.now()}.mp4`;
      const s3 = getS3Client();
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: mp4Key,
          Body: outBytes,
          ContentType: "video/mp4",
        }),
      );

      // If Mux is enabled, kick off ingest from the stitched MP4 so the
      // sequence plays through the normal HLS player. Otherwise leave
      // the s3Key set to the stitched MP4 and the player can stream it
      // directly via a signed URL.
      if (isFeatureEnabled("muxIngest")) {
        const signed = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: BUCKET_NAME, Key: mp4Key }),
          { expiresIn: 60 * 60 * 24 },
        );
        const asset = await createMuxAssetFromInputUrl(args.videoId, signed);
        if (asset.id) {
          await ctx.runMutation(internal.videos.setMuxAssetReference, {
            videoId: args.videoId,
            muxAssetId: asset.id,
          });
        }
      }

      await ctx.runMutation(internal.videos.setSequenceStitchReady, {
        videoId: args.videoId,
        stitchedS3Key: mp4Key,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("stitchSequenceAndIngest failed", {
        videoId: args.videoId,
        message,
      });
      await ctx.runMutation(internal.videos.setSequenceStitchError, {
        videoId: args.videoId,
        error: message.slice(0, 480),
      });
    } finally {
      // Clean up temp dir best-effort.
      try {
        await fs.rm(workDir, { recursive: true, force: true });
      } catch {
        // Convex tmpdir is scrubbed between invocations anyway.
      }
    }
  },
});
