# Render compute cost per finished 1080p minute

Measured 2026-08-07 at repository commit `5e4d5696b015ca0914a0f89053f4c9a74d325424`.

## Decision number

The cold render consumed 285.93 CPU-seconds for 126.021333 seconds of finished 1080p H.264. Priced at the 2026-08-07 Google Cloud N2 `us-central1` on-demand list rate, that is **$0.001836260 per finished minute** of compute. Mux would charge $0.084 for the 2.100000 source minutes in this cut, or $0.039993229 per actual finished minute. On this unadjusted CPU-second basis, Mux is **21.7797×** the cold self-render cost.

This is the number with a measurement receipt, not an invoice forecast. The test host is an Apple M1 Pro while an N2 vCPU is an Intel hardware thread. A rough published-x264 comparison suggests the unadjusted conversion could understate x86 CPU usage by approximately 2–3×. A deliberately conservative 3× sensitivity makes the cold value $0.005508780/minute, still 7.2599× below Mux. The sensitivity is not substituted for the measured number because this pipeline was not run on N2.

The cache changes the re-export economics materially:

- An unchanged re-export cost $0.000028321/minute on the same basis, 98.4577% below cold.
- Moving one 21-second clip's in/out points forward 1.5 seconds cost $0.000069808/minute, 96.1984% below cold. Three seconds across three GOP artifacts were re-encoded; 123 of 126 timeline seconds were hits.

For pricing, use the cold number as the compute COGS floor rather than assuming every export will be warm. Keep a 3× architecture margin until this exact fixture is run on the intended x86 worker image. Storage, object operations, orchestration, idle capacity, and egress are outside these numbers.

## What was measured

The timed command was the worker's normal `bun run start` entrypoint. It created a `LocalJobStore`, then ran `JobRunner`, `RenderPipeline`, local object storage, and `SegmentCache`. Source probing, object-store copies, cache lookup/store, all ffmpeg child processes, concat, output upload, manifest upload, and Bun startup are inside `/usr/bin/time -l`.

The render path in [`workers/render/src/ffmpeg.ts`](../workers/render/src/ffmpeg.ts) selects `libx264` for H.264. A repository search found no `videotoolbox`, NVENC, QSV, or VAAPI use in the worker. Although this ffmpeg build supports VideoToolbox, the worker did not invoke it. This is a software-encode measurement.

### Host and tools

| Item | Measured value |
| --- | --- |
| Host | MacBook Pro, Apple M1 Pro, 10 physical/logical CPU cores, 16 GiB memory |
| OS | macOS 26.3 (25D125) |
| Bun | 1.3.9 |
| ffmpeg / ffprobe | 7.1.1, Homebrew build with `libx264` |
| Render target | H.264, MP4, 1920×1080, 30 fps, yuv420p, CRF 20, x264 `fast`, AAC 192 kbps 48 kHz stereo |
| Object store and cache | `LocalObjectStore` on the internal APFS volume |
| Timing | macOS `/usr/bin/time -l`; CPU = user + system; peak RSS reported in bytes and converted using 1 MiB = 1,048,576 bytes |
| Samples | One run in each state, in cold → unchanged warm → one-edit warm order |

### Realistic sources

[`workers/render/scripts/render-cost-fixture.ts`](../workers/render/scripts/render-cost-fixture.ts) generates three deterministic 62-second H.264/AAC sources. Every source probes as 1920×1080, yuv420p, 30 fps, and exactly 62.000000 seconds. These are not flat color bars.

The common ffmpeg arguments were:

```sh
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "$VIDEO_FILTER" \
  -f lavfi -i "sine=frequency=$FREQUENCY:sample_rate=48000" \
  -t 62 \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  "$OUTPUT"
```

| Source | `$VIDEO_FILTER` | Audio | Bytes | Average container bitrate | SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| Moving pattern + grain | `testsrc2=size=1920x1080:rate=30,noise=alls=6:allf=t+u:all_seed=11` | 440 Hz | 136,842,428 | 17.6571 Mb/s | `eedb809bb34676d3c4c3b3669410ee504cb839c25ebe1551d3b0a9e1c017e01f` |
| Rotating gradient + light grain | `gradients=size=1920x1080:rate=30:type=spiral:speed=0.02:seed=22:nb_colors=8,noise=alls=1:allf=t+u:all_seed=22` | 660 Hz | 15,265,478 | 1.96974 Mb/s | `61159c094daeb776e158fdc107a8be51a5930ed806d3b750fdcb6be0208ecddd` |
| Cellular motion | `life=size=640x360:rate=30:ratio=0.12:seed=33:stitch=1:mold=4:life_color=00ff70:death_color=101028:mold_color=ff3060,scale=1920:1080:flags=neighbor` | 880 Hz | 130,278,831 | 16.8102 Mb/s | `5f4d6541296d7c02ac3b92341a60e6a4e964ddf4d0b4513b209eebfebfd52f50` |

The first source has full-frame synthetic motion plus strong temporal grain, the second is a lower-complexity animated graphic with light grain, and the third has rapidly changing cellular motion. This deliberately spans approximately 2–18 Mb/s rather than choosing one unusually compressible scene.

### Edit decision list

The job contains six sequential 21-second trims, two from each source, for 126.000 source/timeline seconds:

| Order | Source | Cold and unchanged warm bounds |
| ---: | --- | ---: |
| 1 | Moving pattern | 1.3–22.3 s |
| 2 | Rotating gradient | 4.4–25.4 s |
| 3 | Cellular motion | 7.5–28.5 s |
| 4 | Moving pattern | 29.2–50.2 s |
| 5 | Rotating gradient | 32.6–53.6 s |
| 6 | Cellular motion | 36.1–57.1 s |

The one-edit run changes only clip 2 to 5.9–26.9 seconds, a 1.5-second slip edit with the same 21-second duration. Output duration therefore remains directly comparable.

## Reproduction

From the repository root:

```sh
cd workers/render
bun install --frozen-lockfile

BENCHMARK_DIR="$(mktemp -d /tmp/snip-render-cost.XXXXXX)"
bun run benchmark:render-cost -- "$BENCHMARK_DIR"
mkdir -p "$BENCHMARK_DIR"/{raw,results,state,work}
```

The fixture command writes sources under `objects/sources`, immutable SHA-256 content IDs, `source-metadata.json`, and the three job envelopes under `jobs`. It requires an empty destination, so the cold cache cannot accidentally inherit artifacts.

Run the cold job with no `cache` directory:

```sh
/usr/bin/time -l env \
  OBJECT_STORE_BACKEND=local \
  LOCAL_OBJECT_STORE_DIR="$BENCHMARK_DIR/objects" \
  CACHE_BACKEND=local \
  CACHE_LOCAL_DIR="$BENCHMARK_DIR/cache" \
  WORK_DIR="$BENCHMARK_DIR/work" \
  JOB_SPEC_PATH="$BENCHMARK_DIR/jobs/cold.json" \
  LOCAL_JOB_STATE_PATH="$BENCHMARK_DIR/state/cold.json" \
  RESULT_MANIFEST_PATH="$BENCHMARK_DIR/results/cold.manifest.json" \
  bun run start \
  >"$BENCHMARK_DIR/raw/cold.stdout" \
  2>"$BENCHMARK_DIR/raw/cold.time.txt"
```

Repeat with the same cache and exact same render spec, but a fresh job ID/state:

```sh
/usr/bin/time -l env \
  OBJECT_STORE_BACKEND=local \
  LOCAL_OBJECT_STORE_DIR="$BENCHMARK_DIR/objects" \
  CACHE_BACKEND=local \
  CACHE_LOCAL_DIR="$BENCHMARK_DIR/cache" \
  WORK_DIR="$BENCHMARK_DIR/work" \
  JOB_SPEC_PATH="$BENCHMARK_DIR/jobs/warm-unchanged.json" \
  LOCAL_JOB_STATE_PATH="$BENCHMARK_DIR/state/warm-unchanged.json" \
  RESULT_MANIFEST_PATH="$BENCHMARK_DIR/results/warm-unchanged.manifest.json" \
  bun run start \
  >"$BENCHMARK_DIR/raw/warm-unchanged.stdout" \
  2>"$BENCHMARK_DIR/raw/warm-unchanged.time.txt"
```

Run the slip edit against that cache:

```sh
/usr/bin/time -l env \
  OBJECT_STORE_BACKEND=local \
  LOCAL_OBJECT_STORE_DIR="$BENCHMARK_DIR/objects" \
  CACHE_BACKEND=local \
  CACHE_LOCAL_DIR="$BENCHMARK_DIR/cache" \
  WORK_DIR="$BENCHMARK_DIR/work" \
  JOB_SPEC_PATH="$BENCHMARK_DIR/jobs/warm-one-edit.json" \
  LOCAL_JOB_STATE_PATH="$BENCHMARK_DIR/state/warm-one-edit.json" \
  RESULT_MANIFEST_PATH="$BENCHMARK_DIR/results/warm-one-edit.manifest.json" \
  bun run start \
  >"$BENCHMARK_DIR/raw/warm-one-edit.stdout" \
  2>"$BENCHMARK_DIR/raw/warm-one-edit.time.txt"
```

After each run, inspect actual output rather than relying only on planned duration:

```sh
ffprobe -v error \
  -show_entries format=duration,size,bit_rate \
  -show_entries stream=index,codec_name,codec_type,width,height,r_frame_rate \
  -of json \
  "$BENCHMARK_DIR/objects/outputs/render-cost.mp4"

jq '{output, cache, cacheSegments}' \
  "$BENCHMARK_DIR/results/warm-one-edit.manifest.json"
```

## Results

`CPU seconds` is user + system. `Output seconds / CPU second` is the requested portable real-time factor; higher is better.

| Run | Wall s | User s | Sys s | CPU s | Peak RSS MiB | Actual output s | Output bytes | Hits / misses | Hit rate | Stream-copy % | Output s / CPU s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold, empty cache | 80.16 | 263.96 | 21.97 | 285.93 | 715.078125 | 126.021333 | 148,255,310 | 0 / 69 | 0% | 0% | 0.440741905 |
| Warm, unchanged | 4.41 | 3.40 | 1.01 | 4.41 | 65.000000 | 126.021333 | 148,255,310 | 69 / 0 | 100% | 100% | 28.576265986 |
| Warm, one edit | 6.46 | 9.32 | 1.55 | 10.87 | 675.640625 | 126.021333 | 148,231,440 | 67 / 3 | 95.714286% | 97.619048% | 11.593498896 |

Raw `/usr/bin/time -l` receipt fields:

```text
cold:           80.16 real   263.96 user   21.97 sys   749813760 maximum resident set size
warm unchanged:  4.41 real     3.40 user    1.01 sys    68157440 maximum resident set size
warm one edit:    6.46 real     9.32 user    1.55 sys   708460544 maximum resident set size
```

The edited manifest's three misses were 5.9–6.0 seconds, 24.0–26.0 seconds, and 26.0–26.9 seconds from the shifted source: exactly 3.000 seconds re-encoded. Its 67 hits covered the other 123.000 seconds. Segment count changed from 69 to 70 because the new edit boundaries split the source GOP layout differently.

## Cost derivation

### List-price assumptions

Prices were read on 2026-08-07 from Google's official [general-purpose VM price sheet](https://cloud.google.com/products/compute/pricing/general-purpose) and [Spot VM price sheet](https://cloud.google.com/spot-vms/pricing):

- Family and region: Google Compute Engine N2, Iowa (`us-central1`). N2 is an x86 general-purpose family. Google documents that smaller N2 machines default to Intel Cascade Lake and that one vCPU is one hardware thread in its [N2 machine documentation](https://cloud.google.com/compute/docs/general-purpose-machines#n2_series).
- On demand: `n2-standard-2`, 2 vCPU and 8 GiB, $0.097118/instance-hour = **$0.048559/vCPU-hour** including its proportional memory.
- Spot: `n2-standard-2`, 2 vCPU and 8 GiB, $0.04606/instance-hour = **$0.02303/vCPU-hour** including memory.
- These are public USD list prices, not negotiated rates and not checked against an invoice. Spot is interruptible and its price can change.
- The CPU-second conversion assumes workers are packed or metered closely enough that one consumed CPU-second becomes one billable vCPU-second. It excludes idle fleet time. The cold peak RSS was only 715.08 MiB, so the 4 GiB/vCPU bundled memory ratio is ample.
- No sustained-use, committed-use, free-tier, or volume discount is applied.
- Storage, object operations, R2 transfer CPU, orchestration, logs, and egress are excluded. This is compute only.

For each run:

```text
output_minutes = 126.021333 / 60 = 2.10035555
CPU_seconds = user_seconds + sys_seconds
cost_per_output_minute = CPU_seconds / 3600
                         × price_per_vCPU_hour
                         / output_minutes
```

Cold on-demand arithmetic, without hidden rounding:

```text
(263.96 + 21.97) / 3600 × ($0.097118 / 2) / (126.021333 / 60)
= $0.0018362598537185757 per finished minute
```

| Run | CPU s / output min | On-demand total | On-demand / output min | Spot total | Spot / output min |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold | 136.134094059 | $0.003856798575 | $0.001836259854 | $0.001829157750 | $0.000870880052 |
| Warm, unchanged | 2.099644510 | $0.000059484775 | $0.000028321288 | $0.000028211750 | $0.000013431893 |
| Warm, one edit | 5.175314246 | $0.000146621203 | $0.000069807801 | $0.000069537806 | $0.000033107635 |

Google bills VM allocation time, not `getrusage` directly. As a dedicated-instance sanity check, an otherwise idle 4-vCPU `n2-standard-4` charged for each run's full wall time would cost $0.002059170/min cold, $0.000113285/min unchanged, and $0.000165946/min edited on demand. The requested CPU-second model is the marginal compute cost under fleet packing; these wall-time values are the isolated-job floor before minimum billing increments or startup time.

### Apple silicon versus cloud x86

CPU-seconds port better than wall time, but they are not architecture-neutral. This M1 Pro has physical Apple cores with no SMT; an N2 vCPU is one Cascade Lake or Ice Lake hardware thread. The M1 Pro also mixes performance and efficiency cores. No exact conversion can be claimed without running this fixture in the intended x86 image.

A rough direction check is possible from the same public OpenBenchmarking x264 profile:

- A published [base Apple M1 result](https://openbenchmarking.org/result/2205280-NE-X264APPLE67%26sro%26grs) reports 71.93 fps on the Bosphorus 1080p x264 test with 8 reported threads.
- A published [32-vCPU Google Compute Engine Xeon result](https://openbenchmarking.org/result/2408229-NE-PTSCPU87931%26sro%26gru) reports 107.17 fps on the same test.
- Normalizing those multi-thread totals by reported threads gives `(71.93 / 8) / (107.17 / 32) = 2.6847×` more throughput per reported M1 thread.

That comparison uses a base M1 rather than this M1 Pro, Linux rather than macOS for the Apple result, different compilers, and different total thread counts. It is not a billable calibration. It does support the expected direction: treating an active M1 CPU-second as one N2 vCPU-second probably understates x86 cost. The honest rough magnitude is 2–3×, so the conservative 3× on-demand sensitivity is:

| Run | 3× x86 sensitivity / output min | Mux / sensitivity cost |
| --- | ---: | ---: |
| Cold | $0.005508779561 | 7.2599× |
| Warm, unchanged | $0.000084963865 | 470.7087× |
| Warm, one edit | $0.000209423404 | 190.9683× |

These sensitivity values are estimates; the earlier table contains the measurements.

## Comparison with Mux

The repository's [`convex/cloudflareStream.ts`](../convex/cloudflareStream.ts) records Mux basic encoding at **$0.04 per source minute**. This edit has no speed changes or overlapping sources, so 126.000 timeline seconds consume 126.000 source seconds:

```text
Mux job cost = 126 / 60 × $0.04 = $0.084
Mux equivalent per actual finished minute = $0.084 / (126.021333 / 60)
                                          = $0.03999322876548211
```

Assuming Mux charges each export as a new encode:

| Run | Self on demand / min | Mux / self | Self Spot / min | Mux / self |
| --- | ---: | ---: | ---: | ---: |
| Cold | $0.001836259854 | 21.7797× | $0.000870880052 | 45.9228× |
| Warm, unchanged | $0.000028321288 | 1,412.1260× | $0.000013431893 | 2,977.4828× |
| Warm, one edit | $0.000069807801 | 572.9049× | $0.000033107635 | 1,207.9760× |

## What this means for pricing

Compute does not justify anything close to a $0.04/minute internal COGS assumption for this H.264 conform path. The measured cold compute proxy is 0.183626 cents per finished minute on demand; use that as the baseline because it does not depend on cache luck. A 3× architecture contingency raises it to 0.550878 cents/minute, still far below Mux.

The segment cache makes working-team iterations nearly free in compute terms. The unchanged export used 1.5423% of cold CPU; the realistic slip edit used 3.8016%. Pricing should therefore meter or budget cold source minutes conservatively and treat cached re-exports as margin improvement, not promise the warm cost for every export.

Before turning the number into a contractual gross-margin target, rerun the exact commands on the production x86 instance and include fleet utilization. That removes the largest uncertainty without changing the fixture or arithmetic.

## Trust limits and surprises

- The largest uncertainty is CPU architecture. The 2–3× range is a sensitivity, not a measured N2 correction.
- The local object store uses APFS `copyFile`; warm source/cache copies can benefit from cloning and the OS page cache. Production R2 adds network/TLS CPU and latency. R2 egress is zero, but transfer CPU is still absent here.
- The unchanged run's 4.41 CPU-seconds are not zero because the worker still downloads/copies three sources, probes them, resolves 69 cache objects, copies cached segments, concatenates, and writes output/manifest objects.
- Peak RSS for the three-second edit was 675.64 MiB, close to cold's 715.08 MiB. One short x264 child can establish nearly the full encoder memory high-water mark even when total CPU is small.
- The manifest reports the planned 126.000-second timeline; ffprobe reports 126.021333 seconds after AAC/MP4 concat. Cost uses the latter, which slightly lowers Mux's equivalent per-finished-minute comparison instead of rounding in self-hosting's favor.
- An early fixture attempt used temporal noise strength 3 on the smooth gradient and produced an implausible 2.1 GiB 62-second source. It was discarded before measurement; strength 1 produced the final 15,265,478-byte lower-complexity clip documented above.
- Each state was measured once, not as a repeated median, and host background load was not isolated. CPU-seconds reduce but do not eliminate this source of variance.
- The output was 148,255,310 bytes cold/unchanged and 148,231,440 bytes edited (about 141.39 MiB). Those bytes are reported so storage can be priced separately; no storage charge is included here.
