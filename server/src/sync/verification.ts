import {
  normalizeDestinationEditPolicy,
  planDestinationEditResponse,
  type DesiredCopy,
  type DestinationEditPolicy,
  type DestinationEditResponse
} from "@planipus/calendar-sync";
import { sql, type Kysely, type Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { newId } from "../foundation.js";
import type { PolicyRuntime } from "../policy/runtime.js";
import type { AccessTokenBroker } from "../providers/router.js";
import { ProviderRouter } from "../providers/router.js";
import { ProviderError, type ProviderEventLookup } from "../providers/types.js";
import { eventBelongsToProjection } from "./effects.js";
import { noticeDetailForDesiredCopy, recordSyncNotice } from "./notices.js";

export const DESTINATION_VERIFICATION_INTERVAL_MILLISECONDS = 15 * 60_000;
export const MAX_DESTINATION_VERIFICATIONS_PER_JOB = 100;

interface VerificationTarget {
  readonly projectionId: string;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly sourceBasisHash: string | null;
  readonly generation: number;
  readonly intentSequence: number;
  readonly destinationEventId: string;
  readonly destinationRevision: string | null;
  readonly desiredHash: string;
  readonly desiredState: DesiredCopy;
  readonly calendarRemoteId: string;
  readonly connectionId: string;
  readonly provider: "google" | "fake";
  readonly destinationEdits: DestinationEditPolicy;
}

export type DestinationVerificationDecision =
  | { readonly kind: "current"; readonly observedRevision: string }
  | { readonly kind: "missing" }
  | { readonly kind: "drifted"; readonly observedRevision: string }
  | { readonly kind: "ownership_mismatch"; readonly observedRevision: string };

export interface DestinationVerificationSummary {
  readonly claimed: number;
  readonly current: number;
  readonly repairsScheduled: number;
  readonly held: number;
  readonly deferred: number;
}

/**
 * Verifies a bounded oldest-first slice of source-authoritative destination
 * copies. A read is always performed before a repair is scheduled. What
 * happens after an owned copy is found edited or deleted follows the policy's
 * destination-edit configuration: restore silently, restore and record a
 * user-facing notice (default), or hold the copy untouched for an explicit
 * restore/detach decision. Restores require every private ownership marker to
 * still match the durable projection. Unknown ownership is held for review and
 * is never overwritten.
 */
export class DestinationVerifier {
  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly runtime: PolicyRuntime,
    private readonly providers: ProviderRouter,
    private readonly tokens: AccessTokenBroker
  ) {}

  public async verifyBatch(
    organizationId: string,
    limit = MAX_DESTINATION_VERIFICATIONS_PER_JOB,
    now = new Date()
  ): Promise<DestinationVerificationSummary> {
    const boundedLimit = Math.max(1, Math.min(limit, MAX_DESTINATION_VERIFICATIONS_PER_JOB));
    const projectionIds = await this.claimDue(
      organizationId,
      boundedLimit,
      now,
      new Date(now.getTime() - DESTINATION_VERIFICATION_INTERVAL_MILLISECONDS)
    );
    const tokenCache = new Map<string, Promise<string>>();
    let current = 0;
    let repairsScheduled = 0;
    let held = 0;
    let deferred = 0;

    for (const projectionId of projectionIds) {
      const target = await this.loadTarget(organizationId, projectionId);
      if (!target) {
        deferred += 1;
        continue;
      }
      try {
        let token = tokenCache.get(target.connectionId);
        if (!token) {
          token = this.tokens.accessToken(organizationId, target.connectionId);
          tokenCache.set(target.connectionId, token);
        }
        const provider = this.providers.resolve(target.provider);
        const observed = await provider.getEvent(
          await token,
          target.calendarRemoteId,
          target.destinationEventId
        );
        const decision = classifyDestinationVerification(target, observed);
        switch (decision.kind) {
          case "current":
            current += 1;
            break;
          case "ownership_mismatch":
            if (await this.holdOwnershipMismatch(organizationId, target, decision, now)) {
              held += 1;
            } else {
              deferred += 1;
            }
            break;
          case "missing":
          case "drifted": {
            const plan = planDestinationEditResponse(target.destinationEdits, decision.kind);
            if (plan.response === "hold") {
              if (await this.holdDestinationEdit(organizationId, target, decision, plan, now)) {
                held += 1;
              } else {
                deferred += 1;
              }
            } else if (await this.scheduleRepair(organizationId, target, decision, plan, now)) {
              repairsScheduled += 1;
            } else {
              deferred += 1;
            }
            break;
          }
        }
      } catch (error) {
        if (error instanceof ProviderError && error.code === "provider_auth") {
          await this.db
            .updateTable("provider_connections")
            .set({ status: "action_required", safe_error_code: error.code, updated_at: now })
            .where("organization_id", "=", organizationId)
            .where("id", "=", target.connectionId)
            .execute();
        }
        // Verification is a safety read, not the source sync critical path.
        // A transient read failure leaves the converged projection untouched;
        // the oldest-first scheduler will retry it after the bounded interval.
        deferred += 1;
      }
    }
    return {
      claimed: projectionIds.length,
      current,
      repairsScheduled,
      held,
      deferred
    };
  }

  private async claimDue(
    organizationId: string,
    limit: number,
    now: Date,
    cutoff: Date
  ): Promise<readonly string[]> {
    return this.db.transaction().execute(async (transaction) => {
      const rows = await transaction
        .selectFrom("projections as projection")
        .innerJoin("sync_policies as policy", "policy.id", "projection.policy_id")
        .select("projection.id")
        .where("projection.organization_id", "=", organizationId)
        .where("policy.organization_id", "=", organizationId)
        .where("policy.status", "=", "active")
        .where("projection.status", "=", "converged")
        .where("projection.ownership", "=", "attached")
        .where("projection.destination_event_id", "is not", null)
        .where("projection.desired_state", "is not", null)
        .where("projection.desired_hash", "is not", null)
        .where((expression) => expression.or([
          expression("projection.last_verified_at", "is", null),
          expression("projection.last_verified_at", "<", cutoff)
        ]))
        .orderBy(sql`projection.last_verified_at asc nulls first`)
        .orderBy("projection.id", "asc")
        .limit(limit)
        .forUpdate("projection")
        .skipLocked()
        .execute();
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.id);
      await transaction
        .updateTable("projections")
        .set({ last_verified_at: now })
        .where("id", "in", ids)
        .execute();
      return ids;
    });
  }

  private async loadTarget(
    organizationId: string,
    projectionId: string
  ): Promise<VerificationTarget | null> {
    const row = await this.db
      .selectFrom("projections as projection")
      .innerJoin("sync_policies as policy", "policy.id", "projection.policy_id")
      .innerJoin("calendar_endpoints as calendar", "calendar.id", "projection.destination_calendar_id")
      .innerJoin("provider_connections as connection", "connection.id", "calendar.connection_id")
      .select([
        "projection.id as projection_id",
        "projection.policy_id",
        "projection.policy_revision",
        "projection.source_basis_hash",
        "projection.generation",
        "projection.intent_sequence",
        "projection.destination_event_id",
        "projection.destination_etag",
        "projection.desired_hash",
        "projection.desired_state",
        "policy.policy_document",
        "calendar.remote_id as calendar_remote_id",
        "calendar.writable as calendar_writable",
        "connection.id as connection_id",
        "connection.provider",
        "connection.status as connection_status",
        "connection.intended_role"
      ])
      .where("projection.organization_id", "=", organizationId)
      .where("projection.id", "=", projectionId)
      .where("projection.status", "=", "converged")
      .where("projection.ownership", "=", "attached")
      .where("policy.status", "=", "active")
      .executeTakeFirst();
    if (
      !row?.destination_event_id
      || !row.desired_hash
      || !row.desired_state
      || !row.calendar_writable
      || row.connection_status !== "active"
      || (row.intended_role !== "destination" && row.intended_role !== "both")
    ) {
      return null;
    }
    return {
      projectionId: row.projection_id,
      policyId: row.policy_id,
      policyRevision: row.policy_revision,
      sourceBasisHash: row.source_basis_hash,
      generation: row.generation,
      intentSequence: Number(row.intent_sequence),
      destinationEventId: row.destination_event_id,
      destinationRevision: row.destination_etag,
      desiredHash: row.desired_hash,
      desiredState: row.desired_state as unknown as DesiredCopy,
      calendarRemoteId: row.calendar_remote_id,
      connectionId: row.connection_id,
      provider: row.provider,
      destinationEdits: normalizeDestinationEditPolicy(
        (row.policy_document as Record<string, unknown>)["destination_edits"]
      )
    };
  }

  private async scheduleRepair(
    organizationId: string,
    target: VerificationTarget,
    decision: Extract<DestinationVerificationDecision, { kind: "missing" | "drifted" }>,
    plan: Extract<DestinationEditResponse, { response: "repair" }>,
    now: Date
  ): Promise<boolean> {
    return this.db.transaction().execute(async (transaction) => {
      const policy = await transaction
        .selectFrom("sync_policies")
        .select(["status", "revision"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", target.policyId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !policy
        || policy.status !== "active"
        || policy.revision !== target.policyRevision
      ) {
        return false;
      }
      const current = await transaction
        .selectFrom("projections")
        .select([
          "status",
          "ownership",
          "policy_revision",
          "generation",
          "intent_sequence",
          "destination_event_id",
          "destination_etag",
          "desired_hash",
          "desired_state"
        ])
        .where("organization_id", "=", organizationId)
        .where("id", "=", target.projectionId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !current
        || current.status !== "converged"
        || current.ownership !== "attached"
        || current.policy_revision !== target.policyRevision
        || current.generation !== target.generation
        || current.destination_event_id !== target.destinationEventId
        || current.destination_etag !== target.destinationRevision
        || current.desired_hash !== target.desiredHash
        || !current.desired_state
      ) {
        return false;
      }
      const unfinished = await transaction
        .selectFrom("outbox_effects")
        .select("id")
        .where("projection_id", "=", target.projectionId)
        .where("state", "in", ["pending", "leased", "retry"])
        .executeTakeFirst();
      if (unfinished) {
        return false;
      }

      const operation = decision.kind === "missing" ? "create" : "update";
      const intentSequence = Number(current.intent_sequence) + 1;
      const previousDesired = current.desired_state as unknown as DesiredCopy;
      if (
        previousDesired.provenance?.policy_ref !== target.policyId
        || previousDesired.provenance.projection_ref !== target.projectionId
        || previousDesired.provenance.generation !== target.generation
        || this.runtime.hash(previousDesired) !== target.desiredHash
      ) {
        return false;
      }
      const repair = destinationRepairGeneration(
        previousDesired,
        current.generation,
        decision.kind
      );
      const desiredHash = this.runtime.hash(repair.desiredState);
      const idempotencyKey = this.runtime.hash({
        version: 1,
        kind: "destination_verification_repair",
        policy_ref: target.policyId,
        policy_revision: target.policyRevision,
        projection_ref: target.projectionId,
        generation: repair.generation,
        intent_sequence: intentSequence,
        operation,
        desired_fingerprint: desiredHash
      });
      await transaction
        .insertInto("outbox_effects")
        .values({
          id: newId(),
          organization_id: organizationId,
          policy_id: target.policyId,
          projection_id: target.projectionId,
          source_basis_hash: target.sourceBasisHash,
          policy_revision: target.policyRevision,
          operation,
          idempotency_key: idempotencyKey,
          desired_state: repair.desiredState,
          state: "pending",
          attempt_count: 0,
          run_after: now,
          lease_owner: null,
          lease_expires_at: null,
          ambiguous: false,
          safe_error_code: null
        })
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("projections")
        .set({
          intent_sequence: intentSequence,
          generation: repair.generation,
          recovery_operation: null,
          destination_event_id: decision.kind === "missing" ? null : target.destinationEventId,
          destination_etag: decision.kind === "drifted" ? decision.observedRevision : null,
          desired_hash: desiredHash,
          desired_state: repair.desiredState,
          status: "pending",
          safe_error_code: decision.kind === "missing" ? "destination_missing" : "destination_drift",
          updated_at: now
        })
        .where("id", "=", target.projectionId)
        .executeTakeFirstOrThrow();
      await this.audit(
        transaction,
        organizationId,
        target,
        "copy.repair_scheduled",
        plan.safe_error_code,
        {
          operation,
          previous_generation: target.generation,
          repair_generation: repair.generation
        },
        desiredHash
      );
      if (plan.notice) {
        await recordSyncNotice(transaction, {
          organizationId,
          policyId: target.policyId,
          projectionId: target.projectionId,
          kind: plan.notice,
          detail: noticeDetailForDesiredCopy(decision.kind, repair.desiredState)
        });
      }
      return true;
    });
  }

  /**
   * Freeze an owned-but-edited (or deleted) copy for an explicit decision. The
   * projection stays attached with its validated recovery evidence so the
   * notice's `restore` action can replay it through marker-verified ambiguous
   * recovery, while `keep_and_detach` releases the copy instead. Until then no
   * provider write happens and the person's direct change stays in place.
   */
  private async holdDestinationEdit(
    organizationId: string,
    target: VerificationTarget,
    decision: Extract<DestinationVerificationDecision, { kind: "missing" | "drifted" }>,
    plan: Extract<DestinationEditResponse, { response: "hold" }>,
    now: Date
  ): Promise<boolean> {
    return this.db.transaction().execute(async (transaction) => {
      const policy = await transaction
        .selectFrom("sync_policies")
        .select(["status", "revision"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", target.policyId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !policy
        || policy.status !== "active"
        || policy.revision !== target.policyRevision
      ) {
        return false;
      }
      const current = await transaction
        .selectFrom("projections")
        .select([
          "status",
          "ownership",
          "policy_revision",
          "generation",
          "destination_event_id",
          "destination_etag",
          "desired_hash",
          "desired_state"
        ])
        .where("organization_id", "=", organizationId)
        .where("id", "=", target.projectionId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !current
        || current.status !== "converged"
        || current.ownership !== "attached"
        || current.policy_revision !== target.policyRevision
        || current.generation !== target.generation
        || current.destination_event_id !== target.destinationEventId
        || current.destination_etag !== target.destinationRevision
        || current.desired_hash !== target.desiredHash
        || !current.desired_state
      ) {
        return false;
      }
      const unfinished = await transaction
        .selectFrom("outbox_effects")
        .select("id")
        .where("projection_id", "=", target.projectionId)
        .where("state", "in", ["pending", "leased", "retry"])
        .executeTakeFirst();
      if (unfinished) {
        return false;
      }
      const desired = current.desired_state as unknown as DesiredCopy;
      if (
        desired.provenance?.policy_ref !== target.policyId
        || desired.provenance.projection_ref !== target.projectionId
        || desired.provenance.generation !== target.generation
        || this.runtime.hash(desired) !== target.desiredHash
      ) {
        return false;
      }
      await transaction
        .updateTable("projections")
        .set({
          status: "held",
          recovery_operation: decision.kind === "missing" ? "create" : "update",
          safe_error_code: plan.safe_error_code,
          ...(decision.kind === "drifted"
            ? { destination_etag: decision.observedRevision }
            : {}),
          updated_at: now
        })
        .where("id", "=", target.projectionId)
        .executeTakeFirstOrThrow();
      await recordSyncNotice(transaction, {
        organizationId,
        policyId: target.policyId,
        projectionId: target.projectionId,
        kind: plan.notice,
        detail: noticeDetailForDesiredCopy(decision.kind, desired)
      });
      await this.audit(
        transaction,
        organizationId,
        target,
        "copy.held",
        plan.safe_error_code,
        { operation: decision.kind === "missing" ? "create" : "update" }
      );
      return true;
    });
  }

  private async holdOwnershipMismatch(
    organizationId: string,
    target: VerificationTarget,
    decision: Extract<DestinationVerificationDecision, { kind: "ownership_mismatch" }>,
    now: Date
  ): Promise<boolean> {
    return this.db.transaction().execute(async (transaction) => {
      const policy = await transaction
        .selectFrom("sync_policies")
        .select(["status", "revision"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", target.policyId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !policy
        || policy.status !== "active"
        || policy.revision !== target.policyRevision
      ) {
        return false;
      }
      const current = await transaction
        .selectFrom("projections")
        .select([
          "status",
          "ownership",
          "policy_revision",
          "generation",
          "destination_event_id",
          "destination_etag",
          "desired_hash"
        ])
        .where("organization_id", "=", organizationId)
        .where("id", "=", target.projectionId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !current
        || current.status !== "converged"
        || current.ownership !== "attached"
        || current.policy_revision !== target.policyRevision
        || current.generation !== target.generation
        || current.destination_event_id !== target.destinationEventId
        || current.destination_etag !== target.destinationRevision
        || current.desired_hash !== target.desiredHash
      ) {
        return false;
      }
      const unfinished = await transaction
        .selectFrom("outbox_effects")
        .select("id")
        .where("projection_id", "=", target.projectionId)
        .where("state", "in", ["pending", "leased", "retry"])
        .executeTakeFirst();
      if (unfinished) {
        return false;
      }
      await transaction
        .updateTable("projections")
        .set({
          status: "held",
          ownership: "ambiguous",
          recovery_operation: "update",
          safe_error_code: "ownership_mismatch",
          destination_etag: decision.observedRevision,
          updated_at: now
        })
        .where("id", "=", target.projectionId)
        .executeTakeFirstOrThrow();
      await this.audit(
        transaction,
        organizationId,
        target,
        "copy.held",
        "destination_ownership_mismatch",
        {}
      );
      return true;
    });
  }

  private async audit(
    transaction: Transaction<DatabaseSchema>,
    organizationId: string,
    target: VerificationTarget,
    action: string,
    reasonCode: string,
    detail: Readonly<Record<string, unknown>>,
    afterHash = target.desiredHash
  ): Promise<void> {
    await transaction
      .insertInto("audit_facts")
      .values({
        id: newId(),
        organization_id: organizationId,
        principal_id: null,
        actor_kind: "recovery",
        action,
        target_type: "projection",
        target_id: target.projectionId,
        reason_code: reasonCode,
        before_hash: target.desiredHash,
        after_hash: afterHash,
        detail: {
          verification: "destination",
          generation: target.generation,
          ...detail
        }
      })
      .executeTakeFirstOrThrow();
  }
}

export function classifyDestinationVerification(
  target: Pick<VerificationTarget, "policyId" | "projectionId" | "generation" | "destinationRevision">,
  observed: ProviderEventLookup | null
): DestinationVerificationDecision {
  if (!observed) {
    return { kind: "missing" };
  }
  if (!eventBelongsToProjection(observed, target.policyId, target.projectionId, target.generation)) {
    return { kind: "ownership_mismatch", observedRevision: observed.remoteRevision };
  }
  if (observed.remoteRevision === target.destinationRevision) {
    return { kind: "current", observedRevision: observed.remoteRevision };
  }
  return { kind: "drifted", observedRevision: observed.remoteRevision };
}

export function destinationRepairGeneration(
  desiredState: DesiredCopy,
  currentGeneration: number,
  kind: "missing" | "drifted"
): { readonly generation: number; readonly desiredState: DesiredCopy } {
  if (kind === "drifted") {
    return { generation: currentGeneration, desiredState };
  }
  const generation = currentGeneration + 1;
  return {
    generation,
    desiredState: {
      ...desiredState,
      provenance: {
        ...desiredState.provenance,
        generation
      }
    }
  };
}
