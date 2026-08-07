import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { GopSegment } from "./gop";
import { runProcess } from "./process";
import type { RenderTarget, SegmentEffects } from "./types";

export interface MediaProbe {
  durationSeconds: number;
  hasAudio: boolean;
  keyframes: number[];
}

function seconds(value: number): string {
  return value.toFixed(6);
}

export async function probeMedia(
  sourcePath: string,
  signal?: AbortSignal,
): Promise<MediaProbe> {
  const [media, frames] = await Promise.all([
    runProcess(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration:stream=codec_type",
        "-of", "json",
        sourcePath,
      ],
      { signal },
    ),
    runProcess(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-skip_frame", "nokey",
        "-show_frames",
        "-show_entries", "frame=best_effort_timestamp_time",
        "-of", "csv=p=0",
        sourcePath,
      ],
      { signal },
    ),
  ]);
  const parsed = JSON.parse(media.stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string }[];
  };
  const durationSeconds = Number.parseFloat(parsed.format?.duration ?? "");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ffprobe did not return a valid duration for ${sourcePath}.`);
  }
  const keyframes = frames.stdout
    .split(/\r?\n/)
    .map((line) => Number.parseFloat(line.split(",")[0]))
    .filter(Number.isFinite);
  if (keyframes.length === 0) keyframes.push(0);
  return {
    durationSeconds,
    hasAudio: parsed.streams?.some((stream) => stream.codec_type === "audio") ?? false,
    keyframes,
  };
}

function videoFilters(target: RenderTarget, effects: SegmentEffects): string {
  const filters = [
    "setpts=PTS-STARTPTS",
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease`,
    `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:black`,
    `fps=${target.fps}`,
  ];
  if (
    effects.brightness !== 0
    || effects.contrast !== 1
    || effects.saturation !== 1
  ) {
    filters.push(
      `eq=brightness=${effects.brightness}:contrast=${effects.contrast}:saturation=${effects.saturation}`,
    );
  }
  filters.push(`format=${target.pixelFormat}`);
  return filters.join(",");
}

export async function encodeSegment(args: {
  sourcePath: string;
  destination: string;
  range: GopSegment;
  effects: SegmentEffects;
  target: RenderTarget;
  hasAudio: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  await mkdir(dirname(args.destination), { recursive: true });
  const duration = args.range.outSeconds - args.range.inSeconds;
  const command = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-ss", seconds(args.range.inSeconds),
    "-i", args.sourcePath,
  ];
  if (!args.hasAudio) {
    command.push(
      "-f", "lavfi",
      "-t", seconds(duration),
      "-i", `anullsrc=channel_layout=${args.target.audioChannels === 1 ? "mono" : "stereo"}:sample_rate=${args.target.audioSampleRate}`,
    );
  }
  command.push(
    "-t", seconds(duration),
    "-map", "0:v:0",
    "-map", args.hasAudio ? "0:a:0" : "1:a:0",
    "-vf", videoFilters(args.target, args.effects),
    "-af", `asetpts=PTS-STARTPTS,volume=${args.effects.muted ? 0 : args.effects.volume}`,
    "-c:v", args.target.codec === "h264" ? "libx264" : "libx265",
    "-preset", args.target.preset,
    "-crf", String(args.target.crf),
    "-pix_fmt", args.target.pixelFormat,
    "-g", String(Math.max(1, Math.round(args.target.fps * 2))),
    "-keyint_min", String(Math.max(1, Math.round(args.target.fps * 2))),
    "-sc_threshold", "0",
  );
  if (args.target.codec === "hevc") command.push("-tag:v", "hvc1");
  command.push(
    "-c:a", args.target.audioCodec,
    "-b:a", `${args.target.audioBitrateKbps}k`,
    "-ar", String(args.target.audioSampleRate),
    "-ac", String(args.target.audioChannels),
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    "-metadata", "creation_time=1970-01-01T00:00:00Z",
    "-movflags", "+faststart",
    args.destination,
  );
  await runProcess("ffmpeg", command, { signal: args.signal });
}

export async function concatenateSegments(
  segmentPaths: string[],
  listPath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  if (segmentPaths.length === 0) throw new Error("Cannot concatenate zero segments.");
  await mkdir(dirname(listPath), { recursive: true });
  const directory = dirname(listPath);
  const content = segmentPaths.map((path) => `file '${basename(path)}'`).join("\n");
  await writeFile(listPath, `${content}\n`, "utf8");
  await runProcess(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", basename(listPath),
      "-c", "copy",
      "-movflags", "+faststart",
      basename(outputPath),
    ],
    { cwd: directory, signal },
  );
}
