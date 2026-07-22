import type {
  DestinationCapabilities,
  HoursProfile,
  PolicyEvaluationInput,
  ProjectionInput,
  SourceObservation,
  SyncPolicy
} from "@planipus/calendar-sync";
import type { Kysely, Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { newId } from "../foundation.js";
import {
  compilePolicyDraft,
  destinationCapabilities,
  type PolicyDraft
} from "../policy/service.js";
import type { PolicyRuntime } from "../policy/runtime.js";
import { sourceObservationBasisHash } from "./basis.js";

const DAY_MILLISECONDS = 86_400_000;

export interface ReconciliationSummary {
  readonly policyId: string;
  readonly evaluated: number;
  readonly effectsCreated: number;
  readonly counts: Readonly<Record<string, number>>;
}

export interface ExistingProjectionPersistence {
  readonly desired_hash: string | null;
  readonly desired_state: object | null;
  readonly safe_error_code: string | null;
}

/**
 * A held evaluation intentionally emits no write intent. When the hold comes
 * from ambiguous destination ownership, however, the last validated desired
 * copy is the evidence required by explicit read-before-write recovery. Keep
 * that evidence until recovery resolves the hold instead of treating the
 * evaluator's absent desired copy as a request to erase it.
 */
export function projectionPersistenceForResult(
  result: ReturnType<PolicyRuntime["evaluate"]>,
  existing?: ExistingProjectionPersistence
): {
  readonly desiredHash: string | null;
  readonly desiredState: object | null;
  readonly safeErrorCode: string | null;
} {
  const preserveHeldEvidence = result.selection === "held"
    && result.operation === "none"
    && existing !== undefined;
  return {
    desiredHash: result.desired_fingerprint
      ?? (preserveHeldEvidence ? existing.desired_hash : null),
    desiredState: result.desired_copy
      ?? (preserveHeldEvidence ? existing.desired_state : null),
    safeErrorCode: result.selection === "invalid"
      ? result.primary_reason_code
      : result.selection === "held"
        ? existing?.safe_error_code ?? result.primary_reason_code
        : null
  };
}

export function recoveryOperationForResult(
  result: ReturnType<PolicyRuntime["evaluate"]>
): "create" | "update" | "delete" | null {
  if (result.selection === "included") {
    return result.operation === "create" ? "create" : "update";
  }
  return result.selection === "excluded" && result.operation === "delete"
    ? "delete"
    : null;
}

/**
 * Turns provider observations into durable desired-state projections and outbox
 * effects. No network write is performed here: committing the projection and its
 * effect in one database transaction is the crash-safety boundary.
 */
export class PolicyReconciler {
  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly runtime: PolicyRuntime
  ) {}

  public async reconcile(organizationId: string, policyId: string): Promise<ReconciliationSummary> {
    const policy = await this.db
      .selectFrom("sync_policies")
      .innerJoin("calendar_endpoints as destination", "destination.id", "sync_policies.destination_calendar_id")
      .innerJoin(
        "provider_connections as destination_connection",
        "destination_connection.id",
        "destination.connection_id"
      )
      .select([
        "sync_policies.id",
        "sync_policies.revision",
        "sync_policies.status",
        "sync_policies.policy_document",
        "sync_policies.source_calendar_id",
        "sync_policies.destination_calendar_id",
        "sync_policies.hours_profile_id",
        "destination.writable as destination_writable",
        "destination.capabilities as destination_capabilities",
        "destination_connection.account_label as destination_identity"
      ])
      .where("sync_policies.organization_id", "=", organizationId)
      .where("sync_policies.id", "=", policyId)
      .executeTakeFirst();
    if (!policy || policy.status === "deleted") {
      return { policyId, evaluated: 0, effectsCreated: 0, counts: { not_found: 1 } };
    }
    // Pausing freezes existing copies. A resume explicitly schedules a new pass.
    if (policy.status === "paused") {
      return { policyId, evaluated: 0, effectsCreated: 0, counts: { paused: 1 } };
    }

    const draft = policy.policy_document as unknown as PolicyDraft;
    const hoursProfile = await this.loadHoursProfile(organizationId, policy.hours_profile_id);
    const canonicalPolicy = compilePolicyDraft(draft, policy.id, policy.revision, "active");
    const capabilities = destinationCapabilities(
      policy.destination_capabilities,
      policy.destination_writable
    );
    const counts: Record<string, number> = {};
    let effectsCreated = 0;
    let evaluated = 0;
    let afterId: string | undefined;
    while (true) {
      let query = this.db
        .selectFrom("source_observations")
        .select(["id", "normalized_event", "observation_hash", "recurrence_identity", "tombstone"])
        .where("organization_id", "=", organizationId)
        .where("calendar_endpoint_id", "=", policy.source_calendar_id);
      if (afterId) {
        query = query.where("id", ">", afterId);
      }
      const observations = await query.orderBy("id", "asc").limit(1_000).execute();
      for (const observation of observations) {
        const effectCreated = await this.db.transaction().execute(async (transaction) => {
          return this.reconcileObservation(
            transaction,
            organizationId,
            canonicalPolicy,
            capabilities,
            hoursProfile,
            observation.id,
            observation.observation_hash,
            observation.tombstone,
            observation.recurrence_identity,
            markDestinationIdentityInvitation(
              observationForEvaluation(
                observation.normalized_event as SourceObservation,
                observation.tombstone
              ),
              policy.destination_identity
            ),
            draft.horizon
          );
        });
        counts[effectCreated.decision] = (counts[effectCreated.decision] ?? 0) + 1;
        if (effectCreated.created) {
          effectsCreated += 1;
        }
      }
      evaluated += observations.length;
      afterId = observations.at(-1)?.id;
      if (observations.length < 1_000) {
        break;
      }
    }

    await this.db
      .updateTable("sync_policies")
      .set({ last_success_at: new Date(), safe_error_code: null, updated_at: new Date() })
      .where("organization_id", "=", organizationId)
      .where("id", "=", policyId)
      .execute();
    return { policyId, evaluated, effectsCreated, counts };
  }

  private async reconcileObservation(
    transaction: Transaction<DatabaseSchema>,
    organizationId: string,
    policy: SyncPolicy,
    capabilities: DestinationCapabilities,
    hoursProfile: HoursProfile | undefined,
    observationId: string,
    observationHash: string,
    tombstone: boolean,
    recurrenceIdentity: string,
    source: SourceObservation,
    configuredHorizon: PolicyDraft["horizon"]
  ): Promise<{ readonly created: boolean; readonly decision: string }> {
    const sourceBasisHash = sourceObservationBasisHash(this.runtime, observationHash, tombstone);
    const existing = await transaction
      .selectFrom("projections")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("policy_id", "=", policy.policy_ref)
      .where("source_observation_id", "=", observationId)
      .where("recurrence_identity", "=", recurrenceIdentity)
      .forUpdate()
      .executeTakeFirst();
    const blockingDeadEffect = existing
      ? await transaction
        .selectFrom("outbox_effects")
        .select(["id", "safe_error_code"])
        .where("organization_id", "=", organizationId)
        .where("projection_id", "=", existing.id)
        .where("state", "=", "dead")
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .executeTakeFirst()
      : undefined;
    const projectionId = existing?.id ?? newId();
    const generation = existing?.generation ?? 1;
    const projection: ProjectionInput = existing
      ? {
          // A successfully deleted copy is a retained identity record, not an
          // attached destination. If the source becomes eligible again this
          // maps back to a deterministic create instead of another delete.
          ownership: existing.status === "deleted" && existing.destination_event_id === null
            ? "none"
            : existing.ownership === "ambiguous"
              // Shadow evaluation refreshes the current recovery payload only;
              // the durable projection remains held/ambiguous and no provider
              // write is authorized here.
              ? "attached"
              : existing.ownership,
          projection_ref: existing.id,
          generation,
          ...(existing.destination_event_id ? { destination_event_ref: existing.destination_event_id } : {}),
          destination_exists: existing.destination_event_id !== null,
          ...(existing.desired_hash ? { desired_fingerprint: existing.desired_hash } : {})
        }
      : { ownership: "none" };
    const horizon = configuredHorizon ?? { past_days: 30, future_days: 365 };
    const now = new Date();
    const input: PolicyEvaluationInput = {
      now: now.toISOString(),
      horizon: {
        start: new Date(now.getTime() - horizon.past_days * DAY_MILLISECONDS).toISOString(),
        end: new Date(now.getTime() + horizon.future_days * DAY_MILLISECONDS).toISOString()
      },
      candidate_projection_ref: projectionId,
      policy,
      ...(hoursProfile ? { hours_profile: hoursProfile } : {}),
      source,
      projection,
      destination_capabilities: capabilities
    };
    const result = this.runtime.evaluate(input);
    const decision = `${result.selection}:${result.operation}:${result.primary_reason_code}`;
    const intentSequence = Number(existing?.intent_sequence ?? 0)
      + (result.operation === "none" ? 0 : 1);

    if (existing && (blockingDeadEffect || existing.ownership === "ambiguous")) {
      const status = existing.ownership === "ambiguous" ? "held" : "failed";
      const recoveryOperation = recoveryOperationForResult(result);
      await transaction
        .updateTable("projections")
        .set({
          policy_revision: policy.revision,
          source_basis_hash: sourceBasisHash,
          recovery_operation: recoveryOperation,
          desired_hash: result.desired_fingerprint ?? null,
          desired_state: result.desired_copy ?? null,
          status,
          safe_error_code: recoveryOperation === null
            ? result.primary_reason_code
            : blockingDeadEffect?.safe_error_code
              ?? existing.safe_error_code
              ?? "effect_recovery_required",
          updated_at: now
        })
        .where("id", "=", existing.id)
        .executeTakeFirstOrThrow();
      return {
        created: false,
        decision: blockingDeadEffect
          ? `${status}:none:blocking_dead_effect`
          : "held:none:recovery_shadow_refreshed"
      };
    }

    if (!existing && result.operation === "none") {
      return { created: false, decision };
    }

    const persistence = projectionPersistenceForResult(result, existing);
    const desiredState = persistence.desiredState;
    const desiredHash = persistence.desiredHash;
    if (!existing) {
      await transaction
        .insertInto("projections")
        .values({
          id: projectionId,
          organization_id: organizationId,
          policy_id: policy.policy_ref,
          policy_revision: policy.revision,
          source_observation_id: observationId,
          source_basis_hash: sourceBasisHash,
          recovery_operation: null,
          recurrence_identity: recurrenceIdentity,
          destination_calendar_id: policy.destination_calendar_ref,
          destination_event_id: null,
          destination_etag: null,
          generation,
          intent_sequence: intentSequence,
          desired_hash: desiredHash,
          desired_state: desiredState,
          status: result.operation === "none" ? "held" : "pending",
          ownership: result.selection === "held" ? "ambiguous" : "attached",
          last_success_at: null,
          safe_error_code: persistence.safeErrorCode
        })
        .executeTakeFirstOrThrow();
    } else {
      await transaction
        .updateTable("projections")
        .set({
          policy_revision: policy.revision,
          source_basis_hash: sourceBasisHash,
          recovery_operation: null,
          ...(result.operation === "none" ? {} : { intent_sequence: intentSequence }),
          desired_hash: desiredHash,
          desired_state: desiredState,
          status: result.operation === "none"
            ? result.selection === "held"
              ? "held"
              // A no-op tombstone evaluation must retain the durable deleted
              // state. Relabeling it converged makes the next pass treat the
              // retained identity row as attached and emit a phantom delete.
              : existing.status === "deleted" && existing.destination_event_id === null
                ? "deleted"
                : "converged"
            : "pending",
          safe_error_code: persistence.safeErrorCode,
          updated_at: now
        })
        .where("id", "=", existing.id)
        .executeTakeFirstOrThrow();
    }

    if (result.operation === "none") {
      return { created: false, decision };
    }
    const idempotencyKey = this.runtime.hash({
      version: 1,
      policy_ref: policy.policy_ref,
      policy_revision: policy.revision,
      projection_ref: projectionId,
      generation,
      intent_sequence: intentSequence,
      operation: result.operation,
      desired_fingerprint: desiredHash
    });
    const inserted = await transaction
      .insertInto("outbox_effects")
      .values({
        id: newId(),
        organization_id: organizationId,
        policy_id: policy.policy_ref,
        projection_id: projectionId,
        source_basis_hash: sourceBasisHash,
        policy_revision: policy.revision,
        operation: result.operation,
        idempotency_key: idempotencyKey,
        desired_state: desiredState,
        state: "pending",
        attempt_count: 0,
        run_after: now,
        lease_owner: null,
        lease_expires_at: null,
        ambiguous: false,
        safe_error_code: null
      })
      .onConflict((conflict) => conflict.column("idempotency_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    return { created: inserted !== undefined, decision };
  }

  private async loadHoursProfile(
    organizationId: string,
    profileId: string | null
  ): Promise<HoursProfile | undefined> {
    if (!profileId) {
      return undefined;
    }
    const row = await this.db
      .selectFrom("hours_profiles")
      .select(["id", "version", "timezone", "dst_resolution", "weekly_intervals", "exceptions"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", profileId)
      .executeTakeFirst();
    return row
      ? {
          profile_ref: row.id,
          revision: row.version,
          timezone: row.timezone,
          dst_resolution: row.dst_resolution as HoursProfile["dst_resolution"],
          weekly: row.weekly_intervals as HoursProfile["weekly"],
          exceptions: row.exceptions as HoursProfile["exceptions"]
        }
      : undefined;
  }
}

export function markDestinationIdentityInvitation(
  source: SourceObservation,
  destinationIdentity: string
): SourceObservation {
  const identity = normalizeIdentity(destinationIdentity);
  const invited = source.destination_identity_invited
    || (source.attendees ?? []).some((attendee) => normalizeIdentity(attendee) === identity)
    || (source.organizer !== undefined && normalizeIdentity(source.organizer) === identity);
  return invited === source.destination_identity_invited
    ? source
    : { ...source, destination_identity_invited: invited };
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

export function observationForEvaluation(
  source: SourceObservation,
  tombstone: boolean
): SourceObservation {
  return tombstone && source.lifecycle === "confirmed"
    ? { ...source, lifecycle: "deleted" }
    : source;
}
