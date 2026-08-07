import { describe, expect, test } from "bun:test";
import { jitteredBackoffMs } from "../src/polling";

describe("jitteredBackoffMs", () => {
  test("backs off exponentially, caps, and applies bounded jitter", () => {
    const base = { baseDelayMs: 100, maxDelayMs: 500 };
    expect(jitteredBackoffMs(0, { ...base, random: () => 0 })).toBe(75);
    expect(jitteredBackoffMs(1, { ...base, random: () => 0.5 })).toBe(200);
    expect(jitteredBackoffMs(10, { ...base, random: () => 1 })).toBe(500);
  });
});
