import { sql, type Kysely, type Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import type { PolicyRuntime } from "../policy/runtime.js";
import type { AccessTokenBroker } from "../providers/router.js";
import { ProviderRouter } from "../providers/router.js";
import { providerCalendarIdentity } from "../providers/calendar-identity.js";
import { calendarSyncQueryFingerprint } from "../sync/query.js";
import {
  conflictPreviewResult,
  conflictSnapshotDocument,
  overlappingBusyIntervals,
  workInvitationCandidate
} from "./engine.js";
import type {
  ConflictBusyInterval,
  ConflictCalendarBinding,
  ConflictResponseDraft,
  ConflictResponsePreparedInput,
  WorkInvitationCandidate,
  WorkObservationRow
} from "./types.js";
import { ConflictResponseInputError } from "./validation.js";
import type { PrivateAvailabilityHasher } from "./privacy-hash.js";

type Executor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;
const WORK_OBSERVATION_LIMIT = 5_000;
const FREEBUSY_GROUP_CONCURRENCY = 4;
const FREEBUSY_INTERVAL_LIMIT = 50_000;

export interface ConflictResponseProviderDependencies {
  readonly providers: ProviderRouter;
  readonly tokens: AccessTokenBroker;
}

export async function prepareConflictResponseInput(
  executor: Executor,
  runtime: Pick<PolicyRuntime, "hash">,
  privateHasher: PrivateAvailabilityHasher,
  providerDependencies: ConflictResponseProviderDependencies,
  organizationId: string,
  draft: ConflictResponseDraft,
  referenceAt: Date
): Promise<ConflictResponsePreparedInput> {
  const { response, availability } = await loadConflictCalendarSelection(
    executor,
    organizationId,
    draft
  );
  await requireResponseSync(executor, runtime, organizationId, response, referenceAt);
  const pausedOutboundBridgePresent = await requireNoCopyPolicies(
    executor,
    organizationId,
    availability
  );
  const automaticDeclinesAppliedLast24Hours = await countRecentAppliedDeclines(
    executor,
    organizationId,
    providerCalendarIdentity(response),
    referenceAt
  );
  const horizonEnd = new Date(referenceAt.getTime() + draft.horizon_days * 86_400_000);
  const invitations = await loadWorkInvitations(
    executor,
    organizationId,
    response.id,
    referenceAt,
    horizonEnd
  );
  const availabilityEnd = invitations.reduce(
    (maximum, invitation) => Date.parse(invitation.end_at) > maximum.getTime()
      ? new Date(invitation.end_at)
      : maximum,
    horizonEnd
  );
  const busy = await queryOpaqueAvailability(
    providerDependencies,
    organizationId,
    availability,
    referenceAt.toISOString(),
    availabilityEnd.toISOString()
  );
  const conflicts = invitations.flatMap((invitation) => {
    const overlappingBusy = overlappingBusyIntervals(invitation, busy);
    return overlappingBusy.length > 0
      ? [{ invitation, overlapping_busy: overlappingBusy }]
      : [];
  });
  const snapshot = conflictSnapshotDocument({
    draft,
    reference_at: referenceAt.toISOString(),
    horizon_end: horizonEnd.toISOString(),
    availability_end: availabilityEnd.toISOString(),
    response_calendar: response,
    availability_calendars: availability,
    invitations,
    busy,
    automatic_declines_applied_last_24_hours: automaticDeclinesAppliedLast24Hours
  });
  const result = conflictPreviewResult(
    invitations,
    busy,
    automaticDeclinesAppliedLast24Hours
  );
  return {
    response_calendar: response,
    availability_calendars: availability,
    invitations,
    busy,
    conflicts,
    snapshot_hash: privateHasher.hash({
      snapshot,
      paused_outbound_bridge_present: pausedOutboundBridgePresent
    }),
    result: {
      ...result,
      warnings: [
        ...result.warnings,
        ...(pausedOutboundBridgePresent ? ["paused_bridge_existing_copies_remain"] : []),
        ...(availability.some((calendar) => calendar.intended_role !== "availability")
          ? ["availability_role_may_retain_event_content"]
          : [])
      ]
    }
  };
}

export async function countRecentAppliedDeclines(
  executor: Executor,
  organizationId: string,
  responseProviderIdentity: string,
  now: Date
): Promise<number> {
  // Actions are mutable reconciliation state: a provider reschedule can reuse
  // an action row with a new basis. Audit facts are the immutable record of
  // verified provider-side declines, so the safety budget must count them.
  const row = await executor.selectFrom("audit_facts")
    .innerJoin(
      "invitation_response_actions",
      (join) => join
        .onRef("invitation_response_actions.organization_id", "=", "audit_facts.organization_id")
        // audit_facts is polymorphic text; cast the trusted UUID side to text
        // so malformed unrelated audit targets can never trigger a UUID cast.
        .on(sql<boolean>`invitation_response_actions.id::text = audit_facts.target_id`)
    )
    .innerJoin(
      "conflict_response_rules",
      (join) => join
        .onRef("conflict_response_rules.organization_id", "=", "audit_facts.organization_id")
        .onRef("conflict_response_rules.id", "=", "invitation_response_actions.rule_id")
    )
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("audit_facts.organization_id", "=", organizationId)
    .where("audit_facts.action", "=", "invitation_response.declined")
    .where("audit_facts.target_type", "=", "invitation_response_action")
    .where("conflict_response_rules.response_provider_identity", "=", responseProviderIdentity)
    .where(
      "audit_facts.created_at",
      ">=",
      new Date(now.getTime() - 24 * 60 * 60_000)
    )
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export async function loadConflictCalendarSelection(
  executor: Executor,
  organizationId: string,
  draft: ConflictResponseDraft
): Promise<{
  readonly response: ConflictCalendarBinding;
  readonly availability: readonly ConflictCalendarBinding[];
}> {
  const selectedIds = [draft.response_calendar_id, ...draft.availability_calendar_ids];
  const rows = await executor.selectFrom("calendar_endpoints")
    .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
    .select([
      "calendar_endpoints.id",
      "calendar_endpoints.connection_id",
      "calendar_endpoints.remote_id",
      "calendar_endpoints.name",
      "calendar_endpoints.readable",
      "calendar_endpoints.writable",
      "calendar_endpoints.capabilities",
      "provider_connections.provider",
      "provider_connections.scopes",
      "provider_connections.status as connection_status",
      "provider_connections.intended_role"
    ])
    .where("calendar_endpoints.organization_id", "=", organizationId)
    .where("calendar_endpoints.id", "in", selectedIds)
    .execute();
  if (rows.length !== selectedIds.length) {
    throw new ConflictResponseInputError(
      "calendar_not_found",
      "one or more selected calendars were not found"
    );
  }
  const response = rows.find((row) => row.id === draft.response_calendar_id);
  if (
    !response
    || !response.readable
    || !response.writable
    || response.connection_status !== "active"
    || response.intended_role !== "both"
  ) {
    throw new ConflictResponseInputError(
      "response_calendar_unavailable",
      "the response calendar must belong to an active connection configured for both reading and writing"
    );
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const availability = draft.availability_calendar_ids.map((id) => byId.get(id));
  if (availability.some((calendar) => !calendar)) {
    throw new ConflictResponseInputError("calendar_not_found", "an availability calendar was not found");
  }
  const availableRows = availability as ConflictCalendarBinding[];
  requireDistinctProviderCalendars(response as ConflictCalendarBinding, availableRows);
  if (availableRows.some((calendar) =>
    !isFreeBusyReadable(calendar)
    || calendar.connection_status !== "active"
    || (
      calendar.intended_role !== "availability"
      && calendar.intended_role !== "source"
      && calendar.intended_role !== "both"
    )
  )) {
    throw new ConflictResponseInputError(
      "availability_calendar_unavailable",
      "availability calendars must belong to active readable connections"
    );
  }
  if (availableRows.some((calendar) =>
    calendar.provider === "google" && !hasGoogleFreeBusyScope(calendar.scopes)
  )) {
    throw new ConflictResponseInputError(
      "availability_scope_missing",
      "reconnect the availability account to grant Google's free/busy-only scope"
    );
  }
  return {
    response: response as ConflictCalendarBinding,
    availability: availableRows.sort((left, right) => compareText(left.id, right.id))
  };
}

export function requireDistinctProviderCalendars(
  response: ConflictCalendarBinding,
  availability: readonly ConflictCalendarBinding[]
): void {
  const responseIdentity = providerCalendarIdentity(response);
  const availabilityIdentities = availability.map(providerCalendarIdentity);
  if (
    availabilityIdentities.includes(responseIdentity)
    || new Set(availabilityIdentities).size !== availabilityIdentities.length
  ) {
    throw new ConflictResponseInputError(
      "same_provider_calendar",
      "response and availability selections must refer to distinct provider calendars"
    );
  }
}

export async function queryOpaqueAvailability(
  dependencies: ConflictResponseProviderDependencies,
  organizationId: string,
  calendars: readonly ConflictCalendarBinding[],
  timeMin: string,
  timeMax: string
): Promise<readonly ConflictBusyInterval[]> {
  const grouped = new Map<string, ConflictCalendarBinding[]>();
  for (const calendar of calendars) {
    const key = `${calendar.provider}:${calendar.connection_id}`;
    const group = grouped.get(key) ?? [];
    group.push(calendar);
    grouped.set(key, group);
  }
  const groups = [...grouped.values()];
  const results: ConflictBusyInterval[][] = Array.from({ length: groups.length }, () => []);
  let nextGroup = 0;
  let intervalCount = 0;
  const queryGroup = async (group: ConflictCalendarBinding[]): Promise<ConflictBusyInterval[]> => {
    const first = group[0];
    if (!first) return [];
    const provider = dependencies.providers.resolve(first.provider);
    const accessToken = await dependencies.tokens.accessToken(organizationId, first.connection_id);
    const result = await provider.queryFreeBusy(accessToken, {
      calendarIds: group.map((calendar) => calendar.remote_id),
      timeMin,
      timeMax
    });
    const requestedMinimum = Date.parse(timeMin);
    const requestedMaximum = Date.parse(timeMax);
    const returnedMinimum = Date.parse(result.timeMin);
    const returnedMaximum = Date.parse(result.timeMax);
    if (
      !Number.isFinite(returnedMinimum)
      || !Number.isFinite(returnedMaximum)
      || returnedMinimum !== requestedMinimum
      || returnedMaximum !== requestedMaximum
    ) {
      throw new ConflictResponseInputError(
        "freebusy_bounds_invalid",
        "the provider returned free/busy data for a different time window"
      );
    }
    const localByRemote = new Map(group.map((calendar) => [calendar.remote_id, calendar.id]));
    if (
      result.calendars.length !== group.length
      || new Set(result.calendars.map((calendar) => calendar.calendarId)).size !== group.length
      || result.calendars.some((calendar) => !localByRemote.has(calendar.calendarId))
    ) {
      throw new ConflictResponseInputError(
        "freebusy_incomplete",
        "the provider returned an incomplete availability result",
        true
      );
    }
    const returnedIntervalCount = result.calendars.reduce(
      (count, calendar) => count + calendar.busy.length,
      0
    );
    intervalCount += returnedIntervalCount;
    if (intervalCount > FREEBUSY_INTERVAL_LIMIT) {
      throw new ConflictResponseInputError(
        "freebusy_too_large",
        "the provider returned too many availability intervals"
      );
    }
    return result.calendars.flatMap((calendar) => calendar.busy.map((interval) => {
      const start = Date.parse(interval.start);
      const end = Date.parse(interval.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        throw new ConflictResponseInputError(
          "freebusy_invalid",
          "the provider returned an invalid availability interval",
          true
        );
      }
      if (start < requestedMinimum || end > requestedMaximum) {
        throw new ConflictResponseInputError(
          "freebusy_bounds_invalid",
          "the provider returned availability outside the requested time window"
        );
      }
      return {
        calendar_id: localByRemote.get(calendar.calendarId) as string,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString()
      };
    }));
  };
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextGroup;
      nextGroup += 1;
      const group = groups[index];
      if (!group) return;
      results[index] = await queryGroup(group);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(FREEBUSY_GROUP_CONCURRENCY, groups.length) },
    worker
  ));
  return results.flat().sort((left, right) =>
    compareText(left.calendar_id, right.calendar_id)
    || compareText(left.start, right.start)
    || compareText(left.end, right.end)
  );
}

async function loadWorkInvitations(
  executor: Executor,
  organizationId: string,
  calendarId: string,
  referenceAt: Date,
  horizonEnd: Date
): Promise<readonly WorkInvitationCandidate[]> {
  const observations = await executor.selectFrom("source_observations")
    .select([
      "id",
      "remote_event_id",
      "recurrence_identity",
      "remote_etag",
      "observation_hash",
      "normalized_event"
    ])
    .where("organization_id", "=", organizationId)
    .where("calendar_endpoint_id", "=", calendarId)
    .where("managed_copy", "=", false)
    .where("tombstone", "=", false)
    .where(sql<boolean>`normalized_event->>'lifecycle' = 'confirmed'`)
    .where(sql<boolean>`normalized_event->>'origin' = 'provider_original'`)
    .where(sql<boolean>`normalized_event->>'availability' = 'busy'`)
    .where(sql<boolean>`normalized_event #>> '{timing,kind}' = 'timed'`)
    .where(sql<boolean>`normalized_event #>> '{relationship,role}' = 'attendee'`)
    .where(sql<boolean>`normalized_event #>> '{relationship,response}' = 'needs_action'`)
    .where(sql<boolean>`normalized_event #>> '{timing,start_instant}' >= ${referenceAt.toISOString()}`)
    .where(sql<boolean>`normalized_event #>> '{timing,start_instant}' < ${horizonEnd.toISOString()}`)
    .orderBy(sql<string>`normalized_event #>> '{timing,start_instant}'`, "asc")
    .orderBy("id", "asc")
    .limit(WORK_OBSERVATION_LIMIT + 1)
    .execute();
  if (observations.length > WORK_OBSERVATION_LIMIT) {
    throw new ConflictResponseInputError(
      "work_observation_limit",
      `conflict response exceeds the ${WORK_OBSERVATION_LIMIT}-observation safety limit`
    );
  }
  return observations
    .map((row) => workInvitationCandidate(row as WorkObservationRow, referenceAt, horizonEnd))
    .filter((candidate): candidate is Exclude<typeof candidate, null> => candidate !== null)
    .sort((left, right) =>
      compareText(left.start_at, right.start_at)
      || compareText(left.end_at, right.end_at)
      || compareText(left.observation_hash, right.observation_hash)
    );
}

async function requireResponseSync(
  executor: Executor,
  runtime: Pick<PolicyRuntime, "hash">,
  organizationId: string,
  response: ConflictCalendarBinding,
  referenceAt: Date
): Promise<void> {
  const queryFingerprint = calendarSyncQueryFingerprint(
    runtime,
    response.provider,
    response.remote_id
  );
  const cursor = await executor.selectFrom("sync_cursors")
    .select("id")
    .where("organization_id", "=", organizationId)
    .where("calendar_endpoint_id", "=", response.id)
    .where("query_fingerprint", "=", queryFingerprint)
    .where("state", "=", "ready")
    .where("last_success_at", "is not", null)
    .where("last_success_at", ">=", new Date(referenceAt.getTime() - 15 * 60_000))
    .limit(1)
    .executeTakeFirst();
  if (!cursor) {
    throw new ConflictResponseInputError(
      "response_sync_incomplete",
      "the response calendar must finish syncing before invitations can be evaluated",
      true
    );
  }
}

export async function requireNoCopyPolicies(
  executor: Executor,
  organizationId: string,
  availability: readonly ConflictCalendarBinding[]
): Promise<boolean> {
  const protectedIdentities = availability.map(providerCalendarIdentity);
  const copyPolicies = await executor.selectFrom("sync_policies")
    .select([
      "id",
      "status",
      "source_provider_identity",
      "destination_provider_identity"
    ])
    .where("organization_id", "=", organizationId)
    .where("status", "in", ["active", "paused"])
    .where((expression) => expression.or([
      expression("source_provider_identity", "in", protectedIdentities),
      expression("destination_provider_identity", "in", protectedIdentities)
    ]))
    .execute();
  if (copyPolicies.some((policy) =>
    protectedIdentities.includes(policy.destination_provider_identity)
  )) {
    throw new ConflictResponseInputError(
      "availability_copy_feedback",
      "availability calendars cannot contain inbound bridge copies because those copies can create self-conflicts"
    );
  }
  if (copyPolicies.some((policy) =>
    policy.status === "active"
    && protectedIdentities.includes(policy.source_provider_identity)
  )) {
    throw new ConflictResponseInputError(
      "copy_policy_conflict",
      "a selected availability calendar has an active outbound bridge; pause every such bridge before enabling no-copy conflict response"
    );
  }
  return copyPolicies.some((policy) =>
    policy.status === "paused"
    && protectedIdentities.includes(policy.source_provider_identity)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isFreeBusyReadable(calendar: ConflictCalendarBinding): boolean {
  if (calendar.readable) return true;
  return isRecord(calendar.capabilities)
    && calendar.capabilities["freebusy_readable"] === true;
}

function hasGoogleFreeBusyScope(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const accepted = new Set([
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar"
  ]);
  return value.some((scope) => typeof scope === "string" && accepted.has(scope));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
