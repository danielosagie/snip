import { describe, expect, test } from "bun:test";
import type { GenericId } from "convex/values";

import {
  applyTimelineOps,
  createTimelineDocument,
} from "@/lib/timeline/operations";
import type { TimelineDocument, TimelineOp } from "@/lib/timeline/types";
import {
  buildRippleDeleteOps,
  getEditorTracks,
  invertTimelineOps,
  materializeTimelineOps,
  timelineRange,
} from "./timelineModel";

function opFactory() {
  let id = 0;
  return () => `op-${++id}`;
}

function fixture(): TimelineDocument {
  const base = createTimelineDocument({
    sequenceId: "sequence-1",
    actorId: "actor-1",
    timestamp: 1,
    properties: { frameRate: { value: 30, rate: 1 } },
  });
  const drafts = [
    {
      type: "addTrack" as const,
      track: { id: "track-1", kind: "video" as const, position: 0 },
    },
    ...[
      ["clip-a", 0, 2],
      ["clip-b", 2, 3],
      ["clip-c", 5, 1],
    ].map(([id, start, duration]) => ({
      type: "addClip" as const,
      trackId: "track-1",
      clip: {
        id: id as string,
        mediaId: "media-1" as GenericId<"videos">,
        timelineRange: timelineRange(start as number, duration as number, 30),
        sourceRange: timelineRange(0, duration as number, 30),
        properties: { name: id as string, volume: 1 },
      },
    })),
  ];
  return applyTimelineOps(
    base,
    materializeTimelineOps(drafts, "actor-1", 10, opFactory()),
  ).document;
}

describe("timeline operation history", () => {
  test("inverts a move and property edit", () => {
    const before = fixture();
    const forward = materializeTimelineOps(
      [
        {
          type: "moveClip",
          clipId: "clip-b",
          targetTrackId: "track-1",
          timelineStart: { value: 120, rate: 30 },
        },
        {
          type: "setClipProperty",
          clipId: "clip-b",
          property: "volume",
          value: 0.25,
        },
      ],
      "actor-1",
      100,
      opFactory(),
    );
    const inverse = invertTimelineOps(before, forward);
    const edited = applyTimelineOps(before, forward).document;
    const restored = applyTimelineOps(
      edited,
      materializeTimelineOps(inverse, "actor-1", 200, opFactory()),
    ).document;
    const clip = getEditorTracks(restored)[0].clips.find(
      (candidate) => candidate.id === "clip-b",
    );
    expect(clip?.timelineStart).toBe(2);
    expect(clip?.volume).toBe(1);
  });

  test("redo drafts can be materialized with fresh operation ids", () => {
    const drafts = buildRippleDeleteOps(fixture(), ["clip-b"]);
    const createId = opFactory();
    const first = materializeTimelineOps(drafts, "actor-1", 100, createId);
    const second = materializeTimelineOps(drafts, "actor-1", 200, createId);
    expect(
      JSON.stringify(first.map((op) => op.opId)) ===
        JSON.stringify(second.map((op) => op.opId)),
    ).toBe(false);
  });
});

describe("ripple math", () => {
  test("closes a removed middle interval", () => {
    const document = fixture();
    const ops = materializeTimelineOps(
      buildRippleDeleteOps(document, ["clip-b"]),
      "actor-1",
      100,
      opFactory(),
    );
    const result = applyTimelineOps(document, ops).document;
    const clips = getEditorTracks(result)[0].clips;
    expect(clips.map((clip) => clip.id)).toEqual(["clip-a", "clip-c"]);
    expect(clips.find((clip) => clip.id === "clip-c")?.timelineStart).toBe(2);
  });

  test("merges overlapping ripple intervals", () => {
    const document = fixture();
    const overlapping: TimelineOp[] = materializeTimelineOps(
      [
        {
          type: "moveClip",
          clipId: "clip-b",
          targetTrackId: "track-1",
          timelineStart: { value: 30, rate: 30 },
        },
      ],
      "actor-1",
      100,
      opFactory(),
    );
    const changed = applyTimelineOps(document, overlapping).document;
    const ops = materializeTimelineOps(
      buildRippleDeleteOps(changed, ["clip-a", "clip-b"]),
      "actor-1",
      200,
      opFactory(),
    );
    const result = applyTimelineOps(changed, ops).document;
    expect(getEditorTracks(result)[0].clips[0].timelineStart).toBe(1);
  });
});
