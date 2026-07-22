import type { SourceObservation } from "@planipus/calendar-sync";

import { loadConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import { runMigrations } from "../database/migrate.js";
import { runMigrationsWithRetry } from "../database/startup.js";
import {
  OWNER_PRINCIPAL_ID,
  PERSONAL_ORGANIZATION_ID
} from "../foundation.js";
import { sharedPolicyRuntime } from "../policy/runtime.js";
import { reportFatal } from "../process.js";
import { repairFakeDemoCrossAccountEndpoints } from "../providers/fake-demo-repair.js";
import { calendarSyncQueryFingerprint } from "../sync/query.js";

const SOURCE_CONNECTION_ID = "00000000-0000-7000-8000-000000000010";
const DESTINATION_CONNECTION_ID = "00000000-0000-7000-8000-000000000011";
const SOURCE_CALENDAR_ID = "00000000-0000-7000-8000-000000000020";
const DESTINATION_CALENDAR_ID = "00000000-0000-7000-8000-000000000021";
const SOURCE_CURSOR_ID = "00000000-0000-7000-8000-000000000030";
const SOURCE_OBSERVATION_ID = "00000000-0000-7000-8000-000000000031";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.environment === "production" || config.providerMode !== "fake") {
    throw new Error("fake demo data may be seeded only outside production in fake provider mode");
  }
  const database = createDatabase(config.databaseUrl);
  try {
    await runMigrationsWithRetry(
      async () => runMigrations(database.pool, config.migrationsDirectory),
      { attempts: config.migrationAttempts }
    );
    const now = new Date();
    const observation = demoObservation(now);
    const queryFingerprint = calendarSyncQueryFingerprint(
      sharedPolicyRuntime,
      "fake",
      "fake-personal-primary"
    );
    let repairedEndpointCount = 0;
    await database.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("provider_connections")
        .values([
          {
            id: SOURCE_CONNECTION_ID,
            organization_id: PERSONAL_ORGANIZATION_ID,
            owner_principal_id: OWNER_PRINCIPAL_ID,
            provider: "fake",
            remote_subject: "fake-personal-account",
            account_label: "personal@example.invalid",
            display_label: "Personal demo",
            intended_role: "source",
            email_masked: "p•••••••@example.invalid",
            credential_envelope: { fixture: "local-development-only" },
            key_version: "fake-v1",
            scopes: JSON.stringify(["calendar.read"]),
            status: "active",
            last_success_at: now,
            safe_error_code: null
          },
          {
            id: DESTINATION_CONNECTION_ID,
            organization_id: PERSONAL_ORGANIZATION_ID,
            owner_principal_id: OWNER_PRINCIPAL_ID,
            provider: "fake",
            remote_subject: "fake-work-account",
            account_label: "work@example.invalid",
            display_label: "Work demo",
            intended_role: "destination",
            email_masked: "w•••@example.invalid",
            credential_envelope: { fixture: "local-development-only" },
            key_version: "fake-v1",
            scopes: JSON.stringify(["calendar.write"]),
            status: "active",
            last_success_at: now,
            safe_error_code: null
          }
        ])
        .onConflict((conflict) => conflict.column("id").doNothing())
        .execute();
      await transaction.updateTable("provider_connections").set({
        display_label: "Personal demo",
        intended_role: "source",
        status: "active",
        last_success_at: now,
        safe_error_code: null,
        updated_at: now
      }).where("id", "=", SOURCE_CONNECTION_ID).executeTakeFirstOrThrow();
      await transaction.updateTable("provider_connections").set({
        display_label: "Work demo",
        intended_role: "destination",
        status: "active",
        last_success_at: now,
        safe_error_code: null,
        updated_at: now
      }).where("id", "=", DESTINATION_CONNECTION_ID).executeTakeFirstOrThrow();
      await transaction
        .insertInto("calendar_endpoints")
        .values([
          {
            id: SOURCE_CALENDAR_ID,
            organization_id: PERSONAL_ORGANIZATION_ID,
            connection_id: SOURCE_CONNECTION_ID,
            remote_id: "fake-personal-primary",
            name: "Personal",
            timezone: "America/Vancouver",
            access_role: "reader",
            readable: true,
            writable: false,
            primary_calendar: true,
            capabilities: {}
          },
          {
            id: DESTINATION_CALENDAR_ID,
            organization_id: PERSONAL_ORGANIZATION_ID,
            connection_id: DESTINATION_CONNECTION_ID,
            remote_id: "fake-work-primary",
            name: "Work",
            timezone: "America/Vancouver",
            access_role: "owner",
            readable: false,
            writable: true,
            primary_calendar: true,
            capabilities: {
              private_visibility: true,
              conference_copy: false,
              color: true
            }
          }
        ])
        .onConflict((conflict) => conflict.column("id").doNothing())
        .execute();
      await transaction.updateTable("calendar_endpoints").set({
        connection_id: SOURCE_CONNECTION_ID,
        remote_id: "fake-personal-primary",
        name: "Personal",
        timezone: "America/Vancouver",
        access_role: "reader",
        readable: true,
        writable: false,
        primary_calendar: true,
        capabilities: {},
        updated_at: now
      }).where("id", "=", SOURCE_CALENDAR_ID).executeTakeFirstOrThrow();
      await transaction.updateTable("calendar_endpoints").set({
        connection_id: DESTINATION_CONNECTION_ID,
        remote_id: "fake-work-primary",
        name: "Work",
        timezone: "America/Vancouver",
        access_role: "owner",
        readable: false,
        writable: true,
        primary_calendar: true,
        capabilities: {
          private_visibility: true,
          conference_copy: false,
          color: true
        },
        updated_at: now
      }).where("id", "=", DESTINATION_CALENDAR_ID).executeTakeFirstOrThrow();
      repairedEndpointCount = await repairFakeDemoCrossAccountEndpoints(transaction, {
        sourceConnectionId: SOURCE_CONNECTION_ID,
        destinationConnectionId: DESTINATION_CONNECTION_ID,
        sourceCalendarId: SOURCE_CALENDAR_ID,
        destinationCalendarId: DESTINATION_CALENDAR_ID,
        sourceRemoteId: "fake-personal-primary",
        destinationRemoteId: "fake-work-primary"
      });
      await transaction
        .insertInto("sync_cursors")
        .values({
          id: SOURCE_CURSOR_ID,
          organization_id: PERSONAL_ORGANIZATION_ID,
          calendar_endpoint_id: SOURCE_CALENDAR_ID,
          query_fingerprint: queryFingerprint,
          sync_token: "fake-sync-1",
          generation: 1,
          state: "ready",
          last_started_at: now,
          last_full_sync_at: now,
          last_success_at: now,
          safe_error_code: null
        })
        .onConflict((conflict) => conflict.columns(["calendar_endpoint_id", "query_fingerprint"]).doUpdateSet({
          sync_token: "fake-sync-1",
          state: "ready",
          last_started_at: now,
          last_full_sync_at: now,
          last_success_at: now,
          safe_error_code: null,
          updated_at: now
        }))
        .execute();
      await transaction
        .insertInto("source_observations")
        .values({
          id: SOURCE_OBSERVATION_ID,
          organization_id: PERSONAL_ORGANIZATION_ID,
          calendar_endpoint_id: SOURCE_CALENDAR_ID,
          remote_event_id: observation.source_event_ref,
          recurrence_identity: observation.source_occurrence_ref,
          remote_etag: observation.remote_revision,
          normalized_event: observation,
          observation_hash: sharedPolicyRuntime.hash(observation),
          managed_copy: false,
          tombstone: false,
          sync_generation: 1,
          observed_at: now
        })
        .onConflict((conflict) => conflict.columns([
          "calendar_endpoint_id",
          "remote_event_id",
          "recurrence_identity"
        ]).doUpdateSet({
          normalized_event: observation,
          observation_hash: sharedPolicyRuntime.hash(observation),
          remote_etag: observation.remote_revision,
          managed_copy: false,
          tombstone: false,
          sync_generation: 1,
          observed_at: now,
          updated_at: now
        }))
        .execute();
    });
    console.log(
      repairedEndpointCount === 0
        ? "Seeded the idempotent local fake-provider calendar demo."
        : `Seeded the local fake-provider demo and removed ${repairedEndpointCount} unreferenced cross-account endpoint${repairedEndpointCount === 1 ? "" : "s"}.`
    );
  } finally {
    config.masterKey.fill(0);
    await database.close();
  }
}

function demoObservation(now: Date): SourceObservation {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(18, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  return {
    source_event_ref: "fake-personal-demo-event",
    source_occurrence_ref: "",
    remote_revision: "fake-etag-1",
    lifecycle: "confirmed",
    origin: "provider_original",
    timing: {
      kind: "timed",
      start_instant: start.toISOString(),
      end_instant: end.toISOString(),
      start_tzid: "America/Vancouver",
      end_tzid: "America/Vancouver"
    },
    availability: "busy",
    relationship: { role: "organizer", response: "accepted" },
    destination_identity_invited: false,
    content: {
      summary: "Private demo appointment",
      description: "This field should disappear under Busy only.",
      location: "Private demo location"
    }
  };
}

void main().catch(reportFatal);
