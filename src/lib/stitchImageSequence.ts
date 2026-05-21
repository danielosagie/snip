/**
 * Client-side image-sequence stitcher.
 *
 * Runs the real ffmpeg compiled to WebAssembly directly in the browser
 * to turn an ordered set of frame images (PNG/JPG/etc.) into an H.264
 * MP4. The frames are already in the browser at upload time, so there's
 * no server round-trip and no server-side ffmpeg binary to wrestle with
 * (which is exactly what didn't work on Convex's runtime).
 *
 * We use the SINGLE-THREADED ffmpeg core on purpose: the multi-threaded
 * core needs SharedArrayBuffer, which requires cross-origin-isolation
 * (COOP/COEP) response headers. Single-threaded is slower but works on
 * any host with no special headers.
 *
 * The wasm core (~25-30 MB) is fetched from a CDN the first time a
 * stitch runs and cached by the browser afterwards. The fetch happens
 * in the user's browser, so it isn't subject to the deployment's
 * server-side network policy.
 */

import type { FFmpeg } from "@ffmpeg/ffmpeg";

// Pinned to the installed @ffmpeg/core version. Single-threaded build.
const CORE_VERSION = "0.12.10";
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let ffmpegSingleton: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(
  onLog?: (line: string) => void,
): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on("log", ({ message }) => onLog(message));
    }
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    // Reset so a transient CDN failure can be retried on the next call.
    loadPromise = null;
    throw err;
  }
}

export interface StitchProgress {
  /** 0..1 over the whole job (write frames → encode → read). */
  ratio: number;
  stage: "loading" | "writing" | "encoding" | "reading";
}

export interface StitchOptions {
  fps?: number;
  /** Called with coarse progress so the UI can show a bar. */
  onProgress?: (p: StitchProgress) => void;
}

function framePattern(ext: string): string {
  return `frame_%06d.${ext}`;
}

function safeExt(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "png";
  // ffmpeg's image2 demuxer reads common raster types directly. EXR/DPX
  // are supported by the full build; keep the extension as-is so the
  // demuxer picks the right decoder.
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : "png";
}

/**
 * Stitch ordered frame Files into an MP4 File.
 *
 * @param frames  Frame images in display order (index 0 = first frame).
 * @param options fps + progress callback.
 * @returns       A `video/mp4` File named from the stem, ready to upload.
 */
export async function stitchImageSequence(
  frames: File[],
  stem: string,
  options: StitchOptions = {},
): Promise<File> {
  if (frames.length < 2) {
    throw new Error("Need at least two frames to stitch a sequence.");
  }
  const fps = options.fps ?? 24;
  const report = options.onProgress;

  report?.({ ratio: 0, stage: "loading" });
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = await import("@ffmpeg/util");

  // All frames must share an extension for ffmpeg's numbered-input
  // pattern. We normalize to the first frame's extension.
  const ext = safeExt(frames[0].name);

  // Write every frame into ffmpeg's in-memory FS as a zero-padded
  // numbered file the image2 demuxer can sequence.
  for (let i = 0; i < frames.length; i++) {
    const idx = String(i + 1).padStart(6, "0");
    await ffmpeg.writeFile(`frame_${idx}.${ext}`, await fetchFile(frames[i]));
    report?.({ ratio: (i / frames.length) * 0.6, stage: "writing" });
  }

  report?.({ ratio: 0.6, stage: "encoding" });
  // -pix_fmt yuv420p + even-dimension scale keeps the output playable in
  // every browser / Mux (H.264 needs even width+height).
  const outName = "out.mp4";
  await ffmpeg.exec([
    "-framerate", String(fps),
    "-i", framePattern(ext),
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outName,
  ]);

  report?.({ ratio: 0.95, stage: "reading" });
  const data = await ffmpeg.readFile(outName);
  // data is Uint8Array; copy into a fresh ArrayBuffer for the Blob.
  const u8 = data as Uint8Array;
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);

  // Best-effort cleanup of the FS so repeated stitches don't accumulate.
  try {
    for (let i = 0; i < frames.length; i++) {
      const idx = String(i + 1).padStart(6, "0");
      await ffmpeg.deleteFile(`frame_${idx}.${ext}`);
    }
    await ffmpeg.deleteFile(outName);
  } catch {
    // Non-fatal — the singleton FS is scoped to the tab.
  }

  report?.({ ratio: 1, stage: "reading" });
  const safeName = (stem || "sequence").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return new File([ab], `${safeName}.mp4`, { type: "video/mp4" });
}
