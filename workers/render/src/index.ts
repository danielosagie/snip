import { createRunnerFromEnv } from "./config";

const controller = new AbortController();
let interruptedBy: NodeJS.Signals | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    interruptedBy = signal;
    controller.abort(new Error(`Received ${signal}.`));
  });
}

try {
  const runner = await createRunnerFromEnv();
  const result = await runner.runNext(controller.signal);
  if (result) {
    console.log(JSON.stringify({
      status: "completed",
      outputKey: result.outputKey,
      manifestKey: result.manifestKey,
      cache: result.cache,
    }));
  } else {
    console.log(JSON.stringify({ status: "idle", reason: "No claimable local job." }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = interruptedBy === "SIGINT" ? 130 : interruptedBy === "SIGTERM" ? 143 : 1;
}
