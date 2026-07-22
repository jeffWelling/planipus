import {
  materializeHours,
  type HoursProfile,
  type SourceObservation
} from "@planipus/calendar-sync";
import type { Kysely, Transaction } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { newId } from "../foundation.js";
import { PostgresJobQueue } from "../jobs/queue.js";
import type { PolicyRuntime } from "../policy/runtime.js";
import { addLocalDays, localDateAt, planScheduling } from "./engine.js";
import type {
  ManagedPlanningEvent,
  PlanningBusyInterval,
  PlanningDraft,
  PlanningInput,
  PlanningResult
} from "./types.js";
import { parsePlanningDraft, PlanningInputError } from "./validation.js";

type Executor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;
const AVAILABILITY_MAX_AGE_MILLISECONDS = 30 * 60_000;

export interface PlanningPreviewDocument extends PlanningResult {
  readonly preview_token: string;
  readonly expires_at: string;
}

export interface PlanningRuleDocument {
  readonly id: string;
  readonly kind: PlanningDraft["kind"];
  readonly name: string;
  readonly status: "active" | "paused" | "deleting";
  readonly target_calendar_id: string;
  readonly target_calendar_name: string;
  readonly rule: PlanningDraft;
  readonly scheduled_count: number;
  readonly unmet_count: number;
  readonly pending_count: number;
  readonly suggestion_count: number;
  readonly next_occurrences: readonly {
    readonly id: string;
    readonly occurrence_key: string;
    readonly status: string;
    readonly reason_code: string;
    readonly start_at: string | null;
    readonly end_at: string | null;
  }[];
  readonly last_success_at: string | null;
}

export interface PlanningSuggestionDocument {
  readonly id: string;
  readonly rule_id: string;
  readonly rule_name: string;
  readonly planned_event_id: string;
  readonly kind: "move" | "shorten" | "skip";
  readonly reason_code: string;
  readonly current_start_at: string | null;
  readonly current_end_at: string | null;
  readonly proposed_start_at: string | null;
  readonly proposed_end_at: string | null;
  readonly expires_at: string;
}

export class PlanningService {
  private readonly jobs: PostgresJobQueue;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly runtime: Pick<PolicyRuntime, "hash">
  ) {
    this.jobs = new PostgresJobQueue(db);
  }

  public async preview(
    organizationId: string,
    principalId: string,
    input: unknown,
    now = new Date()
  ): Promise<PlanningPreviewDocument> {
    const draft = parsePlanningDraft(input);
    const prepared = await this.prepare(organizationId, draft, now, this.db);
    const result = planScheduling(prepared.input);
    const id = newId();
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await this.db.insertInto("planning_previews").values({
      id,
      organization_id: organizationId,
      principal_id: principalId,
      rule_kind: draft.kind,
      draft_document: draft,
      draft_hash: this.runtime.hash(draft),
      input_snapshot_hash: prepared.snapshotHash,
      result_document: result,
      planning_reference_at: now,
      expires_at: expiresAt,
      consumed_at: null
    }).executeTakeFirstOrThrow();
    return { ...result, preview_token: id, expires_at: expiresAt.toISOString() };
  }

  public async activate(
    organizationId: string,
    principalId: string,
    previewId: string,
    now = new Date()
  ): Promise<{ readonly id: string }> {
    return this.db.transaction().execute(async (transaction) => {
      const preview = await transaction.selectFrom("planning_previews")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("principal_id", "=", principalId)
        .where("id", "=", previewId)
        .forUpdate()
        .executeTakeFirst();
      if (!preview || preview.consumed_at || preview.expires_at <= now) {
        throw new PlanningInputError("preview_stale", "planning preview has expired or was already used");
      }
      const draft = parsePlanningDraft(preview.draft_document);
      const prepared = await this.prepare(
        organizationId,
        draft,
        preview.planning_reference_at,
        transaction
      );
      if (prepared.snapshotHash !== preview.input_snapshot_hash) {
        throw new PlanningInputError("preview_stale", "calendar availability changed after preview");
      }
      const result = planScheduling(prepared.input);
      if (draft.kind === "smart_meeting" && result.occurrences.some((occurrence) =>
        occurrence.event !== undefined
        && new Date(occurrence.event.timing.start_instant).getTime() <= now.getTime()
      )) {
        throw new PlanningInputError("preview_stale", "a proposed meeting time has already started");
      }
      const ruleId = newId();
      const ruleHash = this.runtime.hash(draft);
      await transaction.insertInto("planning_rules").values({
        id: ruleId,
        organization_id: organizationId,
        owner_principal_id: principalId,
        kind: draft.kind,
        name: draft.name,
        target_calendar_id: draft.target_calendar_id,
        status: "active",
        revision: 1,
        rule_document: draft,
        rule_hash: ruleHash,
        last_planned_at: now,
        last_success_at: null,
        safe_error_code: null
      }).executeTakeFirstOrThrow();
      for (const occurrence of result.occurrences) {
        const plannedEventId = newId();
        const desired = occurrence.event ? withProvenance(
          occurrence.event,
          draft.kind,
          ruleId,
          plannedEventId,
          occurrence.occurrence_key,
          1,
          1
        ) : null;
        await transaction.insertInto("planned_events").values({
          id: plannedEventId,
          organization_id: organizationId,
          rule_id: ruleId,
          rule_revision: 1,
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
        if (desired) {
          await this.jobs.enqueue(
            organizationId,
            "apply_planned_event",
            `planned-event:${plannedEventId}:intent:1`,
            { planned_event_id: plannedEventId, intent_sequence: 1 },
            now,
            transaction
          );
        }
      }
      await transaction.updateTable("planning_previews")
        .set({ consumed_at: now })
        .where("id", "=", previewId)
        .executeTakeFirstOrThrow();
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: "user",
        action: "planning_rule.activated",
        target_type: "planning_rule",
        target_id: ruleId,
        reason_code: "preview_confirmed",
        before_hash: null,
        after_hash: ruleHash,
        detail: {
          kind: draft.kind,
          scheduled_count: result.scheduled_count,
          unmet_count: result.unmet_count
        }
      }).executeTakeFirstOrThrow();
      return { id: ruleId };
    });
  }

  public async list(
    organizationId: string,
    now = new Date()
  ): Promise<readonly PlanningRuleDocument[]> {
    const rules = await this.db.selectFrom("planning_rules")
      .innerJoin("calendar_endpoints", "calendar_endpoints.id", "planning_rules.target_calendar_id")
      .select([
        "planning_rules.id",
        "planning_rules.kind",
        "planning_rules.name",
        "planning_rules.status",
        "planning_rules.target_calendar_id",
        "planning_rules.rule_document",
        "planning_rules.last_success_at",
        "calendar_endpoints.name as target_calendar_name"
      ])
      .where("planning_rules.organization_id", "=", organizationId)
      .where("planning_rules.status", "!=", "deleted")
      .orderBy("planning_rules.created_at", "asc")
      .execute();
    const result: PlanningRuleDocument[] = [];
    for (const rule of rules) {
      const [events, suggestions] = await Promise.all([
        this.db.selectFrom("planned_events")
          .select(["id", "occurrence_key", "status", "reason_code", "desired_state"])
          .where("organization_id", "=", organizationId)
          .where("rule_id", "=", rule.id)
          .orderBy("occurrence_key", "asc")
          .execute(),
        this.db.selectFrom("planning_suggestions")
          .select("id")
          .where("organization_id", "=", organizationId)
          .where("rule_id", "=", rule.id)
          .where("status", "=", "pending")
          .execute()
      ]);
      const parsedRule = parsePlanningDraft(rule.rule_document);
      const today = localDateAt(now.toISOString(), parsedRule.timezone);
      const visibleEvents = events.filter((event) => {
        if (["deleted", "skipped", "pending_delete"].includes(event.status)) return false;
        const desired = managedEventOrNull(event.desired_state);
        if (desired) return new Date(desired.timing.end_instant).getTime() > now.getTime();
        const localKey = event.occurrence_key.startsWith("week:")
          ? event.occurrence_key.slice("week:".length)
          : null;
        return event.status === "unmet" && localKey !== null && localKey >= today;
      });
      result.push({
        id: rule.id,
        kind: rule.kind,
        name: rule.name,
        status: rule.status as "active" | "paused" | "deleting",
        target_calendar_id: rule.target_calendar_id,
        target_calendar_name: rule.target_calendar_name,
        rule: parsedRule,
        scheduled_count: visibleEvents.filter((event) => event.desired_state !== null).length,
        unmet_count: visibleEvents.filter((event) => event.status === "unmet").length,
        pending_count: visibleEvents.filter((event) => event.status.startsWith("pending_")).length,
        suggestion_count: suggestions.length,
        next_occurrences: visibleEvents.slice(0, 8).map((event) => {
          const desired = event.desired_state as unknown as ManagedPlanningEvent | null;
          return {
            id: event.id,
            occurrence_key: event.occurrence_key,
            status: event.status,
            reason_code: event.reason_code,
            start_at: desired?.timing.start_instant ?? null,
            end_at: desired?.timing.end_instant ?? null
          };
        }),
        last_success_at: rule.last_success_at?.toISOString() ?? null
      });
    }
    return result;
  }

  public async listSuggestions(
    organizationId: string,
    now = new Date()
  ): Promise<readonly PlanningSuggestionDocument[]> {
    const rows = await this.db.selectFrom("planning_suggestions")
      .innerJoin("planning_rules", "planning_rules.id", "planning_suggestions.rule_id")
      .innerJoin("planned_events", "planned_events.id", "planning_suggestions.planned_event_id")
      .select([
        "planning_suggestions.id",
        "planning_suggestions.rule_id",
        "planning_suggestions.planned_event_id",
        "planning_suggestions.kind",
        "planning_suggestions.reason_code",
        "planning_suggestions.proposed_state",
        "planning_suggestions.expires_at",
        "planning_rules.name as rule_name",
        "planned_events.desired_state as current_state"
      ])
      .where("planning_suggestions.organization_id", "=", organizationId)
      .where("planning_suggestions.status", "=", "pending")
      .where("planning_suggestions.expires_at", ">", now)
      .where("planning_rules.status", "=", "active")
      .orderBy("planning_suggestions.created_at", "asc")
      .execute();
    return rows.map((row) => {
      const current = managedEventOrNull(row.current_state);
      const proposed = managedEventOrNull(row.proposed_state);
      return {
        id: row.id,
        rule_id: row.rule_id,
        rule_name: row.rule_name,
        planned_event_id: row.planned_event_id,
        kind: row.kind,
        reason_code: row.reason_code,
        current_start_at: current?.timing.start_instant ?? null,
        current_end_at: current?.timing.end_instant ?? null,
        proposed_start_at: proposed?.timing.start_instant ?? null,
        proposed_end_at: proposed?.timing.end_instant ?? null,
        expires_at: row.expires_at.toISOString()
      };
    });
  }

  public async resolveSuggestion(
    organizationId: string,
    principalId: string,
    suggestionId: string,
    decision: "accept" | "dismiss",
    now = new Date()
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const suggestion = await transaction.selectFrom("planning_suggestions")
        .innerJoin("planning_rules", "planning_rules.id", "planning_suggestions.rule_id")
        .innerJoin("planned_events", "planned_events.id", "planning_suggestions.planned_event_id")
        .select([
          "planning_suggestions.id",
          "planning_suggestions.rule_id",
          "planning_suggestions.planned_event_id",
          "planning_suggestions.kind",
          "planning_suggestions.basis_hash",
          "planning_suggestions.proposed_state",
          "planning_suggestions.reason_code",
          "planning_suggestions.status",
          "planning_suggestions.expires_at",
          "planning_rules.status as rule_status",
          "planning_rules.revision as rule_revision",
          "planning_rules.kind as rule_kind",
          "planning_rules.rule_document",
          "planned_events.intent_sequence",
          "planned_events.generation",
          "planned_events.occurrence_key",
          "planned_events.destination_event_id",
          "planned_events.desired_hash",
          "planned_events.desired_state"
        ])
        .where("planning_suggestions.organization_id", "=", organizationId)
        .where("planning_suggestions.id", "=", suggestionId)
        .forUpdate(["planning_suggestions", "planned_events", "planning_rules"])
        .executeTakeFirst();
      if (!suggestion || suggestion.status !== "pending") {
        throw new PlanningInputError("suggestion_stale", "that suggested change is no longer available");
      }
      if (suggestion.expires_at <= now || suggestion.rule_status !== "active") {
        throw new PlanningInputError("suggestion_stale", "that suggested change has expired");
      }
      let auditedAfterHash = suggestion.desired_hash;
      if (decision === "dismiss") {
        await transaction.updateTable("planning_suggestions").set({
          status: "dismissed",
          updated_at: now
        }).where("id", "=", suggestion.id).executeTakeFirstOrThrow();
      } else {
        const proposed = managedEventOrNull(suggestion.proposed_state);
        const proposedHash = proposed ? this.runtime.hash(proposed) : null;
        const expectedBasis = this.runtime.hash({
          current: suggestion.desired_hash,
          proposed: proposedHash,
          revision: suggestion.rule_revision
        });
        if (expectedBasis !== suggestion.basis_hash) {
          throw new PlanningInputError("suggestion_stale", "calendar state changed after this suggestion was made");
        }
        const draft = parsePlanningDraft(suggestion.rule_document);
        if (insideNoMoveWindow(suggestion.desired_state, now, draft.kind === "smart_meeting" ? draft.lock_before_minutes : 0)) {
          throw new PlanningInputError("suggestion_stale", "this meeting is now inside its no-move window");
        }
        const prepared = await this.prepareForReconcile(
          organizationId,
          draft,
          now,
          suggestion.rule_id,
          transaction
        );
        const latest = planScheduling(prepared.input).occurrences
          .find((occurrence) => occurrence.occurrence_key === suggestion.occurrence_key);
        const latestProposed = latest?.event ? withProvenance(
          latest.event,
          suggestion.rule_kind,
          suggestion.rule_id,
          suggestion.planned_event_id,
          suggestion.occurrence_key,
          suggestion.generation,
          Number(suggestion.intent_sequence)
        ) : null;
        const latestHash = latestProposed ? this.runtime.hash(latestProposed) : null;
        if (latestHash !== proposedHash) {
          throw new PlanningInputError("suggestion_stale", "availability changed after this suggestion was made");
        }
        const intent = Number(suggestion.intent_sequence) + 1;
        const writeProposed = proposed ? withPlanningIntent(proposed, intent) : null;
        if (writeProposed) {
          auditedAfterHash = this.runtime.hash(writeProposed);
          await transaction.updateTable("planned_events").set({
            intent_sequence: intent,
            desired_state: writeProposed,
            desired_hash: auditedAfterHash,
            status: suggestion.destination_event_id ? "pending_update" : "pending_create",
            send_updates: writeProposed.write_controls.send_updates,
            reason_code: "suggestion_accepted",
            safe_error_code: null,
            updated_at: now
          }).where("id", "=", suggestion.planned_event_id).executeTakeFirstOrThrow();
        } else {
          auditedAfterHash = null;
          await transaction.updateTable("planned_events").set({
            intent_sequence: intent,
            desired_state: null,
            desired_hash: null,
            status: suggestion.destination_event_id ? "pending_delete" : "skipped",
            reason_code: "suggestion_skip_accepted",
            safe_error_code: null,
            updated_at: now
          }).where("id", "=", suggestion.planned_event_id).executeTakeFirstOrThrow();
        }
        await this.jobs.enqueue(
          organizationId,
          "apply_planned_event",
          `planned-event:${suggestion.planned_event_id}:suggestion:${suggestion.id}`,
          { planned_event_id: suggestion.planned_event_id, intent_sequence: intent },
          now,
          transaction
        );
        await transaction.updateTable("planning_suggestions").set({
          status: "accepted",
          updated_at: now
        }).where("id", "=", suggestion.id).executeTakeFirstOrThrow();
        await transaction.updateTable("planning_suggestions").set({
          status: "expired",
          updated_at: now
        })
          .where("planned_event_id", "=", suggestion.planned_event_id)
          .where("status", "=", "pending")
          .where("id", "!=", suggestion.id)
          .execute();
      }
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: "user",
        action: decision === "accept" ? "planning_suggestion.accepted" : "planning_suggestion.dismissed",
        target_type: "planning_suggestion",
        target_id: suggestion.id,
        reason_code: suggestion.reason_code,
        before_hash: suggestion.desired_hash,
        after_hash: decision === "accept" ? auditedAfterHash : suggestion.desired_hash,
        detail: { kind: suggestion.kind }
      }).executeTakeFirstOrThrow();
    });
  }

  public async setPaused(
    organizationId: string,
    principalId: string,
    ruleId: string,
    paused: boolean
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const rule = await transaction.selectFrom("planning_rules")
        .select(["status", "revision", "rule_hash"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", ruleId)
        .where("status", "in", ["active", "paused"])
        .forUpdate()
        .executeTakeFirst();
      if (!rule) throw new PlanningInputError("not_found", "planning rule was not found");
      await transaction.updateTable("planning_rules")
        .set({ status: paused ? "paused" : "active", updated_at: new Date() })
        .where("id", "=", ruleId)
        .executeTakeFirstOrThrow();
      if (!paused) {
        await this.jobs.enqueue(
          organizationId,
          "reconcile_planning_rule",
          `planning-rule:${ruleId}:revision:${rule.revision}`,
          { rule_id: ruleId },
          new Date(),
          transaction
        );
        const pending = await transaction.selectFrom("planned_events")
          .select(["id", "intent_sequence"])
          .where("organization_id", "=", organizationId)
          .where("rule_id", "=", ruleId)
          .where("status", "in", ["pending_create", "pending_update", "pending_delete"])
          .execute();
        for (const event of pending) {
          await this.jobs.enqueue(
            organizationId,
            "apply_planned_event",
            `planned-event:${event.id}:resume:${event.intent_sequence}:${Date.now()}`,
            { planned_event_id: event.id, intent_sequence: Number(event.intent_sequence) },
            new Date(),
            transaction
          );
        }
      }
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: "user",
        action: paused ? "planning_rule.paused" : "planning_rule.resumed",
        target_type: "planning_rule",
        target_id: ruleId,
        reason_code: "user_command",
        before_hash: rule.rule_hash,
        after_hash: rule.rule_hash,
        detail: { kind: "lifecycle" }
      }).executeTakeFirstOrThrow();
    });
  }

  public async remove(
    organizationId: string,
    principalId: string,
    ruleId: string,
    now = new Date()
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const rule = await transaction.selectFrom("planning_rules")
        .select(["status", "revision", "rule_hash", "kind"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", ruleId)
        .where("status", "!=", "deleted")
        .forUpdate()
        .executeTakeFirst();
      if (!rule) throw new PlanningInputError("not_found", "planning rule was not found");
      await transaction.updateTable("planning_rules").set({
        status: "deleting",
        revision: rule.revision + 1,
        updated_at: now
      }).where("id", "=", ruleId).executeTakeFirstOrThrow();
      await transaction.updateTable("planning_suggestions").set({
        status: "expired",
        updated_at: now
      }).where("rule_id", "=", ruleId).where("status", "=", "pending").execute();
      const events = await transaction.selectFrom("planned_events")
        .select(["id", "destination_event_id", "intent_sequence", "status", "desired_state"])
        .where("organization_id", "=", organizationId)
        .where("rule_id", "=", ruleId)
        .forUpdate()
        .execute();
      let cleanupCount = 0;
      for (const event of events) {
        const desired = managedEventOrNull(event.desired_state);
        const futureOrCurrent = desired !== null && new Date(desired.timing.end_instant) > now;
        const cleanupAlreadyPending = event.status === "pending_delete";
        const remoteMayExist = event.destination_event_id !== null
          || ["pending_create", "pending_update"].includes(event.status);
        if (cleanupAlreadyPending || (futureOrCurrent && remoteMayExist)) {
          cleanupCount += 1;
          const intent = Number(event.intent_sequence) + 1;
          await transaction.updateTable("planned_events").set({
            intent_sequence: intent,
            desired_state: null,
            desired_hash: null,
            status: "pending_delete",
            reason_code: "rule_removed",
            safe_error_code: null,
            updated_at: now
          }).where("id", "=", event.id).executeTakeFirstOrThrow();
          await this.jobs.enqueue(
            organizationId,
            "apply_planned_event",
            `planned-event:${event.id}:remove:${intent}`,
            { planned_event_id: event.id, intent_sequence: intent },
            now,
            transaction
          );
        } else {
          await transaction.updateTable("planned_events").set({
            desired_state: null,
            desired_hash: null,
            status: "deleted",
            reason_code: "rule_removed",
            updated_at: now
          }).where("id", "=", event.id).executeTakeFirstOrThrow();
        }
      }
      if (cleanupCount === 0) {
        await transaction.updateTable("planning_rules").set({
          status: "deleted",
          updated_at: now
        }).where("id", "=", ruleId).executeTakeFirstOrThrow();
      }
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: "user",
        action: cleanupCount === 0 ? "planning_rule.removed" : "planning_rule.removal_requested",
        target_type: "planning_rule",
        target_id: ruleId,
        reason_code: "user_command",
        before_hash: rule.rule_hash,
        after_hash: null,
        detail: { kind: rule.kind, managed_events: events.length, cleanup_pending: cleanupCount }
      }).executeTakeFirstOrThrow();
    });
  }

  public async requestReplan(organizationId: string, ruleId: string): Promise<string | null> {
    const rule = await this.db.selectFrom("planning_rules")
      .select("revision")
      .where("organization_id", "=", organizationId)
      .where("id", "=", ruleId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!rule) throw new PlanningInputError("not_found", "planning rule was not found");
    return this.jobs.enqueue(
      organizationId,
      "reconcile_planning_rule",
      `planning-rule:${ruleId}:revision:${rule.revision}:manual:${Date.now()}`,
      { rule_id: ruleId }
    );
  }

  public async prepareForReconcile(
    organizationId: string,
    draft: PlanningDraft,
    now: Date,
    excludeRuleId: string,
    executor: Executor = this.db
  ): Promise<{ readonly input: PlanningInput; readonly snapshotHash: string }> {
    return this.prepare(
      organizationId,
      rollingDraft(draft, now),
      now,
      executor,
      excludeRuleId
    );
  }

  private async prepare(
    organizationId: string,
    draft: PlanningDraft,
    now: Date,
    executor: Executor,
    excludeRuleId?: string
  ): Promise<{ readonly input: PlanningInput; readonly snapshotHash: string }> {
    const target = await executor.selectFrom("calendar_endpoints")
      .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
      .select([
        "calendar_endpoints.id",
        "calendar_endpoints.writable",
        "calendar_endpoints.updated_at",
        "provider_connections.status",
        "provider_connections.intended_role"
      ])
      .where("calendar_endpoints.organization_id", "=", organizationId)
      .where("calendar_endpoints.id", "=", draft.target_calendar_id)
      .executeTakeFirst();
    if (
      !target
      || !target.writable
      || target.status !== "active"
      || (target.intended_role !== "destination" && target.intended_role !== "both")
    ) {
      throw new PlanningInputError("calendar_capability", "target calendar is not writable");
    }
    const requested = draft.kind === "smart_meeting" ? [...draft.availability_calendar_ids] : [];
    const calendars = requested.length === 0 ? [] : await executor.selectFrom("calendar_endpoints")
      .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
      .select([
        "calendar_endpoints.id",
        "calendar_endpoints.readable",
        "calendar_endpoints.updated_at",
        "provider_connections.status"
      ])
      .where("calendar_endpoints.organization_id", "=", organizationId)
      .where("calendar_endpoints.id", "in", requested)
      .orderBy("calendar_endpoints.id", "asc")
      .execute();
    const cursors = requested.length === 0 ? [] : await executor.selectFrom("sync_cursors")
      .select(["calendar_endpoint_id", "state", "last_success_at", "updated_at"])
      .where("organization_id", "=", organizationId)
      .where("calendar_endpoint_id", "in", requested)
      .orderBy("calendar_endpoint_id", "asc")
      .orderBy("updated_at", "desc")
      .execute();
    const freshnessCutoff = new Date(now.getTime() - AVAILABILITY_MAX_AGE_MILLISECONDS);
    const known = calendars
      .filter((calendar) => calendar.readable && calendar.status === "active")
      .filter((calendar) => cursors.some((cursor) => cursor.calendar_endpoint_id === calendar.id
        && cursor.state === "ready"
        && cursor.last_success_at !== null
        && cursor.last_success_at >= freshnessCutoff))
      .map((calendar) => calendar.id);
    if (draft.kind === "smart_meeting" && new Set(requested).size !== new Set(known).size) {
      throw new PlanningInputError(
        "availability_not_ready",
        "one or more selected calendars have not completed a recent sync"
      );
    }
    const observations = known.length === 0 ? [] : await executor.selectFrom("source_observations")
      .select(["calendar_endpoint_id", "observation_hash", "normalized_event", "tombstone"])
      .where("organization_id", "=", organizationId)
      .where("calendar_endpoint_id", "in", known)
      .where("tombstone", "=", false)
      .orderBy("calendar_endpoint_id", "asc")
      .orderBy("remote_event_id", "asc")
      .orderBy("recurrence_identity", "asc")
      .execute();
    let plannedQuery = executor.selectFrom("planned_events")
      .innerJoin("planning_rules", "planning_rules.id", "planned_events.rule_id")
      .select([
        "planned_events.id",
        "planned_events.destination_calendar_id",
        "planned_events.desired_hash",
        "planned_events.desired_state",
        "planned_events.status"
      ])
      .where("planned_events.organization_id", "=", organizationId)
      .where("planning_rules.status", "=", "active")
      .where("planning_rules.kind", "=", "smart_meeting")
      .where("planned_events.destination_calendar_id", "in", [
        ...new Set([...requested, draft.target_calendar_id])
      ])
      .where("planned_events.status", "in", ["pending_create", "pending_update", "converged", "held"])
      .orderBy("planned_events.id", "asc");
    if (excludeRuleId) {
      plannedQuery = plannedQuery.where("planned_events.rule_id", "!=", excludeRuleId);
    }
    const planned = draft.kind === "smart_meeting" ? await plannedQuery.execute() : [];
    const busy: PlanningBusyInterval[] = [];
    for (const row of observations) {
      const event = row.normalized_event as unknown as SourceObservation;
      const eventRuleRef = event.provider_metadata?.["planipus_rule_ref"];
      if (
        event.lifecycle === "confirmed"
        && event.availability !== "free"
        && event.relationship.response !== "declined"
        && eventRuleRef !== excludeRuleId
      ) {
        if (event.timing?.kind === "timed") {
          busy.push({
            calendar_id: row.calendar_endpoint_id,
            start: event.timing.start_instant,
            end: event.timing.end_instant
          });
        } else if (event.timing?.kind === "all_day") {
          const materialized = materializeHours({
            profile: fullDayProfile(event.timing.timezone),
            start_date: event.timing.start_date,
            end_date_exclusive: event.timing.end_date
          });
          if (materialized.diagnostics.includes("dst_resolution_rejected")) {
            throw new PlanningInputError("availability_not_ready", "an all-day busy event has invalid timezone data");
          }
          for (const interval of materialized.concrete_intervals) {
            busy.push({ calendar_id: row.calendar_endpoint_id, ...interval });
          }
        }
      }
    }
    for (const row of planned) {
      const event = row.desired_state as unknown as ManagedPlanningEvent | null;
      if (event?.timing) {
        busy.push({
          calendar_id: row.destination_calendar_id,
          start: event.timing.start_instant,
          end: event.timing.end_instant
        });
      }
    }
    const snapshotHash = this.runtime.hash({
      version: 1,
      target: { id: target.id, updated_at: target.updated_at.toISOString() },
      calendars: calendars.map((calendar) => ({
        id: calendar.id,
        updated_at: calendar.updated_at.toISOString(),
        status: calendar.status
      })),
      cursors: cursors.map((cursor) => ({
        calendar_id: cursor.calendar_endpoint_id,
        state: cursor.state,
        last_success_at: cursor.last_success_at?.toISOString() ?? null,
        updated_at: cursor.updated_at.toISOString()
      })),
      observations: observations.map((row) => ({
        calendar_id: row.calendar_endpoint_id,
        hash: row.observation_hash,
        tombstone: row.tombstone
      })),
      planned: planned.map((row) => ({
        id: row.id,
        desired_hash: row.desired_hash,
        status: row.status
      }))
    });
    return {
      input: {
        draft,
        now: now.toISOString(),
        busy,
        known_availability_calendar_ids: known
      },
      snapshotHash
    };
  }
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

function managedEventOrNull(value: unknown): ManagedPlanningEvent | null {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || !("timing" in value)
    || !("provenance" in value)
  ) return null;
  return value as ManagedPlanningEvent;
}

function insideNoMoveWindow(value: unknown, now: Date, lockBeforeMinutes: number): boolean {
  const event = managedEventOrNull(value);
  if (!event) return false;
  const start = new Date(event.timing.start_instant).getTime();
  return Number.isFinite(start)
    && start > now.getTime()
    && start <= now.getTime() + lockBeforeMinutes * 60_000;
}

function withPlanningIntent(event: ManagedPlanningEvent, intentSequence: number): ManagedPlanningEvent {
  return {
    ...event,
    provenance: { ...event.provenance, intent_sequence: intentSequence }
  };
}

function fullDayProfile(timezone: string): HoursProfile {
  return {
    profile_ref: "planning-all-day-busy",
    revision: 1,
    timezone,
    dst_resolution: {
      ambiguous: "earlier_offset",
      nonexistent: "shift_forward_by_gap"
    },
    weekly: ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => ({
      weekday,
      start: "00:00:00",
      end: "00:00:00",
      end_day_offset: 1
    })),
    exceptions: []
  };
}

function rollingDraft(draft: PlanningDraft, now: Date): PlanningDraft {
  if (draft.kind !== "smart_meeting") return draft;
  const today = localDateAt(now.toISOString(), draft.timezone);
  const cycleDays = draft.cadence_weeks * 7;
  const elapsedDays = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${draft.start_date}T00:00:00Z`))
      / 86_400_000
  );
  if (!Number.isFinite(elapsedDays) || elapsedDays < cycleDays) return draft;
  const cycles = Math.floor(elapsedDays / cycleDays);
  return { ...draft, start_date: addLocalDays(draft.start_date, cycles * cycleDays) };
}

export { PlanningInputError } from "./validation.js";
