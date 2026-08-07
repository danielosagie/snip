import { describe, expect, test } from "bun:test";

import type { SequencePlaybackClip } from "./timelineMapping";
import {
  clipMediaTimeToTimelineTime,
  nextSequenceClip,
  timelineTimeToClip,
  timelineTimeToClipMediaTime,
} from "./timelineMapping";

const clips: SequencePlaybackClip[] = [
  {
    id: "clip-a",
    mediaId: "media-a",
    timelineStart: 0,
    timelineDuration: 4,
    sourceStart: 10,
    sourceDuration: 8,
    playbackRate: 2,
    volume: 1,
    source: null,
  },
  {
    id: "clip-b",
    mediaId: "media-b",
    timelineStart: 4,
    timelineDuration: 3,
    sourceStart: 2,
    sourceDuration: 3,
    playbackRate: 1,
    volume: 1,
    source: null,
  },
];

describe("timeline playback mapping", () => {
  test("maps timeline time into source media time", () => {
    const clip = timelineTimeToClip(clips, 1.5);
    expect(clip?.id).toBe("clip-a");
    expect(timelineTimeToClipMediaTime(clips[0], 1.5)).toBe(13);
  });

  test("maps media time back to timeline time", () => {
    expect(clipMediaTimeToTimelineTime(clips[0], 16)).toBe(3);
    expect(clipMediaTimeToTimelineTime(clips[1], 4.5)).toBe(6.5);
  });

  test("selects the next clip at a cut", () => {
    expect(timelineTimeToClip(clips, 4)?.id).toBe("clip-b");
    expect(nextSequenceClip(clips, "clip-a")?.id).toBe("clip-b");
  });
});
