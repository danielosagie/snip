import type {
  TimelinePresencePayload,
  TimelineSoftLockClaim,
  TimelineTime,
} from "../../lib/timeline/types";

export const EDIT_PRESENCE_STALE_MS = 45_000;
export const DESKTOP_PRESENCE_STALE_MS = 30_000;
export const WATCH_PRESENCE_STALE_MS = 12_000;
export const WATCH_CHASE_THRESHOLD_SECONDS = 1.25;

const MAX_SELECTED_CLIPS = 256;
const MAX_SOFT_LOCKS = 32;
const MAX_FILE_PATH_LENGTH = 1_024;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export interface TimelinePresenceParticipant {
  userId: string;
  actorId: string;
  displayName: string;
  avatarUrl?: string;
  online: boolean;
  lastDisconnected: number;
  updatedAt: number;
  payload: TimelinePresencePayload;
}

export interface WatchPresenceParticipant {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  online: boolean;
  lastDisconnected: number;
  joinedAt: number;
  updatedAt: number;
  playheadSeconds: number;
  playing: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isTimelineTime(value: unknown): value is TimelineTime {
  return (
    isRecord(value) &&
    isFiniteNumber(value.value) &&
    value.value >= 0 &&
    isFiniteNumber(value.rate) &&
    value.rate > 0
  );
}

function isTimelineRange(value: unknown) {
  return (
    isRecord(value) &&
    isTimelineTime(value.start) &&
    isTimelineTime(value.duration)
  );
}

function isSoftLockClaim(value: unknown): value is TimelineSoftLockClaim {
  if (
    !isRecord(value) ||
    typeof value.holder !== "string" ||
    !isFiniteNumber(value.claimedAt) ||
    !isRecord(value.target)
  ) {
    return false;
  }

  if (value.target.kind === "sequence") {
    return (
      typeof value.target.sequenceId === "string" &&
      value.target.sequenceId.length > 0
    );
  }

  return (
    value.target.kind === "file" &&
    typeof value.target.path === "string" &&
    value.target.path.trim().length > 0 &&
    value.target.path.length <= MAX_FILE_PATH_LENGTH
  );
}

/** Runtime guard for Agent A's authoritative timeline presence contract. */
export function isTimelinePresencePayload(
  value: unknown,
): value is TimelinePresencePayload {
  return (
    isRecord(value) &&
    isTimelineTime(value.playheadPosition) &&
    Array.isArray(value.selectedClipIds) &&
    value.selectedClipIds.length <= MAX_SELECTED_CLIPS &&
    value.selectedClipIds.every(
      (clipId) => typeof clipId === "string" && clipId.length > 0,
    ) &&
    isTimelineRange(value.viewportRange) &&
    Array.isArray(value.softLocks) &&
    value.softLocks.length <= MAX_SOFT_LOCKS &&
    value.softLocks.every(isSoftLockClaim)
  );
}

export function softLockTargetKey(
  target: TimelineSoftLockClaim["target"],
) {
  return target.kind === "sequence"
    ? `sequence:${target.sequenceId}`
    : `file:${target.path.trim()}`;
}

export function isSameSoftLockTarget(
  left: TimelineSoftLockClaim["target"],
  right: TimelineSoftLockClaim["target"],
) {
  return softLockTargetKey(left) === softLockTargetKey(right);
}

/**
 * Applies semantic limits and makes the authenticated actor authoritative for
 * every claim. Convex validators still enforce the wire shape before this runs.
 */
export function normalizeTimelinePresencePayload(
  value: unknown,
  actorId: string,
  now: number,
): TimelinePresencePayload | null {
  if (!isTimelinePresencePayload(value)) return null;

  const selectedClipIds = Array.from(new Set(value.selectedClipIds)).slice(
    0,
    MAX_SELECTED_CLIPS,
  );
  const locksByTarget = new Map<string, TimelineSoftLockClaim>();

  for (const claim of value.softLocks.slice(0, MAX_SOFT_LOCKS)) {
    const target =
      claim.target.kind === "file"
        ? { kind: "file" as const, path: claim.target.path.trim() }
        : claim.target;
    const claimedAt =
      claim.claimedAt > 0 &&
      claim.claimedAt <= now + MAX_CLOCK_SKEW_MS
        ? claim.claimedAt
        : now;

    locksByTarget.set(softLockTargetKey(target), {
      target,
      holder: actorId,
      claimedAt,
    });
  }

  return {
    playheadPosition: value.playheadPosition,
    selectedClipIds,
    viewportRange: value.viewportRange,
    softLocks: Array.from(locksByTarget.values()),
  };
}

export function isEditPresenceActive(
  participant: Pick<TimelinePresenceParticipant, "online" | "updatedAt">,
  now: number,
  staleAfterMs = EDIT_PRESENCE_STALE_MS,
) {
  return (
    participant.online &&
    participant.updatedAt <= now + MAX_CLOCK_SKEW_MS &&
    now - participant.updatedAt <= staleAfterMs
  );
}

export function getSoftLockConflicts(
  participants: TimelinePresenceParticipant[],
  target: TimelineSoftLockClaim["target"],
  actorId: string | null,
  now: number,
) {
  const conflicts: Array<{
    participant: TimelinePresenceParticipant;
    claim: TimelineSoftLockClaim;
  }> = [];

  for (const participant of participants) {
    if (
      participant.actorId === actorId ||
      !isEditPresenceActive(participant, now)
    ) {
      continue;
    }

    for (const claim of participant.payload.softLocks) {
      if (isSameSoftLockTarget(claim.target, target)) {
        conflicts.push({ participant, claim });
      }
    }
  }

  return conflicts.sort((left, right) =>
    left.claim.claimedAt - right.claim.claimedAt,
  );
}

export function isDesktopActivityActive(
  lastSeen: number,
  now: number,
  staleAfterMs = DESKTOP_PRESENCE_STALE_MS,
) {
  return lastSeen <= now + MAX_CLOCK_SKEW_MS && now - lastSeen <= staleAfterMs;
}

export function fileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || path;
}

export function selectWatchHost(
  participants: WatchPresenceParticipant[],
  now: number,
) {
  let host: WatchPresenceParticipant | null = null;

  for (const participant of participants) {
    if (
      !participant.online ||
      now - participant.updatedAt > WATCH_PRESENCE_STALE_MS
    ) {
      continue;
    }
    if (
      host === null ||
      participant.joinedAt < host.joinedAt ||
      (participant.joinedAt === host.joinedAt &&
        participant.userId.localeCompare(host.userId) < 0)
    ) {
      host = participant;
    }
  }

  return host;
}

export function getFollowSyncChase(input: {
  following: boolean;
  localPlayheadSeconds: number;
  localPlaying?: boolean;
  host: WatchPresenceParticipant | null;
  now: number;
  thresholdSeconds?: number;
}): { playheadSeconds: number; playing: boolean } | null {
  const {
    following,
    localPlayheadSeconds,
    localPlaying,
    host,
    now,
    thresholdSeconds = WATCH_CHASE_THRESHOLD_SECONDS,
  } = input;

  if (
    !following ||
    !host ||
    !host.online ||
    now - host.updatedAt > WATCH_PRESENCE_STALE_MS
  ) {
    return null;
  }

  const elapsedSeconds = Math.max(0, now - host.updatedAt) / 1_000;
  const target = Math.max(
    0,
    host.playheadSeconds + (host.playing ? elapsedSeconds : 0),
  );

  const playbackStateMatches =
    localPlaying === undefined || localPlaying === host.playing;
  if (
    Math.abs(target - localPlayheadSeconds) < thresholdSeconds &&
    playbackStateMatches
  ) {
    return null;
  }

  return { playheadSeconds: target, playing: host.playing };
}
