import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SegmentCache } from "./cache";
import { ConvexJobStore, HttpConvexJobTransport } from "./convexJobStore";
import { LocalJobStore } from "./jobStore";
import type { JobStore } from "./jobStore";
import {
  createObjectStoreFromEnv,
  createR2ObjectStoreFromEnv,
  LocalObjectStore,
  type ObjectStore,
} from "./objectStore";
import { RenderPipeline } from "./pipeline";
import { JobRunner } from "./runner";
import { stableStringify } from "./cacheKey";
import { normalizeJobSpec } from "./validation";

function positiveEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function envFlag(name: string): boolean {
  return ["1", "true", "yes"].includes(process.env[name]?.trim().toLowerCase() ?? "");
}

function requiredEnv(name: string, aliases: string[] = []): string {
  for (const candidate of [name, ...aliases]) {
    const value = process.env[candidate]?.trim();
    if (value) return value;
  }
  throw new Error(`${name} is required.`);
}

export type JobStoreBackend = "local" | "convex";

export function jobStoreBackendFromEnv(): JobStoreBackend {
  const backend = process.env.JOB_STORE_BACKEND?.trim().toLowerCase() || "local";
  if (backend !== "local" && backend !== "convex") {
    throw new Error("JOB_STORE_BACKEND must be local or convex.");
  }
  return backend;
}

async function readJobInput(): Promise<unknown> {
  const inline = process.env.RENDER_JOB_JSON?.trim();
  if (inline) return JSON.parse(inline) as unknown;
  const path = process.env.JOB_SPEC_PATH?.trim();
  if (!path) throw new Error("Set JOB_SPEC_PATH or RENDER_JOB_JSON.");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function cacheStore(primary: ObjectStore): ObjectStore {
  const backend = process.env.CACHE_BACKEND?.trim().toLowerCase();
  if (!backend) return primary;
  if (backend === "r2") return createR2ObjectStoreFromEnv();
  if (backend === "local") {
    const root = process.env.CACHE_LOCAL_DIR?.trim();
    if (!root) throw new Error("CACHE_LOCAL_DIR is required for a local cache.");
    return new LocalObjectStore(root);
  }
  throw new Error("CACHE_BACKEND must be r2 or local.");
}

export async function createRunnerFromEnv(): Promise<JobRunner> {
  const workRoot = process.env.WORK_DIR?.trim() || "/tmp/snip-render";
  const backend = jobStoreBackendFromEnv();
  let store: JobStore;
  if (backend === "convex") {
    store = new ConvexJobStore(new HttpConvexJobTransport({
      siteUrl: requiredEnv("CONVEX_SITE_URL", ["VITE_CONVEX_SITE_URL"]),
      pluginToken: requiredEnv("RENDER_WORKER_PLUGIN_TOKEN"),
      timeoutMs: positiveEnvNumber("CONVEX_HTTP_TIMEOUT_MS", 15_000),
    }));
  } else {
    const input = await readJobInput();
    const envelope = input && typeof input === "object" && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    const spec = normalizeJobSpec(envelope.spec ?? input);
    const defaultId = `local-${createHash("sha256")
      .update(stableStringify(spec))
      .digest("hex")
      .slice(0, 16)}`;
    const jobId = typeof envelope.id === "string" && envelope.id.trim()
      ? envelope.id.trim()
      : process.env.RENDER_JOB_ID?.trim() || defaultId;
    const statePath = process.env.LOCAL_JOB_STATE_PATH?.trim()
      || join(workRoot, `${jobId}.state.json`);
    store = await LocalJobStore.open({ statePath, jobId, spec });
  }
  const primary = createObjectStoreFromEnv();
  const cache = new SegmentCache(
    cacheStore(primary),
    process.env.CACHE_PREFIX?.trim() || "render-cache",
  );
  const pipeline = new RenderPipeline({
    objectStore: primary,
    cache,
    workRoot,
    resultManifestPath: process.env.RESULT_MANIFEST_PATH?.trim() || undefined,
    keepWorkDir: envFlag("KEEP_WORK_DIR"),
  });
  return new JobRunner(store, pipeline, {
    workerId: process.env.WORKER_ID?.trim() || `${hostname()}-${process.pid}`,
    leaseMs: positiveEnvNumber("JOB_LEASE_MS", 30_000),
    heartbeatIntervalMs: positiveEnvNumber("HEARTBEAT_INTERVAL_MS", 5_000),
  });
}
