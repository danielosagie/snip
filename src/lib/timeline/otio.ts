import type { GenericId } from "convex/values";
import {
  applyTimelineOps,
  assertTimelinePropertyValue,
  createTimelineDocument,
  isTimelineTime,
} from "./operations";
import {
  TIMELINE_CLIP_PROPERTIES,
  TIMELINE_SEQUENCE_PROPERTIES,
  TIMELINE_TRACK_PROPERTIES,
  type TimelineDocument,
  type TimelineOp,
  type TimelinePropertyValue,
  type TimelineTime,
  type TimelineTrackKind,
} from "./types";

export interface OtioRationalTime {
  OTIO_SCHEMA: "RationalTime.1";
  value: number;
  rate: number;
}

export interface OtioTimeRange {
  OTIO_SCHEMA: "TimeRange.1";
  start_time: OtioRationalTime;
  duration: OtioRationalTime;
}

export interface OtioExternalReference {
  OTIO_SCHEMA: "ExternalReference.1";
  target_url: string;
  available_range?: OtioTimeRange;
  metadata?: Record<string, unknown>;
}

export interface OtioMissingReference {
  OTIO_SCHEMA: "MissingReference.1";
  metadata?: Record<string, unknown>;
}

export interface OtioClip {
  OTIO_SCHEMA: "Clip.2";
  name: string;
  source_range: OtioTimeRange;
  media_reference: OtioExternalReference | OtioMissingReference;
  metadata: Record<string, unknown>;
}

export interface OtioGap {
  OTIO_SCHEMA: "Gap.1";
  name: string;
  source_range: OtioTimeRange;
  metadata: Record<string, unknown>;
}

export interface OtioTrack {
  OTIO_SCHEMA: "Track.1";
  name: string;
  kind: "Video" | "Audio";
  children: Array<OtioClip | OtioGap>;
  metadata: Record<string, unknown>;
}

export interface OtioStack {
  OTIO_SCHEMA: "Stack.1";
  name: string;
  children: OtioTrack[];
  metadata: Record<string, unknown>;
}

export interface OtioTimeline {
  OTIO_SCHEMA: "Timeline.1";
  name: string;
  global_start_time: OtioRationalTime;
  tracks: OtioStack;
  metadata: Record<string, unknown>;
}

export interface OtioImportOptions {
  actorId: string;
  timestamp: number;
  resolveMediaId?: (
    reference: OtioExternalReference | OtioMissingReference,
    clip: OtioClip,
  ) => GenericId<"videos"> | undefined;
}

interface SnipMetadata {
  id?: string;
  timelineStart?: TimelineTime;
  timelineDuration?: TimelineTime;
  properties?: Record<string, TimelinePropertyValue>;
  source?: Record<string, unknown>;
}

const DEFAULT_RATE = 24;

function rationalTime(time: TimelineTime): OtioRationalTime {
  return { OTIO_SCHEMA: "RationalTime.1", value: time.value, rate: time.rate };
}

function timelineTime(value: unknown, fallback: TimelineTime): TimelineTime {
  const resolved = isTimelineTime(value) ? value : fallback;
  return { value: resolved.value, rate: resolved.rate };
}

function timeRange(start: TimelineTime, duration: TimelineTime): OtioTimeRange {
  return {
    OTIO_SCHEMA: "TimeRange.1",
    start_time: rationalTime(start),
    duration: rationalTime(duration),
  };
}

function propertyValue(
  properties: Record<string, { value: TimelinePropertyValue }>,
  key: string,
) {
  return properties[key]?.value;
}

function activeProperties(
  properties: Record<string, { value: TimelinePropertyValue }>,
): Record<string, TimelinePropertyValue> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, property]) => [key, property.value]),
  );
}

function seconds(time: TimelineTime) {
  return time.value / time.rate;
}

function atRate(time: TimelineTime, rate: number): TimelineTime {
  return { value: seconds(time) * rate, rate };
}

function timelineName(document: TimelineDocument) {
  const name = propertyValue(
    document.sequence.properties,
    TIMELINE_SEQUENCE_PROPERTIES.name,
  );
  return typeof name === "string" ? name : "Timeline";
}

function trackKind(trackKindValue: TimelinePropertyValue | undefined) {
  return trackKindValue === "audio" ? ("Audio" as const) : ("Video" as const);
}

function makeGap(start: TimelineTime, duration: TimelineTime): OtioGap {
  return {
    OTIO_SCHEMA: "Gap.1",
    name: "Gap",
    source_range: timeRange(start, duration),
    metadata: {},
  };
}

/** Convert live state into interoperable OTIO JSON without tombstones. */
export function timelineDocumentToOtio(document: TimelineDocument): OtioTimeline {
  const sequenceRate = timelineTime(
    propertyValue(
      document.sequence.properties,
      TIMELINE_SEQUENCE_PROPERTIES.frameRate,
    ),
    { value: DEFAULT_RATE, rate: 1 },
  );
  const frameRate = sequenceRate.value / sequenceRate.rate || DEFAULT_RATE;
  const tracks = Object.values(document.sequence.tracks)
    .filter((track) => !track.removed.value)
    .sort((left, right) => {
      const leftPosition = propertyValue(
        left.properties,
        TIMELINE_TRACK_PROPERTIES.position,
      );
      const rightPosition = propertyValue(
        right.properties,
        TIMELINE_TRACK_PROPERTIES.position,
      );
      return (
        (typeof leftPosition === "number" ? leftPosition : 0) -
        (typeof rightPosition === "number" ? rightPosition : 0)
      );
    })
    .map((track): OtioTrack => {
      const nameValue = propertyValue(track.properties, TIMELINE_TRACK_PROPERTIES.name);
      const clips = Object.values(track.clips)
        .filter((clip) => !clip.removed.value && clip.trackId.value === track.id)
        .sort((left, right) => {
          const leftStart = timelineTime(
            propertyValue(left.properties, TIMELINE_CLIP_PROPERTIES.timelineStart),
            { value: 0, rate: frameRate },
          );
          const rightStart = timelineTime(
            propertyValue(right.properties, TIMELINE_CLIP_PROPERTIES.timelineStart),
            { value: 0, rate: frameRate },
          );
          return seconds(leftStart) - seconds(rightStart) || left.id.localeCompare(right.id);
        });
      const children: Array<OtioClip | OtioGap> = [];
      let cursorSeconds = 0;

      for (const clip of clips) {
        const timelineStart = timelineTime(
          propertyValue(clip.properties, TIMELINE_CLIP_PROPERTIES.timelineStart),
          { value: cursorSeconds * frameRate, rate: frameRate },
        );
        const timelineDuration = timelineTime(
          propertyValue(clip.properties, TIMELINE_CLIP_PROPERTIES.timelineDuration),
          { value: 0, rate: frameRate },
        );
        const sourceStart = timelineTime(
          propertyValue(clip.properties, TIMELINE_CLIP_PROPERTIES.sourceStart),
          { value: 0, rate: timelineDuration.rate },
        );
        const sourceDuration = timelineTime(
          propertyValue(clip.properties, TIMELINE_CLIP_PROPERTIES.sourceDuration),
          timelineDuration,
        );
        const clipStartSeconds = seconds(timelineStart);
        if (clipStartSeconds > cursorSeconds) {
          children.push(
            makeGap(
              { value: 0, rate: frameRate },
              { value: (clipStartSeconds - cursorSeconds) * frameRate, rate: frameRate },
            ),
          );
        }
        const name = propertyValue(clip.properties, TIMELINE_CLIP_PROPERTIES.name);
        children.push({
          OTIO_SCHEMA: "Clip.2",
          name: typeof name === "string" ? name : clip.id,
          source_range: timeRange(sourceStart, sourceDuration),
          media_reference: {
            OTIO_SCHEMA: "ExternalReference.1",
            target_url: `snip://videos/${clip.mediaId.value}`,
            available_range: timeRange(sourceStart, sourceDuration),
            metadata: { snip: { videoId: clip.mediaId.value } },
          },
          metadata: {
            snip: {
              id: clip.id,
              timelineStart,
              timelineDuration,
              properties: activeProperties(clip.properties),
            } satisfies SnipMetadata,
          },
        });
        cursorSeconds = Math.max(
          cursorSeconds,
          clipStartSeconds + seconds(timelineDuration),
        );
      }

      return {
        OTIO_SCHEMA: "Track.1",
        name: typeof nameValue === "string" ? nameValue : track.id,
        kind: trackKind(
          propertyValue(track.properties, TIMELINE_TRACK_PROPERTIES.kind),
        ),
        children,
        metadata: {
          snip: {
            id: track.id,
            properties: activeProperties(track.properties),
          } satisfies SnipMetadata,
        },
      };
    });

  return {
    OTIO_SCHEMA: "Timeline.1",
    name: timelineName(document),
    global_start_time: rationalTime({ value: 0, rate: frameRate }),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "Tracks",
      children: tracks,
      metadata: {},
    },
    metadata: {
      snip: {
        id: document.sequence.id,
        properties: activeProperties(document.sequence.properties),
      } satisfies SnipMetadata,
    },
  };
}

function readSnipMetadata(value: unknown): SnipMetadata {
  if (!value || typeof value !== "object") return {};
  const snip = (value as Record<string, unknown>).snip;
  return snip && typeof snip === "object" ? (snip as SnipMetadata) : {};
}

function stableId(prefix: string, input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function mediaIdFromReference(reference: OtioExternalReference | OtioMissingReference) {
  if (reference.OTIO_SCHEMA !== "ExternalReference.1") return undefined;
  const match = /^snip:\/\/videos\/([^/?#]+)$/.exec(reference.target_url);
  return match?.[1] as GenericId<"videos"> | undefined;
}

function importPropertyMap(value: unknown): Record<string, TimelinePropertyValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, TimelinePropertyValue> = {};
  for (const [property, propertyValue] of Object.entries(value)) {
    assertTimelinePropertyValue(propertyValue as TimelinePropertyValue);
    result[property] = propertyValue as TimelinePropertyValue;
  }
  return result;
}

/** Build a fresh LWW document from OTIO, resolving every clip to a videos row. */
export function otioToTimelineDocument(
  timeline: OtioTimeline,
  options: OtioImportOptions,
): TimelineDocument {
  if (timeline.OTIO_SCHEMA !== "Timeline.1" || timeline.tracks?.OTIO_SCHEMA !== "Stack.1") {
    throw new Error("Input is not an OTIO Timeline.1 document.");
  }
  const timelineMetadata = readSnipMetadata(timeline.metadata);
  const sequenceId =
    timelineMetadata.id ?? stableId("sequence", `${timeline.name}:${timeline.tracks.children.length}`);
  const sequenceProperties = importPropertyMap(timelineMetadata.properties);
  sequenceProperties[TIMELINE_SEQUENCE_PROPERTIES.name] = timeline.name;
  if (!sequenceProperties[TIMELINE_SEQUENCE_PROPERTIES.frameRate]) {
    sequenceProperties[TIMELINE_SEQUENCE_PROPERTIES.frameRate] = {
      value: timeline.global_start_time?.rate || DEFAULT_RATE,
      rate: 1,
    };
  }
  let document = createTimelineDocument({
    sequenceId,
    actorId: options.actorId,
    timestamp: options.timestamp,
    properties: sequenceProperties,
  });
  const ops: TimelineOp[] = [];

  timeline.tracks.children.forEach((track, trackIndex) => {
    const trackMetadata = readSnipMetadata(track.metadata);
    const id = trackMetadata.id ?? stableId("track", `${sequenceId}:${trackIndex}:${track.name}`);
    const properties = importPropertyMap(trackMetadata.properties);
    const kind: TimelineTrackKind = track.kind === "Audio" ? "audio" : "video";
    ops.push({
      type: "addTrack",
      opId: `import:track:${id}`,
      actorId: options.actorId,
      timestamp: options.timestamp,
      track: { id, kind, name: track.name, position: trackIndex, properties },
    });

    let cursorSeconds = 0;
    track.children.forEach((child, childIndex) => {
      const duration = timelineTime(child.source_range?.duration, {
        value: 0,
        rate: DEFAULT_RATE,
      });
      if (child.OTIO_SCHEMA === "Gap.1") {
        cursorSeconds += seconds(duration);
        return;
      }

      const clipMetadata = readSnipMetadata(child.metadata);
      const clipId =
        clipMetadata.id ?? stableId("clip", `${id}:${childIndex}:${child.name}`);
      const mediaId =
        options.resolveMediaId?.(child.media_reference, child) ??
        mediaIdFromReference(child.media_reference);
      if (!mediaId) {
        throw new Error(`No videos row could be resolved for clip ${child.name || clipId}.`);
      }
      const sourceStart = timelineTime(child.source_range?.start_time, {
        value: 0,
        rate: duration.rate,
      });
      const timelineStart = timelineTime(clipMetadata.timelineStart, {
        value: cursorSeconds * duration.rate,
        rate: duration.rate,
      });
      const timelineDuration = timelineTime(clipMetadata.timelineDuration, duration);
      const properties = importPropertyMap(clipMetadata.properties);
      properties[TIMELINE_CLIP_PROPERTIES.name] = child.name;
      ops.push({
        type: "addClip",
        opId: `import:clip:${clipId}`,
        actorId: options.actorId,
        timestamp: options.timestamp,
        trackId: id,
        clip: {
          id: clipId,
          mediaId,
          timelineRange: { start: timelineStart, duration: timelineDuration },
          sourceRange: { start: sourceStart, duration },
          properties,
        },
      });
      cursorSeconds = Math.max(
        cursorSeconds,
        seconds(timelineStart) + seconds(timelineDuration),
      );
    });
  });

  document = applyTimelineOps(document, ops).document;
  return document;
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function xmlAttributes(source: string) {
  const attributes: Record<string, string> = {};
  const expression = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(expression)) {
    attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function parseFcpxTime(value: string | undefined, fallbackRate = DEFAULT_RATE): TimelineTime {
  if (!value) return { value: 0, rate: fallbackRate };
  const match = /^(-?(?:\d+(?:\.\d+)?))(?:\/((?:\d+(?:\.\d+)?)))?s$/.exec(
    value.trim(),
  );
  if (!match) throw new Error(`Invalid FCPXML time value: ${value}`);
  const numerator = Number(match[1]);
  const denominator = match[2] ? Number(match[2]) : 1;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    throw new Error(`Invalid FCPXML time value: ${value}`);
  }
  return { value: numerator, rate: denominator };
}

function basename(value: string) {
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const pieces = withoutQuery.split(/[\\/]/);
  const result = pieces.at(-1) ?? value;
  try {
    return decodeURIComponent(result);
  } catch {
    return result;
  }
}

interface FcpxAsset {
  id: string;
  name: string;
  src?: string;
  start: TimelineTime;
  duration: TimelineTime;
}

/** Import Final Cut Pro XML as ordinary OTIO tracks and external references. */
export function fcpxmlToOtio(xml: string): OtioTimeline {
  if (!/<fcpxml\b/i.test(xml)) throw new Error("Input is not an FCPXML document.");

  const assets = new Map<string, FcpxAsset>();
  for (const match of xml.matchAll(/<asset\b(?!-)([^>]*)\/?\s*>/gi)) {
    const attributes = xmlAttributes(match[1]);
    if (!attributes.id) continue;
    assets.set(attributes.id, {
      id: attributes.id,
      name: attributes.name ?? basename(attributes.src ?? attributes.id),
      src: attributes.src,
      start: parseFcpxTime(attributes.start),
      duration: parseFcpxTime(attributes.duration),
    });
  }

  const formats = new Map<string, Record<string, string>>();
  for (const match of xml.matchAll(/<format\b([^>]*)\/?\s*>/gi)) {
    const attributes = xmlAttributes(match[1]);
    if (attributes.id) formats.set(attributes.id, attributes);
  }

  const sequenceMatch = /<sequence\b([^>]*)>([\s\S]*?)<\/sequence>/i.exec(xml);
  if (!sequenceMatch) throw new Error("FCPXML does not contain a sequence.");
  const sequenceAttributes = xmlAttributes(sequenceMatch[1]);
  const sequenceBody = sequenceMatch[2];
  const spineMatch = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(sequenceBody);
  if (!spineMatch) throw new Error("FCPXML sequence does not contain a spine.");

  const format = formats.get(sequenceAttributes.format ?? "");
  const frameDuration = parseFcpxTime(format?.frameDuration);
  const frameRate = frameDuration.value > 0 ? frameDuration.rate / frameDuration.value : DEFAULT_RATE;
  const sequenceStart = parseFcpxTime(sequenceAttributes.tcStart, frameRate);
  const eventMatch = /<event\b([^>]*)>/i.exec(xml);
  const projectMatch = /<project\b([^>]*)>/i.exec(xml);
  const sequenceName =
    xmlAttributes(projectMatch?.[1] ?? "").name ??
    xmlAttributes(eventMatch?.[1] ?? "").name ??
    "Imported timeline";

  const trackMap = new Map<string, OtioTrack>();
  const trackCursorSeconds = new Map<string, number>();
  const clipExpression = /<(asset-clip|ref-clip|video|audio)\b([^>]*)>/gi;
  let clipIndex = 0;
  for (const match of spineMatch[1].matchAll(clipExpression)) {
    const tag = match[1].toLowerCase();
    const attributes = xmlAttributes(match[2]);
    if (!attributes.ref || !attributes.duration) continue;
    const asset = assets.get(attributes.ref);
    const kind = tag === "audio" ? "Audio" : "Video";
    const lane = attributes.lane ?? "0";
    const trackKey = `${kind}:${lane}`;
    let track = trackMap.get(trackKey);
    if (!track) {
      track = {
        OTIO_SCHEMA: "Track.1",
        name: lane === "0" ? kind : `${kind} ${lane}`,
        kind,
        children: [],
        metadata: {
          snip: {
            id: stableId("track", `${sequenceName}:${trackKey}`),
            properties: {
              [TIMELINE_TRACK_PROPERTIES.kind]: kind === "Audio" ? "audio" : "video",
              fcpxmlLane: lane,
            },
          } satisfies SnipMetadata,
        },
      };
      trackMap.set(trackKey, track);
    }

    const duration = atRate(parseFcpxTime(attributes.duration, frameRate), frameRate);
    const impliedOffsetSeconds =
      seconds(sequenceStart) + (trackCursorSeconds.get(trackKey) ?? 0);
    const offset = attributes.offset
      ? parseFcpxTime(attributes.offset, frameRate)
      : { value: impliedOffsetSeconds * frameRate, rate: frameRate };
    const start = parseFcpxTime(attributes.start, asset?.start.rate ?? frameRate);
    const timelineStartSeconds = seconds(offset) - seconds(sequenceStart);
    const timelineStart: TimelineTime = {
      value: Math.max(0, timelineStartSeconds) * frameRate,
      rate: frameRate,
    };
    const sourceStart: TimelineTime = {
      value: Math.max(0, seconds(start) - seconds(asset?.start ?? { value: 0, rate: 1 })) * frameRate,
      rate: frameRate,
    };
    const sourceUrl = asset?.src ?? `fcpxml://resource/${attributes.ref}`;
    const name = attributes.name ?? asset?.name ?? attributes.ref;
    const clipId = stableId(
      "clip",
      `${attributes.ref}:${attributes.offset ?? clipIndex}:${attributes.start ?? "0s"}:${duration.value}`,
    );
    clipIndex += 1;
    track.children.push({
      OTIO_SCHEMA: "Clip.2",
      name,
      source_range: timeRange(sourceStart, duration),
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: sourceUrl,
        available_range: asset
          ? timeRange(
              { value: 0, rate: frameRate },
              atRate(asset.duration, frameRate),
            )
          : undefined,
        metadata: {
          fcpxml: { assetId: attributes.ref, assetName: asset?.name, sourceUrl },
        },
      },
      metadata: {
        snip: {
          id: clipId,
          timelineStart,
          timelineDuration: duration,
          properties: {
            [TIMELINE_CLIP_PROPERTIES.name]: name,
            fcpxmlLane: lane,
          },
          source: { fcpxmlAssetId: attributes.ref },
        } satisfies SnipMetadata,
      },
    });
    trackCursorSeconds.set(
      trackKey,
      Math.max(
        trackCursorSeconds.get(trackKey) ?? 0,
        seconds(timelineStart) + seconds(duration),
      ),
    );
  }

  for (const track of trackMap.values()) {
    const clips = track.children
      .filter((child): child is OtioClip => child.OTIO_SCHEMA === "Clip.2")
      .sort((left, right) => {
        const leftStart = timelineTime(
          readSnipMetadata(left.metadata).timelineStart,
          { value: 0, rate: frameRate },
        );
        const rightStart = timelineTime(
          readSnipMetadata(right.metadata).timelineStart,
          { value: 0, rate: frameRate },
        );
        return seconds(leftStart) - seconds(rightStart);
      });
    const children: Array<OtioClip | OtioGap> = [];
    let cursorSeconds = 0;
    for (const clip of clips) {
      const metadata = readSnipMetadata(clip.metadata);
      const start = timelineTime(metadata.timelineStart, {
        value: cursorSeconds * frameRate,
        rate: frameRate,
      });
      const duration = timelineTime(metadata.timelineDuration, clip.source_range.duration);
      const startSeconds = seconds(start);
      if (startSeconds > cursorSeconds) {
        children.push(
          makeGap(
            { value: 0, rate: frameRate },
            { value: (startSeconds - cursorSeconds) * frameRate, rate: frameRate },
          ),
        );
      }
      children.push(clip);
      cursorSeconds = Math.max(cursorSeconds, startSeconds + seconds(duration));
    }
    track.children = children;
  }

  if (clipIndex === 0) {
    throw new Error("FCPXML sequence does not contain supported clips.");
  }

  const sequenceProperties: Record<string, TimelinePropertyValue> = {
    [TIMELINE_SEQUENCE_PROPERTIES.name]: sequenceName,
    [TIMELINE_SEQUENCE_PROPERTIES.frameRate]: { value: frameRate, rate: 1 },
  };
  if (format?.width) sequenceProperties[TIMELINE_SEQUENCE_PROPERTIES.width] = Number(format.width);
  if (format?.height) sequenceProperties[TIMELINE_SEQUENCE_PROPERTIES.height] = Number(format.height);

  return {
    OTIO_SCHEMA: "Timeline.1",
    name: sequenceName,
    global_start_time: rationalTime(atRate(sequenceStart, frameRate)),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "Tracks",
      children: Array.from(trackMap.values()),
      metadata: {},
    },
    metadata: {
      snip: {
        id: stableId("sequence", sequenceName),
        properties: sequenceProperties,
        source: { format: "fcpxml" },
      } satisfies SnipMetadata,
    },
  };
}

export function fcpxmlToTimelineDocument(xml: string, options: OtioImportOptions) {
  return otioToTimelineDocument(fcpxmlToOtio(xml), options);
}
