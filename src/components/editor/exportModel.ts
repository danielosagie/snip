import {
  TIMELINE_SEQUENCE_PROPERTIES,
  type RenderJobPhase,
  type RenderJobStatus,
  type RenderOutputSpec,
  type TimelineDocument,
  type TimelineTime,
} from "@/lib/timeline/types";

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FRAME_RATE: TimelineTime = { value: 30, rate: 1 };
const MAX_EXPORT_WIDTH = 1920;
const MAX_EXPORT_HEIGHT = 1080;

export type RenderJobProgress = {
  jobId: string;
  status: RenderJobStatus;
  phase: RenderJobPhase | null;
  progress: number;
  message: string | null;
  cancellationRequestedAt: number | null;
  outputObjectKey: string | null;
  manifestObjectKey: string | null;
  outputBytes: number | null;
  failure: {
    code: string;
    retryable: boolean;
    message?: string;
    detail?: Record<string, string>;
  } | null;
  cacheResult?: { streamCopyPercent: number } | null;
  createdAt: number;
  queuedAt: number;
  completedAt: number | null;
  failedAt: number | null;
};

export type ExportProgressView = {
  phase: string;
  percent: number;
  active: boolean;
  failureMessage: string | null;
  streamCopyPercent: number | null;
};

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function frameRateProperty(value: unknown): TimelineTime {
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && "value" in value
    && "rate" in value
  ) {
    const frameRate = value as TimelineTime;
    if (
      Number.isFinite(frameRate.value)
      && Number.isFinite(frameRate.rate)
      && frameRate.value > 0
      && frameRate.rate > 0
      && frameRate.value / frameRate.rate >= 1
      && frameRate.value / frameRate.rate <= 120
    ) {
      return { value: frameRate.value, rate: frameRate.rate };
    }
  }
  return { ...DEFAULT_FRAME_RATE };
}

function evenDimension(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

/** Build the conservative first-version output accepted by the render adapter. */
export function buildRenderOutputSpec(
  document: TimelineDocument,
): RenderOutputSpec {
  const properties = document.sequence.properties;
  const sourceWidth = positiveNumber(
    properties[TIMELINE_SEQUENCE_PROPERTIES.width]?.value,
    DEFAULT_WIDTH,
  );
  const sourceHeight = positiveNumber(
    properties[TIMELINE_SEQUENCE_PROPERTIES.height]?.value,
    DEFAULT_HEIGHT,
  );
  // V1 caps output at a 1920x1080 canvas to bound worker memory and queue time.
  const scale = Math.min(
    1,
    MAX_EXPORT_WIDTH / sourceWidth,
    MAX_EXPORT_HEIGHT / sourceHeight,
  );

  return {
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: evenDimension(sourceWidth * scale),
    height: evenDimension(sourceHeight * scale),
    frameRate: frameRateProperty(
      properties[TIMELINE_SEQUENCE_PROPERTIES.frameRate]?.value,
    ),
  };
}

function failureMessage(progress: RenderJobProgress): string | null {
  if (progress.status !== "failed") return null;
  if (!progress.failure) return progress.message ?? "Render failed.";
  const detailMessage = progress.failure.detail
    ? Object.values(progress.failure.detail).find((value) => value.trim())
    : undefined;
  const message =
    progress.failure.message?.trim()
    || detailMessage
    || progress.message?.trim()
    || "Render failed.";
  return `${progress.failure.code}: ${message}`;
}

/** Convert the reactive queue record to compact editor-facing values. */
export function exportProgressView(
  progress: RenderJobProgress,
): ExportProgressView {
  const rawProgress = Number.isFinite(progress.progress) ? progress.progress : 0;
  const streamCopyPercent = progress.status === "done"
    && Number.isFinite(progress.cacheResult?.streamCopyPercent)
    ? Math.min(100, Math.max(0, progress.cacheResult!.streamCopyPercent))
    : null;

  return {
    phase:
      progress.phase
      ?? (progress.status === "done" ? "complete" : progress.status),
    percent: Math.round(Math.min(1, Math.max(0, rawProgress)) * 100),
    active: !["done", "failed"].includes(progress.status),
    failureMessage: failureMessage(progress),
    streamCopyPercent,
  };
}
