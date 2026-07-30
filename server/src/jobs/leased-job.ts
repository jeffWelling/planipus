import {
  JobLeaseLostError,
  type LeasedJob,
  type PostgresJobQueue
} from "./queue.js";

type LeaseQueue = Pick<PostgresJobQueue, "renew" | "succeed" | "fail">;

export type LeasedJobResult = "succeeded" | "failed" | "lease_lost";

/**
 * Run one leased job while periodically extending its ownership window.
 *
 * The final renewal closes the race between a completed dispatch and its
 * terminal transition. If ownership is already gone, the worker deliberately
 * performs no transition: the current owner is responsible for the job.
 */
export async function processLeasedJob(
  queue: LeaseQueue,
  job: LeasedJob,
  owner: string,
  leaseSeconds: number,
  dispatch: (job: LeasedJob) => Promise<void>
): Promise<LeasedJobResult> {
  const heartbeat = new JobLeaseHeartbeat(queue, job.id, owner, leaseSeconds);
  heartbeat.start();
  try {
    await dispatch(job);
  } catch (error) {
    if (!await heartbeat.stopAndConfirmOwnership()) return "lease_lost";
    try {
      await queue.fail(job.id, owner, error, job.attemptCount);
      return "failed";
    } catch (transitionError) {
      if (transitionError instanceof JobLeaseLostError) return "lease_lost";
      throw transitionError;
    }
  }

  if (!await heartbeat.stopAndConfirmOwnership()) return "lease_lost";
  try {
    await queue.succeed(job.id, owner);
    return "succeeded";
  } catch (error) {
    if (error instanceof JobLeaseLostError) return "lease_lost";
    throw error;
  }
}

class JobLeaseHeartbeat {
  private readonly intervalMilliseconds: number;
  private timer: NodeJS.Timeout | undefined;
  private renewal: Promise<void> = Promise.resolve();
  private stopped = false;
  private ownershipLost = false;

  public constructor(
    private readonly queue: Pick<PostgresJobQueue, "renew">,
    private readonly jobId: string,
    private readonly owner: string,
    private readonly leaseSeconds: number
  ) {
    this.intervalMilliseconds = Math.max(1_000, Math.floor(leaseSeconds * 1_000 / 3));
  }

  public start(): void {
    this.schedule();
  }

  public async stopAndConfirmOwnership(): Promise<boolean> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.renewal;
    if (this.ownershipLost) return false;
    return this.queue.renew(this.jobId, this.owner, this.leaseSeconds);
  }

  private schedule(): void {
    if (this.stopped || this.ownershipLost) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.renewal = this.renewal.then(async () => {
        if (this.stopped || this.ownershipLost) return;
        try {
          this.ownershipLost = !await this.queue.renew(
            this.jobId,
            this.owner,
            this.leaseSeconds
          );
        } catch {
          // A transient database error is not proof of ownership loss. Retry
          // on the next heartbeat; the final conditional renewal/transition
          // remains the authority before recording an outcome.
        }
      }).finally(() => {
        this.schedule();
      });
    }, this.intervalMilliseconds);
    this.timer.unref();
  }
}
