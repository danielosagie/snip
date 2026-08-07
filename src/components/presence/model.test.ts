import assert from "node:assert/strict";
import test from "node:test";

import type { TimelinePresencePayload } from "@/lib/timeline/types";
import {
  getFollowSyncChase,
  getSoftLockConflicts,
  isEditPresenceActive,
  isTimelinePresencePayload,
  normalizeTimelinePresencePayload,
  type TimelinePresenceParticipant,
  type WatchPresenceParticipant,
} from "./model";

const NOW = 1_800_000_000_000;

function payload(overrides: Partial<TimelinePresencePayload> = {}) {
  return {
    playheadPosition: { value: 48, rate: 24 },
    selectedClipIds: ["clip-1"],
    viewportRange: {
      start: { value: 0, rate: 24 },
      duration: { value: 240, rate: 24 },
    },
    softLocks: [],
    ...overrides,
  } satisfies TimelinePresencePayload;
}

test("presence payload validation rejects malformed time and lock targets", () => {
  assert.equal(isTimelinePresencePayload(payload()), true);
  assert.equal(
    isTimelinePresencePayload(
      payload({ playheadPosition: { value: Number.NaN, rate: 24 } }),
    ),
    false,
  );
  assert.equal(
    isTimelinePresencePayload(
      payload({
        softLocks: [
          {
            target: { kind: "file", path: "" },
            holder: "spoofed",
            claimedAt: NOW,
          },
        ],
      }),
    ),
    false,
  );
});

test("presence normalization owns lock holder identity and dedupes claims", () => {
  const normalized = normalizeTimelinePresencePayload(
    payload({
      selectedClipIds: ["clip-1", "clip-1", "clip-2"],
      softLocks: [
        {
          target: { kind: "file", path: " cut_v3.prproj " },
          holder: "spoofed",
          claimedAt: NOW,
        },
        {
          target: { kind: "file", path: "cut_v3.prproj" },
          holder: "other",
          claimedAt: NOW,
        },
      ],
    }),
    "actor-1",
    NOW,
  );

  assert.deepEqual(normalized?.selectedClipIds, ["clip-1", "clip-2"]);
  assert.deepEqual(normalized?.softLocks, [
    {
      target: { kind: "file", path: "cut_v3.prproj" },
      holder: "actor-1",
      claimedAt: NOW,
    },
  ]);
});

test("soft lock claims expire when their presence heartbeat is stale", () => {
  const participant: TimelinePresenceParticipant = {
    userId: "presence-1",
    actorId: "actor-1",
    displayName: "Dara",
    online: true,
    lastDisconnected: 0,
    updatedAt: NOW - 1_000,
    payload: payload({
      softLocks: [
        {
          target: { kind: "sequence", sequenceId: "sequence-1" },
          holder: "actor-1",
          claimedAt: NOW - 5_000,
        },
      ],
    }),
  };

  assert.equal(isEditPresenceActive(participant, NOW), true);
  assert.equal(
    getSoftLockConflicts(
      [participant],
      { kind: "sequence", sequenceId: "sequence-1" },
      "actor-2",
      NOW,
    ).length,
    1,
  );
  assert.equal(isEditPresenceActive(participant, NOW + 60_000), false);
  assert.equal(
    getSoftLockConflicts(
      [participant],
      { kind: "sequence", sequenceId: "sequence-1" },
      "actor-2",
      NOW + 60_000,
    ).length,
    0,
  );
});

test("follow sync chases meaningful drift and ignores close playheads", () => {
  const host: WatchPresenceParticipant = {
    userId: "host",
    displayName: "Host",
    online: true,
    lastDisconnected: 0,
    joinedAt: NOW - 10_000,
    updatedAt: NOW - 500,
    playheadSeconds: 10,
    playing: true,
  };

  assert.deepEqual(
    getFollowSyncChase({
      following: true,
      localPlayheadSeconds: 5,
      host,
      now: NOW,
    }),
    { playheadSeconds: 10.5, playing: true },
  );
  assert.equal(
    getFollowSyncChase({
      following: true,
      localPlayheadSeconds: 10.4,
      localPlaying: true,
      host,
      now: NOW,
    }),
    null,
  );
  assert.deepEqual(
    getFollowSyncChase({
      following: true,
      localPlayheadSeconds: 10.4,
      localPlaying: true,
      host: { ...host, playheadSeconds: 10.4, playing: false, updatedAt: NOW },
      now: NOW,
    }),
    { playheadSeconds: 10.4, playing: false },
  );
  assert.equal(
    getFollowSyncChase({
      following: false,
      localPlayheadSeconds: 0,
      host,
      now: NOW,
    }),
    null,
  );
});
