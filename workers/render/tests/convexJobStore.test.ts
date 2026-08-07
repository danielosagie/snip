import { describe, expect, test } from "bun:test";
import {
  ConvexJobStore,
  type ConvexJobTransport,
} from "../src/convexJobStore";
import type { RenderJobResult } from "../src/types";

class MockTransport implements ConvexJobTransport {
  readonly requests: Array<{ path: string; body: unknown }> = [];
  private readonly responses = new Map<string, unknown[]>();

  enqueue(path: string, response: unknown): void {
    this.responses.set(path, [...(this.responses.get(path) ?? []), response]);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    this.requests.push({ path, body });
    const queue = this.responses.get(path) ?? [];
    if (queue.length === 0) throw new Error(`No mock response for ${path}.`);
    const [response, ...rest] = queue;
    this.responses.set(path, rest);
    return response as T;
  }
}

function cache() {
  return {
    hits: 1,
    misses: 1,
    totalSegments: 2,
    hitRate: 0.5,
    hitBytes: 40,
    missBytes: 60,
    totalBytes: 100,
    byteHitRate: 0.4,
    hitDurationSeconds: 1,
    missDurationSeconds: 2,
    totalDurationSeconds: 3,
    streamCopyPercent: 33.333,
  };
}

function result(): RenderJobResult {
  const accounting = cache();
  return {
    outputKey: "render-exports/job.mp4",
    manifestKey: "render-exports/job.manifest.json",
    outputBytes: 123,
    cache: accounting,
    manifest: {
      version: 1,
      jobId: "job-1",
      attempt: 2,
      startedAt: "2026-08-07T00:00:00.000Z",
      completedAt: "2026-08-07T00:00:03.000Z",
      output: {
        key: "render-exports/job.mp4",
        bytes: 123,
        codec: "h264",
        container: "mp4",
        width: 640,
        height: 360,
        durationSeconds: 3,
      },
      sources: [],
      cache: accounting,
      cacheSegments: [],
    },
  };
}

describe("ConvexJobStore", () => {
  test("claims and validates a normalized worker specification", async () => {
    const transport = new MockTransport();
    transport.enqueue("/render-jobs/claim", {
      ok: true,
      claim: {
        jobId: "job-1",
        claimToken: "token-1",
        workerId: "worker-a",
        attempt: 2,
        spec: {
          segments: [{
            sourceKey: "sources/a.mp4",
            sourceContentId: "object-key:sources/a.mp4",
            inSeconds: 0,
            outSeconds: 3,
            effects: { brightness: 0, contrast: 1, saturation: 1, volume: 1, muted: false },
          }],
          target: { codec: "h264", container: "mp4", width: 640, height: 360, fps: 30 },
          outputKey: "render-exports/job.mp4",
          manifestKey: "render-exports/job.manifest.json",
        },
      },
    });
    const store = new ConvexJobStore(transport);
    const claim = await store.claim("worker-a", 30_000);

    expect(claim).toMatchObject({ jobId: "job-1", attempt: 2, workerId: "worker-a" });
    expect(claim?.spec.target).toMatchObject({ pixelFormat: "yuv420p", audioCodec: "aac" });
    expect(transport.requests[0]).toEqual({
      path: "/render-jobs/claim",
      body: { workerId: "worker-a", leaseMs: 30_000 },
    });
  });

  test("returns false when heartbeat observes cancellation", async () => {
    const transport = new MockTransport();
    transport.enqueue("/render-jobs/heartbeat", {
      ok: true,
      accepted: false,
      cancellationRequested: true,
    });
    const store = new ConvexJobStore(transport);
    const accepted = await store.heartbeat(
      {
        jobId: "job-1",
        claimToken: "token-1",
        workerId: "worker-a",
        attempt: 1,
        spec: {} as never,
      },
      { phase: "rendering", progress: 0.5, message: "Halfway" },
      30_000,
    );
    expect(accepted).toBe(false);
    expect(transport.requests[0]?.body).toMatchObject({
      jobId: "job-1",
      claimToken: "token-1",
      phase: "rendering",
      progress: 0.5,
      leaseMs: 30_000,
    });
  });

  test("completes with object and cache accounting and sends structured failures", async () => {
    const transport = new MockTransport();
    transport.enqueue("/render-jobs/complete", { ok: true, accepted: true });
    transport.enqueue("/render-jobs/fail", { ok: true, accepted: true });
    const store = new ConvexJobStore(transport);
    const claim = {
      jobId: "job-1",
      claimToken: "token-1",
      workerId: "worker-a",
      attempt: 1,
      spec: {} as never,
    };

    await store.complete(claim, result());
    await store.fail(claim, "ffmpeg exited 1");

    expect(transport.requests[0]).toEqual({
      path: "/render-jobs/complete",
      body: {
        jobId: "job-1",
        claimToken: "token-1",
        workerId: "worker-a",
        outputObjectKey: "render-exports/job.mp4",
        manifestObjectKey: "render-exports/job.manifest.json",
        outputBytes: 123,
        cache: cache(),
      },
    });
    expect(transport.requests[1]?.body).toMatchObject({
      failure: {
        code: "RENDER_FAILED",
        retryable: false,
        message: "ffmpeg exited 1",
      },
    });
  });
});
