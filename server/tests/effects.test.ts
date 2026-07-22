import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import type { DesiredCopy } from "@planipus/calendar-sync";

import type { DatabaseSchema } from "../src/database/types.js";
import { FakeCalendarProvider } from "../src/providers/fake.js";
import type { AccessTokenBroker } from "../src/providers/router.js";
import { ProviderRouter } from "../src/providers/router.js";
import { EffectExecutor } from "../src/sync/effects.js";

const DESIRED: DesiredCopy = {
  timing: {
    kind: "timed",
    start_instant: "2026-07-21T17:00:00Z",
    end_instant: "2026-07-21T18:00:00Z",
    start_tzid: "UTC",
    end_tzid: "UTC"
  },
  summary: "Busy",
  transparency: "opaque",
  visibility: "private",
  reminders: [],
  write_controls: { send_notifications: false },
  provenance: {
    version: 1,
    policy_ref: "policy-1",
    projection_ref: "projection-1",
    generation: 1
  }
};

describe("EffectExecutor policy fence", () => {
  it("leases but defers a paused-policy effect before token or provider access", async () => {
    const fixture = pausedEffectDatabase();
    const provider = new FakeCalendarProvider();
    const providerCalls = [
      vi.spyOn(provider, "getEvent"),
      vi.spyOn(provider, "createEvent"),
      vi.spyOn(provider, "updateEvent"),
      vi.spyOn(provider, "deleteEvent")
    ];
    const accessToken = vi.fn<AccessTokenBroker["accessToken"]>(async () => "unused-token");
    const executor = new EffectExecutor(
      fixture.db,
      new ProviderRouter(undefined, provider),
      { accessToken }
    );

    await expect(executor.runBatch("worker-1", 1, 60)).resolves.toBe(1);

    expect(accessToken).not.toHaveBeenCalled();
    for (const providerCall of providerCalls) {
      expect(providerCall).not.toHaveBeenCalled();
    }
    expect(fixture.effect).toMatchObject({
      state: "retry",
      attempt_count: 0,
      lease_owner: null,
      safe_error_code: "policy_paused"
    });
    expect(fixture.audit).toContainEqual(expect.objectContaining({
      action: "copy.deferred",
      reason_code: "policy_paused"
    }));
  });
});

function pausedEffectDatabase(): {
  readonly db: Kysely<DatabaseSchema>;
  readonly effect: Record<string, unknown>;
  readonly audit: Array<Record<string, unknown>>;
} {
  const now = new Date();
  const effect: Record<string, unknown> = {
    id: "effect-1",
    organization_id: "organization-1",
    policy_id: "policy-1",
    projection_id: "projection-1",
    policy_revision: 1,
    operation: "create",
    idempotency_key: `sha256:${"a".repeat(64)}`,
    desired_state: DESIRED,
    state: "pending",
    attempt_count: 0,
    run_after: now,
    lease_owner: null,
    lease_expires_at: null,
    ambiguous: false,
    safe_error_code: null,
    created_at: now,
    updated_at: now
  };
  const target = {
    projection_id: "projection-1",
    generation: 1,
    destination_event_id: null,
    destination_etag: null,
    current_policy_id: "policy-1",
    policy_status: "paused",
    current_policy_revision: 1,
    calendar_remote_id: "destination-primary",
    connection_id: "connection-1",
    calendar_writable: true,
    provider: "fake",
    connection_status: "active",
    intended_role: "destination"
  };
  const policy = {
    id: "policy-1",
    status: "paused",
    revision: 1
  };
  const audit: Array<Record<string, unknown>> = [];
  const database: Record<string, unknown> = {};

  database["transaction"] = () => ({
    execute: async (callback: (transaction: unknown) => unknown) => callback(database)
  });
  database["selectFrom"] = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const method of ["selectAll", "select", "innerJoin", "where", "orderBy", "limit", "forUpdate", "skipLocked"]) {
      builder[method] = chain;
    }
    builder["execute"] = async () => table.startsWith("outbox_effects")
      && (effect["state"] === "pending" || effect["state"] === "retry")
      ? [effect]
      : [];
    builder["executeTakeFirst"] = async () => {
      if (table === "sync_policies") return policy;
      if (table === "outbox_effects" && effect["state"] === "leased") {
        return { id: effect["id"] };
      }
      return table === "projections" ? target : undefined;
    };
    return builder;
  };
  database["updateTable"] = (table: string) => updateBuilder(table, effect);
  database["insertInto"] = (table: string) => {
    let row: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder["values"] = (next: Record<string, unknown>) => {
      row = next;
      return builder;
    };
    builder["executeTakeFirstOrThrow"] = async () => {
      if (table === "audit_facts") audit.push(row);
      return { id: row["id"] };
    };
    return builder;
  };

  return { db: database as unknown as Kysely<DatabaseSchema>, effect, audit };
}

function updateBuilder(table: string, effect: Record<string, unknown>): Record<string, unknown> {
  const predicates: Array<[string, string, unknown]> = [];
  let values: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  const expression = (column: string, operator: string, operand: number): number => {
    const current = Number(effect[column]);
    return operator === "+" ? current + operand : current - operand;
  };
  builder["set"] = (next: Record<string, unknown> | ((value: typeof expression) => Record<string, unknown>)) => {
    values = typeof next === "function" ? next(expression) : next;
    return builder;
  };
  builder["where"] = (...parts: unknown[]) => {
    if (parts.length === 3 && typeof parts[0] === "string" && typeof parts[1] === "string") {
      predicates.push([parts[0], parts[1], parts[2]]);
    }
    return builder;
  };
  const applies = (): boolean => table === "outbox_effects"
    && predicates.every(([column, operator, expected]) => {
      const actual = effect[column];
      if (operator === "=") return actual === expected;
      if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
      if (operator === "<") return actual instanceof Date && expected instanceof Date && actual < expected;
      return true;
    });
  const apply = (): { numUpdatedRows: bigint } => {
    const matched = applies();
    if (matched) Object.assign(effect, values);
    return { numUpdatedRows: matched ? 1n : 0n };
  };
  builder["execute"] = async () => apply();
  builder["executeTakeFirstOrThrow"] = async () => {
    const result = apply();
    if (result.numUpdatedRows !== 1n) throw new Error("fixture update did not match");
    return result;
  };
  return builder;
}
