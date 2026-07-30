import { afterEach, describe, expect, it, vi } from "vitest";

import { processLeasedJob } from "../src/jobs/leased-job.js";
import { JobLeaseLostError, type LeasedJob } from "../src/jobs/queue.js";

const JOB: LeasedJob = {
  id: "00000000-0000-7000-8000-000000000101",
  organizationId: "00000000-0000-7000-8000-000000000001",
  kind: "reconcile_conflict_response_rule",
  payload: { rule_id: "00000000-0000-7000-8000-000000000201" },
  attemptCount: 1
};

afterEach(() => {
  vi.useRealTimers();
});

describe("processLeasedJob", () => {
  it("renews a slow job before recording success", async () => {
    vi.useFakeTimers();
    const queue = leaseQueue();
    let finishDispatch: () => void = () => undefined;
    const dispatchPending = new Promise<void>((resolve) => {
      finishDispatch = resolve;
    });

    const result = processLeasedJob(queue, JOB, "worker-1", 60, async () => {
      await dispatchPending;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(queue.renew).toHaveBeenCalledTimes(1);

    finishDispatch();
    await expect(result).resolves.toBe("succeeded");
    expect(queue.renew).toHaveBeenCalledTimes(2);
    expect(queue.succeed).toHaveBeenCalledWith(JOB.id, "worker-1");
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("does not transition a job after a heartbeat proves ownership was lost", async () => {
    vi.useFakeTimers();
    const queue = leaseQueue();
    queue.renew.mockResolvedValue(false);
    let finishDispatch: () => void = () => undefined;
    const dispatchPending = new Promise<void>((resolve) => {
      finishDispatch = resolve;
    });

    const result = processLeasedJob(queue, JOB, "worker-1", 60, async () => {
      await dispatchPending;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    finishDispatch();

    await expect(result).resolves.toBe("lease_lost");
    expect(queue.succeed).not.toHaveBeenCalled();
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("records a dispatch failure while the lease is still owned", async () => {
    const queue = leaseQueue();
    const failure = new Error("provider unavailable");

    await expect(processLeasedJob(queue, JOB, "worker-1", 60, async () => {
      throw failure;
    })).resolves.toBe("failed");

    expect(queue.renew).toHaveBeenCalledOnce();
    expect(queue.fail).toHaveBeenCalledWith(JOB.id, "worker-1", failure, 1);
    expect(queue.succeed).not.toHaveBeenCalled();
  });

  it.each(["succeed", "fail"] as const)(
    "treats ownership loss during %s as a handled result",
    async (transition) => {
      const queue = leaseQueue();
      queue[transition].mockRejectedValue(new JobLeaseLostError(JOB.id));
      const dispatch = transition === "fail"
        ? async (): Promise<void> => { throw new Error("dispatch failed"); }
        : async (): Promise<void> => undefined;

      await expect(processLeasedJob(queue, JOB, "worker-1", 60, dispatch))
        .resolves.toBe("lease_lost");
    }
  );
});

function leaseQueue(): {
  readonly renew: ReturnType<typeof vi.fn<(id: string, owner: string, leaseSeconds: number) => Promise<boolean>>>;
  readonly succeed: ReturnType<typeof vi.fn<(id: string, owner: string) => Promise<void>>>;
  readonly fail: ReturnType<typeof vi.fn<(
    id: string,
    owner: string,
    error: unknown,
    attemptCount: number
  ) => Promise<void>>>;
} {
  return {
    renew: vi.fn(async () => true),
    succeed: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined)
  };
}
