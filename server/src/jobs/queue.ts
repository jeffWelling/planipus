import { sql, type Kysely, type Transaction, type Updateable } from "kysely";

import { newId, safeErrorCode } from "../foundation.js";
import type { DatabaseSchema, ScheduledJobTable } from "../database/types.js";

export interface LeasedJob {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly attemptCount: number;
}

export class JobLeaseLostError extends Error {
  public constructor(public readonly jobId: string) {
    super(`job lease was lost before transition: ${jobId}`);
    this.name = "JobLeaseLostError";
  }
}

type DbExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export class PostgresJobQueue {
  public constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async enqueue(
    organizationId: string,
    kind: string,
    dedupeKey: string,
    payload: unknown,
    runAfter = new Date(),
    executor: DbExecutor = this.db
  ): Promise<string | null> {
    assertJobPayload(payload);
    const id = newId();
    const inserted = await executor
      .insertInto("scheduled_jobs")
      .values({
        id,
        organization_id: organizationId,
        kind,
        dedupe_key: dedupeKey,
        payload,
        state: "pending",
        attempt_count: 0,
        run_after: runAfter,
        lease_owner: null,
        lease_expires_at: null,
        safe_error_code: null
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning("id")
      .executeTakeFirst();
    return inserted?.id ?? null;
  }

  /** Keep a time-windowed job from being recreated after it has completed.
   * The transaction-scoped advisory lock serializes the same historical key
   * across scheduler replicas; the non-partial lookup index keeps the check
   * bounded across retained terminal rows. */
  public async enqueueOnce(
    organizationId: string,
    kind: string,
    dedupeKey: string,
    payload: unknown,
    runAfter = new Date(),
    executor?: Transaction<DatabaseSchema>
  ): Promise<string | null> {
    assertJobPayload(payload);
    const enqueueInTransaction = async (
      transaction: Transaction<DatabaseSchema>
    ): Promise<string | null> => {
      const lockIdentity = JSON.stringify([organizationId, kind, dedupeKey]);
      await sql`select pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`
        .execute(transaction);
      const existing = await transaction.selectFrom("scheduled_jobs")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where("kind", "=", kind)
        .where("dedupe_key", "=", dedupeKey)
        .executeTakeFirst();
      if (existing) return null;
      return this.enqueue(organizationId, kind, dedupeKey, payload, runAfter, transaction);
    };
    return executor
      ? enqueueInTransaction(executor)
      : this.db.transaction().execute(enqueueInTransaction);
  }

  public async lease(owner: string, limit: number, leaseSeconds: number): Promise<readonly LeasedJob[]> {
    return this.db.transaction().execute(async (transaction) => {
      const now = new Date();
      const expired = await transaction
        .updateTable("scheduled_jobs")
        .set({ state: "retry", lease_owner: null, lease_expires_at: null })
        .where("state", "=", "leased")
        .where("lease_expires_at", "<", now)
        .execute();
      void expired;

      const rows = await transaction
        .selectFrom("scheduled_jobs")
        .selectAll()
        .where("state", "in", ["pending", "retry"])
        .where("run_after", "<=", now)
        .orderBy("run_after", "asc")
        .orderBy("id", "asc")
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.id);
      await transaction
        .updateTable("scheduled_jobs")
        .set((expression) => ({
          state: "leased",
          lease_owner: owner,
          lease_expires_at: new Date(now.getTime() + leaseSeconds * 1_000),
          attempt_count: expression("attempt_count", "+", 1),
          updated_at: now
        }))
        .where("id", "in", ids)
        .execute();
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        kind: row.kind,
        payload: row.payload,
        attemptCount: row.attempt_count + 1
      }));
    });
  }

  public async succeed(id: string, owner: string): Promise<void> {
    await this.transition(id, owner, {
      state: "succeeded",
      lease_owner: null,
      lease_expires_at: null,
      safe_error_code: null,
      updated_at: new Date()
    });
  }

  /** Extend a lease only while this worker still owns it. A false result is a
   * definitive ownership loss; callers must not attempt a terminal transition
   * or assume that another worker has not begun recovery. */
  public async renew(id: string, owner: string, leaseSeconds: number): Promise<boolean> {
    const now = new Date();
    const result = await this.db
      .updateTable("scheduled_jobs")
      .set({
        lease_expires_at: new Date(now.getTime() + leaseSeconds * 1_000),
        updated_at: now
      })
      .where("id", "=", id)
      .where("state", "=", "leased")
      .where("lease_owner", "=", owner)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  public async fail(id: string, owner: string, error: unknown, attemptCount: number): Promise<void> {
    const explicitlyNonRetryable = error !== null
      && typeof error === "object"
      && "retryable" in error
      && error.retryable === false;
    const dead = explicitlyNonRetryable || attemptCount >= 10;
    const seconds = Math.min(3_600, 2 ** Math.min(attemptCount, 10) + Math.random());
    await this.transition(id, owner, {
      state: dead ? "dead" : "retry",
      lease_owner: null,
      lease_expires_at: null,
      run_after: new Date(Date.now() + seconds * 1_000),
      safe_error_code: safeErrorCode(error),
      updated_at: new Date()
    });
  }

  private async transition(
    id: string,
    owner: string,
    values: Updateable<ScheduledJobTable>
  ): Promise<void> {
    const result = await this.db
      .updateTable("scheduled_jobs")
      .set(values)
      .where("id", "=", id)
      .where("state", "=", "leased")
      .where("lease_owner", "=", owner)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) {
      throw new JobLeaseLostError(id);
    }
  }
}

function assertJobPayload(payload: unknown): asserts payload is object {
  if (payload === null || typeof payload !== "object") {
    throw new TypeError("scheduled job payload must be a JSON object or array");
  }
}
