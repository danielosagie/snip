import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SegmentCache } from "./cache";
import { LocalJobStore } from "./jobStore";
import { LocalObjectStore } from "./objectStore";
import { RenderPipeline } from "./pipeline";
import { runProcess } from "./process";
import { JobRunner } from "./runner";
import { normalizeJobSpec } from "./validation";

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const demoRoot = process.env.DEMO_DIR?.trim()
  || await mkdtemp(join(tmpdir(), "snip-render-demo-"));
const objectRoot = join(demoRoot, "objects");
const sourceKey = "sources/demo-source.mp4";
const sourcePath = join(objectRoot, sourceKey);
await mkdir(join(objectRoot, "sources"), { recursive: true });

await runProcess("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
  "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
  "-t", "8",
  "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
  "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
  "-c:a", "aac", "-b:a", "128k",
  sourcePath,
]);
const sourceContentId = await sha256File(sourcePath);
const objectStore = new LocalObjectStore(objectRoot);
const cache = new SegmentCache(objectStore);

async function runPass(pass: number) {
  const jobId = `demo-pass-${pass}`;
  const spec = normalizeJobSpec({
    segments: [
      { sourceKey, sourceContentId, inSeconds: 0.2, outSeconds: 3.8 },
      {
        sourceKey,
        sourceContentId,
        inSeconds: 4,
        outSeconds: 7.8,
        effects: { saturation: 0.9 },
      },
    ],
    target: { codec: "h264", container: "mp4", width: 640, height: 360, fps: 30 },
    outputKey: `outputs/${jobId}.mp4`,
    manifestKey: `outputs/${jobId}.manifest.json`,
  });
  const jobStore = await LocalJobStore.open({
    statePath: join(demoRoot, `${jobId}.state.json`),
    jobId,
    spec,
  });
  const runner = new JobRunner(
    jobStore,
    new RenderPipeline({
      objectStore,
      cache,
      workRoot: join(demoRoot, "work"),
      resultManifestPath: join(demoRoot, `${jobId}.manifest.json`),
    }),
    { workerId: `demo-worker-${pass}`, leaseMs: 30_000, heartbeatIntervalMs: 2_000 },
  );
  const result = await runner.runNext();
  if (!result) throw new Error(`${jobId} was not claimable.`);
  return result;
}

const first = await runPass(1);
const second = await runPass(2);
if (second.cache.streamCopyPercent <= 90) {
  throw new Error(
    `Expected the second pass to stream-copy more than 90%, got ${second.cache.streamCopyPercent.toFixed(2)}%.`,
  );
}
console.log(JSON.stringify({
  demoRoot,
  firstPass: first.cache,
  secondPass: second.cache,
  secondManifest: join(demoRoot, "demo-pass-2.manifest.json"),
}, null, 2));
