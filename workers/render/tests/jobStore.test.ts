import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalJobStore } from "../src/jobStore";
import { JobRunner, type JobPipeline } from "../src/runner";
import type { RenderJobResult } from "../src/types";
import { normalizeJobSpec } from "../src/validation";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function jobSpec(output = "outputs/render.mp4") {
  return normalizeJobSpec({
    segments: [{
      sourceKey: "sources/original.mp4",
      sourceContentId: "sha256:source-v1",
      inSeconds: 0,
      outSeconds: 2,
    }],
    target: { width: 640, height: 360 },
    outputKey: output,
    manifestKey: `${output}.manifest.json`,
  });
}

function resultFor(outputKey: string): RenderJobResult {
  const cache = {
    hits: 0,
    misses: 1,
    totalSegments: 1,
    hitRate: 0,
    hitBytes: 0,
    missBytes: 100,
    totalBytes: 100,
    byteHitRate: 0,
    hitDurationSeconds: 0,
    missDurationSeconds: 2,
    totalDurationSeconds: 2,
    streamCopyPercent: 0,
  };
  return {
    outputKey,
    manifestKey: `${outputKey}.manifest.json`,
    outputBytes: 100,
    cache,
    manifest: {
      version: 1,
      jobId: "job-1",
      attempt: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      output: {
        key: outputKey,
        bytes: 100,
        codec: "h264",
        container: "mp4",
        width: 640,
        height: 360,
        durationSeconds: 2,
      },
      sources: [],
      cache,
      cacheSegments: [],
    },
  };
}

describe("LocalJobStore", () => {
  test("claims, heartbeats, releases, reclaims, and completes a local job", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-job-store-test-"));
    tempDirectories.push(root);
    const statePath = join(root, "job.json");
    const spec = jobSpec();
    const store = await LocalJobStore.open({ statePath, jobId: "job-1", spec });

    const first = await store.claim("worker-a", 30_000);
    expect(first?.attempt).toBe(1);
    expect(await store.heartbeat(
      first!,
      { phase: "rendering", progress: 0.5 },
      30_000,
    )).toBe(true);
    await store.release(first!, "interrupted");

    const second = await store.claim("worker-b", 30_000);
    expect(second?.attempt).toBe(2);
    await store.complete(second!, resultFor(spec.outputKey));
    expect(await store.claim("worker-c", 30_000)).toBeNull();

    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      status: string;
      attempt: number;
      progress: number;
    };
    expect(state).toMatchObject({ status: "completed", attempt: 2, progress: 1 });
  });

  test("does not reuse a state path for a different job or spec", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-job-state-test-"));
    tempDirectories.push(root);
    const statePath = join(root, "job.json");
    await LocalJobStore.open({ statePath, jobId: "job-1", spec: jobSpec() });

    await expect(LocalJobStore.open({
      statePath,
      jobId: "job-2",
      spec: jobSpec(),
    })).rejects.toThrow("belongs to job-1");
    await expect(LocalJobStore.open({
      statePath,
      jobId: "job-1",
      spec: jobSpec("outputs/different.mp4"),
    })).rejects.toThrow("does not match");
  });
});

describe("JobRunner", () => {
  test("does not claim work when its signal is already aborted", async () => {
    const root = await mkdtemp(join(tmpdir(), "render-job-runner-test-"));
    tempDirectories.push(root);
    const statePath = join(root, "job.json");
    const spec = jobSpec();
    const store = await LocalJobStore.open({ statePath, jobId: "job-1", spec });
    let pipelineCalled = false;
    const pipeline: JobPipeline = {
      async run() {
        pipelineCalled = true;
        return resultFor(spec.outputKey);
      },
    };
    const runner = new JobRunner(store, pipeline, {
      workerId: "worker-a",
      leaseMs: 30_000,
      heartbeatIntervalMs: 5_000,
    });
    const controller = new AbortController();
    controller.abort(new Error("stop before claim"));

    await expect(runner.runNext(controller.signal)).rejects.toThrow("stop before claim");
    expect(pipelineCalled).toBe(false);
    expect((await store.claim("worker-b", 30_000))?.attempt).toBe(1);
  });
});
