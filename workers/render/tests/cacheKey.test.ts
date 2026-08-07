import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SegmentCache } from "../src/cache";
import {
  createSegmentCacheIdentity,
  hashSegmentIdentity,
  segmentCacheObjectKey,
  stableStringify,
} from "../src/cacheKey";
import { LocalObjectStore } from "../src/objectStore";
import { normalizeJobSpec } from "../src/validation";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function cacheInput() {
  const spec = normalizeJobSpec({
    segments: [{
      sourceKey: "sources/a.mp4",
      sourceContentId: "sha256:abc123",
      inSeconds: 1.25,
      outSeconds: 3.5,
      effects: { brightness: 0.1 },
    }],
    target: { width: 1280, height: 720 },
    outputKey: "outputs/a.mp4",
    manifestKey: "outputs/a.json",
  });
  return {
    sourceContentId: spec.segments[0].sourceContentId,
    inSeconds: spec.segments[0].inSeconds,
    outSeconds: spec.segments[0].outSeconds,
    effects: spec.segments[0].effects,
    target: spec.target,
  };
}

describe("segment cache identity", () => {
  test("is canonical and rounds time to integer microseconds", () => {
    const input = cacheInput();
    const identity = createSegmentCacheIdentity({
      ...input,
      inSeconds: 1.2500000001,
    });
    expect(identity.trim.inMicroseconds).toBe(1_250_000);
    expect(stableStringify({ z: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"z":1}',
    );
    const hash = hashSegmentIdentity(identity);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(segmentCacheObjectKey(hash)).toBe(
      `render-cache/snip-segment-v1/${hash.slice(0, 2)}/${hash}.mp4`,
    );
  });

  test("changes for every correctness-bearing input but not the source key", () => {
    const input = cacheInput();
    const base = hashSegmentIdentity(createSegmentCacheIdentity(input));
    const variants = [
      { ...input, sourceContentId: "sha256:different" },
      { ...input, inSeconds: input.inSeconds + 0.001 },
      { ...input, outSeconds: input.outSeconds + 0.001 },
      { ...input, effects: { ...input.effects, contrast: 1.1 } },
      { ...input, target: { ...input.target, crf: input.target.crf + 1 } },
      { ...input, target: { ...input.target, width: 1920 } },
    ];
    for (const variant of variants) {
      expect(hashSegmentIdentity(createSegmentCacheIdentity(variant))).not.toBe(base);
    }
  });

  test("rejects identities that collapse to an empty trim range", () => {
    const input = cacheInput();
    expect(() => createSegmentCacheIdentity({
      ...input,
      inSeconds: 1.0000001,
      outSeconds: 1.0000004,
    })).toThrow("at least one microsecond");
    expect(() => segmentCacheObjectKey("a".repeat(64), "/")).toThrow(
      "prefix cannot be empty",
    );
  });

  test("stores and restores through the local filesystem backend", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-cache-test-"));
    tempDirectories.push(root);
    const store = new LocalObjectStore(join(root, "objects"));
    const cache = new SegmentCache(store);
    const address = cache.address(cacheInput());
    const encoded = join(root, "encoded.mp4");
    const restored = join(root, "restored.mp4");
    await writeFile(encoded, "encoded-segment");

    expect((await cache.restore(address, restored)).hit).toBe(false);
    const stored = await cache.storeFile(address, encoded);
    expect(stored.bytes).toBe(15);
    const hit = await cache.restore(address, restored);
    expect(hit.hit).toBe(true);
    expect(hit.bytes).toBe(15);
    expect(await readFile(restored, "utf8")).toBe("encoded-segment");
  });
});
