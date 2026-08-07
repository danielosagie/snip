import assert from "node:assert/strict";
import test from "node:test";
import type { GenericId } from "convex/values";
import {
  applyTimelineOps,
  createTimelineDocument,
  parseTimelineDocumentJson,
} from "./operations";
import {
  TIMELINE_CLIP_PROPERTIES,
  TIMELINE_SEQUENCE_PROPERTIES,
  type TimelineOp,
} from "./types";

const VIDEO_ID = "video_1" as GenericId<"videos">;
const time = (value: number, rate = 24) => ({ value, rate });

function emptyDocument() {
  return createTimelineDocument({
    sequenceId: "sequence_1",
    actorId: "seed",
    timestamp: 1,
    properties: {
      [TIMELINE_SEQUENCE_PROPERTIES.name]: "Assembly",
      [TIMELINE_SEQUENCE_PROPERTIES.frameRate]: { value: 24, rate: 1 },
    },
  });
}

function opBase(opId: string, timestamp = 10) {
  return { opId, actorId: "user_1", timestamp };
}

test("equal-time LWW writes converge regardless of arrival order", () => {
  const first: TimelineOp = {
    ...opBase("op_a", 100),
    actorId: "actor_a",
    type: "setSequenceProperty",
    property: "status",
    value: "first",
  };
  const second: TimelineOp = {
    ...opBase("op_b", 100),
    actorId: "actor_b",
    type: "setSequenceProperty",
    property: "status",
    value: "second",
  };

  const left = applyTimelineOps(emptyDocument(), [first, second]).document;
  const right = applyTimelineOps(emptyDocument(), [second, first]).document;

  assert.deepEqual(left, right);
  assert.equal(left.sequence.properties.status.value, "second");
});

test("operation replay is idempotent and older writes cannot revive tombstones", () => {
  const addTrack: TimelineOp = {
    ...opBase("track_add", 10),
    type: "addTrack",
    track: { id: "video_1", kind: "video" },
  };
  const addClip: TimelineOp = {
    ...opBase("clip_add", 20),
    type: "addClip",
    trackId: "video_1",
    clip: {
      id: "clip_1",
      mediaId: VIDEO_ID,
      timelineRange: { start: time(0), duration: time(48) },
      sourceRange: { start: time(24), duration: time(48) },
    },
  };
  const removeClip: TimelineOp = {
    ...opBase("clip_remove", 30),
    type: "removeClip",
    clipId: "clip_1",
  };

  const initial = applyTimelineOps(emptyDocument(), [addTrack, addClip, addClip]);
  assert.deepEqual(initial.appliedOpIds, ["track_add", "clip_add"]);

  const removed = applyTimelineOps(initial.document, [removeClip, addClip]).document;
  assert.equal(removed.sequence.tracks.video_1.clips.clip_1.removed.value, true);

  const revived = applyTimelineOps(removed, [
    { ...addClip, opId: "clip_revive", timestamp: 40 },
  ]).document;
  assert.equal(revived.sequence.tracks.video_1.clips.clip_1.removed.value, false);
});

test("clip range and cross-track move update independent LWW properties", () => {
  const setup: TimelineOp[] = [
    {
      ...opBase("video_track"),
      type: "addTrack",
      track: { id: "video_1", kind: "video", position: 0 },
    },
    {
      ...opBase("audio_track"),
      type: "addTrack",
      track: { id: "video_2", kind: "video", position: 1 },
    },
    {
      ...opBase("clip_add", 20),
      type: "addClip",
      trackId: "video_1",
      clip: {
        id: "clip_1",
        mediaId: VIDEO_ID,
        timelineRange: { start: time(0), duration: time(48) },
        sourceRange: { start: time(24), duration: time(48) },
      },
    },
  ];
  const document = applyTimelineOps(emptyDocument(), setup).document;
  const moved = applyTimelineOps(document, [
    {
      ...opBase("range", 30),
      type: "setClipRange",
      clipId: "clip_1",
      sourceRange: { start: time(48), duration: time(24) },
    },
    {
      ...opBase("move", 31),
      type: "moveClip",
      clipId: "clip_1",
      targetTrackId: "video_2",
      timelineStart: time(72),
    },
  ]).document;

  assert.equal(moved.sequence.tracks.video_1.clips.clip_1, undefined);
  const clip = moved.sequence.tracks.video_2.clips.clip_1;
  assert.equal(clip.trackId.value, "video_2");
  assert.deepEqual(clip.properties[TIMELINE_CLIP_PROPERTIES.timelineStart].value, time(72));
  assert.deepEqual(clip.properties[TIMELINE_CLIP_PROPERTIES.sourceStart].value, time(48));
  assert.deepEqual(clip.properties[TIMELINE_CLIP_PROPERTIES.sourceDuration].value, time(24));
});

test("snapshot JSON validates and restores the same document", () => {
  const document = applyTimelineOps(emptyDocument(), [
    {
      ...opBase("track_add"),
      type: "addTrack",
      track: { id: "video_1", kind: "video" },
    },
  ]).document;
  assert.deepEqual(parseTimelineDocumentJson(JSON.stringify(document)), document);
  assert.throws(
    () => parseTimelineDocumentJson('{"schemaVersion":2}'),
    /schema version is unsupported/,
  );
});
