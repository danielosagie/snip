import { describe, expect, test } from "bun:test";

import { createTimelineDocument } from "@/lib/timeline/operations";
import {
  TIMELINE_SEQUENCE_PROPERTIES,
  type TimelineDocument,
  type TimelinePropertyValue,
} from "@/lib/timeline/types";
import {
  buildRenderOutputSpec,
  exportProgressView,
  type RenderJobProgress,
} from "./exportModel";

function timeline(
  properties: Record<string, TimelinePropertyValue>,
): TimelineDocument {
  return createTimelineDocument({
    sequenceId: "sequence-1",
    actorId: "actor-1",
    timestamp: 1,
    properties,
  });
}

function progress(
  overrides: Partial<RenderJobProgress> = {},
): RenderJobProgress {
  return {
    jobId: "job-1",
    status: "running",
    phase: "rendering",
    progress: 0.426,
    message: "Rendering.",
    cancellationRequestedAt: null,
    outputObjectKey: null,
    manifestObjectKey: null,
    outputBytes: null,
    failure: null,
    createdAt: 1,
    queuedAt: 1,
    completedAt: null,
    failedAt: null,
    ...overrides,
  };
}

describe("render output spec", () => {
  test("uses MP4 H.264 at the source resolution", () => {
    const output = buildRenderOutputSpec(timeline({
      [TIMELINE_SEQUENCE_PROPERTIES.width]: 1280,
      [TIMELINE_SEQUENCE_PROPERTIES.height]: 720,
      [TIMELINE_SEQUENCE_PROPERTIES.frameRate]: { value: 30_000, rate: 1001 },
    }));

    expect(output).toEqual({
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1280,
      height: 720,
      frameRate: { value: 30_000, rate: 1001 },
    });
  });

  test("fits 4K source dimensions inside the 1080p cap", () => {
    const output = buildRenderOutputSpec(timeline({
      [TIMELINE_SEQUENCE_PROPERTIES.width]: 3840,
      [TIMELINE_SEQUENCE_PROPERTIES.height]: 2160,
    }));

    expect(output.width).toBe(1920);
    expect(output.height).toBe(1080);
    expect(output.frameRate).toEqual({ value: 30, rate: 1 });
  });

  test("rounds odd source dimensions down for H.264", () => {
    const output = buildRenderOutputSpec(timeline({
      [TIMELINE_SEQUENCE_PROPERTIES.width]: 1279,
      [TIMELINE_SEQUENCE_PROPERTIES.height]: 719,
    }));

    expect(output.width).toBe(1278);
    expect(output.height).toBe(718);
  });

  test("falls back when the source frame rate is outside adapter limits", () => {
    const output = buildRenderOutputSpec(timeline({
      [TIMELINE_SEQUENCE_PROPERTIES.frameRate]: { value: 240, rate: 1 },
    }));

    expect(output.frameRate).toEqual({ value: 30, rate: 1 });
  });
});

describe("export progress view", () => {
  test("maps phase and clamps percent", () => {
    expect(exportProgressView(progress({ progress: 1.5 }))).toEqual({
      phase: "rendering",
      percent: 100,
      active: true,
      failureMessage: null,
      streamCopyPercent: null,
    });
  });

  test("uses the structured failure", () => {
    expect(exportProgressView(progress({
      status: "failed",
      phase: null,
      failure: {
        code: "SOURCE_MISSING",
        retryable: true,
        message: "Source object missing.",
      },
    })).failureMessage).toBe("SOURCE_MISSING: Source object missing.");
  });

  test("shows completed stream-copy percent", () => {
    expect(exportProgressView(progress({
      status: "done",
      phase: "complete",
      progress: 1,
      cacheResult: { streamCopyPercent: 87.25 },
    }))).toEqual({
      phase: "complete",
      percent: 100,
      active: false,
      failureMessage: null,
      streamCopyPercent: 87.25,
    });
  });
});
