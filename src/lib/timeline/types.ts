import type { GenericId } from "convex/values";

export type TimelineEntityId = string;
export type TimelineSequenceId = TimelineEntityId;
export type TimelineTrackId = TimelineEntityId;
export type TimelineClipId = TimelineEntityId;
export type TimelineActorId = string;

/** A frame-accurate time expressed as `value / rate` seconds. */
export interface TimelineTime {
  value: number;
  rate: number;
}

export interface TimelineRange {
  start: TimelineTime;
  duration: TimelineTime;
}

export type TimelinePropertyValue =
  | null
  | boolean
  | number
  | string
  | TimelineTime
  | TimelineRange
  | Array<null | boolean | number | string | TimelineTime>
  | Record<string, null | boolean | number | string>;

/**
 * Metadata attached to every independently mergeable value.
 *
 * Writes compare timestamp first, then actorId and opId as deterministic
 * tie-breakers. This makes replay idempotent without retaining an unbounded
 * applied-op log.
 */
export interface TimelineLwwValue<T> {
  value: T;
  timestamp: number;
  actorId: TimelineActorId;
  opId: string;
}

export const TIMELINE_CLIP_PROPERTIES = {
  name: "name",
  timelineStart: "timelineStart",
  timelineDuration: "timelineDuration",
  sourceStart: "sourceStart",
  sourceDuration: "sourceDuration",
  enabled: "enabled",
  opacity: "opacity",
  volume: "volume",
  playbackRate: "playbackRate",
} as const;

export const TIMELINE_TRACK_PROPERTIES = {
  name: "name",
  kind: "kind",
  position: "position",
  enabled: "enabled",
  locked: "locked",
  muted: "muted",
} as const;

export const TIMELINE_SEQUENCE_PROPERTIES = {
  name: "name",
  frameRate: "frameRate",
  width: "width",
  height: "height",
  sampleRate: "sampleRate",
} as const;

export type TimelineTrackKind = "video" | "audio" | "title" | "metadata";

export interface TimelineClip {
  id: TimelineClipId;
  /** References the canonical media row. */
  mediaId: TimelineLwwValue<GenericId<"videos">>;
  /** The owning track is LWW so concurrent cross-track moves converge. */
  trackId: TimelineLwwValue<TimelineTrackId>;
  /** Removed entities remain as tombstones so remove and replay are idempotent. */
  removed: TimelineLwwValue<boolean>;
  properties: Record<string, TimelineLwwValue<TimelinePropertyValue>>;
}

export interface TimelineTrack {
  id: TimelineTrackId;
  removed: TimelineLwwValue<boolean>;
  properties: Record<string, TimelineLwwValue<TimelinePropertyValue>>;
  clips: Record<TimelineClipId, TimelineClip>;
}

export interface TimelineSequence {
  id: TimelineSequenceId;
  properties: Record<string, TimelineLwwValue<TimelinePropertyValue>>;
  tracks: Record<TimelineTrackId, TimelineTrack>;
}

export interface TimelineDocument {
  schemaVersion: 1;
  sequence: TimelineSequence;
}

export interface TimelineDocRecord {
  id: GenericId<"timelineDocs">;
  teamId: GenericId<"teams">;
  projectId: GenericId<"projects">;
  versionId?: GenericId<"projectVersions">;
  branch: string;
  revision: number;
  headSnapshotId?: GenericId<"timelineSnapshots">;
  document: TimelineDocument;
  updatedAt: number;
  updatedBy: TimelineActorId;
}

export interface TimelineOpBase {
  /** Stable client-generated key used to make retries idempotent. */
  opId: string;
  actorId: TimelineActorId;
  /** Client wall-clock milliseconds, bounded by the server before merge. */
  timestamp: number;
}

export interface TimelineTrackSeed {
  id: TimelineTrackId;
  kind: TimelineTrackKind;
  name?: string;
  position?: number;
  properties?: Record<string, TimelinePropertyValue>;
}

export interface TimelineClipSeed {
  id: TimelineClipId;
  mediaId: GenericId<"videos">;
  timelineRange: TimelineRange;
  sourceRange: TimelineRange;
  properties?: Record<string, TimelinePropertyValue>;
}

export type TimelineOp =
  | (TimelineOpBase & {
      type: "setClipRange";
      clipId: TimelineClipId;
      timelineRange?: TimelineRange;
      sourceRange?: TimelineRange;
    })
  | (TimelineOpBase & {
      type: "moveClip";
      clipId: TimelineClipId;
      targetTrackId: TimelineTrackId;
      timelineStart: TimelineTime;
    })
  | (TimelineOpBase & {
      type: "addClip";
      trackId: TimelineTrackId;
      clip: TimelineClipSeed;
    })
  | (TimelineOpBase & {
      type: "removeClip";
      clipId: TimelineClipId;
    })
  | (TimelineOpBase & {
      type: "setClipProperty";
      clipId: TimelineClipId;
      property: string;
      value: TimelinePropertyValue;
    })
  | (TimelineOpBase & {
      type: "addTrack";
      track: TimelineTrackSeed;
    })
  | (TimelineOpBase & {
      type: "removeTrack";
      trackId: TimelineTrackId;
    })
  | (TimelineOpBase & {
      type: "setTrackProperty";
      trackId: TimelineTrackId;
      property: string;
      value: TimelinePropertyValue;
    })
  | (TimelineOpBase & {
      type: "setSequenceProperty";
      property: string;
      value: TimelinePropertyValue;
    });

export interface TimelineSoftLockClaim {
  target:
    | { kind: "sequence"; sequenceId: TimelineSequenceId }
    | { kind: "file"; path: string };
  holder: TimelineActorId;
  claimedAt: number;
}

export interface TimelinePresencePayload {
  playheadPosition: TimelineTime;
  selectedClipIds: TimelineClipId[];
  viewportRange: TimelineRange;
  softLocks: TimelineSoftLockClaim[];
}

export type RenderJobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "uploading"
  | "done"
  | "failed";

export interface TimelineDocSnapshotReference {
  timelineDocId: GenericId<"timelineDocs">;
  timelineSnapshotId: GenericId<"timelineSnapshots">;
  branch: string;
  revision: number;
}

export type RenderContainer = "mp4" | "mov" | "webm";
export type RenderVideoCodec = "h264" | "hevc" | "prores" | "vp9" | "av1";
export type RenderAudioCodec = "aac" | "pcm" | "opus" | "none";

export interface RenderOutputSpec {
  container: RenderContainer;
  videoCodec: RenderVideoCodec;
  audioCodec: RenderAudioCodec;
  width: number;
  height: number;
  frameRate: TimelineTime;
}

export interface RenderSegmentCacheStats {
  segmentCount: number;
  cacheHits: number;
  cacheMisses: number;
  bytesReused: number;
  bytesRendered: number;
}

export interface RenderJob {
  id: GenericId<"renderJobs">;
  teamId: GenericId<"teams">;
  projectId: GenericId<"projects">;
  status: RenderJobStatus;
  snapshot: TimelineDocSnapshotReference;
  output: RenderOutputSpec;
  outputObjectKey?: string;
  createdAt: number;
  queuedAt: number;
  claimedBy?: string;
  claimedAt?: number;
  startedAt?: number;
  uploadingAt?: number;
  completedAt?: number;
  failedAt?: number;
  heartbeatAt?: number;
  leaseExpiresAt?: number;
  attemptCount: number;
  error?: string;
  segmentCache?: RenderSegmentCacheStats;
}
