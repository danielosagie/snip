import test from "node:test";
import assert from "node:assert/strict";

import {
  alignByteRange,
  clampByteRange,
  mergeByteRanges,
  parseContentRange,
  readIsoBoxHeader,
} from "./rangeMath";

test("clampByteRange keeps inclusive ranges inside the source", () => {
  assert.deepEqual(clampByteRange({ start: -20, end: 400 }, 100), {
    start: 0,
    end: 99,
  });
  assert.deepEqual(clampByteRange({ start: 80, end: 20 }, 100), {
    start: 80,
    end: 80,
  });
});

test("alignByteRange expands to cache block boundaries", () => {
  assert.deepEqual(alignByteRange({ start: 17, end: 32 }, 100, 16), {
    start: 16,
    end: 47,
  });
  assert.deepEqual(alignByteRange({ start: 90, end: 99 }, 100, 16), {
    start: 80,
    end: 99,
  });
});

test("mergeByteRanges joins overlapping and adjacent windows", () => {
  assert.deepEqual(
    mergeByteRanges([
      { start: 20, end: 29 },
      { start: 0, end: 9 },
      { start: 10, end: 19 },
      { start: 40, end: 45 },
    ]),
    [
      { start: 0, end: 29 },
      { start: 40, end: 45 },
    ],
  );
});

test("parseContentRange validates server range metadata", () => {
  assert.deepEqual(parseContentRange("bytes 100-199/1000"), {
    start: 100,
    end: 199,
    total: 1000,
  });
  assert.equal(parseContentRange("bytes 100-99/1000"), null);
  assert.equal(parseContentRange("bytes 0-0/*"), null);
});

test("readIsoBoxHeader parses 32-bit and extended box sizes", () => {
  const standard = new ArrayBuffer(16);
  const standardView = new DataView(standard);
  standardView.setUint32(0, 24);
  for (const [index, char] of [..."moov"].entries()) {
    standardView.setUint8(4 + index, char.charCodeAt(0));
  }
  assert.deepEqual(readIsoBoxHeader(standard, 100, 1000), {
    type: "moov",
    start: 100,
    size: 24,
    headerSize: 8,
    endExclusive: 124,
  });

  const extended = new ArrayBuffer(16);
  const extendedView = new DataView(extended);
  extendedView.setUint32(0, 1);
  for (const [index, char] of [..."mdat"].entries()) {
    extendedView.setUint8(4 + index, char.charCodeAt(0));
  }
  extendedView.setBigUint64(8, 500n);
  assert.equal(readIsoBoxHeader(extended, 100, 1000).endExclusive, 600);
});

