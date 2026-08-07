import { applyTimelineOps, isTimelineTime } from "@/lib/timeline/operations";
import {
  TIMELINE_CLIP_PROPERTIES,
  TIMELINE_SEQUENCE_PROPERTIES,
  TIMELINE_TRACK_PROPERTIES,
  type TimelineClip,
  type TimelineClipSeed,
  type TimelineDocument,
  type TimelineOp,
  type TimelineOpBase,
  type TimelinePropertyValue,
  type TimelineRange,
  type TimelineTime,
  type TimelineTrack,
  type TimelineTrackKind,
} from "@/lib/timeline/types";

type WithoutOpBase<Op> = Op extends TimelineOp
  ? Omit<Op, keyof TimelineOpBase>
  : never;

export type TimelineOpDraft = WithoutOpBase<TimelineOp>;

export type EditorClip = {
  id: string;
  mediaId: string;
  trackId: string;
  name: string;
  timelineStart: number;
  timelineDuration: number;
  sourceStart: number;
  sourceDuration: number;
  volume: number;
  playbackRate: number;
  raw: TimelineClip;
};

export type EditorTrack = {
  id: string;
  name: string;
  kind: TimelineTrackKind;
  position: number;
  locked: boolean;
  muted: boolean;
  clips: EditorClip[];
  raw: TimelineTrack;
};

const CORE_CLIP_PROPERTIES = new Set<string>([
  TIMELINE_CLIP_PROPERTIES.timelineStart,
  TIMELINE_CLIP_PROPERTIES.timelineDuration,
  TIMELINE_CLIP_PROPERTIES.sourceStart,
  TIMELINE_CLIP_PROPERTIES.sourceDuration,
]);

export function timelineSeconds(time: TimelineTime | undefined): number {
  if (!time || !Number.isFinite(time.value) || time.rate <= 0) return 0;
  return time.value / time.rate;
}

export function timelineTime(seconds: number, rate: number): TimelineTime {
  const safeRate = Math.max(1, Math.round(rate || 30));
  return {
    value: Math.round(Math.max(0, seconds) * safeRate),
    rate: safeRate,
  };
}

export function timelineRange(
  startSeconds: number,
  durationSeconds: number,
  rate: number,
): TimelineRange {
  return {
    start: timelineTime(startSeconds, rate),
    duration: timelineTime(durationSeconds, rate),
  };
}

function timeProperty(
  properties: TimelineClip["properties"],
  property: string,
): TimelineTime | undefined {
  const value = properties[property]?.value;
  return isTimelineTime(value) ? value : undefined;
}

function numberProperty(
  properties: TimelineClip["properties"],
  property: string,
  fallback: number,
): number {
  const value = properties[property]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringProperty(
  properties: TimelineClip["properties"],
  property: string,
  fallback: string,
): string {
  const value = properties[property]?.value;
  return typeof value === "string" ? value : fallback;
}

function booleanProperty(
  properties: TimelineClip["properties"],
  property: string,
  fallback: boolean,
): boolean {
  const value = properties[property]?.value;
  return typeof value === "boolean" ? value : fallback;
}

function trackKind(track: TimelineTrack): TimelineTrackKind {
  const value = track.properties[TIMELINE_TRACK_PROPERTIES.kind]?.value;
  return value === "audio" || value === "title" || value === "metadata"
    ? value
    : "video";
}

export function sequenceFrameRate(document: TimelineDocument): number {
  const value =
    document.sequence.properties[TIMELINE_SEQUENCE_PROPERTIES.frameRate]?.value;
  return isTimelineTime(value) ? Math.max(1, timelineSeconds(value)) : 30;
}

export function getEditorTracks(document: TimelineDocument): EditorTrack[] {
  return Object.values(document.sequence.tracks)
    .filter((track) => !track.removed.value)
    .map((track, trackIndex) => {
      const kind = trackKind(track);
      const clips = Object.values(track.clips)
        .filter((clip) => !clip.removed.value)
        .map((clip) => {
          const timelineStart = timelineSeconds(
            timeProperty(
              clip.properties,
              TIMELINE_CLIP_PROPERTIES.timelineStart,
            ),
          );
          const timelineDuration = timelineSeconds(
            timeProperty(
              clip.properties,
              TIMELINE_CLIP_PROPERTIES.timelineDuration,
            ),
          );
          const sourceStart = timelineSeconds(
            timeProperty(clip.properties, TIMELINE_CLIP_PROPERTIES.sourceStart),
          );
          const sourceDuration = timelineSeconds(
            timeProperty(
              clip.properties,
              TIMELINE_CLIP_PROPERTIES.sourceDuration,
            ),
          );
          return {
            id: clip.id,
            mediaId: String(clip.mediaId.value),
            trackId: track.id,
            name: stringProperty(
              clip.properties,
              TIMELINE_CLIP_PROPERTIES.name,
              "Untitled",
            ),
            timelineStart,
            timelineDuration,
            sourceStart,
            sourceDuration,
            volume: numberProperty(
              clip.properties,
              TIMELINE_CLIP_PROPERTIES.volume,
              1,
            ),
            playbackRate: numberProperty(
              clip.properties,
              TIMELINE_CLIP_PROPERTIES.playbackRate,
              1,
            ),
            raw: clip,
          } satisfies EditorClip;
        })
        .sort(
          (left, right) =>
            left.timelineStart - right.timelineStart ||
            left.id.localeCompare(right.id),
        );
      return {
        id: track.id,
        name: stringProperty(
          track.properties,
          TIMELINE_TRACK_PROPERTIES.name,
          `${kind.toUpperCase()} ${trackIndex + 1}`,
        ),
        kind,
        position: numberProperty(
          track.properties,
          TIMELINE_TRACK_PROPERTIES.position,
          trackIndex,
        ),
        locked: booleanProperty(
          track.properties,
          TIMELINE_TRACK_PROPERTIES.locked,
          false,
        ),
        muted: booleanProperty(
          track.properties,
          TIMELINE_TRACK_PROPERTIES.muted,
          false,
        ),
        clips,
        raw: track,
      } satisfies EditorTrack;
    })
    .sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id),
    );
}

export function editorTimelineDuration(tracks: readonly EditorTrack[]): number {
  let duration = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      duration = Math.max(duration, clip.timelineStart + clip.timelineDuration);
    }
  }
  return duration;
}

export function findEditorClip(
  document: TimelineDocument,
  clipId: string,
): { track: TimelineTrack; clip: TimelineClip } | null {
  for (const track of Object.values(document.sequence.tracks)) {
    const clip = track.clips[clipId];
    if (clip) return { track, clip };
  }
  return null;
}

function clipSeed(track: TimelineTrack, clip: TimelineClip): TimelineClipSeed {
  const properties: Record<string, TimelinePropertyValue> = {};
  for (const [property, write] of Object.entries(clip.properties)) {
    if (!CORE_CLIP_PROPERTIES.has(property)) properties[property] = write.value;
  }
  return {
    id: clip.id,
    mediaId: clip.mediaId.value,
    timelineRange: {
      start:
        timeProperty(clip.properties, TIMELINE_CLIP_PROPERTIES.timelineStart) ??
        timelineTime(0, 30),
      duration:
        timeProperty(
          clip.properties,
          TIMELINE_CLIP_PROPERTIES.timelineDuration,
        ) ?? timelineTime(0, 30),
    },
    sourceRange: {
      start:
        timeProperty(clip.properties, TIMELINE_CLIP_PROPERTIES.sourceStart) ??
        timelineTime(0, 30),
      duration:
        timeProperty(
          clip.properties,
          TIMELINE_CLIP_PROPERTIES.sourceDuration,
        ) ?? timelineTime(0, 30),
    },
    properties,
  };
}

function inverseForOp(
  document: TimelineDocument,
  op: TimelineOp,
): TimelineOpDraft[] {
  switch (op.type) {
    case "setClipRange": {
      const found = findEditorClip(document, op.clipId);
      if (!found) return [];
      const inverse: TimelineOpDraft = {
        type: "setClipRange",
        clipId: op.clipId,
      };
      if (op.timelineRange) {
        inverse.timelineRange = clipSeed(found.track, found.clip).timelineRange;
      }
      if (op.sourceRange) {
        inverse.sourceRange = clipSeed(found.track, found.clip).sourceRange;
      }
      return [inverse];
    }
    case "moveClip": {
      const found = findEditorClip(document, op.clipId);
      if (!found) return [];
      return [
        {
          type: "moveClip",
          clipId: op.clipId,
          targetTrackId: found.track.id,
          timelineStart:
            timeProperty(
              found.clip.properties,
              TIMELINE_CLIP_PROPERTIES.timelineStart,
            ) ?? timelineTime(0, 30),
        },
      ];
    }
    case "addClip":
      return [{ type: "removeClip", clipId: op.clip.id }];
    case "removeClip": {
      const found = findEditorClip(document, op.clipId);
      if (!found || found.clip.removed.value) return [];
      return [
        {
          type: "addClip",
          trackId: found.track.id,
          clip: clipSeed(found.track, found.clip),
        },
      ];
    }
    case "setClipProperty": {
      const found = findEditorClip(document, op.clipId);
      if (!found) return [];
      const fallback =
        op.property === TIMELINE_CLIP_PROPERTIES.volume ||
        op.property === TIMELINE_CLIP_PROPERTIES.opacity ||
        op.property === TIMELINE_CLIP_PROPERTIES.playbackRate
          ? 1
          : op.property === TIMELINE_CLIP_PROPERTIES.enabled
            ? true
            : op.property === TIMELINE_CLIP_PROPERTIES.name
              ? "Untitled"
              : null;
      return [
        {
          type: "setClipProperty",
          clipId: op.clipId,
          property: op.property,
          value: found.clip.properties[op.property]?.value ?? fallback,
        },
      ];
    }
    case "addTrack":
      return [{ type: "removeTrack", trackId: op.track.id }];
    case "removeTrack": {
      const track = document.sequence.tracks[op.trackId];
      if (!track || track.removed.value) return [];
      const storedName = track.properties[TIMELINE_TRACK_PROPERTIES.name]?.value;
      return [
        {
          type: "addTrack",
          track: {
            id: track.id,
            kind: trackKind(track),
            ...(typeof storedName === "string" ? { name: storedName } : {}),
            position: numberProperty(
              track.properties,
              TIMELINE_TRACK_PROPERTIES.position,
              0,
            ),
            properties: Object.fromEntries(
              Object.entries(track.properties)
                .filter(
                  ([property]) =>
                    property !== TIMELINE_TRACK_PROPERTIES.kind &&
                    property !== TIMELINE_TRACK_PROPERTIES.name &&
                    property !== TIMELINE_TRACK_PROPERTIES.position,
                )
                .map(([property, write]) => [property, write.value]),
            ),
          },
        },
      ];
    }
    case "setTrackProperty": {
      const track = document.sequence.tracks[op.trackId];
      if (!track) return [];
      const fallback =
        op.property === TIMELINE_TRACK_PROPERTIES.position
          ? getEditorTracks(document).find(
              (candidate) => candidate.id === op.trackId,
            )?.position ?? 0
          : op.property === TIMELINE_TRACK_PROPERTIES.name
            ? trackKind(track).toUpperCase()
            : op.property === TIMELINE_TRACK_PROPERTIES.kind
              ? trackKind(track)
              : op.property === TIMELINE_TRACK_PROPERTIES.enabled
                ? true
                : op.property === TIMELINE_TRACK_PROPERTIES.locked ||
                    op.property === TIMELINE_TRACK_PROPERTIES.muted
                  ? false
                  : null;
      return [
        {
          type: "setTrackProperty",
          trackId: op.trackId,
          property: op.property,
          value: track.properties[op.property]?.value ?? fallback,
        },
      ];
    }
    case "setSequenceProperty":
      return [
        {
          type: "setSequenceProperty",
          property: op.property,
          value: document.sequence.properties[op.property]?.value ?? null,
        },
      ];
  }
}

export function invertTimelineOps(
  document: TimelineDocument,
  ops: readonly TimelineOp[],
): TimelineOpDraft[] {
  let working = document;
  let inverse: TimelineOpDraft[] = [];
  for (const op of ops) {
    inverse = [...inverseForOp(working, op), ...inverse];
    working = applyTimelineOps(working, [op]).document;
  }
  return inverse;
}

export function materializeTimelineOps(
  drafts: readonly TimelineOpDraft[],
  actorId: string,
  timestamp: number,
  createId: () => string = () => crypto.randomUUID(),
): TimelineOp[] {
  return drafts.map((draft, index) => ({
    ...draft,
    actorId,
    timestamp: timestamp + index,
    opId: createId(),
  })) as TimelineOp[];
}

type Interval = { start: number; end: number };

function mergeIntervals(intervals: Interval[]): Interval[] {
  const ordered = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  return merged;
}

function removedDurationBefore(intervals: Interval[], time: number): number {
  let duration = 0;
  for (const interval of intervals) {
    if (interval.end <= time) duration += interval.end - interval.start;
  }
  return duration;
}

export function buildRippleDeleteOps(
  document: TimelineDocument,
  clipIds: readonly string[],
): TimelineOpDraft[] {
  const selectedIds = new Set(clipIds);
  const tracks = getEditorTracks(document);
  const rate = sequenceFrameRate(document);
  const ops: TimelineOpDraft[] = [];

  for (const track of tracks) {
    const selected = track.clips.filter((clip) => selectedIds.has(clip.id));
    if (selected.length === 0) continue;
    const intervals = mergeIntervals(
      selected.map((clip) => ({
        start: clip.timelineStart,
        end: clip.timelineStart + clip.timelineDuration,
      })),
    );
    for (const clip of selected) {
      ops.push({ type: "removeClip", clipId: clip.id });
    }
    for (const clip of track.clips) {
      if (selectedIds.has(clip.id)) continue;
      const shift = removedDurationBefore(intervals, clip.timelineStart);
      if (shift <= 0) continue;
      ops.push({
        type: "moveClip",
        clipId: clip.id,
        targetTrackId: track.id,
        timelineStart: timelineTime(clip.timelineStart - shift, rate),
      });
    }
  }
  return ops;
}

export function buildSplitOps(
  document: TimelineDocument,
  clipId: string,
  playheadSeconds: number,
  nextClipId: string,
): TimelineOpDraft[] {
  const rate = sequenceFrameRate(document);
  const track = getEditorTracks(document).find((candidate) =>
    candidate.clips.some((clip) => clip.id === clipId),
  );
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip) return [];

  const offset = playheadSeconds - clip.timelineStart;
  const frame = 1 / rate;
  if (offset < frame || offset > clip.timelineDuration - frame) return [];

  const rateMultiplier = Math.max(0.0001, clip.playbackRate);
  const firstSourceDuration = Math.min(
    clip.sourceDuration,
    offset * rateMultiplier,
  );
  const secondSourceStart = clip.sourceStart + firstSourceDuration;
  const secondTimelineDuration = clip.timelineDuration - offset;
  const secondSourceDuration = Math.max(
    0,
    clip.sourceDuration - firstSourceDuration,
  );
  const properties: Record<string, TimelinePropertyValue> = {};
  for (const [property, write] of Object.entries(clip.raw.properties)) {
    if (!CORE_CLIP_PROPERTIES.has(property)) properties[property] = write.value;
  }

  return [
    {
      type: "setClipRange",
      clipId,
      timelineRange: timelineRange(clip.timelineStart, offset, rate),
      sourceRange: timelineRange(
        clip.sourceStart,
        firstSourceDuration,
        rate,
      ),
    },
    {
      type: "addClip",
      trackId: track.id,
      clip: {
        id: nextClipId,
        mediaId: clip.raw.mediaId.value,
        timelineRange: timelineRange(
          playheadSeconds,
          secondTimelineDuration,
          rate,
        ),
        sourceRange: timelineRange(
          secondSourceStart,
          secondSourceDuration,
          rate,
        ),
        properties,
      },
    },
  ];
}

export function buildTrimOp(
  document: TimelineDocument,
  clipId: string,
  edge: "in" | "out",
  timelinePosition: number,
): TimelineOpDraft | null {
  const rate = sequenceFrameRate(document);
  const clip = getEditorTracks(document)
    .flatMap((track) => track.clips)
    .find((candidate) => candidate.id === clipId);
  if (!clip) return null;

  const frame = 1 / rate;
  const clipEnd = clip.timelineStart + clip.timelineDuration;
  const playbackRate = Math.max(0.0001, clip.playbackRate);
  if (edge === "in") {
    const nextStart = Math.max(
      clip.timelineStart,
      Math.min(clipEnd - frame, timelinePosition),
    );
    const delta = nextStart - clip.timelineStart;
    return {
      type: "setClipRange",
      clipId,
      timelineRange: timelineRange(
        nextStart,
        clip.timelineDuration - delta,
        rate,
      ),
      sourceRange: timelineRange(
        clip.sourceStart + delta * playbackRate,
        Math.max(frame, clip.sourceDuration - delta * playbackRate),
        rate,
      ),
    };
  }

  const nextEnd = Math.max(
    clip.timelineStart + frame,
    Math.min(clipEnd, timelinePosition),
  );
  const nextDuration = nextEnd - clip.timelineStart;
  return {
    type: "setClipRange",
    clipId,
    timelineRange: timelineRange(clip.timelineStart, nextDuration, rate),
    sourceRange: timelineRange(
      clip.sourceStart,
      Math.min(clip.sourceDuration, nextDuration * playbackRate),
      rate,
    ),
  };
}
