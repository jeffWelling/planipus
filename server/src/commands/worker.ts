import { hostname } from "node:os";

import { delay, randomToken } from "../foundation.js";
import { PostgresJobQueue } from "../jobs/queue.js";
import { processAbortSignal, reportFatal } from "../process.js";
import { createRuntime } from "../runtime.js";

async function main(): Promise<void> {
  const runtime = await createRuntime();
  const jobs = new PostgresJobQueue(runtime.database.db);
  const signal = processAbortSignal();
  const owner = `${hostname()}:${process.pid}:${randomToken(8)}`;
  try {
    while (!signal.aborted) {
      let work = 0;
      const leased = await jobs.lease(owner, 20, runtime.config.jobLeaseSeconds);
      for (const job of leased) {
        try {
          if (runtime.planningCoordinator.handles(job.kind)) {
            await runtime.planningCoordinator.dispatch(job);
          } else {
            await runtime.coordinator.dispatch(job);
          }
          await jobs.succeed(job.id, owner);
        } catch (error) {
          await jobs.fail(job.id, owner, error, job.attemptCount);
        }
      }
      work += leased.length;
      work += await runtime.effects.runBatch(owner, 20, runtime.config.jobLeaseSeconds);
      if (work === 0) {
        await delay(runtime.config.workerIntervalMs, signal).catch(() => undefined);
      }
    }
  } finally {
    await runtime.close();
  }
}

void main().catch(reportFatal);
