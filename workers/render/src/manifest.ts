import type {
  CacheAccounting,
  CacheSegmentManifest,
  RenderResultManifest,
} from "./types";

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function summarizeCache(segments: CacheSegmentManifest[]): CacheAccounting {
  let hits = 0;
  let misses = 0;
  let hitBytes = 0;
  let missBytes = 0;
  let hitDurationSeconds = 0;
  let missDurationSeconds = 0;
  for (const segment of segments) {
    if (segment.cacheResult === "hit") {
      hits += 1;
      hitBytes += segment.bytes;
      hitDurationSeconds += segment.durationSeconds;
    } else {
      misses += 1;
      missBytes += segment.bytes;
      missDurationSeconds += segment.durationSeconds;
    }
  }
  const totalSegments = hits + misses;
  const totalBytes = hitBytes + missBytes;
  const totalDurationSeconds = hitDurationSeconds + missDurationSeconds;
  return {
    hits,
    misses,
    totalSegments,
    hitRate: ratio(hits, totalSegments),
    hitBytes,
    missBytes,
    totalBytes,
    byteHitRate: ratio(hitBytes, totalBytes),
    hitDurationSeconds,
    missDurationSeconds,
    totalDurationSeconds,
    streamCopyPercent: ratio(hitDurationSeconds, totalDurationSeconds) * 100,
  };
}

export function serializeManifest(manifest: RenderResultManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
