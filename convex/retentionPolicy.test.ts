import test from "node:test";
import assert from "node:assert/strict";
import type { Doc } from "./_generated/dataModel";
import {
  hasLiveLadder,
  isEvictionCandidate,
  isEvictionEnabled,
  resolveLadderProvider,
  retentionHotDays,
  videoLastActivityAt,
} from "./retentionPolicy";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

// Minimal ready Mux video with a live ladder, created 100 days ago and
// never viewed. Tests override individual fields.
function makeVideo(overrides: Partial<Doc<"videos">> = {}): Doc<"videos"> {
  return {
    _id: "v1" as Doc<"videos">["_id"],
    _creationTime: NOW - 100 * DAY,
    projectId: "p1" as Doc<"videos">["projectId"],
    uploadedByClerkId: "u1",
    uploaderName: "U",
    title: "clip",
    visibility: "private",
    publicId: "pub1",
    status: "ready",
    workflowStatus: "review",
    muxAssetId: "asset1",
    muxPlaybackId: "play1",
    fileSize: 1000,
    ...overrides,
  } as Doc<"videos">;
}

test("videoLastActivityAt falls back to creation when never viewed", () => {
  const v = makeVideo();
  assert.equal(videoLastActivityAt(v), v._creationTime);
  const viewed = makeVideo({ lastViewedAt: NOW - DAY });
  assert.equal(videoLastActivityAt(viewed), NOW - DAY);
});

test("resolveLadderProvider prefers explicit, else infers from streamUid", () => {
  assert.equal(resolveLadderProvider(makeVideo()), "mux");
  assert.equal(
    resolveLadderProvider(makeVideo({ streamUid: "s1", muxPlaybackId: undefined, muxAssetId: undefined })),
    "cloudflare_stream",
  );
  assert.equal(
    resolveLadderProvider(makeVideo({ playbackProvider: "cloudflare_stream" })),
    "cloudflare_stream",
  );
});

test("hasLiveLadder reflects the resolved provider's handles", () => {
  assert.equal(hasLiveLadder(makeVideo()), true);
  assert.equal(
    hasLiveLadder(makeVideo({ muxPlaybackId: undefined, muxAssetId: undefined })),
    false,
  );
  assert.equal(
    hasLiveLadder(
      makeVideo({
        playbackProvider: "cloudflare_stream",
        streamUid: undefined,
        muxPlaybackId: undefined,
        muxAssetId: undefined,
      }),
    ),
    false,
  );
});

test("isEvictionCandidate evicts a cold, ready, member-facing video", () => {
  const cutoff = NOW - 30 * DAY;
  assert.equal(isEvictionCandidate(makeVideo(), cutoff), true);
});

test("isEvictionCandidate keeps hot videos viewed within the window", () => {
  const cutoff = NOW - 30 * DAY;
  assert.equal(
    isEvictionCandidate(makeVideo({ lastViewedAt: NOW - 5 * DAY }), cutoff),
    false,
  );
});

test("isEvictionCandidate skips deferred / already-evicted / not-ready rows", () => {
  const cutoff = NOW - 30 * DAY;
  assert.equal(isEvictionCandidate(makeVideo({ encodingDeferred: true }), cutoff), false);
  assert.equal(isEvictionCandidate(makeVideo({ renditionEvictedAt: NOW - 40 * DAY }), cutoff), false);
  assert.equal(isEvictionCandidate(makeVideo({ status: "processing" }), cutoff), false);
  assert.equal(isEvictionCandidate(makeVideo({ deletedAt: NOW - 40 * DAY }), cutoff), false);
});

test("isEvictionCandidate never strands paid delivery", () => {
  const cutoff = NOW - 30 * DAY;
  assert.equal(isEvictionCandidate(makeVideo({ muxSignedPlaybackId: "signed1" }), cutoff), false);
  assert.equal(
    isEvictionCandidate(makeVideo({ paywall: { priceCents: 500, currency: "usd" } }), cutoff),
    false,
  );
});

test("isEvictionCandidate skips non-video kinds", () => {
  const cutoff = NOW - 30 * DAY;
  assert.equal(isEvictionCandidate(makeVideo({ kind: "image" }), cutoff), false);
  assert.equal(isEvictionCandidate(makeVideo({ kind: "audio" }), cutoff), false);
});

test("retentionHotDays honors env, defaults to 30", () => {
  const prev = process.env.RETENTION_HOT_DAYS;
  delete process.env.RETENTION_HOT_DAYS;
  assert.equal(retentionHotDays(), 30);
  process.env.RETENTION_HOT_DAYS = "7";
  assert.equal(retentionHotDays(), 7);
  process.env.RETENTION_HOT_DAYS = "garbage";
  assert.equal(retentionHotDays(), 30);
  if (prev === undefined) delete process.env.RETENTION_HOT_DAYS;
  else process.env.RETENTION_HOT_DAYS = prev;
});

test("isEvictionEnabled: explicit flag wins, else gated on billing", () => {
  const prevFlag = process.env.RETENTION_EVICTION;
  const prevKey = process.env.STRIPE_SECRET_KEY;

  process.env.RETENTION_EVICTION = "on";
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(isEvictionEnabled(), true);

  process.env.RETENTION_EVICTION = "off";
  process.env.STRIPE_SECRET_KEY = "sk_live_x";
  assert.equal(isEvictionEnabled(), false);

  delete process.env.RETENTION_EVICTION;
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(isEvictionEnabled(), false);
  process.env.STRIPE_SECRET_KEY = "sk_live_x";
  assert.equal(isEvictionEnabled(), true);

  if (prevFlag === undefined) delete process.env.RETENTION_EVICTION;
  else process.env.RETENTION_EVICTION = prevFlag;
  if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = prevKey;
});
