import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { describe, expect, it } from "vitest";

import type { DesiredCopy, SourceObservation } from "@planipus/calendar-sync";

import { runMigrations } from "../src/database/migrate.js";
import type { DatabaseSchema } from "../src/database/types.js";
import { sharedPolicyRuntime } from "../src/policy/runtime.js";
import { PolicyService, type PolicyDraft } from "../src/policy/service.js";
import { FakeCalendarProvider } from "../src/providers/fake.js";
import { FakeAccessTokenBroker, ProviderRouter } from "../src/providers/router.js";
import { ProviderError, type ProviderWriteResult } from "../src/providers/types.js";
import { CalendarSyncCoordinator } from "../src/sync/coordinator.js";
import { EffectExecutor, managedEventId } from "../src/sync/effects.js";
import { calendarSyncQueryFingerprint } from "../src/sync/query.js";
import { PolicyReconciler } from "../src/sync/reconciliation.js";
import {
  DESTINATION_VERIFICATION_INTERVAL_MILLISECONDS,
  DestinationVerifier
} from "../src/sync/verification.js";

const { Pool } = pg;
const TEST_DATABASE_URL = process.env["PLANIPUS_TEST_DATABASE_URL"]?.trim() || null;
const ORGANIZATION_ID = "00000000-0000-7000-8000-000000000001";
const PRINCIPAL_ID = "00000000-0000-7000-8000-000000000002";
const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../migrations", import.meta.url));

describe.skipIf(TEST_DATABASE_URL === null)("PostgreSQL policy integration", () => {
  it("migrates, activates a policy, and advances calendar-wide full-sync generations", async () => {
    if (TEST_DATABASE_URL === null) {
      throw new Error("PLANIPUS_TEST_DATABASE_URL disappeared after test registration");
    }

    const schema = randomSchemaIdentifier();
    const quotedSchema = quoteIdentifier(schema);
    const administrationPool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
      application_name: "planipus-postgres-integration-admin"
    });
    let schemaCreated = false;
    let database: Kysely<DatabaseSchema> | null = null;

    try {
      await administrationPool.query(`create schema ${quotedSchema}`);
      schemaCreated = true;

      const isolatedPool = new Pool({
        connectionString: TEST_DATABASE_URL,
        // The identifier is generated locally and restricted to [a-z0-9_].
        // Startup options apply the exact schema to every pooled connection,
        // including the raw node-postgres connection used by migrations.
        options: `-csearch_path=${schema}`,
        max: 4,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 30_000,
        application_name: "planipus-postgres-integration"
      });
      database = new Kysely<DatabaseSchema>({
        dialect: new PostgresDialect({ pool: isolatedPool })
      });

      await runMigrations(isolatedPool, MIGRATIONS_DIRECTORY);
      const migrations = await isolatedPool.query<{ name: string }>(
        "select name from server_schema_migrations order by name"
      );
      expect(migrations.rows.map((row) => row.name)).toContain("0001_initial.sql");
      expect(migrations.rows.map((row) => row.name)).toContain("0002_destination_verification.sql");
      expect(migrations.rows.map((row) => row.name)).toContain("0003_recovery_basis.sql");

      const sourceConnectionId = randomUUID();
      const destinationConnectionId = randomUUID();
      const sourceCalendarId = randomUUID();
      const destinationCalendarId = randomUUID();
      const sourceObservationId = randomUUID();
      const sourceObservation = sourceEventForTomorrow();

      await database.transaction().execute(async (transaction) => {
        await transaction
          .insertInto("provider_connections")
          .values([
            {
              id: sourceConnectionId,
              organization_id: ORGANIZATION_ID,
              owner_principal_id: PRINCIPAL_ID,
              provider: "fake",
              remote_subject: `source-${sourceConnectionId}`,
              account_label: "source@example.invalid",
              display_label: "Personal source",
              intended_role: "source",
              email_masked: "s•••••@example.invalid",
              credential_envelope: { fixture: true },
              key_version: "test-v1",
              scopes: JSON.stringify(["calendar.read"]),
              status: "active",
              last_success_at: null,
              safe_error_code: null
            },
            {
              id: destinationConnectionId,
              organization_id: ORGANIZATION_ID,
              owner_principal_id: PRINCIPAL_ID,
              provider: "fake",
              remote_subject: `destination-${destinationConnectionId}`,
              account_label: "destination@example.invalid",
              display_label: "Work destination",
              intended_role: "destination",
              email_masked: "d•••••@example.invalid",
              credential_envelope: { fixture: true },
              key_version: "test-v1",
              scopes: JSON.stringify(["calendar.write"]),
              status: "active",
              last_success_at: null,
              safe_error_code: null
            }
          ])
          .execute();

        await transaction
          .insertInto("calendar_endpoints")
          .values([
            {
              id: sourceCalendarId,
              organization_id: ORGANIZATION_ID,
              connection_id: sourceConnectionId,
              remote_id: "source-primary",
              name: "Personal",
              timezone: "UTC",
              access_role: "reader",
              readable: true,
              writable: false,
              primary_calendar: true,
              capabilities: {}
            },
            {
              id: destinationCalendarId,
              organization_id: ORGANIZATION_ID,
              connection_id: destinationConnectionId,
              remote_id: "destination-primary",
              name: "Work",
              timezone: "UTC",
              access_role: "owner",
              readable: true,
              writable: true,
              primary_calendar: true,
              capabilities: {
                private_visibility: true,
                conference_copy: false,
                color: true
              }
            }
          ])
          .execute();

        await transaction
          .insertInto("source_observations")
          .values({
            id: sourceObservationId,
            organization_id: ORGANIZATION_ID,
            calendar_endpoint_id: sourceCalendarId,
            remote_event_id: sourceObservation.source_event_ref,
            recurrence_identity: "",
            remote_etag: sourceObservation.remote_revision,
            normalized_event: sourceObservation,
            observation_hash: sharedPolicyRuntime.hash(sourceObservation),
            managed_copy: false,
            tombstone: false,
            sync_generation: 1,
            observed_at: new Date()
          })
          .execute();

        const seededAt = new Date();
        await transaction
          .insertInto("sync_cursors")
          .values({
            id: randomUUID(),
            organization_id: ORGANIZATION_ID,
            calendar_endpoint_id: sourceCalendarId,
            query_fingerprint: calendarSyncQueryFingerprint(
              sharedPolicyRuntime,
              "fake",
              "source-primary"
            ),
            sync_token: "preview-ready-cursor",
            generation: 1,
            state: "ready",
            last_started_at: seededAt,
            last_full_sync_at: seededAt,
            last_success_at: seededAt,
            safe_error_code: null
          })
          .execute();
      });

      const connections = await database
        .selectFrom("provider_connections")
        .select(["provider", "scopes"])
        .orderBy("display_label")
        .execute();
      expect(connections).toHaveLength(2);
      expect(connections.every((connection) => connection.provider === "fake")).toBe(true);
      expect(connections.map((connection) => connection.scopes)).toEqual([
        ["calendar.read"],
        ["calendar.write"]
      ]);

      const draft = inlineHoursDraft(sourceCalendarId, destinationCalendarId);
      const policies = new PolicyService(database, sharedPolicyRuntime);
      const preview = await policies.preview(ORGANIZATION_ID, PRINCIPAL_ID, draft);
      expect(preview.counts).toMatchObject({ create: 1, excluded: 0 });

      const previewRow = await database
        .selectFrom("policy_previews")
        .select(["policy_hash", "source_cursor_fingerprint"])
        .where("id", "=", preview.preview_token)
        .executeTakeFirstOrThrow();
      expect(previewRow.policy_hash).toBe(sharedPolicyRuntime.hash(draft));
      expectCanonicalHash(previewRow.policy_hash);
      expectCanonicalHash(previewRow.source_cursor_fingerprint);

      const activated = await policies.activate(
        ORGANIZATION_ID,
        PRINCIPAL_ID,
        preview.preview_token
      );
      expect(activated.revision).toBe(1);

      const policy = await database
        .selectFrom("sync_policies")
        .select(["id", "hours_profile_id", "policy_document", "policy_hash", "status"])
        .where("id", "=", activated.id)
        .executeTakeFirstOrThrow();
      expect(policy.status).toBe("active");
      expect(policy.hours_profile_id).not.toBeNull();
      expectCanonicalHash(policy.policy_hash);
      expect(policy.policy_hash).toBe(sharedPolicyRuntime.hash(policy.policy_document));

      const hoursProfile = await database
        .selectFrom("hours_profiles")
        .select(["weekly_intervals", "exceptions"])
        .where("id", "=", policy.hours_profile_id!)
        .executeTakeFirstOrThrow();
      expect(Array.isArray(hoursProfile.weekly_intervals)).toBe(true);
      expect(hoursProfile.weekly_intervals).toEqual(draft.hours_profile?.weekly);
      expect(Array.isArray(hoursProfile.exceptions)).toBe(true);
      expect(hoursProfile.exceptions).toEqual(draft.hours_profile?.exceptions);

      const job = await database
        .selectFrom("scheduled_jobs")
        .select(["kind", "dedupe_key", "payload", "state", "attempt_count"])
        .where("organization_id", "=", ORGANIZATION_ID)
        .executeTakeFirstOrThrow();
      expect(job).toEqual({
        kind: "reconcile_policy",
        dedupe_key: `policy:${activated.id}:revision:1`,
        payload: { policy_id: activated.id },
        state: "pending",
        attempt_count: 0
      });

      const fakeProvider = new BlockingCreateFakeCalendarProvider();
      const providers = new ProviderRouter(fakeProvider, fakeProvider);
      const tokenBroker = new FakeAccessTokenBroker();
      const reconciler = new PolicyReconciler(database, sharedPolicyRuntime);
      const reconciliation = await reconciler.reconcile(ORGANIZATION_ID, activated.id);
      expect(reconciliation.effectsCreated).toBe(1);
      const projection = await database
        .selectFrom("projections")
        .select(["id", "generation", "destination_event_id"])
        .where("policy_id", "=", activated.id)
        .executeTakeFirstOrThrow();
      const initialEventId = managedEventId(projection.id, projection.generation);
      const effects = new EffectExecutor(database, providers, tokenBroker);

      // A leased intent must respect a pause that happens after reconciliation
      // but before the provider write, then wake safely on resume.
      await policies.setPaused(ORGANIZATION_ID, PRINCIPAL_ID, activated.id, true);
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      const pausedEffect = await database
        .selectFrom("outbox_effects")
        .select(["state", "safe_error_code"])
        .where("projection_id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(pausedEffect).toEqual({
        state: "retry",
        safe_error_code: "policy_paused"
      });
      await expect(fakeProvider.getEvent("token", "destination-primary", initialEventId))
        .resolves.toBeNull();
      await policies.setPaused(ORGANIZATION_ID, PRINCIPAL_ID, activated.id, false);

      // If a provider write wins the policy lock first, pause must wait until
      // both the external write and its local outcome commit. This is the
      // complementary race to the pause-first case above and protects the API
      // guarantee that no already-started write remains after pause returns.
      const createGate = fakeProvider.blockNextCreate();
      const inFlightWrite = effects.runBatch("postgres-integration-worker", 10, 60);
      await withTimeout(createGate.entered, 5_000, "effect did not reach the blocked provider write");
      const inFlightPause = policies.setPaused(
        ORGANIZATION_ID,
        PRINCIPAL_ID,
        activated.id,
        true
      );
      let lockObservationError: unknown = null;
      let pauseWasBlocked = false;
      try {
        pauseWasBlocked = await waitUntil(async () => {
          const activity = await isolatedPool.query<{ waiting: boolean }>(`
            select exists (
              select 1
              from pg_stat_activity
              where datname = current_database()
                and pid <> pg_backend_pid()
                and application_name = 'planipus-postgres-integration'
                and wait_event_type = 'Lock'
                and query ilike '%sync_policies%'
            ) as waiting
          `);
          return activity.rows[0]?.waiting === true;
        }, 5_000);
      } catch (error) {
        lockObservationError = error;
      } finally {
        createGate.release();
      }
      expect(await inFlightWrite).toBe(1);
      await inFlightPause;
      if (lockObservationError) {
        throw lockObservationError;
      }
      expect(pauseWasBlocked).toBe(true);
      const pausedAfterWrite = await database
        .selectFrom("sync_policies")
        .select("status")
        .where("id", "=", activated.id)
        .executeTakeFirstOrThrow();
      expect(pausedAfterWrite.status).toBe("paused");
      await expect(fakeProvider.getEvent("token", "destination-primary", initialEventId))
        .resolves.toMatchObject({
          remoteRevision: "1",
          managedIdentity: {
            policyRef: activated.id,
            projectionRef: projection.id,
            generation: 1
          }
        });
      await policies.setPaused(ORGANIZATION_ID, PRINCIPAL_ID, activated.id, false);

      // A terminal provider effect remains the authoritative queue blocker.
      // The periodic safety reconcile must not relabel it converged/pending,
      // but it must refresh the recovery payload from the current source. A
      // user retry may never replay the dead effect after that source basis
      // changes.
      const terminalUpdate = shiftTimedObservation(sourceObservation, 15 * 60_000);
      await database
        .updateTable("source_observations")
        .set({
          normalized_event: terminalUpdate,
          observation_hash: sharedPolicyRuntime.hash(terminalUpdate),
          remote_etag: terminalUpdate.remote_revision,
          observed_at: new Date(),
          updated_at: new Date()
        })
        .where("id", "=", sourceObservationId)
        .executeTakeFirstOrThrow();
      expect((await reconciler.reconcile(ORGANIZATION_ID, activated.id)).effectsCreated).toBe(1);
      fakeProvider.failNextUpdate();
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      const terminalFailure = await database
        .selectFrom("projections")
        .select(["status", "safe_error_code"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(terminalFailure).toEqual({ status: "failed", safe_error_code: "forced_terminal" });

      const recoveredUpdate = shiftTimedObservation(terminalUpdate, 15 * 60_000);
      await database
        .updateTable("source_observations")
        .set({
          normalized_event: recoveredUpdate,
          observation_hash: sharedPolicyRuntime.hash(recoveredUpdate),
          remote_etag: recoveredUpdate.remote_revision,
          observed_at: new Date(),
          updated_at: new Date()
        })
        .where("id", "=", sourceObservationId)
        .executeTakeFirstOrThrow();
      const afterFailureReconcile = await reconciler.reconcile(ORGANIZATION_ID, activated.id);
      expect(afterFailureReconcile.effectsCreated).toBe(0);
      expect(afterFailureReconcile.counts).toMatchObject({
        "failed:none:blocking_dead_effect": 1
      });
      const stillFailed = await database
        .selectFrom("projections")
        .select(["status", "safe_error_code", "desired_state"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(stillFailed).toMatchObject({ status: "failed", safe_error_code: "forced_terminal" });
      expect((stillFailed.desired_state as unknown as DesiredCopy).timing)
        .toEqual(recoveredUpdate.timing);

      // Recovery keys from the dead predecessor as well as projection status.
      // Simulate a legacy masked status to prove the dead effect remains
      // reachable. Its stale basis is superseded locally; only a subsequent
      // reconcile may enqueue the current source-authoritative payload.
      await database
        .updateTable("projections")
        .set({ status: "converged", safe_error_code: null, updated_at: new Date() })
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(await policies.retryBlocked(
        ORGANIZATION_ID,
        PRINCIPAL_ID,
        activated.id
      )).toBe(1);
      const supersededTerminalEffect = await database
        .selectFrom("outbox_effects")
        .select(["state", "safe_error_code"])
        .where("projection_id", "=", projection.id)
        .where("safe_error_code", "=", "recovery_basis_changed")
        .executeTakeFirstOrThrow();
      expect(supersededTerminalEffect).toEqual({
        state: "succeeded",
        safe_error_code: "recovery_basis_changed"
      });
      expect(await fakeProvider.getEvent("token", "destination-primary", initialEventId))
        .toMatchObject({ remoteRevision: "1" });
      expect(fakeProvider.desired("destination-primary", initialEventId)?.timing)
        .toEqual(sourceObservation.timing);
      const currentRecoveryEffect = await database
        .selectFrom("outbox_effects")
        .select(["ambiguous", "desired_state"])
        .where("projection_id", "=", projection.id)
        .where("state", "=", "pending")
        .orderBy("created_at", "desc")
        .executeTakeFirstOrThrow();
      expect(currentRecoveryEffect.ambiguous).toBe(true);
      expect((currentRecoveryEffect.desired_state as unknown as DesiredCopy).timing)
        .toEqual(recoveredUpdate.timing);
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      const terminalRecovery = await database
        .selectFrom("projections")
        .select(["status", "safe_error_code"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(terminalRecovery).toEqual({ status: "converged", safe_error_code: null });
      expect(fakeProvider.desired("destination-primary", initialEventId)?.timing)
        .toEqual(recoveredUpdate.timing);

      // Tombstone is part of the source basis even when an ingestion pass has
      // not rewritten the normalized payload/hash. A queued create whose row
      // becomes tombstoned must be superseded before provider access and must
      // never recreate a deleted/excluded source event.
      const tombstoneObservationId = randomUUID();
      const tombstoneSource = sourceEventForTomorrow();
      await database
        .insertInto("source_observations")
        .values({
          id: tombstoneObservationId,
          organization_id: ORGANIZATION_ID,
          calendar_endpoint_id: sourceCalendarId,
          remote_event_id: tombstoneSource.source_event_ref,
          recurrence_identity: "",
          remote_etag: tombstoneSource.remote_revision,
          normalized_event: tombstoneSource,
          observation_hash: sharedPolicyRuntime.hash(tombstoneSource),
          managed_copy: false,
          tombstone: false,
          sync_generation: 1,
          observed_at: new Date()
        })
        .executeTakeFirstOrThrow();
      expect((await reconciler.reconcile(ORGANIZATION_ID, activated.id)).effectsCreated).toBe(1);
      const tombstoneProjection = await database
        .selectFrom("projections")
        .select(["id", "generation"])
        .where("source_observation_id", "=", tombstoneObservationId)
        .where("policy_id", "=", activated.id)
        .executeTakeFirstOrThrow();
      const tombstoneEventId = managedEventId(
        tombstoneProjection.id,
        tombstoneProjection.generation
      );
      await database
        .updateTable("source_observations")
        .set({ tombstone: true, observed_at: new Date(), updated_at: new Date() })
        .where("id", "=", tombstoneObservationId)
        .executeTakeFirstOrThrow();
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      await expect(fakeProvider.getEvent("token", "destination-primary", tombstoneEventId))
        .resolves.toBeNull();
      expect((await reconciler.reconcile(ORGANIZATION_ID, activated.id)).effectsCreated).toBe(1);
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      await expect(fakeProvider.getEvent("token", "destination-primary", tombstoneEventId))
        .resolves.toBeNull();
      const deletedTombstoneProjection = await database
        .selectFrom("projections")
        .select(["status", "destination_event_id"])
        .where("id", "=", tombstoneProjection.id)
        .executeTakeFirstOrThrow();
      expect(deletedTombstoneProjection).toEqual({
        status: "deleted",
        destination_event_id: null
      });

      const verifier = new DestinationVerifier(
        database,
        sharedPolicyRuntime,
        providers,
        tokenBroker
      );

      fakeProvider.simulateManualEdit(
        "destination-primary",
        initialEventId,
        (event) => ({ ...event, summary: "Edited in the work calendar" })
      );
      await ageProjectionVerification(database, projection.id);
      const driftSummary = await verifier.verifyBatch(
        ORGANIZATION_ID,
        100,
        new Date()
      );
      expect(driftSummary).toMatchObject({ claimed: 1, repairsScheduled: 1, held: 0 });

      // The copy can disappear after verification reads it but before the
      // queued update reaches Google. The stale update must not reuse the
      // deleted custom ID: the first execution advances generation and queues
      // a new create, and the second execution writes that fresh ID.
      fakeProvider.simulateManualDelete("destination-primary", initialEventId);
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      const racedReplacementProjection = await database
        .selectFrom("projections")
        .select(["generation", "destination_event_id", "desired_hash", "desired_state", "status"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      const racedReplacementDesired = racedReplacementProjection.desired_state as unknown as DesiredCopy;
      const racedReplacementEventId = managedEventId(
        projection.id,
        racedReplacementProjection.generation
      );
      expect(racedReplacementProjection.generation).toBe(2);
      expect(racedReplacementProjection.destination_event_id).toBeNull();
      expect(racedReplacementProjection.status).toBe("pending");
      expect(racedReplacementEventId).not.toBe(initialEventId);
      expect(racedReplacementDesired.provenance.generation).toBe(2);
      expect(racedReplacementProjection.desired_hash).toBe(
        sharedPolicyRuntime.hash(racedReplacementDesired)
      );
      const racedEffects = await database
        .selectFrom("outbox_effects")
        .select(["operation", "state", "safe_error_code"])
        .where("projection_id", "=", projection.id)
        .orderBy("created_at", "asc")
        .execute();
      expect(racedEffects.at(-2)).toMatchObject({
        operation: "update",
        state: "succeeded",
        safe_error_code: "destination_missing_generation_advanced"
      });
      expect(racedEffects.at(-1)).toMatchObject({ operation: "create", state: "pending" });
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      await expect(fakeProvider.getEvent("token", "destination-primary", initialEventId))
        .resolves.toBeNull();
      await expect(fakeProvider.getEvent("token", "destination-primary", racedReplacementEventId))
        .resolves.toMatchObject({
          managedIdentity: {
            policyRef: activated.id,
            projectionRef: projection.id,
            generation: 2
          }
        });

      // Google custom IDs cannot generally be reused after deletion. Advance
      // generation and rewrite provenance before creating a replacement.
      fakeProvider.simulateManualDelete("destination-primary", racedReplacementEventId);
      await ageProjectionVerification(database, projection.id);
      const missingSummary = await verifier.verifyBatch(
        ORGANIZATION_ID,
        100,
        new Date()
      );
      expect(missingSummary).toMatchObject({ claimed: 1, repairsScheduled: 1, held: 0 });
      const replacementProjection = await database
        .selectFrom("projections")
        .select(["generation", "destination_event_id", "desired_hash", "desired_state", "status"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      const replacementDesired = replacementProjection.desired_state as unknown as DesiredCopy;
      const replacementEventId = managedEventId(projection.id, replacementProjection.generation);
      expect(replacementProjection.generation).toBe(3);
      expect(replacementProjection.destination_event_id).toBeNull();
      expect(replacementProjection.status).toBe("pending");
      expect(replacementEventId).not.toBe(racedReplacementEventId);
      expect(replacementDesired.provenance.generation).toBe(3);
      expect(replacementProjection.desired_hash).toBe(sharedPolicyRuntime.hash(replacementDesired));
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      await expect(fakeProvider.getEvent("token", "destination-primary", racedReplacementEventId))
        .resolves.toBeNull();
      await expect(fakeProvider.getEvent("token", "destination-primary", replacementEventId))
        .resolves.toMatchObject({
          managedIdentity: {
            policyRef: activated.id,
            projectionRef: projection.id,
            generation: 3
          }
        });

      // An unrelated event occupying the durable mapping is never overwritten
      // or adopted, even though its remote identifier matches.
      fakeProvider.simulateManualDelete("destination-primary", replacementEventId);
      fakeProvider.setUnmanagedEvent("destination-primary", replacementEventId);
      await ageProjectionVerification(database, projection.id);
      const ownershipSummary = await verifier.verifyBatch(
        ORGANIZATION_ID,
        100,
        new Date()
      );
      expect(ownershipSummary).toMatchObject({ claimed: 1, repairsScheduled: 0, held: 1 });
      const heldProjection = await database
        .selectFrom("projections")
        .select(["status", "ownership", "recovery_operation", "safe_error_code"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(heldProjection).toEqual({
        status: "held",
        ownership: "ambiguous",
        recovery_operation: "update",
        safe_error_code: "ownership_mismatch"
      });
      const heldIdentity = await database
        .selectFrom("projections")
        .select(["generation", "destination_event_id"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(heldIdentity).toEqual({
        generation: 3,
        destination_event_id: replacementEventId
      });
      const heldEvidenceBeforeReconcile = await database
        .selectFrom("projections")
        .select(["desired_hash", "desired_state", "safe_error_code"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      const heldSafetyReconcile = await reconciler.reconcile(ORGANIZATION_ID, activated.id);
      expect(heldSafetyReconcile.effectsCreated).toBe(0);
      const heldEvidenceAfterReconcile = await database
        .selectFrom("projections")
        .select(["status", "ownership", "desired_hash", "desired_state", "safe_error_code"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(heldEvidenceAfterReconcile).toEqual({
        status: "held",
        ownership: "ambiguous",
        ...heldEvidenceBeforeReconcile
      });
      await expect(fakeProvider.getEvent("token", "destination-primary", replacementEventId))
        .resolves.toMatchObject({ managedIdentity: null, remoteRevision: "1" });

      // Explicit recovery never assumes that the user fixed the collision: it
      // re-reads first, holds again while the foreign event remains, and only
      // rotates to a fresh generation after the conflicting event is removed.
      const deadBeforeRecovery = await database
        .selectFrom("outbox_effects")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("projection_id", "=", projection.id)
        .where("state", "=", "dead")
        .executeTakeFirstOrThrow();
      expect(Number(deadBeforeRecovery.count)).toBe(0);
      expect(await policies.retryBlocked(
        ORGANIZATION_ID,
        PRINCIPAL_ID,
        activated.id
      )).toBe(1);
      const manualRecoveryEffect = await database
        .selectFrom("outbox_effects")
        .select(["operation", "state", "ambiguous"])
        .where("projection_id", "=", projection.id)
        .where("state", "=", "pending")
        .executeTakeFirstOrThrow();
      expect(manualRecoveryEffect).toEqual({
        operation: "update",
        state: "pending",
        ambiguous: true
      });
      const identityBeforeRecoveryExecution = await database
        .selectFrom("projections")
        .select(["generation", "destination_event_id", "recovery_operation"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(identityBeforeRecoveryExecution).toEqual({
        generation: 3,
        destination_event_id: replacementEventId,
        recovery_operation: null
      });
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      const repeatedHold = await database
        .selectFrom("outbox_effects")
        .select(["state", "safe_error_code", "ambiguous"])
        .where("projection_id", "=", projection.id)
        .where("state", "=", "dead")
        .executeTakeFirstOrThrow();
      expect(repeatedHold).toEqual({
        state: "dead",
        safe_error_code: "ownership_mismatch",
        ambiguous: true
      });
      const projectionAfterRepeatedHold = await database
        .selectFrom("projections")
        .select(["generation", "destination_event_id", "status", "ownership"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(projectionAfterRepeatedHold).toMatchObject({
        generation: 3,
        destination_event_id: replacementEventId,
        status: "held",
        ownership: "ambiguous"
      });
      await expect(fakeProvider.getEvent("token", "destination-primary", replacementEventId))
        .resolves.toMatchObject({ managedIdentity: null });

      fakeProvider.simulateManualDelete("destination-primary", replacementEventId);
      expect(await policies.retryBlocked(
        ORGANIZATION_ID,
        PRINCIPAL_ID,
        activated.id
      )).toBe(1);
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      const replacementPending = await database
        .selectFrom("projections")
        .select(["generation", "destination_event_id", "status"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      expect(replacementPending).toMatchObject({
        generation: 4,
        destination_event_id: null,
        status: "pending"
      });
      const pendingReplacementEffect = await database
        .selectFrom("outbox_effects")
        .select(["operation", "state", "ambiguous"])
        .where("projection_id", "=", projection.id)
        .where("state", "=", "pending")
        .executeTakeFirstOrThrow();
      expect(pendingReplacementEffect).toEqual({
        operation: "create",
        state: "pending",
        ambiguous: false
      });
      expect(await effects.runBatch("postgres-integration-worker", 10, 60)).toBe(1);
      const recoveredProjection = await database
        .selectFrom("projections")
        .select(["generation", "destination_event_id", "status", "ownership"])
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      const recoveredEventId = managedEventId(projection.id, recoveredProjection.generation);
      expect(recoveredProjection).toMatchObject({
        generation: 4,
        destination_event_id: recoveredEventId,
        status: "converged",
        ownership: "attached"
      });
      await expect(fakeProvider.getEvent("token", "destination-primary", recoveredEventId))
        .resolves.toMatchObject({
          managedIdentity: {
            policyRef: activated.id,
            projectionRef: projection.id,
            generation: 4
          }
        });

      // A new cursor fingerprint must start above every existing observation
      // generation. Otherwise an empty full scan cannot tombstone rows left by
      // an older fingerprint whose generation is equal to or greater than 1.
      fakeProvider.setObservations("source-primary", []);
      const currentQueryFingerprint = calendarSyncQueryFingerprint(
        sharedPolicyRuntime,
        "fake",
        "source-primary"
      );
      await database
        .updateTable("sync_cursors")
        .set({
          query_fingerprint: sharedPolicyRuntime.hash({
            obsolete_query: currentQueryFingerprint
          }),
          updated_at: new Date()
        })
        .where("calendar_endpoint_id", "=", sourceCalendarId)
        .where("query_fingerprint", "=", currentQueryFingerprint)
        .executeTakeFirstOrThrow();
      const sync = new CalendarSyncCoordinator(
        database,
        sharedPolicyRuntime,
        providers,
        tokenBroker
      );
      expect(await sync.syncCalendar(ORGANIZATION_ID, sourceCalendarId)).toBe(0);
      const cursor = await database
        .selectFrom("sync_cursors")
        .select(["generation", "state"])
        .where("calendar_endpoint_id", "=", sourceCalendarId)
        .where("query_fingerprint", "=", currentQueryFingerprint)
        .executeTakeFirstOrThrow();
      expect(Number(cursor.generation)).toBe(2);
      expect(cursor.state).toBe("ready");
      const tombstoned = await database
        .selectFrom("source_observations")
        .select(["tombstone", "sync_generation", "normalized_event"])
        .where("calendar_endpoint_id", "=", sourceCalendarId)
        .executeTakeFirstOrThrow();
      expect(tombstoned.tombstone).toBe(true);
      expect(Number(tombstoned.sync_generation)).toBe(2);
      expect((tombstoned.normalized_event as SourceObservation).lifecycle).toBe("deleted");

      // Repeated source states must create new durable intents even when the
      // desired payload cycles A -> B -> A -> B. Hashing only desired content
      // would collide with an already-succeeded or queued historical effect.
      // Detach the earlier scenario so its source tombstone cannot add a
      // second, unrelated delete intent to these exact counts.
      await database
        .updateTable("projections")
        .set({ ownership: "detached", status: "held", updated_at: new Date() })
        .where("id", "=", projection.id)
        .executeTakeFirstOrThrow();
      const oscillatingObservationId = randomUUID();
      const oscillatingA = sourceEventForTomorrow();
      const oscillatingB = shiftTimedObservation(oscillatingA, 30 * 60_000);
      await database
        .insertInto("source_observations")
        .values({
          id: oscillatingObservationId,
          organization_id: ORGANIZATION_ID,
          calendar_endpoint_id: sourceCalendarId,
          remote_event_id: oscillatingA.source_event_ref,
          recurrence_identity: oscillatingA.source_occurrence_ref,
          remote_etag: oscillatingA.remote_revision,
          normalized_event: oscillatingA,
          observation_hash: sharedPolicyRuntime.hash(oscillatingA),
          managed_copy: false,
          tombstone: false,
          sync_generation: 2,
          observed_at: new Date()
        })
        .executeTakeFirstOrThrow();
      const initialOscillation = await reconciler.reconcile(ORGANIZATION_ID, activated.id);
      expect(initialOscillation.effectsCreated, JSON.stringify(initialOscillation.counts)).toBe(1);
      for (const state of [oscillatingB, oscillatingA, oscillatingB]) {
        await database
          .updateTable("source_observations")
          .set({
            normalized_event: state,
            observation_hash: sharedPolicyRuntime.hash(state),
            remote_etag: state.remote_revision,
            observed_at: new Date(),
            updated_at: new Date()
          })
          .where("id", "=", oscillatingObservationId)
          .executeTakeFirstOrThrow();
        expect((await reconciler.reconcile(ORGANIZATION_ID, activated.id)).effectsCreated).toBe(1);
      }
      const oscillatingProjection = await database
        .selectFrom("projections")
        .select(["id", "intent_sequence", "desired_state"])
        .where("source_observation_id", "=", oscillatingObservationId)
        .executeTakeFirstOrThrow();
      expect(Number(oscillatingProjection.intent_sequence)).toBe(4);
      expect((oscillatingProjection.desired_state as unknown as DesiredCopy).timing)
        .toEqual(oscillatingB.timing);
      const oscillatingEffects = await database
        .selectFrom("outbox_effects")
        .select("idempotency_key")
        .where("projection_id", "=", oscillatingProjection.id)
        .execute();
      expect(oscillatingEffects).toHaveLength(4);
      expect(new Set(oscillatingEffects.map((effect) => effect.idempotency_key)).size).toBe(4);
    } finally {
      await database?.destroy().catch(() => undefined);
      if (schemaCreated) {
        await administrationPool.query(`drop schema ${quotedSchema} cascade`);
      }
      await administrationPool.end();
    }
  }, 60_000);
});

function randomSchemaIdentifier(): string {
  const identifier = `planipus_it_${randomUUID().replaceAll("-", "")}`;
  if (!/^planipus_it_[0-9a-f]{32}$/u.test(identifier)) {
    throw new Error("generated PostgreSQL integration schema identifier was invalid");
  }
  return identifier;
}

function quoteIdentifier(identifier: string): string {
  if (!/^planipus_it_[0-9a-f]{32}$/u.test(identifier)) {
    throw new TypeError("refusing to quote a non-test schema identifier");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function expectCanonicalHash(value: string): void {
  expect(value).toHaveLength(71);
  expect(value).toMatch(/^sha256:[0-9a-f]{64}$/u);
}

async function ageProjectionVerification(
  database: Kysely<DatabaseSchema>,
  projectionId: string
): Promise<void> {
  await database
    .updateTable("projections")
    .set({
      last_verified_at: new Date(
        Date.now() - DESTINATION_VERIFICATION_INTERVAL_MILLISECONDS - 60_000
      )
    })
    .where("id", "=", projectionId)
    .executeTakeFirstOrThrow();
}

function sourceEventForTomorrow(): SourceObservation {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(12, 0, 0, 0);
  const end = new Date(tomorrow.getTime() + 60 * 60_000);
  return {
    source_event_ref: `event-${randomUUID()}`,
    source_occurrence_ref: "",
    remote_revision: "etag-1",
    lifecycle: "confirmed",
    origin: "provider_original",
    timing: {
      kind: "timed",
      start_instant: tomorrow.toISOString(),
      end_instant: end.toISOString(),
      start_tzid: "UTC",
      end_tzid: "UTC"
    },
    availability: "busy",
    relationship: { role: "organizer", response: "accepted" },
    destination_identity_invited: false,
    content: { summary: "Private appointment" }
  };
}

function shiftTimedObservation(
  source: SourceObservation,
  milliseconds: number
): SourceObservation {
  const timing = source.timing;
  if (!timing || timing.kind !== "timed") {
    throw new TypeError("oscillation fixture requires a timed event");
  }
  return {
    ...source,
    remote_revision: `${source.remote_revision}-shifted`,
    timing: {
      kind: "timed",
      start_instant: new Date(
        new Date(timing.start_instant).getTime() + milliseconds
      ).toISOString(),
      end_instant: new Date(
        new Date(timing.end_instant).getTime() + milliseconds
      ).toISOString(),
      start_tzid: timing.start_tzid,
      end_tzid: timing.end_tzid
    }
  };
}

function inlineHoursDraft(sourceCalendarId: string, destinationCalendarId: string): PolicyDraft {
  return {
    name: "Personal during work hours",
    source_calendar_id: sourceCalendarId,
    destination_calendar_id: destinationCalendarId,
    hours: { mode: "overlaps_profile" },
    hours_profile: {
      name: "Every day",
      timezone: "UTC",
      dst_resolution: {
        ambiguous: "earlier_offset",
        nonexistent: "shift_forward_by_gap"
      },
      weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        start: "00:00:00",
        end: "23:59:59",
        end_day_offset: 0 as const
      })),
      exceptions: [{ date: "2099-12-31", kind: "closed" }]
    },
    privacy: {
      preset: "busy_only",
      preset_version: 1,
      generic_summary: "Busy",
      copy_summary: false,
      copy_description: false,
      copy_location: false,
      copy_conference: false,
      copy_attendees: false,
      copy_organizer: false
    },
    selection: {
      timed: "include",
      all_day: "skip",
      free_events: "skip_when_redacted",
      tentative: "busy",
      unanswered: "free",
      skip_when_destination_identity_invited: true,
      source_exclusion_marker: "#nosync",
      manual_exclusions: []
    },
    destination: {},
    horizon: { past_days: 30, future_days: 365 }
  };
}

class BlockingCreateFakeCalendarProvider extends FakeCalendarProvider {
  private failUpdate = false;
  private nextCreateGate: {
    readonly entered: () => void;
    readonly released: Promise<void>;
  } | null = null;

  public failNextUpdate(): void {
    this.failUpdate = true;
  }

  public blockNextCreate(): { readonly entered: Promise<void>; readonly release: () => void } {
    if (this.nextCreateGate) {
      throw new Error("a fake provider create is already blocked");
    }
    let signalEntered: () => void = () => undefined;
    let signalReleased: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      signalReleased = resolve;
    });
    this.nextCreateGate = { entered: signalEntered, released };
    return { entered, release: signalReleased };
  }

  public override async createEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult> {
    const gate = this.nextCreateGate;
    if (gate) {
      this.nextCreateGate = null;
      gate.entered();
      await gate.released;
    }
    return super.createEvent(accessToken, calendarId, eventId, desired);
  }

  public override async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult> {
    if (this.failUpdate) {
      this.failUpdate = false;
      throw new ProviderError(
        "forced_terminal",
        "forced terminal provider failure for recovery coverage",
        false
      );
    }
    return super.updateEvent(accessToken, calendarId, eventId, expectedRevision, desired);
  }
}

async function waitUntil(check: () => Promise<boolean>, timeoutMilliseconds: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await check()) {
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
