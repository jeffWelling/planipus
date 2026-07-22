import { createHash } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { newId, safeErrorCode } from "../foundation.js";
import { PostgresJobQueue, type LeasedJob } from "../jobs/queue.js";
import type { PolicyRuntime } from "../policy/runtime.js";
import type { AccessTokenBroker } from "../providers/router.js";
import { ProviderRouter } from "../providers/router.js";
import { ProviderError } from "../providers/types.js";
import { planScheduling } from "./engine.js";
import { PlanningService } from "./service.js";
import type {
  ManagedPlanningEvent,
  PlannedOccurrenceTemplate,
  PlanningDraft
} from "./types.js";
import { parsePlanningDraft } from "./validation.js";

export class PlanningCoordinator {
  private readonly jobs: PostgresJobQueue;
  private readonly service: PlanningService;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly runtime: Pick<PolicyRuntime, "hash">,
    private readonly providers: ProviderRouter,
    private readonly tokens: AccessTokenBroker,
    private readonly providerWritesEnabled = true
  ) {
    this.jobs = new PostgresJobQueue(db);
    this.service = new PlanningService(db, runtime);
  }

  public handles(kind: string): boolean {
    return kind === "reconcile_planning_rule" || kind === "apply_planned_event";
  }

  public async dispatch(job: LeasedJob): Promise<void> {
    if (job.kind === "reconcile_planning_rule") {
      const ruleId = field(job.payload, "rule_id");
      await this.reconcile(job.organizationId, ruleId, new Date());
      return;
    }
    if (job.kind === "apply_planned_event") {
      const plannedEventId = field(job.payload, "planned_event_id");
      const intent = integerField(job.payload, "intent_sequence");
      await this.apply(job.organizationId, plannedEventId, intent);
      return;
    }
    throw new Error(`unsupported planning job: ${job.kind}`);
  }

  public async reconcile(organizationId: string, ruleId: string, now: Date): Promise<void> {
    const rule = await this.db.selectFrom("planning_rules")
      .select(["id", "status", "revision", "kind", "rule_document"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", ruleId)
      .executeTakeFirst();
    if (!rule || rule.status !== "active") return;
    const draft = parsePlanningDraft(rule.rule_document);
    const prepared = await this.service.prepareForReconcile(organizationId, draft, now, ruleId);
    const result = planScheduling(prepared.input);
    const effectiveDraft = prepared.input.draft;
    await this.db.transaction().execute(async (transaction) => {
      const locked = await transaction.selectFrom("planning_rules")
        .select(["status", "revision"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", ruleId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked || locked.status !== "active" || locked.revision !== rule.revision) return;
      const existing = await transaction.selectFrom("planned_events")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("rule_id", "=", ruleId)
        .forUpdate()
        .execute();
      const byKey = new Map(existing.map((event) => [event.occurrence_key, event]));
      for (const occurrence of result.occurrences) {
        const current = byKey.get(occurrence.occurrence_key);
        byKey.delete(occurrence.occurrence_key);
        if (!current) {
          await this.insertOccurrence(transaction, organizationId, ruleId, rule.revision, effectiveDraft, occurrence, now);
          continue;
        }
        await this.updateOccurrence(transaction, organizationId, ruleId, rule.revision, effectiveDraft, current, occurrence, now);
      }
      for (const stale of byKey.values()) {
        if (stale.status === "pending_delete") {
          if (stale.safe_error_code !== "ownership_mismatch") {
            await this.enqueueApply(
              transaction,
              organizationId,
              stale.id,
              Number(stale.intent_sequence),
              now
            );
          }
        } else if (eventHasEnded(stale.desired_state, now)) {
          await transaction.updateTable("planned_events").set({
            desired_hash: null,
            desired_state: null,
            status: "deleted",
            reason_code: "historical_event_preserved",
            safe_error_code: null,
            updated_at: now
          }).where("id", "=", stale.id).executeTakeFirstOrThrow();
        } else if (stale.destination_event_id && stale.status !== "deleted") {
          const intent = Number(stale.intent_sequence) + 1;
          await transaction.updateTable("planned_events").set({
            rule_revision: rule.revision,
            intent_sequence: intent,
            desired_hash: null,
            desired_state: null,
            status: "pending_delete",
            reason_code: "outside_rolling_horizon",
            safe_error_code: null,
            updated_at: now
          }).where("id", "=", stale.id).executeTakeFirstOrThrow();
          await this.enqueueApply(transaction, organizationId, stale.id, intent, now);
        } else if (!stale.destination_event_id) {
          await transaction.updateTable("planned_events").set({
            desired_hash: null,
            desired_state: null,
            status: "deleted",
            reason_code: "outside_rolling_horizon",
            updated_at: now
          }).where("id", "=", stale.id).executeTakeFirstOrThrow();
        }
      }
      await transaction.updateTable("planning_rules").set({
        last_planned_at: now,
        safe_error_code: result.unmet_count > 0 ? "planning_window_unmet" : null,
        updated_at: now
      }).where("id", "=", ruleId).executeTakeFirstOrThrow();
    });
  }

  public async apply(organizationId: string, plannedEventId: string, expectedIntent: number): Promise<void> {
    if (!this.providerWritesEnabled) {
      throw new ProviderError(
        "planning_writes_disabled",
        "planning provider writes are disabled by installation policy",
        false
      );
    }
    const outcome = await this.db.transaction().execute(async (transaction) => {
      const target = await transaction.selectFrom("planned_events")
        .innerJoin("planning_rules", "planning_rules.id", "planned_events.rule_id")
        .innerJoin("calendar_endpoints", "calendar_endpoints.id", "planned_events.destination_calendar_id")
        .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
        .select([
          "planned_events.id",
          "planned_events.rule_id",
          "planned_events.occurrence_key",
          "planned_events.generation",
          "planned_events.intent_sequence",
          "planned_events.destination_event_id",
          "planned_events.destination_etag",
          "planned_events.desired_state",
          "planned_events.status",
          "planned_events.reason_code",
          "planned_events.send_updates",
          "planning_rules.kind",
          "planning_rules.status as rule_status",
          "calendar_endpoints.remote_id as calendar_remote_id",
          "calendar_endpoints.connection_id",
          "calendar_endpoints.writable",
          "provider_connections.provider",
          "provider_connections.status as connection_status",
          "provider_connections.intended_role"
        ])
        .where("planned_events.organization_id", "=", organizationId)
        .where("planned_events.id", "=", plannedEventId)
        .forUpdate(["planned_events", "planning_rules"])
        .executeTakeFirst();
      if (!target || (target.rule_status !== "active" && target.status !== "pending_delete")) return null;
      if (
        Number(target.intent_sequence) !== expectedIntent
        || !["pending_create", "pending_update", "pending_delete"].includes(target.status)
      ) return null;
      if (
        !target.writable
        || target.connection_status !== "active"
        || (target.intended_role !== "destination" && target.intended_role !== "both")
      ) {
        await this.hold(transaction, target.id, "target_unavailable", target.status === "pending_delete");
        if (target.status === "pending_delete") {
          return new ProviderError(
            "cleanup_target_unavailable",
            "planning cleanup target is temporarily unavailable",
            true
          );
        }
        return null;
      }
      const provider = this.providers.resolve(target.provider);
      const token = await this.tokens.accessToken(organizationId, target.connection_id);
      let eventId = target.destination_event_id ?? planningEventId(target.id, target.generation);
      try {
        if (target.status === "pending_delete") {
          const deleteEventId = target.destination_event_id ?? planningEventId(target.id, target.generation);
          const found = await provider.getPlanningEvent(token, target.calendar_remote_id, deleteEventId);
          if (found && !belongs(found.managedIdentity, target)) {
            await this.hold(transaction, target.id, "ownership_mismatch", true);
            return new ProviderError(
              "cleanup_ownership_mismatch",
              "planning cleanup stopped because event ownership did not match",
              false
            );
          }
          if (found) {
            await provider.deletePlanningEvent(
              token,
              target.calendar_remote_id,
              found.remoteEventId,
              found.remoteRevision,
              target.send_updates
            );
          }
          await transaction.updateTable("planned_events").set({
            destination_event_id: null,
            destination_etag: null,
            status: target.reason_code === "suggestion_skip_accepted" ? "skipped" : "deleted",
            last_success_at: new Date(),
            safe_error_code: null,
            updated_at: new Date()
          }).where("id", "=", target.id).executeTakeFirstOrThrow();
          if (target.rule_status === "deleting") {
            const remaining = await transaction.selectFrom("planned_events")
              .select("id")
              .where("rule_id", "=", target.rule_id)
              .where("status", "=", "pending_delete")
              .limit(1)
              .executeTakeFirst();
            if (!remaining) {
              await transaction.updateTable("planning_rules").set({
                status: "deleted",
                safe_error_code: null,
                updated_at: new Date()
              }).where("id", "=", target.rule_id).executeTakeFirstOrThrow();
            }
          }
          return null;
        }
        let desired = requireManagedEvent(target.desired_state);
        let found = await provider.getPlanningEvent(token, target.calendar_remote_id, eventId);
        if (found && !belongs(found.managedIdentity, target)) {
          await this.hold(transaction, target.id, "ownership_mismatch", false);
          return null;
        }
        if (found?.managedIdentity && found.managedIdentity.intentSequence === Number(target.intent_sequence)) {
          const completedAt = new Date();
          await transaction.updateTable("planned_events").set({
            destination_event_id: found.remoteEventId,
            destination_etag: found.remoteRevision,
            status: "converged",
            last_success_at: completedAt,
            last_verified_at: completedAt,
            safe_error_code: null,
            updated_at: completedAt
          }).where("id", "=", target.id).executeTakeFirstOrThrow();
          await transaction.updateTable("planning_rules").set({
            last_success_at: completedAt,
            safe_error_code: null,
            updated_at: completedAt
          }).where("id", "=", target.rule_id).executeTakeFirstOrThrow();
          return null;
        }
        if (found?.managedIdentity
          && found.managedIdentity.intentSequence > Number(target.intent_sequence)) {
          await this.hold(transaction, target.id, "remote_intent_ahead", false);
          return null;
        }
        if (!found && target.destination_event_id) {
          const generation = target.generation + 1;
          eventId = planningEventId(target.id, generation);
          desired = {
            ...desired,
            provenance: { ...desired.provenance, generation }
          };
          await transaction.updateTable("planned_events").set({
            generation,
            destination_event_id: null,
            destination_etag: null,
            desired_state: desired,
            desired_hash: this.runtime.hash(desired),
            updated_at: new Date()
          }).where("id", "=", target.id).executeTakeFirstOrThrow();
        }
        if (target.kind === "smart_meeting"
          && new Date(desired.timing.start_instant).getTime() <= Date.now()) {
          await this.hold(transaction, target.id, "meeting_start_too_close", false);
          return null;
        }
        const written = found
          ? await provider.updatePlanningEvent(
              token,
              target.calendar_remote_id,
              found.remoteEventId,
              found.remoteRevision,
              desired
            )
          : await provider.createPlanningEvent(token, target.calendar_remote_id, eventId, desired);
        const completedAt = new Date();
        await transaction.updateTable("planned_events").set({
          destination_event_id: written.remoteEventId,
          destination_etag: written.remoteRevision,
          status: "converged",
          last_success_at: completedAt,
          last_verified_at: completedAt,
          safe_error_code: null,
          updated_at: completedAt
        }).where("id", "=", target.id).executeTakeFirstOrThrow();
        await transaction.updateTable("planning_rules").set({
          last_success_at: completedAt,
          safe_error_code: null,
          updated_at: completedAt
        }).where("id", "=", target.rule_id).executeTakeFirstOrThrow();
        return null;
      } catch (error) {
        if (error instanceof ProviderError && error.code === "precondition_failed") {
          await this.hold(transaction, target.id, "ownership_ambiguous", target.status === "pending_delete");
          if (target.status === "pending_delete") {
            return new ProviderError(
              "cleanup_precondition_changed",
              "planning cleanup will re-read a changed event before retrying",
              true
            );
          }
          return null;
        }
        const code = safeErrorCode(error);
        await transaction.updateTable("planned_events").set({
          safe_error_code: code,
          updated_at: new Date()
        }).where("id", "=", target.id).executeTakeFirstOrThrow();
        return error;
      }
    });
    if (outcome) throw outcome;
  }

  private async insertOccurrence(
    transaction: Transaction<DatabaseSchema>,
    organizationId: string,
    ruleId: string,
    revision: number,
    draft: PlanningDraft,
    occurrence: PlannedOccurrenceTemplate,
    now: Date
  ): Promise<void> {
    const id = newId();
    const desired = occurrence.event
      ? withProvenance(occurrence.event, draft.kind, ruleId, id, occurrence.occurrence_key, 1, 1)
      : null;
    await transaction.insertInto("planned_events").values({
      id,
      organization_id: organizationId,
      rule_id: ruleId,
      rule_revision: revision,
      occurrence_key: occurrence.occurrence_key,
      destination_calendar_id: draft.target_calendar_id,
      generation: 1,
      intent_sequence: desired ? 1 : 0,
      destination_event_id: null,
      destination_etag: null,
      desired_hash: desired ? this.runtime.hash(desired) : null,
      desired_state: desired,
      status: desired ? "pending_create" : "unmet",
      send_updates: desired?.write_controls.send_updates ?? false,
      reason_code: occurrence.reason_code,
      last_success_at: null,
      last_verified_at: null,
      safe_error_code: null
    }).executeTakeFirstOrThrow();
    if (desired) await this.enqueueApply(transaction, organizationId, id, 1, now);
  }

  private async updateOccurrence(
    transaction: Transaction<DatabaseSchema>,
    organizationId: string,
    ruleId: string,
    revision: number,
    draft: PlanningDraft,
    current: {
      readonly id: string;
      readonly generation: number;
      readonly intent_sequence: number;
      readonly destination_event_id: string | null;
      readonly desired_hash: string | null;
      readonly desired_state: unknown;
      readonly status: string;
      readonly safe_error_code: string | null;
    },
    occurrence: PlannedOccurrenceTemplate,
    now: Date
  ): Promise<void> {
    const desired = occurrence.event
      ? withProvenance(
          occurrence.event,
          draft.kind,
          ruleId,
          current.id,
          occurrence.occurrence_key,
          current.generation,
          Number(current.intent_sequence)
        )
      : null;
    if (current.status === "skipped") return;
    const desiredHash = desired ? this.runtime.hash(desired) : null;
    if (desiredHash === current.desired_hash && current.status !== "unmet") {
      if (current.status === "held" && current.safe_error_code === "target_unavailable") {
        await transaction.updateTable("planned_events").set({
          status: current.destination_event_id ? "pending_update" : "pending_create",
          safe_error_code: null,
          updated_at: now
        }).where("id", "=", current.id).executeTakeFirstOrThrow();
        await this.enqueueApply(
          transaction,
          organizationId,
          current.id,
          Number(current.intent_sequence),
          now
        );
      } else if (
        (current.status === "pending_create" || current.status === "pending_update")
        && current.safe_error_code === null
      ) {
        await this.enqueueApply(
          transaction,
          organizationId,
          current.id,
          Number(current.intent_sequence),
          now
        );
      }
      return;
    }
    if (
      draft.kind === "smart_meeting"
      && current.destination_event_id
      && insideNoMoveWindow(current.desired_state, now, draft.lock_before_minutes)
    ) {
      await transaction.updateTable("planned_events").set({
        status: "held",
        reason_code: "inside_no_move_window",
        safe_error_code: "meeting_locked",
        updated_at: now
      }).where("id", "=", current.id).executeTakeFirstOrThrow();
      return;
    }
    if (
      draft.kind === "smart_meeting"
      && draft.conflict_policy === "suggest"
      && current.destination_event_id
      && current.status === "converged"
    ) {
      const basis = this.runtime.hash({ current: current.desired_hash, proposed: desiredHash, revision });
      await transaction.insertInto("planning_suggestions").values({
        id: newId(),
        organization_id: organizationId,
        rule_id: ruleId,
        planned_event_id: current.id,
        kind: desired ? "move" : "skip",
        basis_hash: basis,
        proposed_state: desired,
        reason_code: desired ? "conflict_found_better_time" : "conflict_no_mutual_time",
        status: "pending",
        expires_at: new Date(now.getTime() + 14 * 86_400_000)
      }).onConflict((conflict) => conflict.doNothing()).executeTakeFirst();
      return;
    }
    if (
      draft.kind === "smart_meeting"
      && draft.conflict_policy === "keep_with_warning"
      && current.destination_event_id
    ) {
      await transaction.updateTable("planned_events").set({
        status: "held",
        reason_code: "conflict_kept_for_manual_resolution",
        safe_error_code: "meeting_conflict",
        updated_at: now
      }).where("id", "=", current.id).executeTakeFirstOrThrow();
      return;
    }
    if (draft.kind === "smart_meeting" && current.destination_event_id && !desired) {
      await transaction.updateTable("planned_events").set({
        status: "held",
        reason_code: "no_mutual_time_inside_meeting_hours",
        safe_error_code: "planning_window_unmet",
        updated_at: now
      }).where("id", "=", current.id).executeTakeFirstOrThrow();
      return;
    }
    const intent = Number(current.intent_sequence) + 1;
    const writeDesired = desired ? withIntent(desired, intent) : null;
    const writeDesiredHash = writeDesired ? this.runtime.hash(writeDesired) : null;
    await transaction.updateTable("planned_events").set({
      rule_revision: revision,
      intent_sequence: intent,
      desired_hash: writeDesiredHash,
      desired_state: writeDesired,
      status: writeDesired ? (current.destination_event_id ? "pending_update" : "pending_create") : "unmet",
      send_updates: writeDesired?.write_controls.send_updates ?? false,
      reason_code: occurrence.reason_code,
      safe_error_code: writeDesired ? null : "planning_window_unmet",
      updated_at: now
    }).where("id", "=", current.id).executeTakeFirstOrThrow();
    if (writeDesired) await this.enqueueApply(transaction, organizationId, current.id, intent, now);
  }

  private async enqueueApply(
    transaction: Transaction<DatabaseSchema>,
    organizationId: string,
    plannedEventId: string,
    intent: number,
    now: Date
  ): Promise<void> {
    await this.jobs.enqueue(
      organizationId,
      "apply_planned_event",
      `planned-event:${plannedEventId}:intent:${intent}`,
      { planned_event_id: plannedEventId, intent_sequence: intent },
      now,
      transaction
    );
  }

  private async hold(
    transaction: Transaction<DatabaseSchema>,
    plannedEventId: string,
    code: string,
    preservePendingDelete: boolean
  ): Promise<void> {
    await transaction.updateTable("planned_events").set({
      status: preservePendingDelete ? "pending_delete" : "held",
      safe_error_code: code,
      updated_at: new Date()
    }).where("id", "=", plannedEventId).executeTakeFirstOrThrow();
  }
}

function field(payload: unknown, name: string): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error("invalid planning job payload");
  const value = (payload as Record<string, unknown>)[name];
  if (typeof value !== "string") throw new Error("invalid planning job payload");
  return value;
}

function integerField(payload: unknown, name: string): number {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("invalid planning job payload");
  }
  const value = (payload as Record<string, unknown>)[name];
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("invalid planning job payload");
  return Number(value);
}

function withProvenance(
  event: Omit<ManagedPlanningEvent, "provenance">,
  kind: PlanningDraft["kind"],
  ruleId: string,
  plannedEventId: string,
  occurrenceKey: string,
  generation: number,
  intentSequence: number
): ManagedPlanningEvent {
  return {
    ...event,
    provenance: {
      version: 1,
      kind,
      rule_ref: ruleId,
      planned_event_ref: plannedEventId,
      occurrence_key: occurrenceKey,
      generation,
      intent_sequence: intentSequence
    }
  };
}

function requireManagedEvent(value: unknown): ManagedPlanningEvent {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || !("provenance" in value)
    || !("timing" in value)
  ) {
    throw new ProviderError("invalid_desired_state", "planned event desired state is invalid", false);
  }
  return value as ManagedPlanningEvent;
}

function withIntent(event: ManagedPlanningEvent, intentSequence: number): ManagedPlanningEvent {
  return {
    ...event,
    provenance: { ...event.provenance, intent_sequence: intentSequence }
  };
}

function insideNoMoveWindow(value: unknown, now: Date, lockBeforeMinutes: number): boolean {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || !("timing" in value)
  ) return false;
  const timing = (value as { readonly timing?: unknown }).timing;
  if (typeof timing !== "object" || timing === null || Array.isArray(timing) || !("start_instant" in timing)) {
    return false;
  }
  const start = new Date((timing as { readonly start_instant: string }).start_instant).getTime();
  return Number.isFinite(start)
    && start > now.getTime()
    && start <= now.getTime() + lockBeforeMinutes * 60_000;
}

function eventHasEnded(value: unknown, now: Date): boolean {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || !("timing" in value)
  ) return false;
  const timing = (value as { readonly timing?: unknown }).timing;
  if (typeof timing !== "object" || timing === null || Array.isArray(timing) || !("end_instant" in timing)) {
    return false;
  }
  const end = new Date((timing as { readonly end_instant: string }).end_instant).getTime();
  return Number.isFinite(end) && end <= now.getTime();
}

function planningEventId(plannedEventId: string, generation: number): string {
  const digest = createHash("sha256").update(`${plannedEventId}:${generation}`).digest("hex");
  return `p${digest.slice(0, 48)}`;
}

function belongs(
  identity: {
    readonly kind: string;
    readonly ruleRef: string;
    readonly plannedEventRef: string;
    readonly occurrenceKey: string;
    readonly generation: number;
  } | null,
  target: {
    readonly kind: string;
    readonly rule_id: string;
    readonly id: string;
    readonly occurrence_key: string;
    readonly generation: number;
  }
): boolean {
  return identity !== null
    && identity.kind === target.kind
    && identity.ruleRef === target.rule_id
    && identity.plannedEventRef === target.id
    && identity.occurrenceKey === target.occurrence_key
    && identity.generation === target.generation;
}
