import type { PlaybackSource } from "./types";

export type SequencePlaybackClip = {
  id: string;
  mediaId: string;
  timelineStart: number;
  timelineDuration: number;
  sourceStart: number;
  sourceDuration: number;
  playbackRate: number;
  volume: number;
  source: PlaybackSource | null;
};

const EPSILON = 1 / 1_000_000;

export function sortSequenceClips(
  clips: readonly SequencePlaybackClip[],
): SequencePlaybackClip[] {
  return [...clips].sort(
    (left, right) =>
      left.timelineStart - right.timelineStart || left.id.localeCompare(right.id),
  );
}

export function timelineTimeToClip(
  clips: readonly SequencePlaybackClip[],
  timelineTime: number,
): SequencePlaybackClip | null {
  if (!Number.isFinite(timelineTime)) return null;
  const ordered = sortSequenceClips(clips);
  for (const clip of ordered) {
    const clipEnd = clip.timelineStart + clip.timelineDuration;
    if (
      timelineTime + EPSILON >= clip.timelineStart &&
      timelineTime < clipEnd - EPSILON
    ) {
      return clip;
    }
  }

  const finalClip = ordered.at(-1);
  if (
    finalClip &&
    Math.abs(
      timelineTime - (finalClip.timelineStart + finalClip.timelineDuration),
    ) <= EPSILON
  ) {
    return finalClip;
  }
  return null;
}

export function timelineTimeToClipMediaTime(
  clip: SequencePlaybackClip,
  timelineTime: number,
): number {
  const timelineOffset = Math.max(
    0,
    Math.min(clip.timelineDuration, timelineTime - clip.timelineStart),
  );
  const rate = Math.max(EPSILON, clip.playbackRate);
  const mediaOffset = Math.min(clip.sourceDuration, timelineOffset * rate);
  return clip.sourceStart + mediaOffset;
}

export function clipMediaTimeToTimelineTime(
  clip: SequencePlaybackClip,
  mediaTime: number,
): number {
  const mediaOffset = Math.max(
    0,
    Math.min(clip.sourceDuration, mediaTime - clip.sourceStart),
  );
  const rate = Math.max(EPSILON, clip.playbackRate);
  return clip.timelineStart + Math.min(clip.timelineDuration, mediaOffset / rate);
}

export function nextSequenceClip(
  clips: readonly SequencePlaybackClip[],
  clipId: string,
): SequencePlaybackClip | null {
  const ordered = sortSequenceClips(clips);
  const index = ordered.findIndex((clip) => clip.id === clipId);
  return index >= 0 ? ordered[index + 1] ?? null : null;
}

export function sequenceDuration(
  clips: readonly SequencePlaybackClip[],
): number {
  let duration = 0;
  for (const clip of clips) {
    duration = Math.max(duration, clip.timelineStart + clip.timelineDuration);
  }
  return duration;
}
