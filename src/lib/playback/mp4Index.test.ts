import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGopIndex,
  findGopAtTime,
  gopWindowRange,
  type IndexedVideoSample,
} from "./mp4Index";

function sample(
  number: number,
  offset: number,
  cts: number,
  isSync: boolean,
): IndexedVideoSample {
  return {
    number,
    offset,
    size: 100,
    cts,
    dts: cts,
    duration: 1,
    timescale: 2,
    isSync,
  };
}

test("buildGopIndex groups decode samples on sync frames", () => {
  const gops = buildGopIndex(
    [
      sample(0, 1_000, 0, true),
      sample(1, 1_200, 1, false),
      sample(2, 1_500, 2, true),
      sample(3, 1_800, 3, false),
    ],
    2,
  );
  assert.deepEqual(gops, [
    {
      sampleStart: 0,
      sampleEnd: 1,
      startTime: 0,
      endTime: 1,
      byteStart: 1_000,
      byteEnd: 1_299,
    },
    {
      sampleStart: 2,
      sampleEnd: 3,
      startTime: 1,
      endTime: 2,
      byteStart: 1_500,
      byteEnd: 1_899,
    },
  ]);
});

test("findGopAtTime uses the preceding random access point", () => {
  const gops = buildGopIndex(
    [
      sample(0, 100, 0, true),
      sample(1, 200, 1, false),
      sample(2, 300, 2, true),
      sample(3, 400, 3, false),
    ],
    2,
  );
  assert.equal(findGopAtTime(gops, 0.9), 0);
  assert.equal(findGopAtTime(gops, 1), 1);
  assert.equal(findGopAtTime(gops, 99), 1);
});

test("gopWindowRange returns a bounded current plus prefetch window", () => {
  const gops = buildGopIndex(
    [
      sample(0, 100, 0, true),
      sample(1, 200, 1, false),
      sample(2, 400, 2, true),
      sample(3, 500, 3, false),
    ],
    2,
  );
  assert.deepEqual(gopWindowRange(gops, 0, 0), { start: 100, end: 299 });
  assert.deepEqual(gopWindowRange(gops, 0, 1), { start: 100, end: 599 });
});

