import { setTimeout as delay } from "node:timers/promises";

export interface MigrationRetryOptions {
  readonly attempts: number;
  readonly initialDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly signal?: AbortSignal;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export class MigrationStartupError extends Error {
  public constructor(
    public readonly attempts: number,
    cause: unknown
  ) {
    super(`database migrations did not succeed after ${attempts} attempt${attempts === 1 ? "" : "s"}`, {
      cause
    });
    this.name = "MigrationStartupError";
  }
}

/**
 * Retry the idempotent migration runner while an embedded or separately
 * managed PostgreSQL instance becomes reachable. The bound comes from
 * configuration, and each wait remains short so container termination is
 * responsive when an AbortSignal is supplied.
 */
export async function runMigrationsWithRetry(
  migrate: () => Promise<void>,
  options: MigrationRetryOptions
): Promise<void> {
  if (!Number.isSafeInteger(options.attempts) || options.attempts < 1) {
    throw new TypeError("migration attempts must be a positive safe integer");
  }
  const initialDelayMs = options.initialDelayMs ?? 250;
  const maximumDelayMs = options.maximumDelayMs ?? 2_000;
  if (initialDelayMs < 0 || maximumDelayMs < initialDelayMs) {
    throw new TypeError("migration retry delays are invalid");
  }
  const sleep = options.sleep ?? sleepWithAbort;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    options.signal?.throwIfAborted();
    try {
      await migrate();
      return;
    } catch (error) {
      lastError = error;
    }
    if (attempt < options.attempts) {
      const waitMs = Math.min(maximumDelayMs, initialDelayMs * (2 ** (attempt - 1)));
      await sleep(waitMs, options.signal);
    }
  }
  throw new MigrationStartupError(options.attempts, lastError);
}

async function sleepWithAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await delay(milliseconds, undefined, signal ? { signal } : undefined);
}
