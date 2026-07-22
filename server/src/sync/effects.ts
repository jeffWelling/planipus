import type { DesiredCopy } from "@planipus/calendar-sync";
import { sql, type Kysely, type Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { newId, safeErrorCode } from "../foundation.js";
import { PostgresJobQueue } from "../jobs/queue.js";
import { sharedPolicyRuntime } from "../policy/runtime.js";
import type { AccessTokenBroker } from "../providers/router.js";
import { ProviderRouter } from "../providers/router.js";
import {
  ProviderError,
  type ProviderEventLookup,
  type ProviderWriteResult
} from "../providers/types.js";
import { sourceObservationBasisHash } from "./basis.js";

interface LeasedEffect {
  readonly id: string;
  readonly organizationId: string;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly projectionId: string;
  readonly sourceBasisHash: string | null;
  readonly operation: "create" | "update" | "delete";
  readonly desiredState: unknown;
  readonly attemptCount: number;
  readonly ambiguous: boolean;
}

/** Executes committed outbox intents. Deterministic destination IDs make a
 * create discoverable after a timeout or process crash. */
export class EffectExecutor {
  private readonly jobs: PostgresJobQueue;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly providers: ProviderRouter,
    private readonly tokens: AccessTokenBroker
  ) {
    this.jobs = new PostgresJobQueue(db);
  }

  public async runBatch(owner: string, limit: number, leaseSeconds: number): Promise<number> {
    const effects = await this.lease(owner, limit, leaseSeconds);
    for (const effect of effects) {
      await this.executeOne(owner, effect);
    }
    return effects.length;
  }

  private async lease(owner: string, limit: number, leaseSeconds: number): Promise<readonly LeasedEffect[]> {
    return this.db.transaction().execute(async (transaction) => {
      const now = new Date();
      // An expired lease means a previous worker may have crossed the network
      // boundary and died before recording the outcome.
      await transaction
        .updateTable("outbox_effects")
        .set({
          state: "retry",
          lease_owner: null,
          lease_expires_at: null,
          ambiguous: true,
          run_after: now,
          updated_at: now
        })
        .where("state", "=", "leased")
        .where("lease_expires_at", "<", now)
        .execute();
      const rows = await transaction
        .selectFrom("outbox_effects as effect")
        .selectAll()
        .where("effect.state", "in", ["pending", "retry"])
        .where("effect.run_after", "<=", now)
        .where(sql<boolean>`not exists (
          select 1
          from outbox_effects as prior
          where prior.projection_id = effect.projection_id
            and prior.state <> 'succeeded'
            and (
              prior.created_at < effect.created_at
              or (prior.created_at = effect.created_at and prior.id < effect.id)
            )
        )`)
        .orderBy("effect.run_after", "asc")
        .orderBy("effect.id", "asc")
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();
      if (rows.length === 0) {
        return [];
      }
      const ids = rows.map((row) => row.id);
      await transaction
        .updateTable("outbox_effects")
        .set((expression) => ({
          state: "leased",
          lease_owner: owner,
          lease_expires_at: new Date(now.getTime() + leaseSeconds * 1_000),
          attempt_count: expression("attempt_count", "+", 1),
          updated_at: now
        }))
        .where("id", "in", ids)
        .execute();
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        policyId: row.policy_id,
        policyRevision: row.policy_revision,
        projectionId: row.projection_id,
        sourceBasisHash: row.source_basis_hash,
        operation: row.operation,
        desiredState: row.desired_state,
        attemptCount: row.attempt_count + 1,
        ambiguous: row.ambiguous
      }));
    });
  }

  private async executeOne(owner: string, effect: LeasedEffect): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await this.executeOneLocked(transaction, owner, effect);
    });
  }

  /**
   * Hold the policy row lock across the provider write and its committed
   * outcome. PolicyService.setPaused takes the same lock before changing the
   * status, which gives pause a strict execution boundary: either pause wins
   * and this worker observes it before touching the provider, or this worker
   * wins and pause does not return until the write and outcome have committed.
   *
   * The effect row is locked second, matching the policy -> effect ordering
   * used by resume. Besides preserving the lease while the network call is in
   * flight, this prevents an expired-lease reaper from racing the outcome.
   */
  private async executeOneLocked(
    transaction: Transaction<DatabaseSchema>,
    owner: string,
    effect: LeasedEffect
  ): Promise<void> {
    const policy = await transaction
      .selectFrom("sync_policies")
      .select(["id", "status", "revision"])
      .where("organization_id", "=", effect.organizationId)
      .where("id", "=", effect.policyId)
      .forUpdate()
      .executeTakeFirst();
    const lease = await transaction
      .selectFrom("outbox_effects")
      .select("id")
      .where("organization_id", "=", effect.organizationId)
      .where("id", "=", effect.id)
      .where("state", "=", "leased")
      .where("lease_owner", "=", owner)
      .forUpdate()
      .executeTakeFirst();
    if (!lease) {
      return;
    }
    if (policy) {
      const disposition = effectPolicyExecutionDisposition(
        policy.status,
        policy.revision,
        effect.policyRevision
      );
      if (disposition === "defer_paused") {
        await this.defer(transaction, owner, effect, "policy_paused");
        return;
      }
      if (disposition === "defer_revision") {
        await this.defer(transaction, owner, effect, "policy_revision_changed");
        return;
      }
      if (disposition === "supersede_deleted") {
        await this.supersede(transaction, owner, effect, "policy_deleted");
        return;
      }
    }

    const target = await transaction
      .selectFrom("projections")
      .innerJoin(
        "source_observations",
        "source_observations.id",
        "projections.source_observation_id"
      )
      .innerJoin("calendar_endpoints", "calendar_endpoints.id", "projections.destination_calendar_id")
      .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
      .select([
        "projections.id as projection_id",
        "projections.source_basis_hash as projection_source_basis_hash",
        "projections.generation",
        "projections.intent_sequence",
        "projections.destination_event_id",
        "projections.destination_etag",
        "projections.desired_hash",
        "projections.desired_state",
        "projections.policy_revision",
        "projections.policy_id as current_policy_id",
        "source_observations.observation_hash as current_source_observation_hash",
        "source_observations.tombstone as current_source_tombstone",
        "calendar_endpoints.remote_id as calendar_remote_id",
        "calendar_endpoints.connection_id",
        "calendar_endpoints.writable as calendar_writable",
        "provider_connections.provider",
        "provider_connections.status as connection_status",
        "provider_connections.intended_role"
      ])
      .where("projections.organization_id", "=", effect.organizationId)
      .where("projections.id", "=", effect.projectionId)
      .where("projections.policy_id", "=", effect.policyId)
      .forUpdate(["projections", "source_observations"])
      .executeTakeFirst();
    if (
      !policy
      || !target
      || target.current_policy_id !== effect.policyId
      || target.connection_status !== "active"
      || !target.calendar_writable
      || (target.intended_role !== "destination" && target.intended_role !== "both")
    ) {
      await this.fail(
        transaction,
        owner,
        effect,
        new ProviderError("target_unavailable", "destination target is unavailable", false)
      );
      return;
    }
    const currentSourceBasisHash = sourceObservationBasisHash(
      sharedPolicyRuntime,
      target.current_source_observation_hash,
      target.current_source_tombstone
    );
    if (
      !effect.sourceBasisHash
      || !target.projection_source_basis_hash
      || effect.sourceBasisHash !== target.projection_source_basis_hash
      || effect.sourceBasisHash !== currentSourceBasisHash
    ) {
      await this.supersede(transaction, owner, effect, "recovery_basis_changed");
      await transaction
        .updateTable("projections")
        .set({
          status: "failed",
          safe_error_code: "recovery_basis_changed",
          updated_at: new Date()
        })
        .where("organization_id", "=", effect.organizationId)
        .where("id", "=", effect.projectionId)
        .executeTakeFirstOrThrow();
      await this.jobs.enqueue(
        effect.organizationId,
        "reconcile_policy",
        `policy:${effect.policyId}:revision:${effect.policyRevision}:recovery-basis:${effect.id}`,
        { policy_id: effect.policyId },
        new Date(),
        transaction
      );
      return;
    }

    const eventId = target.destination_event_id ?? managedEventId(target.projection_id, target.generation);
    try {
      const provider = this.providers.resolve(target.provider);
      const accessToken = await this.tokens.accessToken(effect.organizationId, target.connection_id);
      if (effect.operation === "create") {
        const desired = requireDesiredCopy(effect.desiredState);
        const found = await provider.getEvent(accessToken, target.calendar_remote_id, eventId);
        if (found) {
          if (!eventBelongsToProjection(found, effect.policyId, target.projection_id, target.generation)) {
            await this.holdAmbiguous(
              transaction,
              owner,
              effect,
              new ProviderError("ownership_mismatch", "destination ownership markers do not match", false)
            );
            return;
          }
          // A preceding create intent or a lost response may already have made
          // the deterministic event. Reapply this intent's desired content so
          // a newer queued create cannot be falsely marked converged.
          const restored = await provider.updateEvent(
            accessToken,
            target.calendar_remote_id,
            found.remoteEventId,
            found.remoteRevision,
            desired
          );
          await this.succeed(transaction, owner, effect, restored.remoteEventId, restored.remoteRevision);
          return;
        }
        if (effect.ambiguous) {
          // The previous create may have reached Google and then been deleted.
          // Google custom IDs are not safely reusable after deletion, so an
          // ambiguous absence advances to a fresh generation before retrying.
          await this.scheduleReplacementAfterMissing(transaction, owner, effect, target);
          return;
        }
        const created = await provider.createEvent(accessToken, target.calendar_remote_id, eventId, desired);
        await this.succeed(transaction, owner, effect, created.remoteEventId, created.remoteRevision);
        return;
      }
      if (effect.operation === "update") {
        const desired = requireDesiredCopy(effect.desiredState);
        let updateEventId = target.destination_event_id;
        let expectedRevision = target.destination_etag;
        if (effect.ambiguous && updateEventId) {
          const found = await provider.getEvent(accessToken, target.calendar_remote_id, updateEventId);
          if (!found) {
            await this.scheduleReplacementAfterMissing(transaction, owner, effect, target);
            return;
          }
          if (!eventBelongsToProjection(found, effect.policyId, target.projection_id, target.generation)) {
            await this.holdAmbiguous(
              transaction,
              owner,
              effect,
              new ProviderError("ownership_mismatch", "destination ownership markers do not match", false)
            );
            return;
          }
          updateEventId = found.remoteEventId;
          expectedRevision = found.remoteRevision;
        }
        let updated: ProviderWriteResult;
        if (updateEventId) {
          try {
            updated = await provider.updateEvent(
              accessToken,
              target.calendar_remote_id,
              updateEventId,
              expectedRevision,
              desired
            );
          } catch (error) {
            if (!(error instanceof ProviderError) || error.status !== 404) {
              throw error;
            }
            // Destination verification may observe an owned edit and enqueue
            // an update just before the user deletes the copy. Re-read before
            // converting that update into a deterministic create. If another
            // event appeared at the ID, require all ownership markers before
            // writing; a create race remains protected by provider
            // preconditions and is held by the outer handler.
            const found = await provider.getEvent(
              accessToken,
              target.calendar_remote_id,
              updateEventId
            );
            if (found) {
              if (!eventBelongsToProjection(found, effect.policyId, target.projection_id, target.generation)) {
                await this.holdAmbiguous(
                  transaction,
                  owner,
                  effect,
                  new ProviderError("ownership_mismatch", "destination ownership markers do not match", false)
                );
                return;
              }
              updated = await provider.updateEvent(
                accessToken,
                target.calendar_remote_id,
                found.remoteEventId,
                found.remoteRevision,
                desired
              );
            } else {
              await this.scheduleReplacementAfterMissing(transaction, owner, effect, target);
              return;
            }
          }
        } else {
          updated = await provider.createEvent(accessToken, target.calendar_remote_id, eventId, desired);
        }
        await this.succeed(transaction, owner, effect, updated.remoteEventId, updated.remoteRevision);
        return;
      }
      const deleteEventId = target.destination_event_id
        ?? (effect.ambiguous ? eventId : null);
      if (deleteEventId) {
        let expectedDeleteRevision = target.destination_etag;
        if (effect.ambiguous) {
          const found = await provider.getEvent(accessToken, target.calendar_remote_id, deleteEventId);
          if (!found) {
            await this.succeed(transaction, owner, effect, null, null);
            return;
          }
          if (!eventBelongsToProjection(found, effect.policyId, target.projection_id, target.generation)) {
            await this.holdAmbiguous(
              transaction,
              owner,
              effect,
              new ProviderError("ownership_mismatch", "destination ownership markers do not match", false)
            );
            return;
          }
          expectedDeleteRevision = found.remoteRevision;
        }
        await provider.deleteEvent(
          accessToken,
          target.calendar_remote_id,
          deleteEventId,
          expectedDeleteRevision
        );
      }
      await this.succeed(transaction, owner, effect, null, null);
    } catch (error) {
      if (error instanceof ProviderError && error.code === "precondition_failed") {
        await this.holdAmbiguous(transaction, owner, effect, error);
        return;
      }
      if (error instanceof ProviderError && error.code === "provider_auth") {
        await transaction
          .updateTable("provider_connections")
          .set({ status: "action_required", safe_error_code: error.code, updated_at: new Date() })
          .where("organization_id", "=", effect.organizationId)
          .where("id", "=", target.connection_id)
          .execute();
      }
      await this.fail(transaction, owner, effect, error);
    }
  }

  /**
   * A confirmed missing event cannot be recreated with the same Google custom
   * ID. Complete the stale intent without calling the provider again, advance
   * the projection generation and provenance together, and enqueue a fresh
   * deterministic create. The surrounding transaction already holds policy,
   * effect, and projection locks in that order.
   */
  private async scheduleReplacementAfterMissing(
    transaction: Transaction<DatabaseSchema>,
    owner: string,
    effect: LeasedEffect,
    target: {
      readonly generation: number;
      readonly intent_sequence: number;
      readonly desired_hash: string | null;
      readonly desired_state: unknown;
      readonly policy_revision: number;
    }
  ): Promise<void> {
    const newer = await transaction
      .selectFrom("outbox_effects")
      .select("id")
      .where("projection_id", "=", effect.projectionId)
      .where("id", "!=", effect.id)
      .where("state", "in", ["pending", "leased", "retry"])
      .executeTakeFirst();
    if (newer) {
      // The later intent carries the newest source-authoritative desired state;
      // let it observe the absence and perform the generation transition.
      await this.supersede(
        transaction,
        owner,
        effect,
        "destination_missing_newer_intent"
      );
      return;
    }

    const desired = requireDesiredCopy(target.desired_state);
    const effectDesired = requireDesiredCopy(effect.desiredState);
    if (
      target.policy_revision !== effect.policyRevision
      || desired.provenance.policy_ref !== effect.policyId
      || desired.provenance.projection_ref !== effect.projectionId
      || desired.provenance.generation !== target.generation
      || !target.desired_hash
      || sharedPolicyRuntime.hash(desired) !== target.desired_hash
      || sharedPolicyRuntime.hash(effectDesired) !== target.desired_hash
    ) {
      throw new ProviderError(
        "stale_missing_repair",
        "destination replacement state changed while the effect was running",
        false
      );
    }

    const now = new Date();
    const generation = target.generation + 1;
    const intentSequence = Number(target.intent_sequence) + 1;
    const replacementDesired: DesiredCopy = {
      ...desired,
      provenance: { ...desired.provenance, generation }
    };
    const desiredHash = sharedPolicyRuntime.hash(replacementDesired);
    const replacementEffectId = newId();
    const idempotencyKey = sharedPolicyRuntime.hash({
      version: 1,
      kind: "destination_missing_generation_repair",
      policy_ref: effect.policyId,
      policy_revision: effect.policyRevision,
      projection_ref: effect.projectionId,
      generation,
      intent_sequence: intentSequence,
      operation: "create",
      desired_fingerprint: desiredHash
    });

    await this.supersede(
      transaction,
      owner,
      effect,
      "destination_missing_generation_advanced"
    );
    await transaction
      .insertInto("outbox_effects")
      .values({
        id: replacementEffectId,
        organization_id: effect.organizationId,
        policy_id: effect.policyId,
        projection_id: effect.projectionId,
        source_basis_hash: effect.sourceBasisHash,
        policy_revision: effect.policyRevision,
        operation: "create",
        idempotency_key: idempotencyKey,
        desired_state: replacementDesired,
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
        generation,
        recovery_operation: null,
        destination_event_id: null,
        destination_etag: null,
        desired_hash: desiredHash,
        desired_state: replacementDesired,
        status: "pending",
        safe_error_code: "destination_missing",
        updated_at: now
      })
      .where("organization_id", "=", effect.organizationId)
      .where("id", "=", effect.projectionId)
      .executeTakeFirstOrThrow();
    await this.audit(
      transaction,
      effect,
      "copy.repair_scheduled",
      "destination_missing_generation_advanced",
      {
        replacement_effect_id: replacementEffectId,
        previous_generation: target.generation,
        repair_generation: generation
      }
    );
  }

  private async defer(
    transaction: Transaction<DatabaseSchema>,
    owner: string,
    effect: LeasedEffect,
    reasonCode: "policy_paused" | "policy_revision_changed"
  ): Promise<void> {
    const now = new Date();
    await transaction
      .updateTable("outbox_effects")
      .set((expression) => ({
        state: "retry",
        attempt_count: expression("attempt_count", "-", 1),
        lease_owner: null,
        lease_expires_at: null,
        run_after: new Date(now.getTime() + 24 * 60 * 60_000),
        ambiguous: false,
        safe_error_code: reasonCode,
        updated_at: now
      }))
      .where("id", "=", effect.id)
      .where("state", "=", "leased")
      .where("lease_owner", "=", owner)
      .executeTakeFirstOrThrow();
    await this.audit(transaction, effect, "copy.deferred", reasonCode);
  }

  private async supersede(
    transaction: Transaction<DatabaseSchema>,
    owner: string,
    effect: LeasedEffect,
    reasonCode:
      | "policy_deleted"
      | "destination_missing_newer_intent"
      | "destination_missing_generation_advanced"
      | "recovery_basis_changed"
  ): Promise<void> {
    await transaction
      .updateTable("outbox_effects")
      .set({
        state: "succeeded",
        lease_owner: null,
        lease_expires_at: null,
        ambiguous: false,
        safe_error_code: reasonCode,
        updated_at: new Date()
      })
      .where("id", "=", effect.id)
      .where("state", "=", "leased")
      .where("lease_owner", "=", owner)
      .executeTakeFirstOrThrow();
    await this.audit(transaction, effect, "copy.effect_superseded", reasonCode);
  }

  private async succeed(
    transaction: Transaction<DatabaseSchema>,
    owner: string,
    effect: LeasedEffect,
    remoteEventId: string | null,
    remoteRevision: string | null
  ): Promise<void> {
    const now = new Date();
    await transaction
      .updateTable("outbox_effects")
      .set({
        state: "succeeded",
        lease_owner: null,
        lease_expires_at: null,
        ambiguous: false,
        safe_error_code: null,
        updated_at: now
      })
      .where("id", "=", effect.id)
      .where("state", "=", "leased")
      .where("lease_owner", "=", owner)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("projections")
      .set((expression) => effect.operation === "delete"
        ? {
            recovery_operation: null,
            destination_event_id: null,
            destination_etag: null,
            generation: expression("generation", "+", 1),
            status: "deleted",
            last_success_at: now,
            last_verified_at: null,
            safe_error_code: null,
            updated_at: now
          }
        : {
            recovery_operation: null,
            destination_event_id: remoteEventId,
            destination_etag: remoteRevision,
            status: "converged",
            ownership: "attached",
            last_success_at: now,
            last_verified_at: now,
            safe_error_code: null,
            updated_at: now
          })
      .where("id", "=", effect.projectionId)
      .executeTakeFirstOrThrow();
    await this.audit(
      transaction,
      effect,
      effect.operation === "delete" ? "copy.deleted" : "copy.converged",
      "provider_write_succeeded"
    );
  }

  private async holdAmbiguous(
    transaction: Transaction<DatabaseSchema>,
    owner: string,
    effect: LeasedEffect,
    error: ProviderError
  ): Promise<void> {
    const now = new Date();
    await transaction
      .updateTable("outbox_effects")
      .set({
        state: "dead",
        lease_owner: null,
        lease_expires_at: null,
        ambiguous: true,
        safe_error_code: error.code,
        updated_at: now
      })
      .where("id", "=", effect.id)
      .where("state", "=", "leased")
      .where("lease_owner", "=", owner)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("projections")
      .set({ ownership: "ambiguous", status: "held", safe_error_code: error.code, updated_at: now })
      .where("id", "=", effect.projectionId)
      .executeTakeFirstOrThrow();
    await this.audit(
      transaction,
      effect,
      "copy.held",
      error.code === "ownership_mismatch"
        ? "destination_ownership_mismatch"
        : "provider_precondition_failed"
    );
  }

  private async fail(
    transaction: Transaction<DatabaseSchema>,
    owner: string,
    effect: LeasedEffect,
    error: unknown
  ): Promise<void> {
    const retryable = error instanceof ProviderError ? error.retryable : true;
    const dead = !retryable || effect.attemptCount >= 10;
    const now = new Date();
    const delaySeconds = Math.min(3_600, 2 ** Math.min(effect.attemptCount, 10));
    await transaction
      .updateTable("outbox_effects")
      .set({
        state: dead ? "dead" : "retry",
        lease_owner: null,
        lease_expires_at: null,
        run_after: new Date(now.getTime() + delaySeconds * 1_000),
        ambiguous: effect.ambiguous || (error instanceof ProviderError && error.ambiguous),
        safe_error_code: safeErrorCode(error),
        updated_at: now
      })
      .where("id", "=", effect.id)
      .where("state", "=", "leased")
      .where("lease_owner", "=", owner)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("projections")
      .set({ status: dead ? "failed" : "retrying", safe_error_code: safeErrorCode(error), updated_at: now })
      .where("id", "=", effect.projectionId)
      .execute();
  }

  private async audit(
    transaction: Transaction<DatabaseSchema>,
    effect: LeasedEffect,
    action: string,
    reasonCode: string,
    extraDetail: Readonly<Record<string, unknown>> = {}
  ): Promise<void> {
    await transaction
      .insertInto("audit_facts")
      .values({
        id: newId(),
        organization_id: effect.organizationId,
        principal_id: null,
        actor_kind: "sync",
        action,
        target_type: "projection",
        target_id: effect.projectionId,
        reason_code: reasonCode,
        before_hash: null,
        after_hash: null,
        detail: { effect_id: effect.id, operation: effect.operation, ...extraDetail }
      })
      .executeTakeFirstOrThrow();
  }
}

export function managedEventId(projectionId: string, generation: number): string {
  return `p${projectionId.replaceAll("-", "").toLowerCase()}${generation}`;
}

export function eventBelongsToProjection(
  event: ProviderEventLookup,
  policyId: string,
  projectionId: string,
  generation: number
): boolean {
  return event.managedIdentity?.policyRef === policyId
    && event.managedIdentity.projectionRef === projectionId
    && event.managedIdentity.generation === generation;
}

export type EffectPolicyExecutionDisposition =
  | "execute"
  | "defer_paused"
  | "defer_revision"
  | "supersede_deleted";

export function effectPolicyExecutionDisposition(
  status: "active" | "paused" | "deleted",
  currentRevision: number,
  effectRevision: number
): EffectPolicyExecutionDisposition {
  if (status === "deleted") return "supersede_deleted";
  if (status === "paused") return "defer_paused";
  return currentRevision === effectRevision ? "execute" : "defer_revision";
}

function requireDesiredCopy(value: unknown): DesiredCopy {
  if (!value || typeof value !== "object" || !("timing" in value) || !("provenance" in value)) {
    throw new ProviderError("invalid_desired_state", "outbox effect has no valid desired copy", false);
  }
  return value as DesiredCopy;
}
