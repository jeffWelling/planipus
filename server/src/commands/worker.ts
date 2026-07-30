import { hostname } from "node:os";

import { delay, randomToken } from "../foundation.js";
import { processLeasedJob } from "../jobs/leased-job.js";
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
      const leased = await jobs.lease(owner, 1, runtime.config.jobLeaseSeconds);
      const job = leased[0];
      if (job) {
        const result = await processLeasedJob(
          jobs,
          job,
          owner,
          runtime.config.jobLeaseSeconds,
          async (leasedJob) => {
            if (runtime.conflictResponseCoordinator.handles(leasedJob.kind)) {
              await runtime.conflictResponseCoordinator.dispatch(leasedJob);
            } else if (runtime.planningCoordinator.handles(leasedJob.kind)) {
              await runtime.planningCoordinator.dispatch(leasedJob);
            } else {
              await runtime.coordinator.dispatch(leasedJob);
            }
          }
        );
        if (result === "lease_lost") {
          process.stderr.write(`Planipus worker lost ownership of job ${job.id}; outcome left to current owner.\n`);
        }
      }
      work += leased.length;
      work += await runtime.effects.runBatch(owner, 1, runtime.config.jobLeaseSeconds);
      if (work === 0) {
        await delay(runtime.config.workerIntervalMs, signal).catch(() => undefined);
      }
    }
  } finally {
    await runtime.close();
  }
}

void main().catch(reportFatal);
