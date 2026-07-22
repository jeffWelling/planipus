import { describe, expect, it, vi } from "vitest";

import {
  MigrationStartupError,
  runMigrationsWithRetry
} from "../src/database/startup.js";

describe("database migration startup", () => {
  it("backs off until a temporarily unavailable database succeeds", async () => {
    const transient = new Error("database unavailable");
    const migrate = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(undefined);
    const waits: number[] = [];

    await runMigrationsWithRetry(migrate, {
      attempts: 5,
      initialDelayMs: 100,
      maximumDelayMs: 150,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      }
    });

    expect(migrate).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([100, 150]);
  });

  it("stops at the configured bound and preserves the final cause", async () => {
    const finalCause = new Error("still unavailable");
    const migrate = vi.fn(async () => {
      throw finalCause;
    });

    await expect(runMigrationsWithRetry(migrate, {
      attempts: 3,
      sleep: async () => undefined
    })).rejects.toMatchObject({
      name: "MigrationStartupError",
      attempts: 3,
      cause: finalCause
    } satisfies Partial<MigrationStartupError>);
    expect(migrate).toHaveBeenCalledTimes(3);
  });

  it("does not retry after cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("shutdown"));
    const migrate = vi.fn(async () => undefined);

    await expect(runMigrationsWithRetry(migrate, {
      attempts: 3,
      signal: controller.signal,
      sleep: async () => undefined
    })).rejects.toThrow("shutdown");
    expect(migrate).not.toHaveBeenCalled();
  });
});
