import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0001_initial.sql", import.meta.url);
const recoveryBasisMigrationUrl = new URL("../migrations/0003_recovery_basis.sql", import.meta.url);
const planningMigrationUrl = new URL("../migrations/0004_planning_rules.sql", import.meta.url);
const jobHistoryMigrationUrl = new URL(
  "../migrations/0005_scheduled_job_history_lookup.sql",
  import.meta.url
);
const apiTokenMigrationUrl = new URL("../migrations/0006_api_tokens.sql", import.meta.url);
const conflictResponseMigrationUrl = new URL(
  "../migrations/0007_conflict_response_rules.sql",
  import.meta.url
);
const availabilityRoleMigrationUrl = new URL(
  "../migrations/0008_availability_connection_role.sql",
  import.meta.url
);
const conflictResponseUniquenessMigrationUrl = new URL(
  "../migrations/0009_conflict_response_uniqueness.sql",
  import.meta.url
);
const conflictInvitationCandidatesMigrationUrl = new URL(
  "../migrations/0010_conflict_invitation_candidates.sql",
  import.meta.url
);
const privateAvailabilityHmacMigrationUrl = new URL(
  "../migrations/0011_private_availability_hmac.sql",
  import.meta.url
);
const conflictResponseProviderIdentityMigrationUrl = new URL(
  "../migrations/0012_conflict_response_provider_identity.sql",
  import.meta.url
);
const declineBudgetAuditIndexMigrationUrl = new URL(
  "../migrations/0013_decline_budget_audit_index.sql",
  import.meta.url
);
const canonicalCalendarProtectionMigrationUrl = new URL(
  "../migrations/0014_canonical_calendar_protection.sql",
  import.meta.url
);

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

  it("indexes retained job history for time-window deduplication", async () => {
    const sql = await readFile(fileURLToPath(jobHistoryMigrationUrl), "utf8");
    expect(sql).toContain("create index scheduled_jobs_history_dedupe_idx");
    expect(sql).toContain("scheduled_jobs (organization_id, kind, dedupe_key)");
    expect(sql).not.toContain("create unique index");
  });

  it("stores only hashed, scoped, expiring API credentials", async () => {
    const sql = await readFile(fileURLToPath(apiTokenMigrationUrl), "utf8");
    expect(sql).toContain("token_hash char(64) not null unique");
    expect(sql).toContain("scopes jsonb not null");
    expect(sql).toContain("expires_at timestamptz not null");
    expect(sql).toContain("where revoked_at is null");
    expect(sql).not.toMatch(/\btoken\s+text\b/);
  });

  it("keeps private availability out of durable decline intents", async () => {
    const sql = await readFile(fileURLToPath(conflictResponseMigrationUrl), "utf8");
    expect(sql).toContain("create table conflict_response_rules");
    expect(sql).toContain("create table conflict_response_availability_calendars");
    expect(sql).toContain("create table invitation_response_actions");
    expect(sql).toContain("work_observation_hash");
    expect(sql).toContain("conflict_basis_hash");
    expect(sql).not.toContain("personal_event_id");
    expect(sql).not.toContain("personal_event_summary");
  });

  it("adds a free-busy-only connection role without altering historical rows", async () => {
    const sql = await readFile(fileURLToPath(availabilityRoleMigrationUrl), "utf8");
    expect(sql).toContain("'availability', 'source', 'destination', 'both'");
    expect(sql).not.toContain("update provider_connections");
  });

  it("allows only one live conflict-response rule to control a work calendar", async () => {
    const sql = await readFile(fileURLToPath(conflictResponseUniquenessMigrationUrl), "utf8");
    expect(sql).toContain("conflict_response_rules_one_live_response_idx");
    expect(sql).toContain("organization_id, response_calendar_id");
    expect(sql).toContain("where status <> 'deleted'");
  });

  it("indexes only future-conflict candidate observations", async () => {
    const sql = await readFile(fileURLToPath(conflictInvitationCandidatesMigrationUrl), "utf8");
    expect(sql).toContain("source_observations_conflict_candidates_idx");
    expect(sql).toContain("relationship,response");
    expect(sql).toContain("needs_action");
  });

  it("accepts keyed private-availability hashes with explicit migration compatibility", async () => {
    const sql = await readFile(fileURLToPath(privateAvailabilityHmacMigrationUrl), "utf8");
    expect(sql).toContain("hmac-sha256");
    expect(sql).toContain("conflict_basis_hash type varchar(76)");
  });

  it("serializes one live controller per underlying provider calendar", async () => {
    const sql = await readFile(fileURLToPath(conflictResponseProviderIdentityMigrationUrl), "utf8");
    expect(sql).toContain("response_provider_identity");
    expect(sql).toContain("conflict_response_rules_one_live_provider_idx");
    expect(sql).toContain("where status <> 'deleted'");
  });

  it("indexes immutable decline facts for the rolling safety budget", async () => {
    const sql = await readFile(fileURLToPath(declineBudgetAuditIndexMigrationUrl), "utf8");
    expect(sql).toContain("audit_facts_invitation_decline_budget_idx");
    expect(sql).toContain("organization_id, created_at, target_id");
    expect(sql).toContain("action = 'invitation_response.declined'");
    expect(sql).toContain("target_type = 'invitation_response_action'");
  });

  it("protects underlying provider calendars across delegated aliases", async () => {
    const sql = await readFile(fileURLToPath(canonicalCalendarProtectionMigrationUrl), "utf8");
    expect(sql).toContain("source_provider_identity");
    expect(sql).toContain("destination_provider_identity");
    expect(sql).toContain("sync_policies_distinct_provider_calendars");
    expect(sql).toContain("safe_error_code = 'same_provider_calendar'");
    expect(sql).toContain("policy.quarantined_same_provider_calendar");
    expect(sql).toContain("effect.state in ('pending', 'leased', 'retry')");
    expect(sql).toContain("provider_calendar_identity");
    expect(sql).toContain("conflict_response_availability_provider_identity_lookup_idx");
    expect(sql).toContain("connection.provider = 'google' then 'global'");
  });
});
