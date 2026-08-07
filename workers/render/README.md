# Snip conform render worker

This package is a self-contained Bun worker for server-side MP4 conforming. It downloads original media from R2, splits requested ranges at source keyframes, restores content-addressed GOP artifacts when available, encodes misses with ffmpeg, concatenates the artifacts with stream copy, and uploads both the export and its result manifest.

Bun is used because it is already the repository runtime and can execute the TypeScript entrypoint directly. The AWS SDK remains on its standard Node-compatible streaming APIs. ffmpeg and ffprobe are system binaries in both local development and the container. This package is not imported by the web application, so no worker environment variables or ffmpeg dependencies enter the web bundle.

## Job lifecycle

`JobRunner` performs these phases in order:

1. `claim`: acquire a token and lease from `JobStore`.
2. `heartbeat`: immediately establish ownership, then renew the lease while work runs.
3. `run`: download sources, probe keyframes, restore cached segments, and encode misses.
4. `upload`: atomically PUT the MP4 and manifest to deterministic R2 keys.
5. `complete`: commit the result and cache accounting through `JobStore`.

Wave 1 provides `LocalJobStore`, backed by an atomically replaced JSON state file. It accepts a job spec from `JOB_SPEC_PATH` or inline `RENDER_JOB_JSON`. The pipeline only depends on the `JobStore` interface, so wave 2 can add Convex claim, heartbeat, release, fail, and complete operations without changing media code.

SIGINT or SIGTERM aborts ffmpeg and releases an owned local lease back to `queued`. Downloads use temporary `.part` files and rename only after success. R2 PUTs are atomic at the object level and use deterministic keys, cache objects are create-if-absent, and the manifest is uploaded after the MP4. A stopped attempt can therefore restart safely. Completed cache segments survive and reduce restart work. Individual transfers retry three times; cross-process multipart resume is intentionally deferred until production file-size data justifies the extra state.

## Cache identity

The cache preimage is canonical JSON containing:

- cache format version, currently `snip-segment-v1`
- immutable source content ID, such as a SHA-256 checksum or immutable object version
- exact segment in and out bounds as integer microseconds
- normalized brightness, contrast, saturation, volume, and mute parameters
- every normalized output parameter: codec, container, resolution, frame rate, pixel format, CRF, preset, and audio settings

The source R2 key is intentionally absent. Moving an unchanged original does not invalidate useful work. Changing content at the same key must change `sourceContentId`; callers must never use a mutable URL as that value.

The canonical preimage is SHA-256 hashed and stored at:

```text
render-cache/snip-segment-v1/<first-two-hash-chars>/<full-hash>.mp4
```

Requested ranges are split at every internal keyframe reported by ffprobe. Interior artifacts are whole GOPs. Only the first and last artifacts can be partial GOPs, which isolates changed edit boundaries while preserving unchanged interior GOPs. On a hit, the artifact is downloaded without transcoding. On a miss, that artifact alone is encoded and stored. The final concat always uses `ffmpeg -c copy`.

The result manifest reports segment hits and misses, hit and miss bytes, segment and byte hit rates, hit and miss durations, and `streamCopyPercent`. Cache metrics are over unique content-addressed artifacts so duplicated timeline references do not inflate the hit rate.

## Local demonstration

Requirements: Bun, ffmpeg, and ffprobe.

```sh
cd workers/render
bun install
bun run test
bun run demo
```

The demo generates an eight-second source with two-second GOPs, runs two separate jobs with the same edit, and keeps all artifacts in the printed temporary directory. The first manifest contains misses. The second asserts `streamCopyPercent > 90` and normally reports 100 percent.

Use `DEMO_DIR=/absolute/path bun run demo` to keep the demo at a predictable path. Start with an empty directory so old cache objects cannot affect the first-pass numbers.

## Docker with R2

Build from this package directory:

```sh
docker build -t snip-render-worker .
```

Prepare a writable work directory and edit the example so the keys, checksums, and trim bounds match real R2 objects:

```sh
mkdir -p /tmp/snip-render-run
cp examples/r2-job.example.json /tmp/snip-render-run/job.json
```

Run the worker:

```sh
docker run --rm \
  -v /tmp/snip-render-run:/work \
  -e R2_ENDPOINT \
  -e R2_ACCESS_KEY_ID \
  -e R2_SECRET_ACCESS_KEY \
  -e R2_BUCKET_NAME \
  snip-render-worker
```

The container writes `/work/job-state.json` and `/work/result-manifest.json`; the MP4, manifest, and segment cache go to R2. To prove the cache on a second independent job, change the JSON `id`, use fresh local state and result paths, and keep the edit and encode parameters identical:

```sh
docker run --rm \
  -v /tmp/snip-render-run:/work \
  -e LOCAL_JOB_STATE_PATH=/work/job-state-2.json \
  -e RESULT_MANIFEST_PATH=/work/result-manifest-2.json \
  -e R2_ENDPOINT \
  -e R2_ACCESS_KEY_ID \
  -e R2_SECRET_ACCESS_KEY \
  -e R2_BUCKET_NAME \
  snip-render-worker

jq '.cache' /tmp/snip-render-run/result-manifest-2.json
```

`R2_REGION` defaults to `auto`. `CACHE_PREFIX` defaults to `render-cache`. The R2 variables match `convex/s3.ts`.

For CI and local fixtures, set `OBJECT_STORE_BACKEND=local` and `LOCAL_OBJECT_STORE_DIR=/absolute/path`. The cache uses that object store unless `CACHE_BACKEND` is explicitly set to `r2` or `local`; a separate local cache also requires `CACHE_LOCAL_DIR`.

Other optional settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WORKER_ID` | hostname and PID | Claim owner identity |
| `JOB_LEASE_MS` | `30000` | Local claim lease |
| `HEARTBEAT_INTERVAL_MS` | `5000` | Lease renewal cadence |
| `WORK_DIR` | `/tmp/snip-render` | Per-attempt temporary files |
| `KEEP_WORK_DIR` | false | Preserve attempt files for debugging |
| `RESULT_MANIFEST_PATH` | unset outside Docker | Extra local manifest copy |

## Job shape

See `examples/r2-job.example.json`. A single normalized target applies to every segment because all cached artifacts must be concat-compatible. H.264 and HEVC video in MP4 are supported. Audio is normalized to AAC; sources without audio receive silence. Effects are declarative and default to identity values. Target defaults are H.264, 1920x1080, 30 fps, yuv420p, CRF 20, `fast`, and 48 kHz stereo AAC at 192 kbps.

The job's `outputKey` and `manifestKey` are deterministic retry targets. They must differ. A completed local state is not claimable again; use a new job ID and state file to model a new export request.

## Wave 2 Convex contract needs

The Convex-backed `JobStore` needs an internal atomic claim mutation that returns the job ID, immutable spec or snapshot, attempt number, worker ID, and an unguessable claim token. Heartbeat, complete, fail, and release mutations must compare that token before writing.

The `renderJobs` row needs status, priority, creation time, attempt count, claim owner/token, heartbeat and lease expiry timestamps, phase, progress, cancellation request, output and manifest keys, result cache accounting, error details, completion time, requester, team, and workspace owner. Queue and stale-lease indexes should support `(status, priority, createdAt)` and `(status, leaseExpiresAt)`. Only internal authenticated server actions should create or mutate fleet state.
