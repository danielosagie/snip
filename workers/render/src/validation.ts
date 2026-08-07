import type {
  RenderJobSpec,
  RenderTarget,
  SegmentEffects,
  SourceSegment,
} from "./types";

const DEFAULT_TARGET: RenderTarget = {
  codec: "h264",
  container: "mp4",
  width: 1920,
  height: 1080,
  fps: 30,
  pixelFormat: "yuv420p",
  crf: 20,
  preset: "fast",
  audioCodec: "aac",
  audioBitrateKbps: 192,
  audioSampleRate: 48_000,
  audioChannels: 2,
};

const DEFAULT_EFFECTS: SegmentEffects = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  volume: 1,
  muted: false,
};

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function finiteNumber(value: unknown, fallback: number, path: string): number {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return resolved;
}

function positiveInteger(value: unknown, fallback: number, path: string): number {
  const resolved = finiteNumber(value, fallback, path);
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }
  return resolved;
}

function bounded(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  path: string,
): number {
  const resolved = finiteNumber(value, fallback, path);
  if (resolved < min || resolved > max) {
    throw new Error(`${path} must be between ${min} and ${max}.`);
  }
  return resolved;
}

function normalizeEffects(value: unknown, path: string): SegmentEffects {
  const raw = value === undefined ? {} : record(value, path);
  return {
    brightness: bounded(raw.brightness, DEFAULT_EFFECTS.brightness, -1, 1, `${path}.brightness`),
    contrast: bounded(raw.contrast, DEFAULT_EFFECTS.contrast, 0, 3, `${path}.contrast`),
    saturation: bounded(raw.saturation, DEFAULT_EFFECTS.saturation, 0, 3, `${path}.saturation`),
    volume: bounded(raw.volume, DEFAULT_EFFECTS.volume, 0, 10, `${path}.volume`),
    muted: raw.muted === undefined ? DEFAULT_EFFECTS.muted : Boolean(raw.muted),
  };
}

function normalizeSegment(value: unknown, index: number): SourceSegment {
  const path = `segments[${index}]`;
  const raw = record(value, path);
  const inSeconds = finiteNumber(raw.inSeconds, Number.NaN, `${path}.inSeconds`);
  const outSeconds = finiteNumber(raw.outSeconds, Number.NaN, `${path}.outSeconds`);
  if (inSeconds < 0) throw new Error(`${path}.inSeconds cannot be negative.`);
  if (outSeconds <= inSeconds) {
    throw new Error(`${path}.outSeconds must be greater than inSeconds.`);
  }
  return {
    sourceKey: nonEmptyString(raw.sourceKey, `${path}.sourceKey`),
    sourceContentId: nonEmptyString(raw.sourceContentId, `${path}.sourceContentId`),
    inSeconds,
    outSeconds,
    effects: normalizeEffects(raw.effects, `${path}.effects`),
  };
}

function normalizeTarget(value: unknown): RenderTarget {
  const raw = value === undefined ? {} : record(value, "target");
  const codec = raw.codec ?? DEFAULT_TARGET.codec;
  if (codec !== "h264" && codec !== "hevc") {
    throw new Error("target.codec must be h264 or hevc.");
  }
  const container = raw.container ?? DEFAULT_TARGET.container;
  if (container !== "mp4") throw new Error("target.container must be mp4.");
  const width = positiveInteger(raw.width, DEFAULT_TARGET.width, "target.width");
  const height = positiveInteger(raw.height, DEFAULT_TARGET.height, "target.height");
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error("target width and height must be even for yuv420p output.");
  }
  const preset = raw.preset ?? DEFAULT_TARGET.preset;
  if (!["veryfast", "faster", "fast", "medium", "slow"].includes(String(preset))) {
    throw new Error("target.preset is not supported.");
  }
  return {
    codec,
    container,
    width,
    height,
    fps: bounded(raw.fps, DEFAULT_TARGET.fps, 1, 120, "target.fps"),
    pixelFormat: "yuv420p",
    crf: bounded(raw.crf, DEFAULT_TARGET.crf, 0, 51, "target.crf"),
    preset: preset as RenderTarget["preset"],
    audioCodec: "aac",
    audioBitrateKbps: positiveInteger(
      raw.audioBitrateKbps,
      DEFAULT_TARGET.audioBitrateKbps,
      "target.audioBitrateKbps",
    ),
    audioSampleRate: positiveInteger(
      raw.audioSampleRate,
      DEFAULT_TARGET.audioSampleRate,
      "target.audioSampleRate",
    ),
    audioChannels: raw.audioChannels === 1 ? 1 : 2,
  };
}

export function normalizeJobSpec(value: unknown): RenderJobSpec {
  const raw = record(value, "job spec");
  if (!Array.isArray(raw.segments) || raw.segments.length === 0) {
    throw new Error("job spec segments must be a non-empty array.");
  }
  const outputKey = nonEmptyString(raw.outputKey, "outputKey");
  const manifestKey = nonEmptyString(raw.manifestKey, "manifestKey");
  if (outputKey === manifestKey) {
    throw new Error("outputKey and manifestKey must be different.");
  }
  return {
    segments: raw.segments.map(normalizeSegment),
    target: normalizeTarget(raw.target),
    outputKey,
    manifestKey,
  };
}
