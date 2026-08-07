# Convex render queue contract

## Export button

Queue creation is disabled unless the Convex deployment has `RENDER_QUEUE_ENABLED=true`.
The public mutation is `api.renderJobs.create`:

```ts
type CreateRenderJobArgs = {
  snapshot: {
    timelineDocId: Id<"timelineDocs">;
    timelineSnapshotId: Id<"timelineSnapshots">;
    branch: string;
    revision: number;
  };
  output: {
    container: "mp4" | "mov" | "webm";
    videoCodec: "h264" | "hevc" | "prores" | "vp9" | "av1";
    audioCodec: "aac" | "pcm" | "opus" | "none";
    width: number;
    height: number;
    frameRate: { value: number; rate: number };
  };
  priority?: number;
};

const jobId: Id<"renderJobs"> = await createRenderJob(args);
```

The first adapter rejects every output combination except MP4 with H.264 or
HEVC video and AAC audio. Width and height must be positive even integers.
`priority` defaults to 100 and lower numbers are claimed first. The caller must
be authenticated and have at least member access to the snapshot's project.

The snapshot must be a committed `snip.timeline.document` snapshot whose
metadata matches all four reference fields. Commit the live timeline first,
then pass the returned snapshot ID and current revision.

## Progress UI

Subscribe reactively to `api.renderJobs.getProgress`:

```ts
const progress = useQuery(api.renderJobs.getProgress, { jobId });
```

The caller needs viewer access to the job's project. The result is `null` when
the row is absent, otherwise:

```ts
{
  jobId,
  status,                 // queued | claimed | running | uploading | done | failed
  phase,                  // claimed | downloading | probing | rendering | uploading | complete | null
  progress,               // 0 through 1
  message,
  cancellationRequestedAt,
  outputObjectKey,
  manifestObjectKey,
  outputBytes,
  failure,                // { code, retryable, message?, detail? } | null
  createdAt,
  queuedAt,
  completedAt,
  failedAt,
}
```

Cancellation uses `api.renderJobs.cancel({ jobId })` and is requester-only.
The A3 schema has no `cancelled` status, so cancelled jobs use `status: "failed"`
with `failure.code: "CANCELLED"`.

## Worker transport

The worker uses HTTP actions instead of `ConvexHttpClient`. This keeps claim,
heartbeat, progress, complete, fail, and release as internal mutations while
reusing the existing team `pluginToken` Bearer authentication from the native
NLE panel. It avoids adding a second credential scheme.

Set:

```text
JOB_STORE_BACKEND=convex
CONVEX_SITE_URL=https://deployment.convex.site
RENDER_WORKER_PLUGIN_TOKEN=<team pluginToken>
```

The worker polls `/render-jobs/claim`, renews its lease through
`/render-jobs/heartbeat`, and releases an owned lease on SIGINT or SIGTERM.
Idle and failed polls use jittered exponential backoff.

## A3 schema seams

Two required fields are not present in the protected A3 schema:

- `videos` has no checksum or immutable object-version field. Queue creation
  uses the timestamp-versioned `s3Key` as `sourceContentId` for now.
- `usageMeters` has no `renderMinutes` or `cacheHitSavingsMinutes` fields.
  Completion atomically stores total and cache-hit durations on `renderJobs`.
  `usageMeters.getOwnerRenderUsage` folds those durable rows for the current
  period until A adds the numeric meter columns. Stripe reporting remains a
  later-wave seam.
