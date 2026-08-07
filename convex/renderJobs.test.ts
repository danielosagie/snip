import test from "node:test";
import assert from "node:assert/strict";
import type { Doc } from "./_generated/dataModel";
import {
  compareQueueCandidates,
  heartbeatDisposition,
  isClaimableRenderJob,
  ownsRenderClaim,
  statusForPhase,
} from "./renderJobs";

function job(
  overrides: Partial<Doc<"renderJobs">> = {},
): Doc<"renderJobs"> {
  return {
    _id: "job-1" as Doc<"renderJobs">["_id"],
    _creationTime: 100,
    teamId: "team-1" as Doc<"renderJobs">["teamId"],
    projectId: "project-1" as Doc<"renderJobs">["projectId"],
    status: "queued",
    snapshot: {
      timelineDocId: "timeline-1" as Doc<"renderJobs">["snapshot"]["timelineDocId"],
      timelineSnapshotId: "snapshot-1" as Doc<"renderJobs">["snapshot"]["timelineSnapshotId"],
      branch: "main",
      revision: 1,
    },
    output: {
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1920,
      height: 1080,
      frameRate: { value: 30, rate: 1 },
    },
    createdAt: 100,
    queuedAt: 100,
    attemptCount: 0,
    ...overrides,
  } as Doc<"renderJobs">;
}

test("queue ordering uses priority before queuedAt", () => {
  const candidates = [
    job({ priority: 100, queuedAt: 1 }),
    job({ priority: 10, queuedAt: 3 }),
    job({ priority: 10, queuedAt: 2 }),
  ].sort(compareQueueCandidates);
  assert.deepEqual(
    candidates.map((candidate) => [candidate.priority, candidate.queuedAt]),
    [[10, 2], [10, 3], [100, 1]],
  );
});

test("claimability recovers stale active leases but not live leases", () => {
  assert.equal(isClaimableRenderJob(job({ status: "queued" }), 1_000), true);
  assert.equal(
    isClaimableRenderJob(job({ status: "running", leaseExpiresAt: 999 }), 1_000),
    true,
  );
  assert.equal(
    isClaimableRenderJob(job({ status: "uploading", leaseExpiresAt: 1_001 }), 1_000),
    false,
  );
  assert.equal(isClaimableRenderJob(job({ status: "done" }), 1_000), false);
});

test("heartbeat checks worker and claim token and maps phases to queue status", () => {
  const claimed = job({
    status: "claimed",
    claimedBy: "worker-a",
    claimToken: "token-a",
  });
  assert.equal(ownsRenderClaim(claimed, "worker-a", "token-a"), true);
  assert.equal(ownsRenderClaim(claimed, "worker-b", "token-a"), false);
  assert.equal(ownsRenderClaim(claimed, "worker-a", "token-b"), false);
  assert.equal(heartbeatDisposition(claimed, "worker-a", "token-a"), "accepted");
  assert.equal(statusForPhase("claimed"), "claimed");
  assert.equal(statusForPhase("rendering"), "running");
  assert.equal(statusForPhase("uploading"), "uploading");
});

test("cancellation is observed only by the current claim owner", () => {
  const cancelled = job({
    status: "running",
    claimedBy: "worker-a",
    claimToken: "token-a",
    cancellationRequestedAt: 500,
  });
  assert.equal(
    heartbeatDisposition(cancelled, "worker-a", "token-a"),
    "cancelled",
  );
  assert.equal(
    heartbeatDisposition(cancelled, "worker-b", "token-a"),
    "lease_lost",
  );
});
