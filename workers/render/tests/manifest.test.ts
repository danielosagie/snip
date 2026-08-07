import { describe, expect, test } from "bun:test";
import { summarizeCache } from "../src/manifest";
import type { CacheSegmentManifest } from "../src/types";

function segment(
  cacheResult: "hit" | "miss",
  bytes: number,
  durationSeconds: number,
): CacheSegmentManifest {
  return {
    cacheHash: "a".repeat(64),
    cacheObjectKey: "render-cache/a.mp4",
    sourceContentId: "source-v1",
    inSeconds: 0,
    outSeconds: durationSeconds,
    durationSeconds,
    startsAtKeyframe: true,
    endsAtKeyframe: true,
    cacheResult,
    bytes,
  };
}

describe("cache manifest accounting", () => {
  test("reports segment, byte, and duration-weighted hit rates", () => {
    const result = summarizeCache([
      segment("hit", 900, 9),
      segment("miss", 100, 1),
    ]);
    expect(result).toEqual({
      hits: 1,
      misses: 1,
      totalSegments: 2,
      hitRate: 0.5,
      hitBytes: 900,
      missBytes: 100,
      totalBytes: 1_000,
      byteHitRate: 0.9,
      hitDurationSeconds: 9,
      missDurationSeconds: 1,
      totalDurationSeconds: 10,
      streamCopyPercent: 90,
    });
  });

  test("handles an empty render without NaN values", () => {
    expect(summarizeCache([])).toMatchObject({
      hitRate: 0,
      byteHitRate: 0,
      streamCopyPercent: 0,
    });
  });
});
