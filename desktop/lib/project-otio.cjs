"use strict";

const DEFAULT_RATE = 24;

function seconds(time) {
  return time && Number.isFinite(time.value) && Number.isFinite(time.rate) && time.rate > 0
    ? time.value / time.rate
    : 0;
}

function rationalTime(time, fallbackRate = DEFAULT_RATE) {
  const rate = time && Number.isFinite(time.rate) && time.rate > 0
    ? time.rate
    : fallbackRate;
  const value = time && Number.isFinite(time.value) ? time.value : 0;
  return { OTIO_SCHEMA: "RationalTime.1", value, rate };
}

function durationBetween(start, end, fallbackRate) {
  if (!start || !end) return { value: 0, rate: fallbackRate };
  const rate = start.rate > 0 ? start.rate : fallbackRate;
  if (start.rate === end.rate) {
    return { value: Math.max(0, end.value - start.value), rate };
  }
  return {
    value: Math.max(0, (end.value * rate) / end.rate - start.value),
    rate,
  };
}

function timeRange(start, duration, fallbackRate) {
  return {
    OTIO_SCHEMA: "TimeRange.1",
    start_time: rationalTime(start, fallbackRate),
    duration: rationalTime(duration, fallbackRate),
  };
}

function makeGap(duration, rate) {
  return {
    OTIO_SCHEMA: "Gap.1",
    name: "Gap",
    source_range: timeRange({ value: 0, rate }, duration, rate),
    metadata: {},
  };
}

function clipDuration(clip, rate) {
  const timelineDuration = durationBetween(clip.timelineIn, clip.timelineOut, rate);
  if (timelineDuration.value > 0) return timelineDuration;
  return durationBetween(clip.sourceIn, clip.sourceOut, rate);
}

function mediaReference(media, clip, sourceDuration, rate) {
  if (!media?.targetUrl) {
    return {
      OTIO_SCHEMA: "MissingReference.1",
      metadata: {
        snip: {
          mediaRefId: clip.mediaRefId,
          mediaName: media?.name ?? null,
        },
      },
    };
  }
  const sourceStart = clip.sourceIn ?? { value: 0, rate };
  return {
    OTIO_SCHEMA: "ExternalReference.1",
    target_url: media.targetUrl,
    available_range: timeRange(sourceStart, sourceDuration, rate),
    metadata: {
      snip: {
        mediaRefId: clip.mediaRefId,
        mediaName: media.name ?? null,
      },
    },
  };
}

function sequenceFor(document, sequenceId) {
  if (!document || document.schema !== "snip.project-intermediate") {
    throw new Error("Input is not a snip project intermediate document.");
  }
  const sequences = Array.isArray(document.sequences) ? document.sequences : [];
  const sequence = sequenceId
    ? sequences.find((candidate) => candidate.id === sequenceId)
    : sequences[0];
  if (!sequence) throw new Error("Project does not contain a timeline sequence.");
  return sequence;
}

/**
 * Map the desktop parser's neutral shape to OTIO Timeline.1. This stays local
 * to desktop because the Electron main process is CommonJS and must not import
 * the web timeline package across the desktop boundary.
 */
function intermediateToOtio(document, options = {}) {
  const sequence = sequenceFor(document, options.sequenceId);
  const rate = Number.isFinite(sequence.rate) && sequence.rate > 0
    ? sequence.rate
    : DEFAULT_RATE;
  const mediaById = new Map(
    (Array.isArray(document.mediaReferences) ? document.mediaReferences : []).map(
      (reference) => [reference.id, reference],
    ),
  );
  const tracks = (Array.isArray(sequence.tracks) ? sequence.tracks : [])
    .slice()
    .sort((left, right) => left.index - right.index)
    .map((track) => {
      const clips = (Array.isArray(track.clips) ? track.clips : [])
        .slice()
        .sort(
          (left, right) =>
            seconds(left.timelineIn) - seconds(right.timelineIn) ||
            left.id.localeCompare(right.id),
        );
      const children = [];
      let cursorSeconds = 0;

      for (const clip of clips) {
        const timelineStart = clip.timelineIn ?? {
          value: cursorSeconds * rate,
          rate,
        };
        const duration = clipDuration(clip, rate);
        const startSeconds = Math.max(0, seconds(timelineStart));
        if (startSeconds > cursorSeconds) {
          children.push(
            makeGap(
              { value: (startSeconds - cursorSeconds) * rate, rate },
              rate,
            ),
          );
        }

        const isGap = track.kind === "gap" || clip.mediaRefId === null;
        if (isGap) {
          children.push({
            OTIO_SCHEMA: "Gap.1",
            name: clip.name || "Gap",
            source_range: timeRange({ value: 0, rate }, duration, rate),
            metadata: {
              snip: {
                id: clip.id,
                timelineStart,
                timelineDuration: duration,
                source: clip.metadata ?? {},
              },
            },
          });
        } else {
          const sourceStart = clip.sourceIn ?? { value: 0, rate };
          const sourceDuration = durationBetween(
            sourceStart,
            clip.sourceOut,
            duration.rate,
          );
          const resolvedSourceDuration = sourceDuration.value > 0
            ? sourceDuration
            : duration;
          const media = mediaById.get(clip.mediaRefId);
          children.push({
            OTIO_SCHEMA: "Clip.2",
            name: clip.name || clip.id,
            source_range: timeRange(sourceStart, resolvedSourceDuration, rate),
            media_reference: mediaReference(
              media,
              clip,
              resolvedSourceDuration,
              rate,
            ),
            metadata: {
              snip: {
                id: clip.id,
                timelineStart,
                timelineDuration: duration,
                properties: {
                  name: clip.name || clip.id,
                  enabled: clip.enabled !== false,
                },
                source: clip.metadata ?? {},
              },
            },
          });
        }
        cursorSeconds = Math.max(cursorSeconds, startSeconds + seconds(duration));
      }

      const kind = track.kind === "audio" ? "Audio" : "Video";
      return {
        OTIO_SCHEMA: "Track.1",
        name: track.name || track.id,
        kind,
        children,
        metadata: {
          snip: {
            id: track.id,
            properties: {
              name: track.name || track.id,
              kind: kind === "Audio" ? "audio" : "video",
              position: track.index,
            },
            source: { kind: track.kind },
          },
        },
      };
    });

  return {
    OTIO_SCHEMA: "Timeline.1",
    name: sequence.name || document.projectName || "Timeline",
    global_start_time: rationalTime({ value: 0, rate }, rate),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "Tracks",
      children: tracks,
      metadata: {},
    },
    metadata: {
      snip: {
        id: sequence.id,
        properties: {
          name: sequence.name || document.projectName || "Timeline",
          frameRate: { value: rate, rate: 1 },
        },
        source: {
          format: document.sourceFormat,
          schema: document.schema,
          version: document.version,
        },
      },
    },
  };
}

module.exports = {
  DEFAULT_RATE,
  intermediateToOtio,
};
