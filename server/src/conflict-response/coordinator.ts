import { sql, type Kysely, type Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { newId, safeErrorCode } from "../foundation.js";
import { PostgresJobQueue, type LeasedJob } from "../jobs/queue.js";
import type { PolicyRuntime } from "../policy/runtime.js";
import type { AccessTokenBroker } from "../providers/router.js";
import { ProviderRouter } from "../providers/router.js";
import { ProviderError } from "../providers/types.js";
import {
  conflictActionBasisDocument,
  overlappingBusyIntervals,
  workInvitationCandidate
} from "./engine.js";
import {
  countRecentAppliedDeclines,
  loadConflictCalendarSelection,
  prepareConflictResponseInput,
  queryOpaqueAvailability,
  requireNoCopyPolicies
} from "./inputs.js";
import {
  MAX_AUTOMATIC_DECLINES_PER_24_HOURS,
  type ConflictResponseDraft,
  type WorkObservationRow
} from "./types.js";
import { ConflictResponseInputError, parseConflictResponseDraft } from "./validation.js";
import type { PrivateAvailabilityHasher } from "./privacy-hash.js";

type Executor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export class ConflictResponseCoordinator {
  private readonly jobs: PostgresJobQueue;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly runtime: Pick<PolicyRuntime, "hash">,
    private readonly privateHasher: PrivateAvailabilityHasher,
    private readonly providers: ProviderRouter,
    private readonly tokens: AccessTokenBroker,
    private readonly providerWritesEnabled = true
  ) {
    this.jobs = new PostgresJobQueue(db);
  }

  public handles(kind: string): boolean {
    return kind === "reconcile_conflict_response_rule"
      || kind === "apply_invitation_response";
  }

  public async dispatch(job: LeasedJob): Promise<void> {
    switch (job.kind) {
      case "reconcile_conflict_response_rule":
        await this.reconcile(job.organizationId, requiredString(job.payload, "rule_id"));
        return;
      case "apply_invitation_response":
        await this.apply(
          job.organizationId,
          requiredString(job.payload, "action_id"),
          requiredString(job.payload, "conflict_basis_hash")
        );
        return;
      default:
        throw new ConflictResponseJobError(
          "unknown_conflict_response_job",
          `unknown conflict-response job kind: ${job.kind}`
        );
    }
  }

  public async reconcile(
    organizationId: string,
    ruleId: string,
    now = new Date()
  ): Promise<void> {
    const rule = await this.db.selectFrom("conflict_response_rules")
      .select([
        "id",
        "revision",
        "status",
        "rule_document",
        "response_provider_identity"
      ])
      .where("organization_id", "=", organizationId)
      .where("id", "=", ruleId)
      .executeTakeFirst();
    if (!rule || rule.status !== "active") return;
    let draft: ConflictResponseDraft;
    try {
      draft = parseConflictResponseDraft(rule.rule_document);
    } catch (error) {
      await this.recordRuleFailure(organizationId, ruleId, error, now);
      return;
    }
    let prepared;
    try {
      prepared = await prepareConflictResponseInput(
        this.db,
        this.runtime,
        this.privateHasher,
        { providers: this.providers, tokens: this.tokens },
        organizationId,
        draft,
        now
      );
    } catch (error) {
      await this.recordRuleFailure(organizationId, ruleId, error, now);
      if (isRetryable(error)) throw error;
      return;
    }

    await this.db.transaction().execute(async (transaction) => {
      const currentRule = await transaction.selectFrom("conflict_response_rules")
        .select(["revision", "status", "rule_hash"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", ruleId)
        .forUpdate()
        .executeTakeFirst();
      if (
        !currentRule
        || currentRule.status !== "active"
        || currentRule.revision !== rule.revision
      ) return;
      const existing = await transaction.selectFrom("invitation_response_actions")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("rule_id", "=", ruleId)
        .forUpdate()
        .execute();
      const existingByObservation = new Map(existing.map((action) => [action.work_observation_id, action]));
      const commentRetentionWarningPresent = existing.some((action) =>
        action.status === "applied"
        && action.safe_error_code === "decline_comment_not_retained"
      );
      const currentActionIds: string[] = [];
      let pendingCount = 0;
      let heldCount = 0;
      let budgetHeldCount = 0;
      let automaticResponsesReserved = await countRecentAppliedDeclines(
        transaction,
        organizationId,
        rule.response_provider_identity,
        now
      );
      for (const conflict of prepared.conflicts) {
        const invitation = conflict.invitation;
        const basisHash = this.privateHasher.hash(conflictActionBasisDocument({
          rule_id: ruleId,
          rule_revision: rule.revision,
          invitation,
          overlapping_busy: conflict.overlapping_busy
        }));
        const prior = existingByObservation.get(invitation.observation_id);
        if (
          prior?.status === "applied"
          && prior.rule_revision === rule.revision
          && prior.work_observation_hash === invitation.observation_hash
          && prior.conflict_basis_hash === basisHash
          && prior.desired_comment === draft.decline_message
        ) {
          currentActionIds.push(prior.id);
          continue;
        }
        const budgetAvailable = automaticResponsesReserved
          < MAX_AUTOMATIC_DECLINES_PER_24_HOURS;
        const status = invitation.remote_revision && budgetAvailable ? "pending" : "held";
        const heldReason = !invitation.remote_revision
          ? "work_revision_missing"
          : "automatic_decline_budget_exceeded";
        const actionId = prior?.id ?? newId();
        currentActionIds.push(actionId);
        if (status === "pending") {
          pendingCount += 1;
          automaticResponsesReserved += 1;
        } else {
          heldCount += 1;
          if (heldReason === "automatic_decline_budget_exceeded") budgetHeldCount += 1;
        }
        if (prior) {
          await transaction.updateTable("invitation_response_actions").set({
            rule_revision: rule.revision,
            response_calendar_id: draft.response_calendar_id,
            remote_event_id: invitation.remote_event_id,
            recurrence_identity: invitation.recurrence_identity,
            work_observation_hash: invitation.observation_hash,
            conflict_basis_hash: basisHash,
            expected_remote_revision: invitation.remote_revision,
            desired_comment: draft.decline_message,
            status,
            remote_revision: null,
            last_attempt_at: null,
            last_success_at: null,
            safe_error_code: status === "held" ? heldReason : null,
            updated_at: now
          }).where("id", "=", prior.id).executeTakeFirstOrThrow();
        } else {
          await transaction.insertInto("invitation_response_actions").values({
            id: actionId,
            organization_id: organizationId,
            rule_id: ruleId,
            rule_revision: rule.revision,
            response_calendar_id: draft.response_calendar_id,
            work_observation_id: invitation.observation_id,
            remote_event_id: invitation.remote_event_id,
            recurrence_identity: invitation.recurrence_identity,
            work_observation_hash: invitation.observation_hash,
            conflict_basis_hash: basisHash,
            expected_remote_revision: invitation.remote_revision,
            desired_comment: draft.decline_message,
            status,
            remote_revision: null,
            last_attempt_at: null,
            last_success_at: null,
            safe_error_code: status === "held" ? heldReason : null
          }).executeTakeFirstOrThrow();
        }
        if (status === "pending") {
          await this.jobs.enqueue(
            organizationId,
            "apply_invitation_response",
            `invitation-response:${actionId}:basis:${basisHash}`,
            { action_id: actionId, conflict_basis_hash: basisHash },
            now,
            transaction
          );
        }
      }
      let stale = transaction.updateTable("invitation_response_actions").set({
        status: "superseded",
        safe_error_code: "conflict_no_longer_present",
        updated_at: now
      }).where("organization_id", "=", organizationId)
        .where("rule_id", "=", ruleId)
        .where("status", "in", ["pending", "held"]);
      if (currentActionIds.length > 0) stale = stale.where("id", "not in", currentActionIds);
      await stale.execute();
      await transaction.updateTable("conflict_response_rules").set({
        last_evaluated_at: now,
        safe_error_code: budgetHeldCount > 0
          ? "automatic_decline_budget_exceeded"
          : heldCount > 0
            ? "work_revision_missing"
            : commentRetentionWarningPresent
              ? "decline_comment_not_retained"
              : null,
        updated_at: now
      }).where("organization_id", "=", organizationId).where("id", "=", ruleId).executeTakeFirstOrThrow();
      if (pendingCount > 0 || heldCount > 0) {
        await transaction.insertInto("audit_facts").values({
          id: newId(),
          organization_id: organizationId,
          principal_id: null,
          actor_kind: "sync",
          action: "conflict_response_rule.reconciled",
          target_type: "conflict_response_rule",
          target_id: ruleId,
          reason_code: "private_availability_evaluated",
          before_hash: currentRule.rule_hash,
          after_hash: currentRule.rule_hash,
          detail: {
            pending_count: pendingCount,
            held_count: heldCount,
            budget_held_count: budgetHeldCount,
            automatic_decline_budget_per_24_hours: MAX_AUTOMATIC_DECLINES_PER_24_HOURS,
            no_copy: true
          }
        }).executeTakeFirstOrThrow();
      }
    });
  }

  public async apply(
    organizationId: string,
    actionId: string,
    expectedConflictBasisHash: string,
    now = new Date()
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const action = await transaction.selectFrom("invitation_response_actions")
        .innerJoin("conflict_response_rules", "conflict_response_rules.id", "invitation_response_actions.rule_id")
        .select([
          "invitation_response_actions.id",
          "invitation_response_actions.rule_id",
          "invitation_response_actions.rule_revision",
          "invitation_response_actions.response_calendar_id",
          "invitation_response_actions.work_observation_id",
          "invitation_response_actions.remote_event_id",
          "invitation_response_actions.recurrence_identity",
          "invitation_response_actions.work_observation_hash",
          "invitation_response_actions.conflict_basis_hash",
          "invitation_response_actions.expected_remote_revision",
          "invitation_response_actions.desired_comment",
          "invitation_response_actions.status",
          "conflict_response_rules.owner_principal_id",
          "conflict_response_rules.status as rule_status",
          "conflict_response_rules.revision as current_rule_revision",
          "conflict_response_rules.rule_document",
          "conflict_response_rules.rule_hash"
        ])
        .where("invitation_response_actions.organization_id", "=", organizationId)
        .where("invitation_response_actions.id", "=", actionId)
        .forUpdate(["invitation_response_actions", "conflict_response_rules"])
        .executeTakeFirst();
      if (
        !action
        || action.status !== "pending"
        || action.rule_status !== "active"
        || action.rule_revision !== action.current_rule_revision
        || action.conflict_basis_hash !== expectedConflictBasisHash
      ) return;
      if (!this.providerWritesEnabled) {
        await holdAction(transaction, organizationId, action.id, "invitation_writes_disabled", now);
        return;
      }
      let draft: ConflictResponseDraft;
      try {
        draft = parseConflictResponseDraft(action.rule_document);
      } catch (error) {
        if (!(error instanceof ConflictResponseInputError)) throw error;
        await holdAction(transaction, organizationId, action.id, error.code, now);
        await markRuleError(transaction, organizationId, action.rule_id, error.code, now);
        return;
      }
      if (draft.response_calendar_id !== action.response_calendar_id) {
        await holdAction(transaction, organizationId, action.id, "response_calendar_changed", now);
        return;
      }
      const observation = await transaction.selectFrom("source_observations")
        .select([
          "id",
          "remote_event_id",
          "recurrence_identity",
          "remote_etag",
          "observation_hash",
          "normalized_event",
          "managed_copy",
          "tombstone"
        ])
        .where("organization_id", "=", organizationId)
        .where("id", "=", action.work_observation_id)
        .forUpdate()
        .executeTakeFirst();
      const horizonEnd = new Date(now.getTime() + draft.horizon_days * 86_400_000);
      const invitation = observation
        ? workInvitationCandidate(observation as WorkObservationRow, now, horizonEnd)
        : null;
      if (
        !observation
        || observation.managed_copy
        || observation.tombstone
        || !invitation
        || invitation.observation_hash !== action.work_observation_hash
        || invitation.remote_event_id !== action.remote_event_id
        || invitation.recurrence_identity !== action.recurrence_identity
      ) {
        await supersedeAction(transaction, organizationId, action.id, "work_invitation_no_longer_eligible", now);
        return;
      }
      if (
        !invitation.remote_revision
        || invitation.remote_revision !== action.expected_remote_revision
      ) {
        await holdAction(transaction, organizationId, action.id, "work_invitation_changed", now);
        return;
      }
      let selection;
      try {
        selection = await loadConflictCalendarSelection(transaction, organizationId, draft);
        await requireNoCopyPolicies(transaction, organizationId, selection.availability);
      } catch (error) {
        if (!(error instanceof ConflictResponseInputError)) throw error;
        await holdAction(transaction, organizationId, action.id, safeErrorCode(error), now);
        await markRuleError(transaction, organizationId, action.rule_id, safeErrorCode(error), now);
        return;
      }
      let busy;
      try {
        busy = await queryOpaqueAvailability(
          { providers: this.providers, tokens: this.tokens },
          organizationId,
          selection.availability,
          invitation.start_at,
          invitation.end_at
        );
      } catch (error) {
        if (isRetryable(error)) throw error;
        const code = safeErrorCode(error);
        await holdAction(transaction, organizationId, action.id, code, now);
        await markRuleError(transaction, organizationId, action.rule_id, code, now);
        return;
      }
      if (overlappingBusyIntervals(invitation, busy).length === 0) {
        await supersedeAction(transaction, organizationId, action.id, "conflict_no_longer_present", now);
        return;
      }
      let result;
      try {
        const provider = this.providers.resolve(selection.response.provider);
        const accessToken = await this.tokens.accessToken(organizationId, selection.response.connection_id);
        result = await provider.declineInvitation(
          accessToken,
          selection.response.remote_id,
          action.remote_event_id,
          {
            expectedRevision: invitation.remote_revision,
            comment: action.desired_comment
          }
        );
      } catch (error) {
        if (error instanceof ProviderError && !error.retryable && !error.ambiguous) {
          await holdAction(transaction, organizationId, action.id, error.code, now);
          await markRuleError(transaction, organizationId, action.rule_id, error.code, now);
          return;
        }
        throw error;
      }
      const applyWarning = result.commentRetained ? null : "decline_comment_not_retained";
      await transaction.updateTable("invitation_response_actions").set({
        status: "applied",
        remote_revision: result.remoteRevision,
        last_attempt_at: now,
        last_success_at: now,
        safe_error_code: applyWarning,
        updated_at: now
      }).where("organization_id", "=", organizationId)
        .where("id", "=", action.id)
        .where("status", "=", "pending")
        .where("conflict_basis_hash", "=", expectedConflictBasisHash)
        .executeTakeFirstOrThrow();
      await transaction.updateTable("conflict_response_rules").set({
        last_success_at: now,
        safe_error_code: applyWarning,
        updated_at: now
      }).where("organization_id", "=", organizationId)
        .where("id", "=", action.rule_id)
        .executeTakeFirstOrThrow();
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: action.owner_principal_id,
        actor_kind: "sync",
        action: "invitation_response.declined",
        target_type: "invitation_response_action",
        target_id: action.id,
        reason_code: "private_availability_conflict",
        before_hash: action.work_observation_hash,
        after_hash: result.remoteRevision ? this.runtime.hash(result.remoteRevision) : null,
        detail: {
          provider_changed: result.changed,
          no_copy: true,
          comment_configured: action.desired_comment.length > 0,
          comment_retained: result.commentRetained
        },
        // PostgreSQL now() is the transaction start. This fact is the rolling
        // provider-write budget, so timestamp the verified completion instead.
        created_at: sql<Date>`clock_timestamp()`
      }).executeTakeFirstOrThrow();
    });
  }

  private async recordRuleFailure(
    organizationId: string,
    ruleId: string,
    error: unknown,
    now: Date
  ): Promise<void> {
    const code = safeErrorCode(error);
    await this.db.transaction().execute(async (transaction) => {
      const rule = await transaction.selectFrom("conflict_response_rules")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where("id", "=", ruleId)
        .where("status", "=", "active")
        .forUpdate()
        .executeTakeFirst();
      if (!rule) return;
      await markRuleError(transaction, organizationId, ruleId, code, now);
      await transaction.updateTable("invitation_response_actions").set({
        status: "held",
        safe_error_code: code,
        updated_at: now
      }).where("organization_id", "=", organizationId)
        .where("rule_id", "=", ruleId)
        .where("status", "=", "pending")
        .execute();
    });
  }
}

async function holdAction(
  executor: Executor,
  organizationId: string,
  actionId: string,
  code: string,
  now: Date
): Promise<void> {
  await executor.updateTable("invitation_response_actions").set({
    status: "held",
    last_attempt_at: now,
    safe_error_code: code,
    updated_at: now
  }).where("organization_id", "=", organizationId).where("id", "=", actionId).executeTakeFirstOrThrow();
}

async function supersedeAction(
  executor: Executor,
  organizationId: string,
  actionId: string,
  code: string,
  now: Date
): Promise<void> {
  await executor.updateTable("invitation_response_actions").set({
    status: "superseded",
    last_attempt_at: now,
    safe_error_code: code,
    updated_at: now
  }).where("organization_id", "=", organizationId).where("id", "=", actionId).executeTakeFirstOrThrow();
}

async function markRuleError(
  executor: Executor,
  organizationId: string,
  ruleId: string,
  code: string,
  now: Date
): Promise<void> {
  await executor.updateTable("conflict_response_rules").set({
    safe_error_code: code,
    updated_at: now
  }).where("organization_id", "=", organizationId).where("id", "=", ruleId).executeTakeFirstOrThrow();
}

function requiredString(payload: unknown, key: string): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ConflictResponseJobError("invalid_job_payload", "job payload must be an object");
  }
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string" || value.length < 1 || value.length > 300) {
    throw new ConflictResponseJobError("invalid_job_payload", `job payload ${key} is invalid`);
  }
  return value;
}

function isRetryable(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "retryable" in error
    && error.retryable === true;
}

class ConflictResponseJobError extends Error {
  public readonly retryable = false;

  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ConflictResponseJobError";
  }
}
