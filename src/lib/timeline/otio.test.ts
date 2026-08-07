import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { GenericId } from "convex/values";
import { applyTimelineOps, createTimelineDocument } from "./operations";
import {
  fcpxmlToOtio,
  fcpxmlToTimelineDocument,
  otioToTimelineDocument,
  timelineDocumentToOtio,
} from "./otio";
import {
  TIMELINE_CLIP_PROPERTIES,
  TIMELINE_SEQUENCE_PROPERTIES,
  type TimelineOp,
} from "./types";

const VIDEO_ID = "video_1" as GenericId<"videos">;
const fixture = readFileSync(new URL("./fixtures/basic.fcpxml", import.meta.url), "utf8");

function sampleDocument() {
  const document = createTimelineDocument({
    sequenceId: "sequence_1",
    actorId: "seed",
    timestamp: 1,
    properties: {
      [TIMELINE_SEQUENCE_PROPERTIES.name]: "Assembly",
      [TIMELINE_SEQUENCE_PROPERTIES.frameRate]: { value: 24, rate: 1 },
      [TIMELINE_SEQUENCE_PROPERTIES.width]: 1920,
      [TIMELINE_SEQUENCE_PROPERTIES.height]: 1080,
    },
  });
  const ops: TimelineOp[] = [
    {
      type: "addTrack",
      opId: "track_1",
      actorId: "seed",
      timestamp: 2,
      track: { id: "track_1", kind: "video", name: "V1", position: 0 },
    },
    {
      type: "addClip",
      opId: "clip_1",
      actorId: "seed",
      timestamp: 3,
      trackId: "track_1",
      clip: {
        id: "clip_1",
        mediaId: VIDEO_ID,
        timelineRange: {
          start: { value: 24, rate: 24 },
          duration: { value: 48, rate: 24 },
        },
        sourceRange: {
          start: { value: 120, rate: 24 },
          duration: { value: 48, rate: 24 },
        },
        properties: { [TIMELINE_CLIP_PROPERTIES.name]: "Opening" },
      },
    },
  ];
  return applyTimelineOps(document, ops).document;
}

test("timeline document round-trips through OTIO without semantic drift", () => {
  const otio = timelineDocumentToOtio(sampleDocument());
  const restored = otioToTimelineDocument(otio, {
    actorId: "importer",
    timestamp: 100,
  });
  assert.deepEqual(timelineDocumentToOtio(restored), otio);
});

test("FCPXML fixture imports resource references, timing, and format metadata", () => {
  const otio = fcpxmlToOtio(fixture);
  assert.equal(otio.name, "Assembly v1");
  assert.equal(otio.tracks.children.length, 1);
  assert.equal(otio.tracks.children[0].children.length, 3);
  assert.equal(otio.tracks.children[0].children[0].OTIO_SCHEMA, "Clip.2");
  assert.equal(otio.tracks.children[0].children[1].OTIO_SCHEMA, "Gap.1");
  assert.equal(otio.metadata.snip !== undefined, true);

  const first = otio.tracks.children[0].children[0];
  assert.equal(first.OTIO_SCHEMA, "Clip.2");
  if (first.OTIO_SCHEMA !== "Clip.2") return;
  assert.equal(first.media_reference.OTIO_SCHEMA, "ExternalReference.1");
  if (first.media_reference.OTIO_SCHEMA !== "ExternalReference.1") return;
  assert.equal(
    first.media_reference.target_url,
    "file:///Volumes/Media/Interview%20A.mov",
  );
  assert.equal(first.source_range.duration.value, 48);
  assert.ok(Math.abs(first.source_range.duration.rate - 24_000 / 1_001) < 0.000_001);
});

test("FCPXML fixture becomes a live document when media is resolved", () => {
  const document = fcpxmlToTimelineDocument(fixture, {
    actorId: "plugin:team_1",
    timestamp: 100,
    resolveMediaId: () => VIDEO_ID,
  });
  assert.equal(document.sequence.properties.name.value, "Assembly v1");
  const track = Object.values(document.sequence.tracks)[0];
  assert.equal(Object.keys(track.clips).length, 2);
  assert.equal(Object.values(track.clips)[0].mediaId.value, VIDEO_ID);
});
