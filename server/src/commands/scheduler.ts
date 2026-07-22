import { delay } from "../foundation.js";
import { processAbortSignal, reportFatal } from "../process.js";
import { createRuntime, planningProviderWritesEnabled } from "../runtime.js";
import { Scheduler } from "../scheduler.js";

async function main(): Promise<void> {
  const runtime = await createRuntime();
  const scheduler = new Scheduler(
    runtime.database.db,
    planningProviderWritesEnabled(runtime.config)
  );
  const signal = processAbortSignal();
  try {
    while (!signal.aborted) {
      await scheduler.tick();
      await delay(runtime.config.schedulerIntervalMs, signal).catch(() => undefined);
    }
  } finally {
    await runtime.close();
  }
}

void main().catch(reportFatal);
