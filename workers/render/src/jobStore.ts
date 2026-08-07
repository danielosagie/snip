import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stableStringify } from "./cacheKey";
import type {
  JobClaim,
  JobHeartbeat,
  RenderJobResult,
  RenderJobSpec,
} from "./types";

export interface JobStore {
  claim(workerId: string, leaseMs: number): Promise<JobClaim | null>;
  heartbeat(
    claim: JobClaim,
    heartbeat: JobHeartbeat,
    leaseMs: number,
  ): Promise<boolean>;
  complete(claim: JobClaim, result: RenderJobResult): Promise<void>;
  fail(claim: JobClaim, error: string): Promise<void>;
  release(claim: JobClaim, reason: string): Promise<void>;
}

type LocalJobStatus = "queued" | "running" | "completed" | "failed";

interface LocalJobState {
  version: 1;
  id: string;
  status: LocalJobStatus;
  spec: RenderJobSpec;
  attempt: number;
  claimedBy?: string;
  claimToken?: string;
  heartbeatAt?: number;
  leaseExpiresAt?: number;
  phase?: JobHeartbeat["phase"];
  progress?: number;
  message?: string;
  result?: RenderJobResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const partPath = `${path}.${randomUUID()}.part`;
  try {
    await writeFile(partPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(partPath, path);
  } catch (error) {
    await rm(partPath, { force: true });
    throw error;
  }
}

export class LocalJobStore implements JobStore {
  private constructor(private readonly statePath: string) {}

  static async open(args: {
    statePath: string;
    jobId: string;
    spec: RenderJobSpec;
  }): Promise<LocalJobStore> {
    const store = new LocalJobStore(args.statePath);
    try {
      const existing = await store.read();
      if (existing.id !== args.jobId) {
        throw new Error(
          `Local job state ${args.statePath} belongs to ${existing.id}, not ${args.jobId}.`,
        );
      }
      if (stableStringify(existing.spec) !== stableStringify(args.spec)) {
        throw new Error(
          `Local job state ${args.statePath} does not match the requested job spec.`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const now = Date.now();
      await atomicWriteJson(args.statePath, {
        version: 1,
        id: args.jobId,
        status: "queued",
        spec: args.spec,
        attempt: 0,
        createdAt: now,
        updatedAt: now,
      } satisfies LocalJobState);
    }
    return store;
  }

  private async read(): Promise<LocalJobState> {
    return JSON.parse(await readFile(this.statePath, "utf8")) as LocalJobState;
  }

  async claim(workerId: string, leaseMs: number): Promise<JobClaim | null> {
    const state = await this.read();
    const now = Date.now();
    const expired = state.status === "running" && (state.leaseExpiresAt ?? 0) <= now;
    if (state.status !== "queued" && !expired) return null;
    const claimToken = randomUUID();
    const next: LocalJobState = {
      ...state,
      status: "running",
      attempt: state.attempt + 1,
      claimedBy: workerId,
      claimToken,
      heartbeatAt: now,
      leaseExpiresAt: now + leaseMs,
      phase: "claimed",
      progress: 0,
      message: expired ? "Reclaimed after an expired lease." : "Claimed.",
      error: undefined,
      updatedAt: now,
    };
    await atomicWriteJson(this.statePath, next);
    return {
      jobId: state.id,
      claimToken,
      workerId,
      attempt: next.attempt,
      spec: state.spec,
    };
  }

  async heartbeat(
    claim: JobClaim,
    heartbeat: JobHeartbeat,
    leaseMs: number,
  ): Promise<boolean> {
    const state = await this.read();
    if (
      state.status !== "running"
      || state.claimToken !== claim.claimToken
      || state.claimedBy !== claim.workerId
    ) {
      return false;
    }
    const now = Date.now();
    await atomicWriteJson(this.statePath, {
      ...state,
      heartbeatAt: now,
      leaseExpiresAt: now + leaseMs,
      phase: heartbeat.phase,
      progress: Math.min(1, Math.max(0, heartbeat.progress)),
      message: heartbeat.message,
      updatedAt: now,
    } satisfies LocalJobState);
    return true;
  }

  async complete(claim: JobClaim, result: RenderJobResult): Promise<void> {
    const state = await this.read();
    this.assertOwnsClaim(state, claim);
    const now = Date.now();
    await atomicWriteJson(this.statePath, {
      ...state,
      status: "completed",
      phase: "complete",
      progress: 1,
      message: "Render completed.",
      result,
      completedAt: now,
      updatedAt: now,
      leaseExpiresAt: undefined,
    } satisfies LocalJobState);
  }

  async fail(claim: JobClaim, error: string): Promise<void> {
    const state = await this.read();
    this.assertOwnsClaim(state, claim);
    await atomicWriteJson(this.statePath, {
      ...state,
      status: "failed",
      message: "Render failed.",
      error,
      updatedAt: Date.now(),
      leaseExpiresAt: undefined,
    } satisfies LocalJobState);
  }

  async release(claim: JobClaim, reason: string): Promise<void> {
    const state = await this.read();
    this.assertOwnsClaim(state, claim);
    await atomicWriteJson(this.statePath, {
      ...state,
      status: "queued",
      claimedBy: undefined,
      claimToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      phase: undefined,
      progress: undefined,
      message: reason,
      updatedAt: Date.now(),
    } satisfies LocalJobState);
  }

  private assertOwnsClaim(state: LocalJobState, claim: JobClaim): void {
    if (
      state.status !== "running"
      || state.claimToken !== claim.claimToken
      || state.claimedBy !== claim.workerId
    ) {
      throw new Error(`Worker ${claim.workerId} no longer owns job ${claim.jobId}.`);
    }
  }
}
