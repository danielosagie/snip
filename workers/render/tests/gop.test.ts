import { describe, expect, test } from "bun:test";
import { planGopSegments } from "../src/gop";

describe("GOP segment planning", () => {
  test("uses internal keyframes and leaves only edge GOPs partial", () => {
    expect(planGopSegments(0.5, 5, [0, 2, 4, 6])).toEqual([
      {
        inSeconds: 0.5,
        outSeconds: 2,
        durationSeconds: 1.5,
        startsAtKeyframe: false,
        endsAtKeyframe: true,
      },
      {
        inSeconds: 2,
        outSeconds: 4,
        durationSeconds: 2,
        startsAtKeyframe: true,
        endsAtKeyframe: true,
      },
      {
        inSeconds: 4,
        outSeconds: 5,
        durationSeconds: 1,
        startsAtKeyframe: true,
        endsAtKeyframe: false,
      },
    ]);
  });

  test("deduplicates, sorts, and tolerates probe noise at edit bounds", () => {
    const result = planGopSegments(2, 4, [4.0000001, 2, 3, 3, -1, Number.NaN]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      inSeconds: 2,
      outSeconds: 3,
      startsAtKeyframe: true,
      endsAtKeyframe: true,
    });
    expect(result[1]).toMatchObject({
      inSeconds: 3,
      outSeconds: 4,
      startsAtKeyframe: true,
      endsAtKeyframe: true,
    });
  });

  test("rejects invalid ranges", () => {
    expect(() => planGopSegments(-1, 2, [0])).toThrow();
    expect(() => planGopSegments(2, 2, [0])).toThrow();
    expect(() => planGopSegments(3, 2, [0])).toThrow();
  });
});
