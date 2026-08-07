"use strict";

const zlib = require("node:zlib");
const { XMLParser } = require("fast-xml-parser");

const INTERMEDIATE_SCHEMA = "snip.project-intermediate";
const INTERMEDIATE_VERSION = 1;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * Neutral wave 1 shape. Times use OTIO-compatible RationalTime values so the
 * wave 2 conversion is a field mapping instead of a seconds round-trip.
 *
 * @typedef {{ value: number, rate: number }} RationalTime
 * @typedef {{
 *   id: string,
 *   name: string,
 *   mediaRefId: string | null,
 *   timelineIn: RationalTime | null,
 *   timelineOut: RationalTime | null,
 *   sourceIn: RationalTime | null,
 *   sourceOut: RationalTime | null,
 *   enabled: boolean,
 *   metadata: Record<string, unknown>,
 * }} IntermediateClip
 * @typedef {{
 *   id: string,
 *   name: string,
 *   kind: 'video' | 'audio' | 'gap' | 'unknown',
 *   index: number,
 *   clips: IntermediateClip[],
 * }} IntermediateTrack
 * @typedef {{
 *   id: string,
 *   name: string,
 *   rate: number | null,
 *   duration: RationalTime | null,
 *   tracks: IntermediateTrack[],
 * }} IntermediateSequence
 */

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function findRecursive(node, tagName, accumulator = []) {
  if (!node || typeof node !== "object") return accumulator;
  for (const [key, value] of Object.entries(node)) {
    if (key === tagName) accumulator.push(...asArray(value));
    if (value && typeof value === "object") {
      findRecursive(value, tagName, accumulator);
    }
  }
  return accumulator;
}

function scalar(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object") {
    const text = value["#text"];
    if (typeof text === "string" || typeof text === "number") return text;
  }
  return null;
}

function firstScalar(node, keys) {
  if (!node || typeof node !== "object") return null;
  for (const key of keys) {
    const value = scalar(node[key]);
    if (value !== null && String(value).length > 0) return value;
  }
  return null;
}

function finiteNumber(value) {
  const raw = scalar(value);
  if (raw === null || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A RationalTime intentionally mirrors OTIO's value/rate representation.
 * `value / rate` is seconds, so wave 2 can map these fields without converting
 * through floating point seconds first.
 */
function rationalTime(value, rate) {
  if (!Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return null;
  return { value, rate };
}

function parseFcpTime(value) {
  const rawValue = scalar(value);
  if (rawValue === null) return null;
  const raw = String(rawValue).trim();
  const fraction = raw.match(/^(-?\d+)\/(\d+)s$/);
  if (fraction) return rationalTime(Number(fraction[1]), Number(fraction[2]));
  const seconds = raw.match(/^(-?(?:\d+\.?\d*|\.\d+))s$/);
  if (seconds) return rationalTime(Number(seconds[1]), 1);
  const number = Number(raw);
  return Number.isFinite(number) ? rationalTime(number, 1) : null;
}

function parsePremiereTime(value, rate) {
  const number = finiteNumber(value);
  return number === null ? null : rationalTime(number, rate);
}

function addTime(left, right) {
  if (!left || !right) return null;
  if (left.rate === right.rate) {
    return rationalTime(left.value + right.value, left.rate);
  }
  return rationalTime(
    left.value * right.rate + right.value * left.rate,
    left.rate * right.rate,
  );
}

function cleanMediaTarget(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("file://")) return decodeURIComponent(new URL(raw).pathname);
  } catch {
    // Keep the original target when an NLE emitted a malformed URL.
  }
  return raw;
}

function uniqueId(prefix, preferred, index) {
  const raw = preferred === null || preferred === undefined ? "" : String(preferred).trim();
  return raw ? `${prefix}:${raw}` : `${prefix}:${index + 1}`;
}

function makeDocument(sourceFormat, projectName) {
  return {
    schema: INTERMEDIATE_SCHEMA,
    version: INTERMEDIATE_VERSION,
    sourceFormat,
    projectName: projectName || null,
    sequences: [],
    mediaReferences: [],
    warnings: [],
  };
}

function mediaReferenceFor(document, byTarget, { id, name, targetUrl }) {
  const target = cleanMediaTarget(targetUrl);
  const key = target || (id ? `id:${id}` : `name:${name || "unknown"}`);
  const existing = byTarget.get(key);
  if (existing) return existing.id;
  const ref = {
    id: id ? `media:${id}` : `media:${document.mediaReferences.length + 1}`,
    name: name || null,
    targetUrl: target,
  };
  document.mediaReferences.push(ref);
  byTarget.set(key, ref);
  return ref.id;
}

function inflatePrproj(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return zlib.gunzipSync(buffer).toString("utf8");
  }
  return buffer.toString("utf8");
}

function collectPremiereTracks(sequence, sectionName, kind) {
  const section = sequence?.[sectionName] ?? sequence?.[sectionName.toLowerCase()];
  if (!section || typeof section !== "object") return [];
  const direct = asArray(section.Track ?? section.track);
  return direct.length > 0
    ? direct.map((track) => ({ track, kind }))
    : findRecursive(section, "Track").map((track) => ({ track, kind }));
}

function collectPremiereClipNodes(track) {
  const tags = [
    "TrackItem",
    "VideoClipTrackItem",
    "AudioClipTrackItem",
    "ClipProjectItem",
    "MasterClip",
    "clipitem",
  ];
  const clips = [];
  const seen = new Set();
  for (const tag of tags) {
    for (const clip of findRecursive(track, tag)) {
      if (!clip || typeof clip !== "object" || seen.has(clip)) continue;
      seen.add(clip);
      clips.push({ clip, tag });
    }
  }
  return clips;
}

function parsePrprojBuffer(input) {
  const xmlText = inflatePrproj(input);
  const parsed = xmlParser.parse(xmlText);
  const root = parsed.PremiereData ?? parsed.xmeml ?? parsed;
  const sequenceNodes = findRecursive(root, "Sequence");
  if (sequenceNodes.length === 0) {
    sequenceNodes.push(...findRecursive(root, "sequence"));
  }
  if (sequenceNodes.length === 0) {
    throw new Error("Premiere project contains no sequence.");
  }

  const document = makeDocument(
    "prproj",
    firstScalar(root, ["Name", "ProjectName", "@_Name"]),
  );
  const mediaByTarget = new Map();

  sequenceNodes.forEach((sequence, sequenceIndex) => {
    const timebase =
      finiteNumber(sequence.Timebase ?? sequence.timebase ?? sequence["@_Timebase"]) || 1;
    const sequenceId = uniqueId(
      "sequence",
      firstScalar(sequence, ["@_ObjectID", "@_id", "ID", "id"]),
      sequenceIndex,
    );
    const parsedSequence = {
      id: sequenceId,
      name:
        firstScalar(sequence, ["Name", "name", "@_Name", "@_name"]) ||
        `Sequence ${sequenceIndex + 1}`,
      rate: timebase,
      duration: parsePremiereTime(
        sequence.Duration ?? sequence.duration ?? sequence["@_Duration"],
        timebase,
      ),
      tracks: [],
    };

    let tracks = [
      ...collectPremiereTracks(sequence, "Video", "video"),
      ...collectPremiereTracks(sequence, "Audio", "audio"),
    ];
    if (tracks.length === 0) {
      tracks = findRecursive(sequence, "Track").map((track) => ({
        track,
        kind: "unknown",
      }));
    }

    tracks.forEach(({ track, kind }, trackIndex) => {
      const parsedTrack = {
        id: uniqueId(
          `${sequenceId}:track`,
          firstScalar(track, ["@_ObjectID", "@_id", "ID", "id"]),
          parsedSequence.tracks.length,
        ),
        name:
          firstScalar(track, ["Name", "name", "@_Name", "@_name"]) ||
          `${kind === "unknown" ? "Track" : kind} ${trackIndex + 1}`,
        kind,
        index:
          finiteNumber(track.Index ?? track.TrackIndex ?? track["@_Index"] ?? track["@_index"]) ??
          trackIndex,
        clips: [],
      };

      collectPremiereClipNodes(track).forEach(({ clip, tag }, clipIndex) => {
        const clipName = firstScalar(clip, [
          "Name",
          "name",
          "MediaName",
          "@_Name",
          "@_name",
        ]);
        const target = firstScalar(clip, [
          "MediaPath",
          "Path",
          "FilePath",
          "pathurl",
          "@_MediaPath",
          "@_path",
        ]);
        const mediaId = firstScalar(clip, [
          "MediaRef",
          "MasterClipID",
          "masterclipid",
          "@_MediaRef",
          "@_ref",
        ]);
        const mediaRefId = mediaReferenceFor(document, mediaByTarget, {
          id: mediaId,
          name: clipName,
          targetUrl: target,
        });
        const timelineIn = parsePremiereTime(
          clip.Start ?? clip.StartTime ?? clip.start ?? clip["@_Start"],
          timebase,
        );
        const timelineOut = parsePremiereTime(
          clip.End ?? clip.EndTime ?? clip.end ?? clip["@_End"],
          timebase,
        );
        const sourceIn = parsePremiereTime(
          clip.In ?? clip.InPoint ?? clip.in ?? clip["@_In"],
          timebase,
        );
        let sourceOut = parsePremiereTime(
          clip.Out ?? clip.OutPoint ?? clip.out ?? clip["@_Out"],
          timebase,
        );
        if (!sourceOut && sourceIn && timelineIn && timelineOut) {
          sourceOut = rationalTime(
            sourceIn.value + timelineOut.value - timelineIn.value,
            timebase,
          );
        }
        parsedTrack.clips.push({
          id: uniqueId(
            `${parsedTrack.id}:clip`,
            firstScalar(clip, ["@_ObjectID", "@_id", "ID", "id"]),
            clipIndex,
          ),
          name: clipName || `Clip ${clipIndex + 1}`,
          mediaRefId,
          timelineIn,
          timelineOut,
          sourceIn,
          sourceOut,
          enabled: firstScalar(clip, ["Enabled", "enabled", "@_Enabled"]) !== "false",
          metadata: { sourceTag: tag },
        });
      });
      parsedSequence.tracks.push(parsedTrack);
    });

    document.sequences.push(parsedSequence);
  });

  if (document.mediaReferences.every((ref) => !ref.targetUrl)) {
    document.warnings.push("Premiere media paths were not embedded in this project file.");
  }
  return document;
}

function inferFcpKind(asset) {
  const hasVideo = String(asset?.["@_hasVideo"] ?? "1") !== "0";
  const hasAudio = String(asset?.["@_hasAudio"] ?? "0") !== "0";
  if (hasVideo) return "video";
  if (hasAudio) return "audio";
  return "unknown";
}

function collectFcpClips(node, accumulator = []) {
  if (!node || typeof node !== "object") return accumulator;
  const clipTags = new Set(["asset-clip", "clip", "ref-clip", "sync-clip", "mc-clip", "gap"]);
  for (const [key, value] of Object.entries(node)) {
    if (clipTags.has(key)) {
      for (const clip of asArray(value)) accumulator.push({ clip, tag: key });
    }
    if (value && typeof value === "object") collectFcpClips(value, accumulator);
  }
  return accumulator;
}

function parseFcpxmlText(xmlText) {
  const parsed = xmlParser.parse(String(xmlText));
  const root = parsed.fcpxml;
  if (!root) throw new Error("FCPXML document is missing the fcpxml root element.");

  const projectNode = findRecursive(root, "project")[0];
  const document = makeDocument("fcpxml", projectNode?.["@_name"] ?? null);
  const assets = new Map();
  for (const asset of findRecursive(root.resources ?? root, "asset")) {
    const id = asset["@_id"];
    if (!id) continue;
    assets.set(String(id), asset);
  }
  const formats = new Map();
  for (const format of findRecursive(root.resources ?? root, "format")) {
    if (format["@_id"]) formats.set(String(format["@_id"]), format);
  }

  const mediaByTarget = new Map();
  for (const [id, asset] of assets) {
    mediaReferenceFor(document, mediaByTarget, {
      id,
      name: asset["@_name"] ?? null,
      targetUrl: asset["@_src"] ?? asset["@_source"] ?? null,
    });
  }

  const sequenceNodes = findRecursive(root, "sequence");
  if (sequenceNodes.length === 0) throw new Error("FCPXML document contains no sequence.");

  sequenceNodes.forEach((sequence, sequenceIndex) => {
    const sequenceId = uniqueId("sequence", sequence["@_id"], sequenceIndex);
    const format = formats.get(String(sequence["@_format"] ?? ""));
    const frameDuration = parseFcpTime(format?.["@_frameDuration"]);
    const parsedSequence = {
      id: sequenceId,
      name:
        sequence["@_name"] ??
        projectNode?.["@_name"] ??
        `Sequence ${sequenceIndex + 1}`,
      rate:
        frameDuration && frameDuration.value !== 0
          ? frameDuration.rate / frameDuration.value
          : null,
      duration: parseFcpTime(sequence["@_duration"]),
      tracks: [],
    };
    const tracks = new Map();
    const spine = sequence.spine ?? sequence;
    collectFcpClips(spine).forEach(({ clip, tag }, clipIndex) => {
      const assetId = clip["@_ref"] ? String(clip["@_ref"]) : null;
      const asset = assetId ? assets.get(assetId) : null;
      const kind = tag === "gap" ? "gap" : inferFcpKind(asset);
      const lane = finiteNumber(clip["@_lane"]) ?? 0;
      const trackKey = `${kind}:${lane}`;
      let track = tracks.get(trackKey);
      if (!track) {
        track = {
          id: `${sequenceId}:track:${kind}:${lane}`,
          name: lane === 0 ? `${kind} primary` : `${kind} lane ${lane}`,
          kind,
          index: lane,
          clips: [],
        };
        tracks.set(trackKey, track);
      }
      const mediaRefId =
        tag === "gap"
          ? null
          : mediaReferenceFor(document, mediaByTarget, {
              id: assetId,
              name: clip["@_name"] ?? asset?.["@_name"] ?? null,
              targetUrl: asset?.["@_src"] ?? null,
            });
      const timelineIn = parseFcpTime(clip["@_offset"] ?? "0s");
      const duration = parseFcpTime(clip["@_duration"]);
      const sourceIn = parseFcpTime(clip["@_start"] ?? asset?.["@_start"] ?? "0s");
      track.clips.push({
        id: uniqueId(`${sequenceId}:clip`, clip["@_id"], clipIndex),
        name: clip["@_name"] ?? asset?.["@_name"] ?? `Clip ${clipIndex + 1}`,
        mediaRefId,
        timelineIn,
        timelineOut: addTime(timelineIn, duration),
        sourceIn,
        sourceOut: addTime(sourceIn, duration),
        enabled: String(clip["@_enabled"] ?? "1") !== "0",
        metadata: {
          sourceTag: tag,
          lane,
          audioRole: clip["@_audioRole"] ?? null,
        },
      });
    });
    parsedSequence.tracks = [...tracks.values()].sort((a, b) => a.index - b.index);
    document.sequences.push(parsedSequence);
  });
  return document;
}

function parseProjectBuffer(input, extension) {
  const ext = String(extension || "").toLowerCase().replace(/^\./, "");
  if (ext === "prproj") return parsePrprojBuffer(input);
  if (ext === "fcpxml") {
    return parseFcpxmlText(Buffer.isBuffer(input) ? input.toString("utf8") : String(input));
  }
  throw new Error(`No timeline parser is available for .${ext || "unknown"}.`);
}

function parseProjectBufferSoft(input, extension) {
  try {
    return { status: "parsed", timeline: parseProjectBuffer(input, extension) };
  } catch (error) {
    return {
      status: "saved_timeline_not_parsed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  INTERMEDIATE_SCHEMA,
  INTERMEDIATE_VERSION,
  addTime,
  inflatePrproj,
  parseFcpTime,
  parseFcpxmlText,
  parsePrprojBuffer,
  parseProjectBuffer,
  parseProjectBufferSoft,
};
