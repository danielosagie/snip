import type { JobStore } from "./jobStore";
import type { JobClaim, JobHeartbeat, RenderJobResult } from "./types";

class LeaseLostError extends Error {}

export interface JobRunnerOptions {
  workerId: string;
  leaseMs: number;
  heartbeatIntervalMs: number;
}

export interface JobPipeline {
  run(
    claim: JobClaim,
    heartbeat: (value: JobHeartbeat) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<RenderJobResult>;
}

export class JobRunner {
  constructor(
    private readonly store: JobStore,
    private readonly pipeline: JobPipeline,
    private readonly options: JobRunnerOptions,
  ) {}

  async runNext(externalSignal?: AbortSignal): Promise<RenderJobResult | null> {
    externalSignal?.throwIfAborted();
    const claim = await this.store.claim(this.options.workerId, this.options.leaseMs);
    if (!claim) return null;
    const controller = new AbortController();
    const abortFromExternal = () => controller.abort(
      externalSignal?.reason ?? new Error("Worker interrupted."),
    );
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    let latest: JobHeartbeat = {
      phase: "claimed",
      progress: 0,
      message: `Claimed by ${this.options.workerId}.`,
    };
    let heartbeatChain = Promise.resolve();
    const sendHeartbeat = async (heartbeat?: JobHeartbeat): Promise<void> => {
      if (heartbeat) latest = heartbeat;
      const next = latest;
      heartbeatChain = heartbeatChain.then(async () => {
        const accepted = await this.store.heartbeat(
          claim,
          next,
          this.options.leaseMs,
        );
        if (!accepted) throw new LeaseLostError(`Lease lost for job ${claim.jobId}.`);
      });
      try {
        await heartbeatChain;
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    };

    await sendHeartbeat();
    const intervalMs = Math.min(
      this.options.heartbeatIntervalMs,
      Math.max(1_000, Math.floor(this.options.leaseMs / 3)),
    );
    const timer = setInterval(() => {
      void sendHeartbeat().catch(() => {
        // The failed heartbeat already aborts the active pipeline.
      });
    }, intervalMs);
    timer.unref();

    try {
      const result = await this.pipeline.run(
        claim,
        async (heartbeat) => await sendHeartbeat(heartbeat),
        controller.signal,
      );
      clearInterval(timer);
      await heartbeatChain;
      await this.store.complete(claim, result);
      return result;
    } catch (error) {
      clearInterval(timer);
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted) {
        await this.safeRelease(claim, `Interrupted: ${message}`);
      } else {
        await this.store.fail(claim, message);
      }
      throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  private async safeRelease(claim: JobClaim, reason: string): Promise<void> {
    try {
      await this.store.release(claim, reason);
    } catch {
      // A rejected release means the lease moved to another worker. Never
      // overwrite the new owner's state during shutdown.
    }
  }
}
