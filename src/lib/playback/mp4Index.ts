import type { Sample } from "mp4box";

import type { ByteRange } from "./rangeMath";

export type IndexedVideoSample = {
  number: number;
  offset: number;
  size: number;
  cts: number;
  dts: number;
  duration: number;
  timescale: number;
  isSync: boolean;
};

export type GopIndexEntry = {
  sampleStart: number;
  sampleEnd: number;
  startTime: number;
  endTime: number;
  byteStart: number;
  byteEnd: number;
};

export type VideoSampleIndex = {
  version: 1;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  decoderDescriptionBase64: string;
  samples: IndexedVideoSample[];
  gops: GopIndexEntry[];
};

export function samplePresentationTime(sample: IndexedVideoSample): number {
  return sample.timescale > 0 ? sample.cts / sample.timescale : 0;
}

export function sampleDurationSeconds(sample: IndexedVideoSample): number {
  return sample.timescale > 0 ? sample.duration / sample.timescale : 0;
}

export function toIndexedSamples(samples: Sample[]): IndexedVideoSample[] {
  return samples.map((sample) => ({
    number: sample.number,
    offset: sample.offset,
    size: sample.size,
    cts: sample.cts,
    dts: sample.dts,
    duration: sample.duration,
    timescale: sample.timescale,
    isSync: sample.is_sync,
  }));
}

export function buildGopIndex(
  samples: IndexedVideoSample[],
  duration: number,
): GopIndexEntry[] {
  if (samples.length === 0) return [];

  const starts: number[] = [0];
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].isSync) starts.push(index);
  }

  return starts.map((sampleStart, gopIndex) => {
    const sampleEnd = (starts[gopIndex + 1] ?? samples.length) - 1;
    let byteStart = Number.POSITIVE_INFINITY;
    let byteEnd = 0;
    for (let index = sampleStart; index <= sampleEnd; index += 1) {
      const sample = samples[index];
      byteStart = Math.min(byteStart, sample.offset);
      byteEnd = Math.max(byteEnd, sample.offset + sample.size - 1);
    }

    const startTime = samplePresentationTime(samples[sampleStart]);
    const nextStart = starts[gopIndex + 1];
    const lastSample = samples[sampleEnd];
    const inferredEnd =
      samplePresentationTime(lastSample) + sampleDurationSeconds(lastSample);
    const endTime =
      nextStart === undefined
        ? Math.max(startTime, duration || inferredEnd)
        : Math.max(startTime, samplePresentationTime(samples[nextStart]));

    return {
      sampleStart,
      sampleEnd,
      startTime,
      endTime,
      byteStart,
      byteEnd,
    };
  });
}

export function findGopAtTime(gops: GopIndexEntry[], time: number): number {
  if (gops.length === 0) return -1;
  const target = Math.max(0, time);
  let low = 0;
  let high = gops.length - 1;
  let match = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (gops[middle].startTime <= target) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

export function gopWindowRange(
  gops: GopIndexEntry[],
  gopIndex: number,
  prefetchGops = 1,
): ByteRange {
  if (gopIndex < 0 || gopIndex >= gops.length) {
    throw new Error("The requested GOP is outside the sample index.");
  }
  const lastIndex = Math.min(
    gops.length - 1,
    gopIndex + Math.max(0, Math.floor(prefetchGops)),
  );
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (let index = gopIndex; index <= lastIndex; index += 1) {
    start = Math.min(start, gops[index].byteStart);
    end = Math.max(end, gops[index].byteEnd);
  }
  return { start, end };
}

export function isVideoSampleIndex(value: unknown): value is VideoSampleIndex {
  if (!value || typeof value !== "object") return false;
  const index = value as Partial<VideoSampleIndex>;
  return (
    index.version === 1 &&
    typeof index.fileSize === "number" &&
    typeof index.duration === "number" &&
    typeof index.codec === "string" &&
    Array.isArray(index.samples) &&
    Array.isArray(index.gops)
  );
}

