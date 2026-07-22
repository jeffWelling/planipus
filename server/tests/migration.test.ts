import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001_initial.sql", import.meta.url);
const recoveryBasisMigrationUrl = new URL("../migrations/0003_recovery_basis.sql", import.meta.url);
const planningMigrationUrl = new URL("../migrations/0004_planning_rules.sql", import.meta.url);

describe("initial PostgreSQL schema", () => {
  it("contains the durable idempotency and tenant integrity constraints", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
    expect(sql).toContain("idempotency_key varchar(71) not null unique");
    expect(sql).toContain("policy_hash varchar(71) not null");
    expect(sql).toContain("source_cursor_fingerprint varchar(71) not null");
    expect(sql).toContain("query_fingerprint varchar(71) not null");
    expect(sql).toContain("'^sha256:[0-9a-f]{64}$'");
    expect(sql).toContain("unique (calendar_endpoint_id, remote_event_id, recurrence_identity)");
    expect(sql).toContain("foreign key (organization_id, source_calendar_id)");
    expect(sql).toContain("where state in ('pending', 'leased', 'retry')");
    expect(sql).toContain("intent_sequence bigint not null default 0");
    expect(sql).toContain("intent_envelope jsonb not null");
    expect(sql).toContain("intended_role text not null");
    expect(sql).toContain("dst_resolution jsonb not null");
  });

  it("does not require privileged extensions", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
    expect(sql.toLowerCase()).not.toContain("create extension");
  });

  it("persists source-plus-tombstone effect authorization and shadow recovery intent", async () => {
    const sql = await readFile(fileURLToPath(recoveryBasisMigrationUrl), "utf8");
    expect(sql).toContain("projections");
    expect(sql).toContain("outbox_effects");
    expect(sql).toContain("source_basis_hash");
    expect(sql).toContain("recovery_operation");
  });

  it("keeps planner ownership separate from calendar-bridge projections", async () => {
    const sql = await readFile(fileURLToPath(planningMigrationUrl), "utf8");
    expect(sql).toContain("create table planning_rules");
    expect(sql).toContain("create table planned_events");
    expect(sql).toContain("create table planning_suggestions");
    expect(sql).toContain("availability_boundary");
    expect(sql).toContain("smart_meeting");
    expect(sql).toContain("unique (rule_id, occurrence_key)");
    expect(sql).not.toContain("references sync_policies");
    expect(sql).not.toContain("references projections");
  });
});
