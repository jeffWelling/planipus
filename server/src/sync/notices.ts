import type { DesiredCopy, DestinationEditNoticeKind } from "@planipus/calendar-sync";
import { type Kysely, type Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { newId } from "../foundation.js";
import { PostgresJobQueue } from "../jobs/queue.js";
import { PolicyInputError } from "../policy/service.js";
import type { PolicyRuntime } from "../policy/runtime.js";
import { sourceObservationBasisHash } from "./basis.js";

export const DESTINATION_EDIT_HOLD_CODES = [
  "destination_edit_held",
  "destination_delete_held"
] as const;

const HELD_NOTICE_KINDS: readonly DestinationEditNoticeKind[] = [
  "copy_edit_held",
  "copy_delete_held"
];

export function isDestinationEditHold(projection: {
  readonly status: string;
  readonly ownership: string;
  readonly safe_error_code: string | null;
}): boolean {
  return projection.status === "held"
    && projection.ownership === "attached"
    && projection.safe_error_code !== null
    && (DESTINATION_EDIT_HOLD_CODES as readonly string[]).includes(projection.safe_error_code);
}

/**
 * The notice detail intentionally repeats only fields of the privacy-transformed
 * desired copy the projection already stores. It identifies which managed copy
 * was touched without widening what Planipus persists about the source event.
 */
export function noticeDetailForDesiredCopy(
  observed: "drifted" | "missing",
  desired: DesiredCopy
): Record<string, unknown> {
  return {
    observed,
    copy_summary: desired.summary,
    copy_timing: desired.timing
  };
}

export async function recordSyncNotice(
  transaction: Transaction<DatabaseSchema>,
  values: {
    readonly organizationId: string;
    readonly policyId: string;
    readonly projectionId: string;
    readonly kind: DestinationEditNoticeKind;
    readonly detail: Readonly<Record<string, unknown>>;
  }
): Promise<string> {
  const id = newId();
  await transaction
    .insertInto("sync_notices")
    .values({
      id,
      organization_id: values.organizationId,
      policy_id: values.policyId,
      projection_id: values.projectionId,
      kind: values.kind,
      resolution: null,
      detail: values.detail
    })
    .executeTakeFirstOrThrow();
  return id;
}

export interface NoticeDocument {
  readonly id: string;
  readonly kind: DestinationEditNoticeKind;
  readonly status: "unread" | "acknowledged" | "resolved";
  readonly resolution: "restore" | "keep_and_detach" | null;
  readonly policy_id: string;
  readonly policy_name: string;
  readonly projection_id: string;
  readonly destination_calendar: string;
  readonly destination_event_id: string | null;
  readonly requires_decision: boolean;
  readonly detail: unknown;
  readonly created_at: string;
  readonly updated_at: string;
}

/** User-visible destination-edit notices and their explicit resolutions. */
export class NoticeService {
  private readonly jobs: PostgresJobQueue;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly runtime: PolicyRuntime
  ) {
    this.jobs = new PostgresJobQueue(db);
  }

  public async list(
    organizationId: string,
    scope: "open" | "all" = "open"
  ): Promise<readonly NoticeDocument[]> {
    let query = this.db
      .selectFrom("sync_notices")
      .innerJoin("sync_policies", "sync_policies.id", "sync_notices.policy_id")
      .innerJoin("projections", "projections.id", "sync_notices.projection_id")
      .innerJoin("calendar_endpoints", "calendar_endpoints.id", "projections.destination_calendar_id")
      .select([
        "sync_notices.id",
        "sync_notices.kind",
        "sync_notices.status",
        "sync_notices.resolution",
        "sync_notices.policy_id",
        "sync_policies.name as policy_name",
        "sync_notices.projection_id",
        "calendar_endpoints.name as destination_calendar",
        "projections.destination_event_id",
        "projections.status as projection_status",
        "projections.ownership as projection_ownership",
        "projections.safe_error_code as projection_safe_error_code",
        "sync_notices.detail",
        "sync_notices.created_at",
        "sync_notices.updated_at"
      ])
      .where("sync_notices.organization_id", "=", organizationId);
    if (scope === "open") {
      query = query.where("sync_notices.status", "!=", "resolved");
    }
    const rows = await query
      .orderBy("sync_notices.created_at", "desc")
      .orderBy("sync_notices.id", "desc")
      .limit(100)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      resolution: row.resolution,
      policy_id: row.policy_id,
      policy_name: row.policy_name,
      projection_id: row.projection_id,
      destination_calendar: row.destination_calendar,
      destination_event_id: row.destination_event_id,
      requires_decision: HELD_NOTICE_KINDS.includes(row.kind)
        && row.status !== "resolved"
        && isDestinationEditHold({
          status: row.projection_status,
          ownership: row.projection_ownership,
          safe_error_code: row.projection_safe_error_code
        }),
      detail: row.detail,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString()
    }));
  }

  /** Mark a notice as seen. Acknowledging an already-acknowledged or resolved
   * notice is an idempotent no-op so a stale UI cannot fail. */
  public async acknowledge(organizationId: string, noticeId: string): Promise<void> {
    const found = await this.db
      .selectFrom("sync_notices")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("id", "=", noticeId)
      .executeTakeFirst();
    if (!found) {
      throw new PolicyInputError("not_found", "sync notice was not found");
    }
    await this.db
      .updateTable("sync_notices")
      .set({ status: "acknowledged", updated_at: new Date() })
      .where("organization_id", "=", organizationId)
      .where("id", "=", noticeId)
      .where("status", "=", "unread")
      .execute();
  }

  /**
   * Resolve a held destination-edit notice with an explicit decision.
   *
   * `restore` re-applies the last shadow-evaluated source-authoritative state
   * through a marker-verified ambiguous intent: the executor re-reads the
   * destination event, requires every private ownership marker to match, and
   * safely rotates the generation if the copy was deleted meanwhile.
   *
   * `keep_and_detach` keeps the person's direct change and detaches the copy so
   * the policy stops managing it, matching the contract's durable-intent
   * controls.
   */
  public async resolve(
    organizationId: string,
    principalId: string,
    noticeId: string,
    action: "restore" | "keep_and_detach"
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const notice = await transaction
        .selectFrom("sync_notices")
        .select(["id", "kind", "status", "policy_id", "projection_id"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", noticeId)
        .forUpdate()
        .executeTakeFirst();
      if (!notice) {
        throw new PolicyInputError("not_found", "sync notice was not found");
      }
      if (!HELD_NOTICE_KINDS.includes(notice.kind) || notice.status === "resolved") {
        throw new PolicyInputError("notice_not_resolvable", "this notice does not carry an open decision");
      }
      const policy = await transaction
        .selectFrom("sync_policies")
        .select(["id", "revision", "policy_hash", "status"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", notice.policy_id)
        .where("status", "!=", "deleted")
        .forUpdate()
        .executeTakeFirst();
      if (!policy) {
        throw new PolicyInputError("not_found", "sync policy was not found");
      }
      const projection = await transaction
        .selectFrom("projections")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("id", "=", notice.projection_id)
        .forUpdate()
        .executeTakeFirst();
      if (!projection || !isDestinationEditHold(projection)) {
        throw new PolicyInputError("hold_stale", "the held copy has already been resolved or superseded");
      }
      const now = new Date();

      if (action === "keep_and_detach") {
        await transaction
          .updateTable("projections")
          .set({
            ownership: "detached",
            status: "converged",
            recovery_operation: null,
            safe_error_code: null,
            updated_at: now
          })
          .where("id", "=", projection.id)
          .executeTakeFirstOrThrow();
        await this.finishNotice(transaction, organizationId, noticeId, "keep_and_detach", now);
        await this.audit(
          transaction,
          organizationId,
          principalId,
          policy.policy_hash,
          projection.id,
          "copy.detached",
          "destination_edit_kept"
        );
        return;
      }

      if (
        projection.policy_revision !== policy.revision
        || !projection.recovery_operation
      ) {
        throw new PolicyInputError("hold_stale", "the held copy changed while the decision was pending");
      }
      const currentSource = await transaction
        .selectFrom("source_observations")
        .select(["observation_hash", "tombstone"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", projection.source_observation_id)
        .forUpdate()
        .executeTakeFirst();
      const currentSourceBasisHash = currentSource
        ? sourceObservationBasisHash(this.runtime, currentSource.observation_hash, currentSource.tombstone)
        : null;
      if (
        !currentSourceBasisHash
        || !projection.source_basis_hash
        || currentSourceBasisHash !== projection.source_basis_hash
      ) {
        await this.jobs.enqueue(
          organizationId,
          "reconcile_policy",
          `policy:${policy.id}:revision:${policy.revision}:notice-basis:${noticeId}`,
          { policy_id: policy.id },
          now,
          transaction
        );
        throw new PolicyInputError("hold_stale", "the source event changed; a fresh reconciliation was scheduled");
      }
      const operation = projection.recovery_operation;
      const desired = projection.desired_state as unknown as DesiredCopy | null;
      if (operation === "delete") {
        if (projection.desired_hash !== null || desired !== null) {
          throw new PolicyInputError("hold_stale", "the held copy's recovery evidence is inconsistent");
        }
      } else if (
        !desired
        || !projection.desired_hash
        || desired.provenance?.policy_ref !== policy.id
        || desired.provenance.projection_ref !== projection.id
        || desired.provenance.generation !== projection.generation
        || this.runtime.hash(desired) !== projection.desired_hash
      ) {
        throw new PolicyInputError("hold_stale", "the held copy's recovery evidence is inconsistent");
      }
      const intentSequence = Number(projection.intent_sequence) + 1;
      const idempotencyKey = this.runtime.hash({
        version: 1,
        kind: "destination_edit_hold_restore",
        policy_ref: policy.id,
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
          policy_id: policy.id,
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
      await this.finishNotice(transaction, organizationId, noticeId, "restore", now);
      await this.audit(
        transaction,
        organizationId,
        principalId,
        policy.policy_hash,
        projection.id,
        "copy.restore_requested",
        "destination_edit_restored"
      );
    });
  }

  private async finishNotice(
    transaction: Transaction<DatabaseSchema>,
    organizationId: string,
    noticeId: string,
    resolution: "restore" | "keep_and_detach",
    now: Date
  ): Promise<void> {
    await transaction
      .updateTable("sync_notices")
      .set({ status: "resolved", resolution, updated_at: now })
      .where("organization_id", "=", organizationId)
      .where("id", "=", noticeId)
      .executeTakeFirstOrThrow();
  }

  private async audit(
    transaction: Transaction<DatabaseSchema>,
    organizationId: string,
    principalId: string,
    policyHash: string,
    projectionId: string,
    action: string,
    reasonCode: string
  ): Promise<void> {
    await transaction
      .insertInto("audit_facts")
      .values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: "user",
        action,
        target_type: "projection",
        target_id: projectionId,
        reason_code: reasonCode,
        before_hash: policyHash,
        after_hash: policyHash,
        detail: {}
      })
      .executeTakeFirstOrThrow();
  }
}
