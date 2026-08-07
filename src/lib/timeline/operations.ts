import {
  TIMELINE_CLIP_PROPERTIES,
  TIMELINE_SEQUENCE_PROPERTIES,
  TIMELINE_TRACK_PROPERTIES,
  type TimelineClip,
  type TimelineDocument,
  type TimelineLwwValue,
  type TimelineOp,
  type TimelineOpBase,
  type TimelinePropertyValue,
  type TimelineRange,
  type TimelineTime,
  type TimelineTrack,
} from "./types";

const MAX_ID_LENGTH = 256;
const MAX_PROPERTY_NAME_LENGTH = 128;
const MAX_PROPERTY_STRING_LENGTH = 100_000;
const MAX_PROPERTY_COLLECTION_SIZE = 256;

export interface ApplyTimelineOpsResult {
  document: TimelineDocument;
  changed: boolean;
  appliedOpIds: string[];
}

export interface CreateTimelineDocumentOptions {
  sequenceId: string;
  actorId: string;
  timestamp: number;
  properties?: Record<string, TimelinePropertyValue>;
}

function assertFiniteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
}

function assertId(value: string, label: string) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_ID_LENGTH
  ) {
    throw new Error(`${label} must be a non-empty string under ${MAX_ID_LENGTH} characters.`);
  }
  if (value === "__proto__" || value === "constructor" || value === "prototype") {
    throw new Error(`${label} uses a reserved value.`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function isTimelineTime(value: unknown): value is TimelineTime {
  return (
    isPlainObject(value) &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    typeof value.rate === "number" &&
    Number.isFinite(value.rate) &&
    value.rate > 0
  );
}

export function isTimelineRange(value: unknown): value is TimelineRange {
  return (
    isPlainObject(value) &&
    isTimelineTime(value.start) &&
    isTimelineTime(value.duration) &&
    value.duration.value >= 0
  );
}

function assertTime(value: TimelineTime, label: string, allowNegative = true) {
  if (!isTimelineTime(value)) {
    throw new Error(`${label} must contain finite value and positive rate fields.`);
  }
  if (!allowNegative && value.value < 0) {
    throw new Error(`${label} must not be negative.`);
  }
}

function assertRange(value: TimelineRange, label: string) {
  if (!isTimelineRange(value)) {
    throw new Error(`${label} must contain a valid start and non-negative duration.`);
  }
}

function assertPropertyName(value: string) {
  assertId(value, "Property name");
  if (value.length > MAX_PROPERTY_NAME_LENGTH) {
    throw new Error(`Property name must be under ${MAX_PROPERTY_NAME_LENGTH} characters.`);
  }
  if (value === "__proto__" || value === "constructor" || value === "prototype") {
    throw new Error(`Property name ${value} is reserved.`);
  }
}

function isPrimitive(value: unknown): value is null | boolean | number | string {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

export function assertTimelinePropertyValue(
  value: TimelinePropertyValue,
  label = "Property value",
) {
  if (isPrimitive(value)) {
    if (typeof value === "number") assertFiniteNumber(value, label);
    if (typeof value === "string" && value.length > MAX_PROPERTY_STRING_LENGTH) {
      throw new Error(`${label} is too long.`);
    }
    return;
  }

  if (isTimelineTime(value)) return;
  if (isTimelineRange(value)) return;

  if (Array.isArray(value)) {
    if (value.length > MAX_PROPERTY_COLLECTION_SIZE) {
      throw new Error(`${label} has too many entries.`);
    }
    for (const entry of value) {
      if (isTimelineTime(entry)) continue;
      if (!isPrimitive(entry)) {
        throw new Error(`${label} arrays may contain only primitives or timeline times.`);
      }
      if (typeof entry === "number") assertFiniteNumber(entry, label);
      if (typeof entry === "string" && entry.length > MAX_PROPERTY_STRING_LENGTH) {
        throw new Error(`${label} contains a string that is too long.`);
      }
    }
    return;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_PROPERTY_COLLECTION_SIZE) {
      throw new Error(`${label} has too many fields.`);
    }
    for (const [key, entry] of entries) {
      assertPropertyName(key);
      if (!isPrimitive(entry)) {
        throw new Error(`${label} records may contain only primitive values.`);
      }
      if (typeof entry === "number") assertFiniteNumber(entry, label);
      if (typeof entry === "string" && entry.length > MAX_PROPERTY_STRING_LENGTH) {
        throw new Error(`${label} contains a string that is too long.`);
      }
    }
    return;
  }

  throw new Error(`${label} is not a supported timeline property value.`);
}

function assertPropertyMap(
  properties: Record<string, TimelinePropertyValue> | undefined,
  scope: "clip" | "track" | "sequence",
) {
  if (!properties) return;
  const entries = Object.entries(properties);
  if (entries.length > MAX_PROPERTY_COLLECTION_SIZE) {
    throw new Error(`Too many ${scope} properties.`);
  }
  for (const [property, value] of entries) {
    assertPropertyName(property);
    assertKnownPropertyValue(scope, property, value);
  }
}

export function createTimelineDocument({
  sequenceId,
  actorId,
  timestamp,
  properties = {},
}: CreateTimelineDocumentOptions): TimelineDocument {
  assertId(sequenceId, "Sequence ID");
  assertId(actorId, "Actor ID");
  assertFiniteNumber(timestamp, "Creation timestamp");
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error("Creation timestamp must be a non-negative integer.");
  }
  assertPropertyMap(properties, "sequence");

  const op: TimelineOpBase = {
    opId: `create:${sequenceId}`,
    actorId,
    timestamp,
  };
  const sequenceProperties: TimelineDocument["sequence"]["properties"] = {};
  for (const [property, value] of Object.entries(properties)) {
    sequenceProperties[property] = write(value, op);
  }

  return {
    schemaVersion: 1,
    sequence: {
      id: sequenceId,
      properties: sequenceProperties,
      tracks: {},
    },
  };
}

function assertKnownPropertyValue(
  scope: "clip" | "track" | "sequence",
  property: string,
  value: TimelinePropertyValue,
) {
  assertTimelinePropertyValue(value);

  const requireType = (condition: boolean, expected: string) => {
    if (!condition) throw new Error(`${property} must be ${expected}.`);
  };

  if (
    scope === "clip" &&
    (property === TIMELINE_CLIP_PROPERTIES.timelineStart ||
      property === TIMELINE_CLIP_PROPERTIES.sourceStart)
  ) {
    assertTime(value as TimelineTime, property);
  }
  if (
    scope === "clip" &&
    (property === TIMELINE_CLIP_PROPERTIES.timelineDuration ||
      property === TIMELINE_CLIP_PROPERTIES.sourceDuration)
  ) {
    assertTime(value as TimelineTime, property, false);
  }
  if (
    scope === "clip" &&
    (property === TIMELINE_CLIP_PROPERTIES.enabled)
  ) {
    requireType(typeof value === "boolean", "a boolean");
  }
  if (
    scope === "clip" &&
    (property === TIMELINE_CLIP_PROPERTIES.opacity ||
      property === TIMELINE_CLIP_PROPERTIES.volume ||
      property === TIMELINE_CLIP_PROPERTIES.playbackRate)
  ) {
    requireType(typeof value === "number", "a number");
    if (
      property === TIMELINE_CLIP_PROPERTIES.opacity &&
      typeof value === "number" &&
      (value < 0 || value > 1)
    ) {
      throw new Error("opacity must be between 0 and 1.");
    }
    if (
      property === TIMELINE_CLIP_PROPERTIES.playbackRate &&
      typeof value === "number" &&
      value <= 0
    ) {
      throw new Error("playbackRate must be positive.");
    }
  }
  if (scope === "clip" && property === TIMELINE_CLIP_PROPERTIES.name) {
    requireType(typeof value === "string", "a string");
  }
  if (
    scope === "sequence" &&
    property === TIMELINE_SEQUENCE_PROPERTIES.frameRate
  ) {
    assertTime(value as TimelineTime, property, false);
    if ((value as TimelineTime).value <= 0) throw new Error("frameRate must be positive.");
  }
  if (
    scope === "track" &&
    property === TIMELINE_TRACK_PROPERTIES.kind &&
    value !== "video" &&
    value !== "audio" &&
    value !== "title" &&
    value !== "metadata"
  ) {
    throw new Error("Track kind is invalid.");
  }
  if (scope === "track" && property === TIMELINE_TRACK_PROPERTIES.name) {
    requireType(typeof value === "string", "a string");
  }
  if (scope === "track" && property === TIMELINE_TRACK_PROPERTIES.position) {
    requireType(typeof value === "number", "a number");
  }
  if (
    scope === "track" &&
    (property === TIMELINE_TRACK_PROPERTIES.enabled ||
      property === TIMELINE_TRACK_PROPERTIES.locked ||
      property === TIMELINE_TRACK_PROPERTIES.muted)
  ) {
    requireType(typeof value === "boolean", "a boolean");
  }
  if (scope === "sequence" && property === TIMELINE_SEQUENCE_PROPERTIES.name) {
    requireType(typeof value === "string", "a string");
  }
  if (
    scope === "sequence" &&
    (property === TIMELINE_SEQUENCE_PROPERTIES.width ||
      property === TIMELINE_SEQUENCE_PROPERTIES.height ||
      property === TIMELINE_SEQUENCE_PROPERTIES.sampleRate)
  ) {
    requireType(typeof value === "number" && value > 0, "a positive number");
  }
}

/** Validate the business rules that Convex's structural validators cannot express. */
export function assertValidTimelineOp(op: TimelineOp) {
  assertId(op.opId, "Operation ID");
  assertId(op.actorId, "Actor ID");
  assertFiniteNumber(op.timestamp, "Operation timestamp");
  if (!Number.isSafeInteger(op.timestamp) || op.timestamp < 0) {
    throw new Error("Operation timestamp must be a non-negative integer.");
  }

  switch (op.type) {
    case "setClipRange":
      assertId(op.clipId, "Clip ID");
      if (!op.timelineRange && !op.sourceRange) {
        throw new Error("setClipRange requires a timeline or source range.");
      }
      if (op.timelineRange) assertRange(op.timelineRange, "Timeline range");
      if (op.sourceRange) assertRange(op.sourceRange, "Source range");
      break;
    case "moveClip":
      assertId(op.clipId, "Clip ID");
      assertId(op.targetTrackId, "Target track ID");
      assertTime(op.timelineStart, "Timeline start");
      break;
    case "addClip":
      assertId(op.trackId, "Track ID");
      assertId(op.clip.id, "Clip ID");
      assertId(op.clip.mediaId, "Media ID");
      assertRange(op.clip.timelineRange, "Timeline range");
      assertRange(op.clip.sourceRange, "Source range");
      assertPropertyMap(op.clip.properties, "clip");
      break;
    case "removeClip":
      assertId(op.clipId, "Clip ID");
      break;
    case "setClipProperty":
      assertId(op.clipId, "Clip ID");
      assertPropertyName(op.property);
      assertKnownPropertyValue("clip", op.property, op.value);
      break;
    case "addTrack":
      assertId(op.track.id, "Track ID");
      if (
        op.track.kind !== "video" &&
        op.track.kind !== "audio" &&
        op.track.kind !== "title" &&
        op.track.kind !== "metadata"
      ) {
        throw new Error("Track kind is invalid.");
      }
      assertPropertyMap(op.track.properties, "track");
      if (op.track.name !== undefined && op.track.name.length > MAX_PROPERTY_STRING_LENGTH) {
        throw new Error("Track name is too long.");
      }
      if (op.track.position !== undefined) {
        assertFiniteNumber(op.track.position, "Track position");
      }
      break;
    case "removeTrack":
      assertId(op.trackId, "Track ID");
      break;
    case "setTrackProperty":
      assertId(op.trackId, "Track ID");
      assertPropertyName(op.property);
      assertKnownPropertyValue("track", op.property, op.value);
      break;
    case "setSequenceProperty":
      assertPropertyName(op.property);
      assertKnownPropertyValue("sequence", op.property, op.value);
      break;
  }
}

/**
 * Orders writes by client timestamp, then actor and operation IDs. The final
 * two comparisons make equal-time writes converge regardless of arrival order.
 */
export function compareTimelineWrites(
  left: Pick<TimelineLwwValue<unknown>, "timestamp" | "actorId" | "opId">,
  right: Pick<TimelineLwwValue<unknown>, "timestamp" | "actorId" | "opId">,
) {
  if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
  const actorOrder = left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0;
  if (actorOrder !== 0) return actorOrder;
  return left.opId < right.opId ? -1 : left.opId > right.opId ? 1 : 0;
}

function write<T>(value: T, op: TimelineOpBase): TimelineLwwValue<T> {
  return {
    value,
    timestamp: op.timestamp,
    actorId: op.actorId,
    opId: op.opId,
  };
}

function applyWrite<T>(
  current: TimelineLwwValue<T> | undefined,
  value: T,
  op: TimelineOpBase,
): { value: TimelineLwwValue<T>; changed: boolean } {
  const next = write(value, op);
  if (current && compareTimelineWrites(next, current) <= 0) {
    return { value: current, changed: false };
  }
  return { value: next, changed: true };
}

function cloneDocument(document: TimelineDocument): TimelineDocument {
  const tracks: TimelineDocument["sequence"]["tracks"] = {};
  for (const [trackId, track] of Object.entries(document.sequence.tracks)) {
    const clips: TimelineTrack["clips"] = {};
    for (const [clipId, clip] of Object.entries(track.clips)) {
      clips[clipId] = { ...clip, properties: { ...clip.properties } };
    }
    tracks[trackId] = {
      ...track,
      properties: { ...track.properties },
      clips,
    };
  }
  return {
    ...document,
    sequence: {
      ...document.sequence,
      properties: { ...document.sequence.properties },
      tracks,
    },
  };
}

function findClip(document: TimelineDocument, clipId: string) {
  for (const track of Object.values(document.sequence.tracks)) {
    const clip = track.clips[clipId];
    if (clip) return { track, clip };
  }
  return null;
}

function requireTrack(document: TimelineDocument, trackId: string) {
  const track = document.sequence.tracks[trackId];
  if (!track) throw new Error(`Track ${trackId} was not found.`);
  return track;
}

function requireClip(document: TimelineDocument, clipId: string) {
  const found = findClip(document, clipId);
  if (!found) throw new Error(`Clip ${clipId} was not found.`);
  return found;
}

function setClipProperty(
  clip: TimelineClip,
  property: string,
  value: TimelinePropertyValue,
  op: TimelineOpBase,
) {
  const result = applyWrite(clip.properties[property], value, op);
  clip.properties[property] = result.value;
  return result.changed;
}

function moveClipBetweenTracks(
  document: TimelineDocument,
  clip: TimelineClip,
  currentTrack: TimelineTrack,
  targetTrack: TimelineTrack,
  op: TimelineOpBase,
) {
  const trackWrite = applyWrite(clip.trackId, targetTrack.id, op);
  clip.trackId = trackWrite.value;
  if (trackWrite.changed && currentTrack.id !== targetTrack.id) {
    delete currentTrack.clips[clip.id];
    targetTrack.clips[clip.id] = clip;
  }
  return trackWrite.changed;
}

function applyTimelineOpMutable(document: TimelineDocument, op: TimelineOp) {
  switch (op.type) {
    case "setClipRange": {
      const { clip } = requireClip(document, op.clipId);
      let changed = false;
      if (op.timelineRange) {
        changed =
          setClipProperty(
            clip,
            TIMELINE_CLIP_PROPERTIES.timelineStart,
            op.timelineRange.start,
            op,
          ) || changed;
        changed =
          setClipProperty(
            clip,
            TIMELINE_CLIP_PROPERTIES.timelineDuration,
            op.timelineRange.duration,
            op,
          ) || changed;
      }
      if (op.sourceRange) {
        changed =
          setClipProperty(
            clip,
            TIMELINE_CLIP_PROPERTIES.sourceStart,
            op.sourceRange.start,
            op,
          ) || changed;
        changed =
          setClipProperty(
            clip,
            TIMELINE_CLIP_PROPERTIES.sourceDuration,
            op.sourceRange.duration,
            op,
          ) || changed;
      }
      return changed;
    }
    case "moveClip": {
      const { track, clip } = requireClip(document, op.clipId);
      const targetTrack = requireTrack(document, op.targetTrackId);
      const moved = moveClipBetweenTracks(document, clip, track, targetTrack, op);
      return (
        setClipProperty(
          clip,
          TIMELINE_CLIP_PROPERTIES.timelineStart,
          op.timelineStart,
          op,
        ) || moved
      );
    }
    case "addClip": {
      const targetTrack = requireTrack(document, op.trackId);
      const existing = findClip(document, op.clip.id);
      let clip: TimelineClip;
      let changed = false;

      if (existing) {
        clip = existing.clip;
        changed =
          moveClipBetweenTracks(document, clip, existing.track, targetTrack, op) || changed;
        const mediaWrite = applyWrite(clip.mediaId, op.clip.mediaId, op);
        clip.mediaId = mediaWrite.value;
        changed = mediaWrite.changed || changed;
        const removedWrite = applyWrite(clip.removed, false, op);
        clip.removed = removedWrite.value;
        changed = removedWrite.changed || changed;
      } else {
        clip = {
          id: op.clip.id,
          mediaId: write(op.clip.mediaId, op),
          trackId: write(op.trackId, op),
          removed: write(false, op),
          properties: {},
        };
        targetTrack.clips[clip.id] = clip;
        changed = true;
      }

      const properties: Record<string, TimelinePropertyValue> = {
        ...op.clip.properties,
        [TIMELINE_CLIP_PROPERTIES.timelineStart]: op.clip.timelineRange.start,
        [TIMELINE_CLIP_PROPERTIES.timelineDuration]: op.clip.timelineRange.duration,
        [TIMELINE_CLIP_PROPERTIES.sourceStart]: op.clip.sourceRange.start,
        [TIMELINE_CLIP_PROPERTIES.sourceDuration]: op.clip.sourceRange.duration,
      };
      for (const [property, value] of Object.entries(properties)) {
        changed = setClipProperty(clip, property, value, op) || changed;
      }
      return changed;
    }
    case "removeClip": {
      const found = findClip(document, op.clipId);
      if (!found) return false;
      const result = applyWrite(found.clip.removed, true, op);
      found.clip.removed = result.value;
      return result.changed;
    }
    case "setClipProperty": {
      const { clip } = requireClip(document, op.clipId);
      return setClipProperty(clip, op.property, op.value, op);
    }
    case "addTrack": {
      let track = document.sequence.tracks[op.track.id];
      let changed = false;
      if (!track) {
        track = {
          id: op.track.id,
          removed: write(false, op),
          properties: {},
          clips: {},
        };
        document.sequence.tracks[track.id] = track;
        changed = true;
      } else {
        const removedWrite = applyWrite(track.removed, false, op);
        track.removed = removedWrite.value;
        changed = removedWrite.changed;
      }

      const properties: Record<string, TimelinePropertyValue> = {
        [TIMELINE_TRACK_PROPERTIES.kind]: op.track.kind,
        ...op.track.properties,
      };
      if (op.track.name !== undefined) {
        properties[TIMELINE_TRACK_PROPERTIES.name] = op.track.name;
      }
      if (op.track.position !== undefined) {
        properties[TIMELINE_TRACK_PROPERTIES.position] = op.track.position;
      }
      for (const [property, value] of Object.entries(properties)) {
        const result = applyWrite(track.properties[property], value, op);
        track.properties[property] = result.value;
        changed = result.changed || changed;
      }
      return changed;
    }
    case "removeTrack": {
      let track = document.sequence.tracks[op.trackId];
      if (!track) {
        track = {
          id: op.trackId,
          removed: write(true, op),
          properties: {},
          clips: {},
        };
        document.sequence.tracks[op.trackId] = track;
        return true;
      }
      const result = applyWrite(track.removed, true, op);
      track.removed = result.value;
      return result.changed;
    }
    case "setTrackProperty": {
      const track = requireTrack(document, op.trackId);
      const result = applyWrite(track.properties[op.property], op.value, op);
      track.properties[op.property] = result.value;
      return result.changed;
    }
    case "setSequenceProperty": {
      const result = applyWrite(
        document.sequence.properties[op.property],
        op.value,
        op,
      );
      document.sequence.properties[op.property] = result.value;
      return result.changed;
    }
  }
}

function assertLwwValue(value: unknown, label: string) {
  if (!isPlainObject(value)) throw new Error(`${label} is not an LWW value.`);
  assertFiniteNumber(value.timestamp as number, `${label} timestamp`);
  if (!Number.isSafeInteger(value.timestamp) || (value.timestamp as number) < 0) {
    throw new Error(`${label} timestamp is invalid.`);
  }
  assertId(value.actorId as string, `${label} actor ID`);
  assertId(value.opId as string, `${label} operation ID`);
  return value;
}

function assertStoredPropertyMap(value: unknown, scope: "clip" | "track" | "sequence") {
  if (!isPlainObject(value)) throw new Error(`${scope} properties must be a record.`);
  if (Object.keys(value).length > MAX_PROPERTY_COLLECTION_SIZE) {
    throw new Error(`Too many ${scope} properties.`);
  }
  for (const [property, rawWrite] of Object.entries(value)) {
    assertPropertyName(property);
    const propertyWrite = assertLwwValue(rawWrite, `${scope} property ${property}`);
    assertKnownPropertyValue(
      scope,
      property,
      propertyWrite.value as TimelinePropertyValue,
    );
  }
}

/** Validate untrusted snapshot JSON before replacing a live document with it. */
export function assertTimelineDocument(value: unknown): asserts value is TimelineDocument {
  if (!isPlainObject(value) || value.schemaVersion !== 1) {
    throw new Error("Timeline document schema version is unsupported.");
  }
  if (!isPlainObject(value.sequence)) {
    throw new Error("Timeline document is missing its sequence.");
  }
  assertId(value.sequence.id as string, "Sequence ID");
  assertStoredPropertyMap(value.sequence.properties, "sequence");
  if (!isPlainObject(value.sequence.tracks)) {
    throw new Error("Timeline tracks must be a record.");
  }

  for (const [trackId, rawTrack] of Object.entries(value.sequence.tracks)) {
    assertId(trackId, "Track ID");
    if (!isPlainObject(rawTrack) || rawTrack.id !== trackId) {
      throw new Error(`Track ${trackId} is invalid.`);
    }
    const removed = assertLwwValue(rawTrack.removed, `Track ${trackId} removed`);
    if (typeof removed.value !== "boolean") {
      throw new Error(`Track ${trackId} removed value must be boolean.`);
    }
    assertStoredPropertyMap(rawTrack.properties, "track");
    if (!isPlainObject(rawTrack.clips)) {
      throw new Error(`Track ${trackId} clips must be a record.`);
    }

    for (const [clipId, rawClip] of Object.entries(rawTrack.clips)) {
      assertId(clipId, "Clip ID");
      if (!isPlainObject(rawClip) || rawClip.id !== clipId) {
        throw new Error(`Clip ${clipId} is invalid.`);
      }
      const mediaId = assertLwwValue(rawClip.mediaId, `Clip ${clipId} media ID`);
      assertId(mediaId.value as string, `Clip ${clipId} media ID`);
      const clipTrackId = assertLwwValue(rawClip.trackId, `Clip ${clipId} track ID`);
      assertId(clipTrackId.value as string, `Clip ${clipId} track ID`);
      const clipRemoved = assertLwwValue(rawClip.removed, `Clip ${clipId} removed`);
      if (typeof clipRemoved.value !== "boolean") {
        throw new Error(`Clip ${clipId} removed value must be boolean.`);
      }
      assertStoredPropertyMap(rawClip.properties, "clip");
    }
  }
}

export function parseTimelineDocumentJson(json: string): TimelineDocument {
  const value: unknown = JSON.parse(json);
  assertTimelineDocument(value);
  return value;
}

/** Apply an ordered batch exactly as the Convex mutation does. */
export function applyTimelineOps(
  source: TimelineDocument,
  ops: readonly TimelineOp[],
): ApplyTimelineOpsResult {
  const document = cloneDocument(source);
  const appliedOpIds: string[] = [];

  for (const op of ops) {
    assertValidTimelineOp(op);
    if (applyTimelineOpMutable(document, op)) appliedOpIds.push(op.opId);
  }

  if (appliedOpIds.length === 0) {
    return { document: source, changed: false, appliedOpIds };
  }
  return { document, changed: true, appliedOpIds };
}
