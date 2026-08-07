import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { runProcess } from "../src/process";

const durationSeconds = 62;

interface SourceFixture {
  fileName: string;
  description: string;
  videoFilter: string;
  audioFrequency: number;
}

const sources: SourceFixture[] = [
  {
    fileName: "moving-pattern-grain.mp4",
    description: "moving test pattern with deterministic temporal grain",
    videoFilter: "testsrc2=size=1920x1080:rate=30,noise=alls=6:allf=t+u:all_seed=11",
    audioFrequency: 440,
  },
  {
    fileName: "rotating-gradient-grain.mp4",
    description: "rotating eight-color spiral gradient with light deterministic temporal grain",
    videoFilter: [
      "gradients=size=1920x1080:rate=30:type=spiral:speed=0.02:seed=22:nb_colors=8",
      "noise=alls=1:allf=t+u:all_seed=22",
    ].join(","),
    audioFrequency: 660,
  },
  {
    fileName: "cellular-motion.mp4",
    description: "deterministic cellular automaton, nearest-neighbor scaled to 1080p",
    videoFilter: [
      "life=size=640x360:rate=30:ratio=0.12:seed=33:stitch=1:mold=4:life_color=00ff70:death_color=101028:mold_color=ff3060",
      "scale=1920:1080:flags=neighbor",
    ].join(","),
    audioFrequency: 880,
  },
];

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertEmptyDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const existing = await readdir(path);
  if (existing.length > 0) {
    throw new Error(`Fixture directory must be empty: ${path}`);
  }
}

function jobEnvelope(
  id: string,
  contentIds: Record<string, string>,
  edited: boolean,
): object {
  const source = (fileName: string) => `sources/${fileName}`;
  const segment = (fileName: string, inSeconds: number, outSeconds: number) => ({
    sourceKey: source(fileName),
    sourceContentId: `sha256:${contentIds[fileName]}`,
    inSeconds,
    outSeconds,
  });
  return {
    id,
    spec: {
      segments: [
        segment("moving-pattern-grain.mp4", 1.3, 22.3),
        segment("rotating-gradient-grain.mp4", edited ? 5.9 : 4.4, edited ? 26.9 : 25.4),
        segment("cellular-motion.mp4", 7.5, 28.5),
        segment("moving-pattern-grain.mp4", 29.2, 50.2),
        segment("rotating-gradient-grain.mp4", 32.6, 53.6),
        segment("cellular-motion.mp4", 36.1, 57.1),
      ],
      target: {
        codec: "h264",
        container: "mp4",
        width: 1920,
        height: 1080,
        fps: 30,
        crf: 20,
        preset: "fast",
        audioBitrateKbps: 192,
        audioSampleRate: 48_000,
        audioChannels: 2,
      },
      outputKey: "outputs/render-cost.mp4",
      manifestKey: "outputs/render-cost.manifest.json",
    },
  };
}

const requestedRoot = process.argv[2]?.trim();
if (!requestedRoot) {
  throw new Error("Usage: bun run benchmark:render-cost -- /absolute/empty/fixture-directory");
}
if (!isAbsolute(requestedRoot)) {
  throw new Error("The fixture directory must be an absolute path.");
}
const fixtureRoot = resolve(requestedRoot);
await assertEmptyDirectory(fixtureRoot);
const objectRoot = join(fixtureRoot, "objects");
const sourceRoot = join(objectRoot, "sources");
const jobsRoot = join(fixtureRoot, "jobs");
await mkdir(sourceRoot, { recursive: true });
await mkdir(jobsRoot, { recursive: true });

const contentIds: Record<string, string> = {};
const sourceMetadata: object[] = [];
for (const fixture of sources) {
  const destination = join(sourceRoot, fixture.fileName);
  console.log(`Generating ${fixture.fileName}: ${fixture.description}`);
  await runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", fixture.videoFilter,
    "-f", "lavfi", "-i", `sine=frequency=${fixture.audioFrequency}:sample_rate=48000`,
    "-t", String(durationSeconds),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    destination,
  ]);
  const contentId = await sha256File(destination);
  contentIds[fixture.fileName] = contentId;
  sourceMetadata.push({
    fileName: fixture.fileName,
    description: fixture.description,
    durationSeconds,
    videoFilter: fixture.videoFilter,
    audioFrequency: fixture.audioFrequency,
    sha256: contentId,
  });
}

const jobs = [
  ["cold", jobEnvelope("render-cost-cold", contentIds, false)],
  ["warm-unchanged", jobEnvelope("render-cost-warm-unchanged", contentIds, false)],
  ["warm-one-edit", jobEnvelope("render-cost-warm-one-edit", contentIds, true)],
] as const;
for (const [name, contents] of jobs) {
  await writeFile(join(jobsRoot, `${name}.json`), `${JSON.stringify(contents, null, 2)}\n`, "utf8");
}
await writeFile(
  join(fixtureRoot, "source-metadata.json"),
  `${JSON.stringify(sourceMetadata, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  fixtureRoot,
  objectRoot,
  jobsRoot,
  durationSeconds,
  outputDurationSeconds: 126,
}, null, 2));
