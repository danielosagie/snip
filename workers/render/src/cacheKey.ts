import { createHash } from "node:crypto";
import type { RenderTarget, SegmentEffects } from "./types";

export const CACHE_FORMAT_VERSION = "snip-segment-v1";

export interface SegmentCacheIdentityInput {
  sourceContentId: string;
  inSeconds: number;
  outSeconds: number;
  effects: SegmentEffects;
  target: RenderTarget;
}

export interface SegmentCacheIdentity {
  cacheFormat: typeof CACHE_FORMAT_VERSION;
  sourceContentId: string;
  trim: {
    inMicroseconds: number;
    outMicroseconds: number;
  };
  effects: SegmentEffects;
  encode: RenderTarget;
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Cache identities require finite numbers.");
  return Object.is(value, -0) ? 0 : value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  if (typeof value === "number") return normalizeNumber(value);
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function secondsToMicroseconds(seconds: number): number {
  if (!Number.isFinite(seconds)) throw new Error("Timestamp must be finite.");
  return Math.round(seconds * 1_000_000);
}

export function createSegmentCacheIdentity(
  input: SegmentCacheIdentityInput,
): SegmentCacheIdentity {
  const sourceContentId = input.sourceContentId.trim();
  if (!sourceContentId) {
    throw new Error("Cache identities require a source content ID.");
  }
  const inMicroseconds = secondsToMicroseconds(input.inSeconds);
  const outMicroseconds = secondsToMicroseconds(input.outSeconds);
  if (inMicroseconds < 0 || outMicroseconds <= inMicroseconds) {
    throw new Error("Cache identity trim bounds must contain at least one microsecond.");
  }
  return {
    cacheFormat: CACHE_FORMAT_VERSION,
    sourceContentId,
    trim: {
      inMicroseconds,
      outMicroseconds,
    },
    effects: input.effects,
    encode: input.target,
  };
}

export function hashSegmentIdentity(identity: SegmentCacheIdentity): string {
  return createHash("sha256").update(stableStringify(identity)).digest("hex");
}

export function segmentCacheObjectKey(hash: string, prefix = "render-cache"): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid SHA-256 cache hash.");
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  if (!cleanPrefix) throw new Error("Cache prefix cannot be empty.");
  return `${cleanPrefix}/${CACHE_FORMAT_VERSION}/${hash.slice(0, 2)}/${hash}.mp4`;
}
