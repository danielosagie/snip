import type { JobRunner } from "./runner";

export interface PollingOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  random?: () => number;
  onError?: (error: unknown) => void;
}

export function jitteredBackoffMs(
  attempt: number,
  options: Pick<PollingOptions, "baseDelayMs" | "maxDelayMs" | "random">,
): number {
  const exponent = Math.max(0, Math.min(20, Math.floor(attempt)));
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** exponent);
  const random = Math.min(1, Math.max(0, (options.random ?? Math.random)()));
  return Math.min(
    options.maxDelayMs,
    Math.max(1, Math.round(ceiling * (0.75 + random * 0.5))),
  );
}

async function waitForPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, delayMs);
    timer.unref();
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Poll forever until aborted. JobRunner owns the claim heartbeat and release path. */
export async function runPollingWorker(
  runner: Pick<JobRunner, "runNext">,
  signal: AbortSignal,
  options: PollingOptions,
): Promise<void> {
  let idleAttempts = 0;
  while (!signal.aborted) {
    try {
      const result = await runner.runNext(signal);
      if (signal.aborted) return;
      if (result) {
        idleAttempts = 0;
        continue;
      }
    } catch (error) {
      if (signal.aborted) return;
      options.onError?.(error);
    }
    await waitForPoll(jitteredBackoffMs(idleAttempts, options), signal);
    idleAttempts += 1;
  }
}
