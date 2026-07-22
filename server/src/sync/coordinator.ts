import type { SourceObservation } from "@planipus/calendar-sync";
import type { Kysely, Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { newId } from "../foundation.js";
import { PostgresJobQueue, type LeasedJob } from "../jobs/queue.js";
import type { PolicyRuntime } from "../policy/runtime.js";
import type { AccessTokenBroker } from "../providers/router.js";
import { ProviderRouter } from "../providers/router.js";
import { ProviderError } from "../providers/types.js";
import {
  calendarSyncQueryFingerprint,
  FULL_SYNC_FUTURE_DAYS,
  FULL_SYNC_PAST_DAYS
} from "./query.js";
import { PolicyReconciler } from "./reconciliation.js";
import {
  DESTINATION_VERIFICATION_INTERVAL_MILLISECONDS,
  DestinationVerifier
} from "./verification.js";

const MAX_PAGES_PER_SYNC = 200;
const FULL_SYNC_REFRESH_MILLISECONDS = 24 * 60 * 60_000;
const MINIMUM_POLL_INTERVAL_MILLISECONDS = 60_000;

export class CalendarSyncCoordinator {
  private readonly jobs: PostgresJobQueue;
  private readonly reconciler: PolicyReconciler;
  private readonly verifier: DestinationVerifier;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly runtime: PolicyRuntime,
    private readonly providers: ProviderRouter,
    private readonly tokens: AccessTokenBroker
  ) {
    this.jobs = new PostgresJobQueue(db);
    this.reconciler = new PolicyReconciler(db, runtime);
    this.verifier = new DestinationVerifier(db, runtime, providers, tokens);
  }

  public async dispatch(job: LeasedJob): Promise<void> {
    switch (job.kind) {
      case "discover_calendars":
        await this.discoverCalendars(job.organizationId, requiredId(job.payload, "connection_id"));
        return;
      case "sync_calendar":
        await this.syncCalendar(job.organizationId, requiredId(job.payload, "calendar_id"));
        return;
      case "reconcile_policy":
        await this.reconciler.reconcile(job.organizationId, requiredId(job.payload, "policy_id"));
        return;
      case "verify_destinations":
        await this.verifier.verifyBatch(job.organizationId);
        return;
      case "safety_sync":
        await this.scheduleSafetySync(job.organizationId);
        return;
      default:
        throw new NonRetryableJobError("unknown_job_kind", `unknown scheduled job kind: ${job.kind}`);
    }
  }

  public async discoverCalendars(organizationId: string, connectionId: string): Promise<number> {
    const connection = await this.db
      .selectFrom("provider_connections")
      .select(["id", "provider", "status", "intended_role"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();
    if (!connection || connection.status !== "active") {
      throw new NonRetryableJobError("connection_unavailable", "provider connection is unavailable");
    }
    const provider = this.providers.resolve(connection.provider);
    const accessToken = await this.tokens.accessToken(organizationId, connection.id);
    const calendars = await provider.listCalendars(accessToken);
    await this.db.transaction().execute(async (transaction) => {
      for (const calendar of calendars) {
        // `readable` and `writable` are policy-selection capabilities, not a
        // verbatim copy of the remote ACL. An account connected only as a
        // destination must never become eligible as a policy source (and vice
        // versa), even though Google's broader write scope can also read.
        const { readable, writable } = policyCapabilitiesForRole(
          connection.intended_role,
          calendar.readable,
          calendar.writable
        );
        const row = await transaction
          .insertInto("calendar_endpoints")
          .values({
            id: newId(),
            organization_id: organizationId,
            connection_id: connection.id,
            remote_id: calendar.remoteId,
            name: calendar.name,
            timezone: calendar.timezone,
            access_role: calendar.accessRole,
            readable,
            writable,
            primary_calendar: calendar.primary,
            capabilities: {
              private_visibility: true,
              conference_copy: false,
              color: true
            }
          })
          .onConflict((conflict) =>
            conflict.columns(["connection_id", "remote_id"]).doUpdateSet({
              name: calendar.name,
              timezone: calendar.timezone,
              access_role: calendar.accessRole,
              readable,
              writable,
              primary_calendar: calendar.primary,
              updated_at: new Date()
            })
          )
          .returning(["id", "readable"])
          .executeTakeFirstOrThrow();
        if (row.readable) {
          await this.jobs.enqueue(
            organizationId,
            "sync_calendar",
            `calendar:${row.id}`,
            { calendar_id: row.id },
            new Date(),
            transaction
          );
        }
      }
      await transaction
        .updateTable("provider_connections")
        .set({ last_success_at: new Date(), safe_error_code: null, updated_at: new Date() })
        .where("id", "=", connection.id)
        .execute();
    });
    return calendars.length;
  }

  public async syncCalendar(organizationId: string, calendarId: string): Promise<number> {
    const calendar = await this.db
      .selectFrom("calendar_endpoints")
      .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
      .select([
        "calendar_endpoints.id",
        "calendar_endpoints.remote_id",
        "calendar_endpoints.readable",
        "calendar_endpoints.connection_id",
        "provider_connections.provider",
        "provider_connections.status as connection_status",
        "provider_connections.intended_role"
      ])
      .where("calendar_endpoints.organization_id", "=", organizationId)
      .where("calendar_endpoints.id", "=", calendarId)
      .executeTakeFirst();
    if (
      !calendar?.readable
      || calendar.connection_status !== "active"
      || (calendar.intended_role !== "source" && calendar.intended_role !== "both")
    ) {
      throw new NonRetryableJobError("calendar_unavailable", "source calendar is unavailable");
    }
    const queryFingerprint = calendarSyncQueryFingerprint(
      this.runtime,
      calendar.provider,
      calendar.remote_id
    );
    // Generations are calendar-wide, not scoped to one query fingerprint. A
    // later code/config version can create a new cursor fingerprint while old
    // observations carry a high generation. Starting again at 1 would make
    // those unseen rows impossible to tombstone after the new full scan.
    const [cursorMaximum, observationMaximum] = await Promise.all([
      this.db
        .selectFrom("sync_cursors")
        .select((expression) => expression.fn.max<number>("generation").as("maximum"))
        .where("organization_id", "=", organizationId)
        .where("calendar_endpoint_id", "=", calendar.id)
        .executeTakeFirst(),
      this.db
        .selectFrom("source_observations")
        .select((expression) => expression.fn.max<number>("sync_generation").as("maximum"))
        .where("organization_id", "=", organizationId)
        .where("calendar_endpoint_id", "=", calendar.id)
        .executeTakeFirst()
    ]);
    const nextCalendarGeneration = Math.max(
      Number(cursorMaximum?.maximum ?? 0),
      Number(observationMaximum?.maximum ?? 0)
    ) + 1;
    const cursor = await this.db
      .insertInto("sync_cursors")
      .values({
        id: newId(),
        organization_id: organizationId,
        calendar_endpoint_id: calendar.id,
        query_fingerprint: queryFingerprint,
        sync_token: null,
        generation: nextCalendarGeneration,
        state: "full_required",
        last_started_at: null,
        last_full_sync_at: null,
        last_success_at: null,
        safe_error_code: null
      })
      .onConflict((conflict) => conflict.columns(["calendar_endpoint_id", "query_fingerprint"]).doNothing())
      .returningAll()
      .executeTakeFirst();
    const currentCursor = cursor ?? await this.db
      .selectFrom("sync_cursors")
      .selectAll()
      .where("calendar_endpoint_id", "=", calendar.id)
      .where("query_fingerprint", "=", queryFingerprint)
      .executeTakeFirstOrThrow();
    if (
      currentCursor.sync_token
      && (
        !currentCursor.last_full_sync_at
        || Date.now() - new Date(currentCursor.last_full_sync_at).getTime() >= FULL_SYNC_REFRESH_MILLISECONDS
      )
    ) {
      await this.db
        .updateTable("sync_cursors")
        .set((expression) => ({
          sync_token: null,
          generation: expression("generation", "+", 1),
          state: "full_required",
          safe_error_code: null,
          updated_at: new Date()
        }))
        .where("id", "=", currentCursor.id)
        .where("sync_token", "=", currentCursor.sync_token)
        .execute();
      throw new ProviderError("horizon_refresh", "calendar horizon is due for a complete refresh", true);
    }
    if (
      currentCursor.state === "ready"
      && currentCursor.last_started_at
      && Date.now() - new Date(currentCursor.last_started_at).getTime() < MINIMUM_POLL_INTERVAL_MILLISECONDS
    ) {
      return 0;
    }
    await this.db
      .updateTable("sync_cursors")
      .set({ state: "syncing", last_started_at: new Date(), safe_error_code: null, updated_at: new Date() })
      .where("id", "=", currentCursor.id)
      .execute();

    const fullSync = currentCursor.sync_token === null;
    // Page tokens are bound to the exact full-sync query. Capture the rolling
    // horizon once so page two cannot differ by milliseconds from page one.
    const fullTimeMin = new Date(Date.now() - FULL_SYNC_PAST_DAYS * 86_400_000).toISOString();
    const fullTimeMax = new Date(Date.now() + FULL_SYNC_FUTURE_DAYS * 86_400_000).toISOString();
    let pageToken: string | undefined;
    let finalSyncToken: string | null = null;
    let observed = 0;
    let pages = 0;
    try {
      const accessToken = await this.tokens.accessToken(organizationId, calendar.connection_id);
      const provider = this.providers.resolve(calendar.provider);
      do {
        pages += 1;
        if (pages > MAX_PAGES_PER_SYNC) {
          throw new ProviderError("sync_page_limit", "calendar sync exceeded the page safety limit", true);
        }
        const page = await provider.listEvents(accessToken, calendar.remote_id, {
          ...(pageToken ? { pageToken } : {}),
          ...(currentCursor.sync_token ? { syncToken: currentCursor.sync_token } : {
            timeMin: fullTimeMin,
            timeMax: fullTimeMax
          })
        });
        await this.persistObservationPage(
          organizationId,
          calendar.id,
          currentCursor.generation,
          page.observations
        );
        observed += page.observations.length;
        pageToken = page.nextPageToken ?? undefined;
        finalSyncToken = page.nextSyncToken ?? finalSyncToken;
      } while (pageToken);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 410) {
        await this.db
          .updateTable("sync_cursors")
          .set((expression) => ({
            sync_token: null,
            generation: expression("generation", "+", 1),
            state: "full_required",
            safe_error_code: "cursor_reset",
            updated_at: new Date()
          }))
          .where("id", "=", currentCursor.id)
          .execute();
        throw new ProviderError("cursor_reset", "expired provider cursor was reset for a full sync", true);
      }
      await this.db
        .updateTable("sync_cursors")
        .set({ state: "action_required", safe_error_code: providerErrorCode(error), updated_at: new Date() })
        .where("id", "=", currentCursor.id)
        .execute();
      throw error;
    }
    if (!finalSyncToken) {
      throw new ProviderError("sync_token_missing", "provider did not return a final sync token", true);
    }

    await this.db.transaction().execute(async (transaction) => {
      if (fullSync) {
        // Only infer absence after every page completed and a final sync token
        // was obtained. An interrupted scan leaves the prior generation intact.
        const stale = await transaction
          .selectFrom("source_observations")
          .select(["id", "normalized_event"])
          .where("organization_id", "=", organizationId)
          .where("calendar_endpoint_id", "=", calendar.id)
          .where("sync_generation", "<", currentCursor.generation)
          .forUpdate()
          .execute();
        for (const row of stale) {
          const previous = row.normalized_event as SourceObservation;
          const deleted: SourceObservation = { ...previous, lifecycle: "deleted" };
          await transaction
            .updateTable("source_observations")
            .set({
              normalized_event: deleted,
              observation_hash: this.runtime.hash(deleted),
              tombstone: true,
              sync_generation: currentCursor.generation,
              observed_at: new Date(),
              updated_at: new Date()
            })
            .where("id", "=", row.id)
            .executeTakeFirstOrThrow();
        }
      }
      await transaction
        .updateTable("sync_cursors")
        .set({
          sync_token: finalSyncToken,
          state: "ready",
          ...(fullSync ? { last_full_sync_at: new Date() } : {}),
          last_success_at: new Date(),
          safe_error_code: null,
          updated_at: new Date()
        })
        .where("id", "=", currentCursor.id)
        .executeTakeFirstOrThrow();
      const policies = await transaction
        .selectFrom("sync_policies")
        .select(["id", "revision"])
        .where("organization_id", "=", organizationId)
        .where("source_calendar_id", "=", calendar.id)
        .where("status", "=", "active")
        .execute();
      const cursorWakeup = this.runtime.hash({ token: finalSyncToken, generation: currentCursor.generation });
      for (const policy of policies) {
        await this.jobs.enqueue(
          organizationId,
          "reconcile_policy",
          `policy:${policy.id}:revision:${policy.revision}:cursor:${cursorWakeup}`,
          { policy_id: policy.id },
          new Date(),
          transaction
        );
      }
    });
    return observed;
  }

  private async persistObservationPage(
    organizationId: string,
    calendarId: string,
    generation: number,
    observations: readonly SourceObservation[]
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      for (const observation of observations) {
        const occurrence = observation.source_occurrence_ref;
        await transaction
          .insertInto("source_observations")
          .values({
            id: newId(),
            organization_id: organizationId,
            calendar_endpoint_id: calendarId,
            remote_event_id: observation.source_event_ref,
            recurrence_identity: occurrence,
            remote_etag: observation.remote_revision || null,
            normalized_event: observation,
            observation_hash: this.runtime.hash(observation),
            managed_copy: observation.origin === "planipus_managed",
            tombstone: observation.lifecycle !== "confirmed",
            sync_generation: generation,
            observed_at: new Date()
          })
          .onConflict((conflict) =>
            conflict.columns(["calendar_endpoint_id", "remote_event_id", "recurrence_identity"]).doUpdateSet({
              remote_etag: observation.remote_revision || null,
              normalized_event: observation,
              observation_hash: this.runtime.hash(observation),
              managed_copy: observation.origin === "planipus_managed",
              tombstone: observation.lifecycle !== "confirmed",
              sync_generation: generation,
              observed_at: new Date(),
              updated_at: new Date()
            })
          )
          .execute();
      }
    });
  }

  private async scheduleSafetySync(organizationId: string): Promise<void> {
    const calendars = await this.db
      .selectFrom("calendar_endpoints")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("readable", "=", true)
      .execute();
    for (const calendar of calendars) {
      await this.jobs.enqueue(
        organizationId,
        "sync_calendar",
        `calendar:${calendar.id}`,
        { calendar_id: calendar.id }
      );
    }
    const verificationWindow = Math.floor(
      Date.now() / DESTINATION_VERIFICATION_INTERVAL_MILLISECONDS
    );
    await this.jobs.enqueue(
      organizationId,
      "verify_destinations",
      `organization:${organizationId}:window:${verificationWindow}`,
      {}
    );
  }
}

export function policyCapabilitiesForRole(
  role: "source" | "destination" | "both",
  remotelyReadable: boolean,
  remotelyWritable: boolean
): { readonly readable: boolean; readonly writable: boolean } {
  return {
    readable: remotelyReadable && (role === "source" || role === "both"),
    writable: remotelyWritable && (role === "destination" || role === "both")
  };
}

export class NonRetryableJobError extends Error {
  public readonly retryable = false;

  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}

function requiredId(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object" || !(key in payload)) {
    throw new NonRetryableJobError("invalid_job_payload", `job payload is missing ${key}`);
  }
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string" || value.length < 1) {
    throw new NonRetryableJobError("invalid_job_payload", `job payload has an invalid ${key}`);
  }
  return value;
}

function providerErrorCode(error: unknown): string {
  return error instanceof ProviderError ? error.code : "sync_failed";
}

export async function enqueueSafetySweep(
  db: Kysely<DatabaseSchema>,
  transaction: Transaction<DatabaseSchema>,
  organizationId: string,
  window: number
): Promise<void> {
  const queue = new PostgresJobQueue(db);
  await queue.enqueue(
    organizationId,
    "safety_sync",
    `organization:${organizationId}:window:${window}`,
    {},
    new Date(),
    transaction
  );
}
