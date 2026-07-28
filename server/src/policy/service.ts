import { sql, type Kysely } from "kysely";
import {
  isDestinationEditPolicy,
  normalizeDestinationEditPolicy,
  type DesiredCopy,
  type DestinationCapabilities,
  type HoursProfile,
  type HoursException,
  type PolicyEvaluationInput,
  type PolicyEvaluationResult,
  type SourceObservation,
  type SyncPolicy,
  type WeeklyInterval
} from "@planipus/calendar-sync";

import type { DatabaseSchema } from "../database/types.js";
import { newId } from "../foundation.js";
import { PostgresJobQueue } from "../jobs/queue.js";
import { calendarSyncQueryFingerprint } from "../sync/query.js";
import { sourceObservationBasisHash } from "../sync/basis.js";
import type { PolicyRuntime } from "./runtime.js";

const PREVIEW_OBSERVATION_LIMIT = 5_000;

export interface PolicyDraft {
  readonly name: string;
  readonly source_calendar_id: string;
  readonly destination_calendar_id: string;
  readonly hours_profile_id?: string | null;
  readonly hours?: SyncPolicy["hours"];
  readonly hours_profile?: InlineHoursProfile;
  readonly privacy: SyncPolicy["privacy"];
  readonly selection: SyncPolicy["selection"];
  readonly destination?: SyncPolicy["destination"];
  readonly destination_edits?: SyncPolicy["destination_edits"];
  readonly horizon?: { readonly past_days: number; readonly future_days: number };
  readonly [key: string]: unknown;
}

export interface InlineHoursProfile {
  readonly name: string;
  readonly timezone: string;
  readonly dst_resolution: HoursProfile["dst_resolution"];
  readonly weekly: WeeklyInterval[];
  readonly exceptions: HoursException[];
}

export interface PreviewSummary {
  readonly preview_token: string;
  readonly expires_at: string;
  readonly complete: true;
  readonly counts: Readonly<Record<string, number>>;
  readonly excluded_by_reason: Readonly<Record<string, number>>;
  readonly disclosure: unknown;
  readonly examples: readonly unknown[];
  readonly warnings: readonly string[];
}

export function destinationCapabilities(raw: unknown, writable: boolean): DestinationCapabilities {
  const value = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  return {
    writable,
    private_visibility: value["private_visibility"] !== false,
    conference_copy: value["conference_copy"] === true,
    color: value["color"] !== false
  };
}

export function compilePolicyDraft(
  draft: PolicyDraft,
  policyRef = "preview",
  revision = 1,
  state: SyncPolicy["state"] = "active",
  resolvedHoursProfileRef?: string
): SyncPolicy {
  const hoursMode = draft.hours?.mode
    ?? (draft.hours_profile_id || draft.hours_profile ? "overlaps_profile" : "all_times");
  const profileRef = resolvedHoursProfileRef
    ?? draft.hours?.profile_ref
    ?? draft.hours_profile_id
    ?? undefined;
  return {
    policy_ref: policyRef,
    revision,
    state,
    source_calendar_ref: draft.source_calendar_id,
    destination_calendar_ref: draft.destination_calendar_id,
    hours: {
      mode: hoursMode,
      ...(hoursMode !== "all_times" && profileRef ? { profile_ref: profileRef } : {})
    },
    privacy: draft.privacy,
    selection: draft.selection,
    destination: draft.destination ?? {},
    destination_edits: normalizeDestinationEditPolicy(draft.destination_edits)
  };
}

function resultCountKey(result: PolicyEvaluationResult): string {
  if (result.selection === "excluded" || result.selection === "held" || result.selection === "invalid") {
    return "excluded";
  }
  return result.operation === "none" ? "unchanged" : result.operation;
}

export class PolicyService {
  private readonly jobs: PostgresJobQueue;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly runtime: PolicyRuntime
  ) {
    this.jobs = new PostgresJobQueue(db);
  }

  public async preview(
    organizationId: string,
    principalId: string,
    draft: PolicyDraft
  ): Promise<PreviewSummary> {
    if (draft.source_calendar_id === draft.destination_calendar_id) {
      throw new PolicyInputError("same_calendar", "source and destination calendars must differ");
    }
    if (draft.hours_profile_id && draft.hours_profile) {
      throw new PolicyInputError("invalid_hours_profile", "choose either a saved or inline hours profile");
    }
    if (draft.destination_edits !== undefined && !isDestinationEditPolicy(draft.destination_edits)) {
      throw new PolicyInputError(
        "invalid_destination_edits",
        "destination-edit behavior must set version 1 with on_edit and on_delete modes"
      );
    }
    const inlineHoursProfile = draft.hours_profile
      ? validateInlineHoursProfile(draft.hours_profile)
      : undefined;
    const hoursMode = draft.hours?.mode
      ?? (draft.hours_profile_id || inlineHoursProfile ? "overlaps_profile" : "all_times");
    if (hoursMode !== "all_times" && !draft.hours_profile_id && !inlineHoursProfile) {
      throw new PolicyInputError("invalid_hours_profile", "hours mode requires an hours profile");
    }
    if (hoursMode === "all_times" && (draft.hours_profile_id || inlineHoursProfile)) {
      throw new PolicyInputError("invalid_hours_profile", "all-times mode cannot use an hours profile");
    }
    const calendars = await this.db
      .selectFrom("calendar_endpoints")
      .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
      .select([
        "calendar_endpoints.id",
        "calendar_endpoints.remote_id",
        "calendar_endpoints.readable",
        "calendar_endpoints.writable",
        "calendar_endpoints.capabilities",
        "provider_connections.provider",
        "provider_connections.intended_role",
        "provider_connections.status as connection_status"
      ])
      .where("calendar_endpoints.organization_id", "=", organizationId)
      .where("calendar_endpoints.id", "in", [draft.source_calendar_id, draft.destination_calendar_id])
      .execute();
    const { source, destination } = requirePolicyCalendars(calendars, draft);
    const queryFingerprint = calendarSyncQueryFingerprint(
      this.runtime,
      source.provider,
      source.remote_id
    );
    const initialCursor = await this.db
      .selectFrom("sync_cursors")
      .select(["query_fingerprint", "generation", "sync_token", "state"])
      .where("organization_id", "=", organizationId)
      .where("calendar_endpoint_id", "=", draft.source_calendar_id)
      .where("query_fingerprint", "=", queryFingerprint)
      .executeTakeFirst();
    requireCompletedCursor(initialCursor, "source_sync_incomplete");
    const initialCursorFingerprint = this.runtime.hash([initialCursor]);
    const observations = await this.db
      .selectFrom("source_observations")
      .select(["id", "normalized_event", "observation_hash"])
      .where("organization_id", "=", organizationId)
      .where("calendar_endpoint_id", "=", draft.source_calendar_id)
      .where("tombstone", "=", false)
      .where("managed_copy", "=", false)
      .orderBy("observed_at", "desc")
      .limit(PREVIEW_OBSERVATION_LIMIT + 1)
      .execute();
    if (observations.length > PREVIEW_OBSERVATION_LIMIT) {
      throw new PolicyInputError(
        "preview_incomplete",
        `policy preview exceeds the ${PREVIEW_OBSERVATION_LIMIT}-observation safety limit`
      );
    }
    const hoursRow = draft.hours_profile_id
      ? await this.db
          .selectFrom("hours_profiles")
          .select(["id", "version", "timezone", "dst_resolution", "weekly_intervals", "exceptions"])
          .where("organization_id", "=", organizationId)
          .where("id", "=", draft.hours_profile_id)
          .executeTakeFirst()
      : null;
    if (draft.hours_profile_id && !hoursRow) {
      throw new PolicyInputError("hours_profile_not_found", "hours profile was not found");
    }
    const inlineProfileRef = inlineHoursProfile
      ? `inline:${this.runtime.hash(inlineHoursProfile)}`
      : undefined;
    const hoursProfile: HoursProfile | undefined = inlineHoursProfile && inlineProfileRef
      ? {
          profile_ref: inlineProfileRef,
          revision: 1,
          timezone: inlineHoursProfile.timezone,
          dst_resolution: inlineHoursProfile.dst_resolution,
          weekly: inlineHoursProfile.weekly,
          exceptions: inlineHoursProfile.exceptions
        }
      : hoursRow
        ? {
          profile_ref: hoursRow.id,
          revision: hoursRow.version,
          timezone: hoursRow.timezone,
          dst_resolution: hoursRow.dst_resolution as HoursProfile["dst_resolution"],
          weekly: hoursRow.weekly_intervals as HoursProfile["weekly"],
          exceptions: hoursRow.exceptions as HoursProfile["exceptions"]
        }
        : undefined;
    const counts: Record<string, number> = { create: 0, update: 0, delete: 0, unchanged: 0, excluded: 0 };
    const excludedByReason: Record<string, number> = {};
    const examples: unknown[] = [];
    let disclosure: unknown = null;
    const now = new Date();
    const horizon = draft.horizon ?? { past_days: 30, future_days: 365 };
    const canonicalPolicy = compilePolicyDraft(draft, "preview", 1, "active", hoursProfile?.profile_ref);
    for (const observation of observations) {
      const input: PolicyEvaluationInput = {
        now: now.toISOString(),
        horizon: {
          start: new Date(now.getTime() - horizon.past_days * 86_400_000).toISOString(),
          end: new Date(now.getTime() + horizon.future_days * 86_400_000).toISOString()
        },
        candidate_projection_ref: `preview:${observation.id}`,
        policy: canonicalPolicy,
        ...(hoursProfile ? { hours_profile: hoursProfile } : {}),
        source: observation.normalized_event as SourceObservation,
        projection: { ownership: "none" },
        destination_capabilities: destinationCapabilities(destination.capabilities, destination.writable)
      };
      const result = this.runtime.evaluate(input);
      const decision = resultCountKey(result);
      counts[decision] = (counts[decision] ?? 0) + 1;
      if (decision === "excluded") {
        for (const reason of result.reason_codes) {
          excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
        }
      }
      disclosure ??= result.disclosure_manifest ?? null;
      if (examples.length < 3) {
        examples.push({
          source: { observation_hash: observation.observation_hash, details_redacted: true },
          decision,
          reason_codes: result.reason_codes,
          disclosure: result.disclosure_manifest ?? null
        });
      }
    }
    const policyHash = this.runtime.hash(draft);
    const cursorRows = await this.db
      .selectFrom("sync_cursors")
      .select(["query_fingerprint", "generation", "sync_token", "state"])
      .where("organization_id", "=", organizationId)
      .where("calendar_endpoint_id", "=", draft.source_calendar_id)
      .where("query_fingerprint", "=", queryFingerprint)
      .execute();
    requireCompletedCursor(cursorRows[0], "source_sync_incomplete");
    const cursorFingerprint = this.runtime.hash(cursorRows);
    if (cursorFingerprint !== initialCursorFingerprint) {
      throw new PolicyInputError(
        "source_sync_incomplete",
        "source calendar changed while the preview was being calculated"
      );
    }
    const id = newId();
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const resultDocument = {
      complete: true as const,
      counts,
      excluded_by_reason: excludedByReason,
      disclosure,
      examples,
      warnings: [] as string[]
    };
    await this.db
      .insertInto("policy_previews")
      .values({
        id,
        organization_id: organizationId,
        principal_id: principalId,
        policy_document: draft,
        policy_hash: policyHash,
        source_cursor_fingerprint: cursorFingerprint,
        result_document: resultDocument,
        expires_at: expiresAt,
        consumed_at: null
      })
      .executeTakeFirstOrThrow();
    return {
      preview_token: id,
      expires_at: expiresAt.toISOString(),
      ...resultDocument
    };
  }

  public async activate(organizationId: string, principalId: string, previewId: string): Promise<{ id: string; revision: number }> {
    return this.db.transaction().execute(async (transaction) => {
      const preview = await transaction
        .selectFrom("policy_previews")
        .selectAll()
        .where("id", "=", previewId)
        .where("organization_id", "=", organizationId)
        .where("principal_id", "=", principalId)
        .forUpdate()
        .executeTakeFirst();
      if (!preview || preview.consumed_at || new Date(preview.expires_at).getTime() <= Date.now()) {
        throw new PolicyInputError("preview_stale", "preview is missing, expired, or already consumed");
      }
      if (!isCompletePreviewResult(preview.result_document)) {
        throw new PolicyInputError("preview_stale", "preview was incomplete and cannot be activated");
      }
      const draft = preview.policy_document as unknown as PolicyDraft;
      const calendars = await transaction
        .selectFrom("calendar_endpoints")
        .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
        .select([
          "calendar_endpoints.id",
          "calendar_endpoints.remote_id",
          "calendar_endpoints.readable",
          "calendar_endpoints.writable",
          "calendar_endpoints.capabilities",
          "provider_connections.provider",
          "provider_connections.intended_role",
          "provider_connections.status as connection_status"
        ])
        .where("calendar_endpoints.organization_id", "=", organizationId)
        .where("calendar_endpoints.id", "in", [draft.source_calendar_id, draft.destination_calendar_id])
        .forUpdate()
        .execute();
      const { source } = requirePolicyCalendars(calendars, draft);
      const queryFingerprint = calendarSyncQueryFingerprint(
        this.runtime,
        source.provider,
        source.remote_id
      );
      const cursorRows = await transaction
        .selectFrom("sync_cursors")
        .select(["query_fingerprint", "generation", "sync_token", "state"])
        .where("organization_id", "=", organizationId)
        .where("calendar_endpoint_id", "=", draft.source_calendar_id)
        .where("query_fingerprint", "=", queryFingerprint)
        .forUpdate()
        .execute();
      requireCompletedCursor(cursorRows[0], "preview_stale");
      if (this.runtime.hash(cursorRows) !== preview.source_cursor_fingerprint) {
        throw new PolicyInputError("preview_stale", "source cursor changed after preview");
      }
      const inlineHoursProfile = draft.hours_profile
        ? validateInlineHoursProfile(draft.hours_profile)
        : undefined;
      const hoursProfileId = inlineHoursProfile ? newId() : draft.hours_profile_id ?? null;
      if (inlineHoursProfile && hoursProfileId) {
        await transaction
          .insertInto("hours_profiles")
          .values({
            id: hoursProfileId,
            organization_id: organizationId,
            name: inlineHoursProfile.name,
            timezone: inlineHoursProfile.timezone,
            dst_resolution: inlineHoursProfile.dst_resolution,
            weekly_intervals: JSON.stringify(inlineHoursProfile.weekly),
            exceptions: JSON.stringify(inlineHoursProfile.exceptions)
          })
          .executeTakeFirstOrThrow();
      }
      const persistedDraft = policyDraftForPersistence(draft, hoursProfileId);
      const persistedPolicyHash = this.runtime.hash(persistedDraft);
      const id = newId();
      await transaction
        .insertInto("sync_policies")
        .values({
          id,
          organization_id: organizationId,
          name: draft.name,
          source_calendar_id: draft.source_calendar_id,
          destination_calendar_id: draft.destination_calendar_id,
          hours_profile_id: hoursProfileId,
          status: "active",
          revision: 1,
          policy_document: persistedDraft,
          policy_hash: persistedPolicyHash,
          last_success_at: null,
          safe_error_code: null
        })
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("policy_previews")
        .set({ consumed_at: new Date() })
        .where("id", "=", previewId)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("audit_facts")
        .values({
          id: newId(),
          organization_id: organizationId,
          principal_id: principalId,
          actor_kind: "user",
          action: "policy.activated",
          target_type: "sync_policy",
          target_id: id,
          reason_code: "preview_confirmed",
          before_hash: null,
          after_hash: persistedPolicyHash,
          detail: { policy_revision: 1 }
        })
        .executeTakeFirstOrThrow();
      await this.jobs.enqueue(organizationId, "reconcile_policy", `policy:${id}:revision:1`, { policy_id: id }, new Date(), transaction);
      return { id, revision: 1 };
    });
  }

  public async list(organizationId: string): Promise<readonly unknown[]> {
    return this.db
      .selectFrom("sync_policies")
      .select(["id", "name", "source_calendar_id", "destination_calendar_id", "status", "revision", "last_success_at", "safe_error_code", "updated_at"])
      .where("organization_id", "=", organizationId)
      .where("status", "!=", "deleted")
      .orderBy("created_at", "asc")
      .execute();
  }

  public async setPaused(organizationId: string, principalId: string, id: string, paused: boolean): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const policy = await transaction
        .selectFrom("sync_policies")
        .select(["revision", "policy_hash", "status"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", id)
        .where("status", "!=", "deleted")
        .forUpdate()
        .executeTakeFirst();
      if (!policy) {
        throw new PolicyInputError("not_found", "sync policy was not found");
      }
      const nextStatus = paused ? "paused" : "active";
      const changedAt = new Date();
      await transaction
        .updateTable("sync_policies")
        .set({ status: nextStatus, updated_at: changedAt })
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      if (!paused) {
        await transaction
          .updateTable("outbox_effects")
          .set({ run_after: changedAt, safe_error_code: null, updated_at: changedAt })
          .where("policy_id", "=", id)
          .where("policy_revision", "=", policy.revision)
          .where("state", "=", "retry")
          .where("safe_error_code", "=", "policy_paused")
          .execute();
      }
      await transaction
        .insertInto("audit_facts")
        .values({
          id: newId(),
          organization_id: organizationId,
          principal_id: principalId,
          actor_kind: "user",
          action: paused ? "policy.paused" : "policy.resumed",
          target_type: "sync_policy",
          target_id: id,
          reason_code: "user_command",
          before_hash: policy.policy_hash,
          after_hash: policy.policy_hash,
          detail: { previous_status: policy.status, status: nextStatus }
        })
        .executeTakeFirstOrThrow();
      if (!paused) {
        await this.jobs.enqueue(organizationId, "reconcile_policy", `policy:${id}:revision:${policy.revision}`, { policy_id: id }, new Date(), transaction);
      }
    });
  }

  /**
   * Explicitly retry terminal/ambiguous projection recovery after the user has
   * inspected and corrected the destination. Existing dead effects are
   * replayed in order with read-before-write enabled. A verifier-only
   * ownership hold receives a new ambiguous update intent, which validates all
   * private ownership markers before it can write and safely rotates the
   * generation if the old Google event was deleted.
   */
  public async retryBlocked(
    organizationId: string,
    principalId: string,
    id: string
  ): Promise<number> {
    return this.db.transaction().execute(async (transaction) => {
      const policy = await transaction
        .selectFrom("sync_policies")
        .select(["revision", "policy_hash", "status"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", id)
        .where("status", "!=", "deleted")
        .forUpdate()
        .executeTakeFirst();
      if (!policy) {
        throw new PolicyInputError("not_found", "sync policy was not found");
      }
      const projections = await transaction
        .selectFrom("projections")
        .select([
          "id",
          "policy_revision",
          "source_observation_id",
          "source_basis_hash",
          "recovery_operation",
          "generation",
          "intent_sequence",
          "destination_event_id",
          "desired_hash",
          "desired_state",
          "status",
          "ownership"
        ])
        .where("organization_id", "=", organizationId)
        .where("policy_id", "=", id)
        .where((expression) => expression.or([
          expression("status", "in", ["held", "failed"]),
          sql<boolean>`exists (
            select 1
            from outbox_effects as blocking_effect
            where blocking_effect.organization_id = projections.organization_id
              and blocking_effect.projection_id = projections.id
              and blocking_effect.state = 'dead'
          )`
        ]))
        .orderBy("updated_at", "asc")
        .limit(100)
        .forUpdate()
        .execute();
      const now = new Date();
      let retried = 0;
      for (const projection of projections) {
        let supersededDead = false;
        const dead = await transaction
          .selectFrom("outbox_effects")
          .select([
            "id",
            "policy_revision",
            "source_basis_hash",
            "operation",
            "desired_state"
          ])
          .where("organization_id", "=", organizationId)
          .where("projection_id", "=", projection.id)
          .where("state", "=", "dead")
          .orderBy("created_at", "asc")
          .orderBy("id", "asc")
          .forUpdate()
          .executeTakeFirst();
        const currentSource = await transaction
          .selectFrom("source_observations")
          .select(["observation_hash", "tombstone"])
          .where("organization_id", "=", organizationId)
          .where("id", "=", projection.source_observation_id)
          .forUpdate()
          .executeTakeFirst();
        const currentSourceBasisHash = currentSource
          ? sourceObservationBasisHash(
              this.runtime,
              currentSource.observation_hash,
              currentSource.tombstone
            )
          : null;
        const sourceBasisMatches = currentSourceBasisHash !== null
          && dead?.source_basis_hash !== null
          && dead?.source_basis_hash !== undefined
          && projection.source_basis_hash !== null
          && dead.source_basis_hash === projection.source_basis_hash
          && dead.source_basis_hash === currentSourceBasisHash;
        const deadDesired = dead?.desired_state as unknown as DesiredCopy | null | undefined;
        const deadPayloadMatches = dead?.operation === "delete"
          ? projection.desired_hash === null && projection.desired_state === null
          : deadDesired !== null
            && deadDesired !== undefined
            && projection.desired_hash !== null
            && projection.desired_state !== null
            && deadDesired.provenance?.policy_ref === id
            && deadDesired.provenance.projection_ref === projection.id
            && deadDesired.provenance.generation === projection.generation
            && this.runtime.hash(deadDesired) === projection.desired_hash
            && this.runtime.hash(projection.desired_state) === projection.desired_hash;
        if (
          dead
          && dead.policy_revision === policy.revision
          && sourceBasisMatches
          && deadPayloadMatches
        ) {
          await transaction
            .updateTable("outbox_effects")
            .set({
              state: "retry",
              attempt_count: 0,
              run_after: now,
              lease_owner: null,
              lease_expires_at: null,
              ambiguous: true,
              safe_error_code: null,
              updated_at: now
            })
            .where("id", "=", dead.id)
            .where("state", "=", "dead")
            .executeTakeFirstOrThrow();
          await transaction
            .updateTable("projections")
            .set({
              recovery_operation: null,
              status: "retrying",
              safe_error_code: null,
              updated_at: now
            })
            .where("id", "=", projection.id)
            .executeTakeFirstOrThrow();
          retried += 1;
          continue;
        }
        if (dead) {
          // An older revision, a changed source observation, or a changed
          // durable desired payload makes direct replay unsafe. Supersede the
          // blocker without provider access. If a safety reconcile already
          // shadow-evaluated current recovery evidence below, schedule that
          // evidence through marker-verified ambiguity handling; otherwise a
          // fresh reconcile is the only safe next step.
          const reasonCode = dead.policy_revision === policy.revision
            ? "recovery_basis_changed"
            : "policy_revision_superseded";
          await transaction
            .updateTable("outbox_effects")
            .set({
              state: "succeeded",
              lease_owner: null,
              lease_expires_at: null,
              ambiguous: false,
              safe_error_code: reasonCode,
              updated_at: now
            })
            .where("id", "=", dead.id)
            .where("state", "=", "dead")
            .executeTakeFirstOrThrow();
          supersededDead = true;
        }
        if (
          (!supersededDead && (
            projection.status !== "held"
            || projection.ownership !== "ambiguous"
          ))
          || projection.policy_revision !== policy.revision
          || !projection.recovery_operation
        ) {
          if (supersededDead) {
            await transaction
              .updateTable("projections")
              .set({
                status: "failed",
                safe_error_code: "recovery_basis_changed",
                updated_at: now
              })
              .where("id", "=", projection.id)
              .executeTakeFirstOrThrow();
            await this.jobs.enqueue(
              organizationId,
              "reconcile_policy",
              `policy:${id}:revision:${policy.revision}:recovery:${dead?.id ?? projection.id}`,
              { policy_id: id },
              now,
              transaction
            );
            retried += 1;
          }
          continue;
        }
        if (
          !currentSource
          || !currentSourceBasisHash
          || !projection.source_basis_hash
          || currentSourceBasisHash !== projection.source_basis_hash
        ) {
          await transaction
            .updateTable("projections")
            .set({
              status: supersededDead ? "failed" : "held",
              safe_error_code: "recovery_basis_changed",
              updated_at: now
            })
            .where("id", "=", projection.id)
            .executeTakeFirstOrThrow();
          await this.jobs.enqueue(
            organizationId,
            "reconcile_policy",
            `policy:${id}:revision:${policy.revision}:recovery-basis:${projection.id}`,
            { policy_id: id },
            now,
            transaction
          );
          retried += 1;
          continue;
        }
        const operation = projection.recovery_operation;
        const desired = projection.desired_state as unknown as DesiredCopy | null;
        if (operation !== "delete") {
          if (
            !desired
            || !projection.desired_hash
            || desired.provenance?.policy_ref !== id
            || desired.provenance.projection_ref !== projection.id
            || desired.provenance.generation !== projection.generation
            || this.runtime.hash(desired) !== projection.desired_hash
          ) {
            if (supersededDead) {
              await transaction
                .updateTable("projections")
                .set({
                  status: "failed",
                  safe_error_code: "recovery_basis_changed",
                  updated_at: now
                })
                .where("id", "=", projection.id)
                .executeTakeFirstOrThrow();
              await this.jobs.enqueue(
                organizationId,
                "reconcile_policy",
                `policy:${id}:revision:${policy.revision}:recovery-payload:${projection.id}`,
                { policy_id: id },
                now,
                transaction
              );
              retried += 1;
            }
            continue;
          }
        } else if (projection.desired_hash !== null || desired !== null) {
          if (supersededDead) {
            await transaction
              .updateTable("projections")
              .set({
                status: "failed",
                safe_error_code: "recovery_basis_changed",
                updated_at: now
              })
              .where("id", "=", projection.id)
              .executeTakeFirstOrThrow();
            await this.jobs.enqueue(
              organizationId,
              "reconcile_policy",
              `policy:${id}:revision:${policy.revision}:recovery-payload:${projection.id}`,
              { policy_id: id },
              now,
              transaction
            );
            retried += 1;
          }
          continue;
        }
        const intentSequence = Number(projection.intent_sequence) + 1;
        const idempotencyKey = this.runtime.hash({
          version: 1,
          kind: "user_requested_ambiguous_recovery",
          policy_ref: id,
          policy_revision: policy.revision,
          projection_ref: projection.id,
          generation: projection.generation,
          intent_sequence: intentSequence,
          operation,
          desired_fingerprint: projection.desired_hash
        });
        await transaction
          .insertInto("outbox_effects")
          .values({
            id: newId(),
            organization_id: organizationId,
            policy_id: id,
            projection_id: projection.id,
            source_basis_hash: projection.source_basis_hash,
            policy_revision: policy.revision,
            operation,
            idempotency_key: idempotencyKey,
            desired_state: desired,
            state: "pending",
            attempt_count: 0,
            run_after: now,
            lease_owner: null,
            lease_expires_at: null,
            ambiguous: true,
            safe_error_code: null
          })
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable("projections")
          .set({
            intent_sequence: intentSequence,
            recovery_operation: null,
            status: "retrying",
            safe_error_code: null,
            updated_at: now
          })
          .where("id", "=", projection.id)
          .executeTakeFirstOrThrow();
        retried += 1;
      }
      await transaction
        .insertInto("audit_facts")
        .values({
          id: newId(),
          organization_id: organizationId,
          principal_id: principalId,
          actor_kind: "user",
          action: "policy.recovery_requested",
          target_type: "sync_policy",
          target_id: id,
          reason_code: "user_command",
          before_hash: policy.policy_hash,
          after_hash: policy.policy_hash,
          detail: { effects_retried: retried }
        })
        .executeTakeFirstOrThrow();
      return retried;
    });
  }

  public async requestReconcile(organizationId: string, id: string): Promise<string | null> {
    const policy = await this.db
      .selectFrom("sync_policies")
      .select(["revision", "status"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
    if (!policy || policy.status === "deleted") {
      throw new PolicyInputError("not_found", "sync policy was not found");
    }
    return this.jobs.enqueue(
      organizationId,
      "reconcile_policy",
      `policy:${id}:revision:${policy.revision}`,
      { policy_id: id }
    );
  }
}

export class PolicyInputError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PolicyInputError";
  }
}

interface PolicyCalendarCapability {
  readonly id: string;
  readonly remote_id: string;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly capabilities: unknown;
  readonly provider: "google" | "fake";
  readonly intended_role: "source" | "destination" | "both";
  readonly connection_status: "active" | "action_required" | "revoked";
}

function requirePolicyCalendars(
  calendars: readonly PolicyCalendarCapability[],
  draft: Pick<PolicyDraft, "source_calendar_id" | "destination_calendar_id">
): { readonly source: PolicyCalendarCapability; readonly destination: PolicyCalendarCapability } {
  const source = calendars.find((calendar) => calendar.id === draft.source_calendar_id);
  const destination = calendars.find((calendar) => calendar.id === draft.destination_calendar_id);
  if (
    source?.connection_status !== "active"
    || !source.readable
    || (source.intended_role !== "source" && source.intended_role !== "both")
    || destination?.connection_status !== "active"
    || !destination.writable
    || (destination.intended_role !== "destination" && destination.intended_role !== "both")
  ) {
    throw new PolicyInputError(
      "calendar_capability",
      "source and destination must be active and match their authorized connection roles"
    );
  }
  return { source, destination };
}

function requireCompletedCursor(
  cursor: {
    readonly state: "full_required" | "syncing" | "ready" | "action_required";
    readonly sync_token: string | null;
  } | undefined,
  code: "source_sync_incomplete" | "preview_stale"
): void {
  if (!cursor || cursor.state !== "ready" || !cursor.sync_token) {
    throw new PolicyInputError(code, "source calendar has not completed its current synchronization");
  }
}

function isCompletePreviewResult(value: unknown): boolean {
  return isRecord(value)
    && value["complete"] === true
    && Array.isArray(value["warnings"])
    && !value["warnings"].includes("preview_truncated");
}

function policyDraftForPersistence(draft: PolicyDraft, hoursProfileId: string | null): PolicyDraft {
  const { hours_profile: _inlineHoursProfile, ...withoutInlineProfile } = draft;
  const mode = draft.hours?.mode ?? (hoursProfileId ? "overlaps_profile" : "all_times");
  return {
    ...withoutInlineProfile,
    hours_profile_id: hoursProfileId,
    hours: {
      mode,
      ...(mode !== "all_times" && hoursProfileId ? { profile_ref: hoursProfileId } : {})
    },
    // The stored policy is explicit: an omitted destination-edit choice is
    // persisted as the concrete default rather than an implicit behavior.
    destination_edits: normalizeDestinationEditPolicy(draft.destination_edits)
  };
}

function validateInlineHoursProfile(value: unknown): InlineHoursProfile {
  if (!isRecord(value)) {
    throw new PolicyInputError("invalid_hours_profile", "hours profile must be an object");
  }
  const rawName = value["name"];
  const rawTimezone = value["timezone"];
  const rawResolution = value["dst_resolution"];
  const rawWeekly = value["weekly"];
  const rawExceptions = value["exceptions"];
  if (typeof rawName !== "string" || typeof rawTimezone !== "string") {
    throw new PolicyInputError("invalid_hours_profile", "hours profile name and timezone are required");
  }
  const name = rawName.normalize("NFC").trim();
  const timezone = rawTimezone.trim();
  if ([...name].length < 1 || [...name].length > 120 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new PolicyInputError("invalid_hours_profile", "hours profile name is invalid");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new PolicyInputError("invalid_hours_profile", "hours profile timezone is invalid");
  }
  if (
    !isRecord(rawResolution)
    || (rawResolution["ambiguous"] !== "earlier_offset" && rawResolution["ambiguous"] !== "later_offset")
    || (rawResolution["nonexistent"] !== "reject" && rawResolution["nonexistent"] !== "shift_forward_by_gap")
  ) {
    throw new PolicyInputError("invalid_hours_profile", "hours profile DST policy is invalid");
  }
  if (!Array.isArray(rawWeekly) || rawWeekly.length > 128 || !rawWeekly.every(isWeeklyInterval)) {
    throw new PolicyInputError("invalid_hours_profile", "hours profile weekly intervals are invalid");
  }
  if (!Array.isArray(rawExceptions) || rawExceptions.length > 366 || !rawExceptions.every(isHoursException)) {
    throw new PolicyInputError("invalid_hours_profile", "hours profile exceptions are invalid");
  }
  const exceptionDates = rawExceptions.map((exception) => (exception as { date: string }).date);
  if (new Set(exceptionDates).size !== exceptionDates.length) {
    throw new PolicyInputError("invalid_hours_profile", "hours profile contains duplicate exception dates");
  }
  return {
    name,
    timezone,
    dst_resolution: {
      ambiguous: rawResolution["ambiguous"],
      nonexistent: rawResolution["nonexistent"]
    },
    weekly: rawWeekly as WeeklyInterval[],
    exceptions: rawExceptions as HoursException[]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWeeklyInterval(value: unknown): value is WeeklyInterval {
  return isRecord(value)
    && Number.isInteger(value["weekday"])
    && Number(value["weekday"]) >= 1
    && Number(value["weekday"]) <= 7
    && isLocalInterval(value);
}

function isLocalInterval(value: Record<string, unknown>): boolean {
  if (
    typeof value["start"] !== "string"
    || typeof value["end"] !== "string"
    || (value["end_day_offset"] !== 0 && value["end_day_offset"] !== 1)
    || !isLocalTime(value["start"])
    || !isLocalTime(value["end"])
  ) {
    return false;
  }
  return value["end_day_offset"] === 1 || value["end"] > value["start"];
}

function isHoursException(value: unknown): value is HoursException {
  if (!isRecord(value) || typeof value["date"] !== "string" || !isLocalDate(value["date"])) {
    return false;
  }
  if (value["kind"] === "closed") {
    return value["intervals"] === undefined;
  }
  return (value["kind"] === "replace" || value["kind"] === "add" || value["kind"] === "remove")
    && Array.isArray(value["intervals"])
    && value["intervals"].length <= 32
    && value["intervals"].every((interval) => isRecord(interval) && isLocalInterval(interval));
}

function isLocalTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/u.test(value);
}

function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
