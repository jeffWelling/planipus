import type { Kysely } from "kysely";

import { lockProtectedSourceCalendars } from "../calendar-protection-lock.js";
import type { DatabaseSchema } from "../database/types.js";
import { isUuid, newId } from "../foundation.js";
import { PostgresJobQueue } from "../jobs/queue.js";
import type { PolicyRuntime } from "../policy/runtime.js";
import type { AccessTokenBroker } from "../providers/router.js";
import { ProviderRouter } from "../providers/router.js";
import {
  loadConflictCalendarSelection,
  prepareConflictResponseInput,
  requireNoCopyPolicies
} from "./inputs.js";
import {
  providerCalendarIdentity,
  providerCalendarProtectionKey
} from "../providers/calendar-identity.js";
import type {
  ConflictResponseActorKind,
  ConflictResponsePreviewDocument,
  ConflictResponseRuleDocument
} from "./types.js";
import { ConflictResponseInputError, parseConflictResponseDraft } from "./validation.js";
import type { PrivateAvailabilityHasher } from "./privacy-hash.js";

const PREVIEW_LIFETIME_MILLISECONDS = 10 * 60_000;
const MAX_ACTIVE_PREVIEWS_PER_PRINCIPAL = 10;

export interface ConflictResponseCapabilities {
  readonly providerWritesEnabled: boolean;
  readonly messageDelivery: "simulated" | "unverified_google";
}

const SAFE_DEFAULT_CAPABILITIES: ConflictResponseCapabilities = {
  providerWritesEnabled: false,
  messageDelivery: "unverified_google"
};

export class ConflictResponseService {
  private readonly jobs: PostgresJobQueue;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly runtime: Pick<PolicyRuntime, "hash">,
    private readonly privateHasher: PrivateAvailabilityHasher,
    private readonly providers: ProviderRouter,
    private readonly tokens: AccessTokenBroker,
    private readonly capabilities: ConflictResponseCapabilities = SAFE_DEFAULT_CAPABILITIES
  ) {
    this.jobs = new PostgresJobQueue(db);
  }

  public async preview(
    organizationId: string,
    principalId: string,
    input: unknown,
    now = new Date()
  ): Promise<ConflictResponsePreviewDocument> {
    const activePreviews = await this.db.selectFrom("conflict_response_previews")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("organization_id", "=", organizationId)
      .where("principal_id", "=", principalId)
      .where("consumed_at", "is", null)
      .where("expires_at", ">", now)
      .executeTakeFirstOrThrow();
    if (Number(activePreviews.count) >= MAX_ACTIVE_PREVIEWS_PER_PRINCIPAL) {
      throw new ConflictResponseInputError(
        "preview_rate_limited",
        "too many active conflict-response previews"
      );
    }
    const draft = parseConflictResponseDraft(input);
    const prepared = await prepareConflictResponseInput(
      this.db,
      this.runtime,
      this.privateHasher,
      { providers: this.providers, tokens: this.tokens },
      organizationId,
      draft,
      now
    );
    const id = newId();
    const expiresAt = new Date(now.getTime() + PREVIEW_LIFETIME_MILLISECONDS);
    await this.db.insertInto("conflict_response_previews").values({
      id,
      organization_id: organizationId,
      principal_id: principalId,
      draft_document: draft,
      draft_hash: this.runtime.hash(draft),
      input_snapshot_hash: prepared.snapshot_hash,
      result_document: prepared.result,
      reference_at: now,
      expires_at: expiresAt,
      consumed_at: null
    }).executeTakeFirstOrThrow();
    return {
      ...prepared.result,
      warnings: [
        ...prepared.result.warnings,
        ...(!this.capabilities.providerWritesEnabled ? ["invitation_writes_disabled"] : []),
        ...(this.capabilities.messageDelivery === "unverified_google"
          ? ["decline_message_delivery_unverified"]
          : [])
      ],
      preview_token: id,
      expires_at: expiresAt.toISOString(),
      provider_writes_enabled: this.capabilities.providerWritesEnabled,
      message_delivery: this.capabilities.messageDelivery
    };
  }

  public async activate(
    organizationId: string,
    principalId: string,
    previewId: string,
    now = new Date(),
    actorKind: ConflictResponseActorKind = "user",
    actorTokenId: string | null = null
  ): Promise<{ readonly id: string }> {
    requireLocalId(previewId, "preview token");
    if (!this.capabilities.providerWritesEnabled) {
      throw new ConflictResponseInputError(
        "invitation_writes_disabled",
        "provider invitation writes are disabled for this installation"
      );
    }
    return this.db.transaction().execute(async (transaction) => {
      const preview = await transaction.selectFrom("conflict_response_previews")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("principal_id", "=", principalId)
        .where("id", "=", previewId)
        .forUpdate()
        .executeTakeFirst();
      if (!preview || preview.consumed_at || preview.expires_at <= now) {
        throw new ConflictResponseInputError(
          "preview_stale",
          "the conflict-response preview expired or was already used"
        );
      }
      const draft = parseConflictResponseDraft(preview.draft_document);
      if (this.runtime.hash(draft) !== preview.draft_hash) {
        throw new ConflictResponseInputError("preview_stale", "the stored preview is no longer valid");
      }
      const selectedCalendars = await loadConflictCalendarSelection(
        transaction,
        organizationId,
        draft
      );
      const responseProviderIdentity = providerCalendarIdentity(selectedCalendars.response);
      await lockProtectedSourceCalendars(
        transaction,
        organizationId,
        [
          `response-provider:${responseProviderIdentity}`,
          draft.response_calendar_id,
          ...draft.availability_calendar_ids,
          ...selectedCalendars.availability.map((calendar) =>
            providerCalendarProtectionKey(providerCalendarIdentity(calendar))
          )
        ]
      );
      const existingResponseRule = await transaction.selectFrom("conflict_response_rules")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where("response_provider_identity", "=", responseProviderIdentity)
        .where("status", "!=", "deleted")
        .limit(1)
        .executeTakeFirst();
      if (existingResponseRule) {
        throw new ConflictResponseInputError(
          "response_rule_conflict",
          "the response calendar already has a conflict-response rule"
        );
      }
      const prepared = await prepareConflictResponseInput(
        transaction,
        this.runtime,
        this.privateHasher,
        { providers: this.providers, tokens: this.tokens },
        organizationId,
        draft,
        preview.reference_at
      );
      if (prepared.snapshot_hash !== preview.input_snapshot_hash) {
        throw new ConflictResponseInputError(
          "preview_stale",
          "calendar invitations or private availability changed after the preview"
        );
      }
      if (prepared.conflicts.some(({ invitation }) => Date.parse(invitation.start_at) <= now.getTime())) {
        throw new ConflictResponseInputError(
          "preview_stale",
          "a conflicting invitation has already started"
        );
      }
      const ruleId = newId();
      const ruleHash = this.runtime.hash(draft);
      await transaction.insertInto("conflict_response_rules").values({
        id: ruleId,
        organization_id: organizationId,
        owner_principal_id: principalId,
        name: draft.name,
        response_calendar_id: draft.response_calendar_id,
        response_provider_identity: responseProviderIdentity,
        status: "active",
        revision: 1,
        rule_document: draft,
        rule_hash: ruleHash,
        last_evaluated_at: null,
        last_success_at: null,
        safe_error_code: null
      }).executeTakeFirstOrThrow();
      for (const calendar of selectedCalendars.availability) {
        await transaction.insertInto("conflict_response_availability_calendars").values({
          organization_id: organizationId,
          rule_id: ruleId,
          calendar_endpoint_id: calendar.id,
          provider_calendar_identity: providerCalendarIdentity(calendar)
        }).executeTakeFirstOrThrow();
      }
      await transaction.updateTable("conflict_response_previews")
        .set({ consumed_at: now })
        .where("id", "=", previewId)
        .executeTakeFirstOrThrow();
      await this.jobs.enqueue(
        organizationId,
        "reconcile_conflict_response_rule",
        `conflict-response-rule:${ruleId}:revision:1`,
        { rule_id: ruleId },
        now,
        transaction
      );
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: actorKind,
        action: "conflict_response_rule.activated",
        target_type: "conflict_response_rule",
        target_id: ruleId,
        reason_code: "preview_confirmed",
        before_hash: null,
        after_hash: ruleHash,
        detail: auditActorDetail({
          invitation_count: prepared.result.invitation_count,
          conflict_count: prepared.result.conflict_count,
          availability_calendar_count: draft.availability_calendar_ids.length,
          no_copy: true
        }, actorKind, actorTokenId)
      }).executeTakeFirstOrThrow();
      return { id: ruleId };
    }).catch((error: unknown) => {
      if (isLiveResponseRuleUniquenessError(error)) {
        throw new ConflictResponseInputError(
          "response_rule_conflict",
          "the response calendar already has a conflict-response rule"
        );
      }
      throw error;
    });
  }

  public async list(organizationId: string): Promise<readonly ConflictResponseRuleDocument[]> {
    const [rules, availabilityCounts, actionCounts] = await Promise.all([
      this.db.selectFrom("conflict_response_rules")
        .innerJoin("calendar_endpoints", "calendar_endpoints.id", "conflict_response_rules.response_calendar_id")
        .select([
          "conflict_response_rules.id",
          "conflict_response_rules.name",
          "conflict_response_rules.status",
          "conflict_response_rules.response_calendar_id",
          "conflict_response_rules.rule_document",
          "conflict_response_rules.last_evaluated_at",
          "conflict_response_rules.last_success_at",
          "conflict_response_rules.safe_error_code",
          "calendar_endpoints.name as response_calendar_name"
        ])
        .where("conflict_response_rules.organization_id", "=", organizationId)
        .where("conflict_response_rules.status", "!=", "deleted")
        .orderBy("conflict_response_rules.created_at", "asc")
        .execute(),
      this.db.selectFrom("conflict_response_availability_calendars")
        .select([
          "rule_id",
          (expression) => expression.fn.countAll<number>().as("calendar_count")
        ])
        .where("organization_id", "=", organizationId)
        .groupBy("rule_id")
        .execute(),
      this.db.selectFrom("invitation_response_actions")
        .select([
          "rule_id",
          "status",
          (expression) => expression.fn.countAll<number>().as("action_count")
        ])
        .where("organization_id", "=", organizationId)
        .groupBy(["rule_id", "status"])
        .execute()
    ]);
    const calendarsByRule = new Map(
      availabilityCounts.map((row) => [row.rule_id, Number(row.calendar_count)])
    );
    const actionsByRule = new Map<string, Map<string, number>>();
    for (const row of actionCounts) {
      const counts = actionsByRule.get(row.rule_id) ?? new Map<string, number>();
      counts.set(row.status, Number(row.action_count));
      actionsByRule.set(row.rule_id, counts);
    }
    return rules.map((rule) => {
      const draft = parseConflictResponseDraft(rule.rule_document);
      const counts = actionsByRule.get(rule.id);
      return {
        id: rule.id,
        name: rule.name,
        status: rule.status === "paused" ? "paused" : "active",
        response_calendar_id: rule.response_calendar_id,
        response_calendar_name: rule.response_calendar_name,
        availability_calendar_count: calendarsByRule.get(rule.id) ?? 0,
        decline_message: draft.decline_message,
        horizon_days: draft.horizon_days,
        pending_count: counts?.get("pending") ?? 0,
        declined_count: counts?.get("applied") ?? 0,
        held_count: counts?.get("held") ?? 0,
        last_evaluated_at: isoOrNull(rule.last_evaluated_at),
        last_success_at: isoOrNull(rule.last_success_at),
        safe_error_code: rule.safe_error_code,
        provider_writes_enabled: this.capabilities.providerWritesEnabled,
        message_delivery: this.capabilities.messageDelivery
      };
    });
  }

  public async setPaused(
    organizationId: string,
    principalId: string,
    id: string,
    paused: boolean,
    now = new Date(),
    actorKind: ConflictResponseActorKind = "user",
    actorTokenId: string | null = null
  ): Promise<void> {
    requireLocalId(id, "conflict-response rule");
    if (!paused && !this.capabilities.providerWritesEnabled) {
      throw new ConflictResponseInputError(
        "invitation_writes_disabled",
        "provider invitation writes are disabled for this installation"
      );
    }
    await this.db.transaction().execute(async (transaction) => {
      const rule = await transaction.selectFrom("conflict_response_rules")
        .select(["revision", "rule_hash", "status", "rule_document"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", id)
        .where("status", "!=", "deleted")
        .forUpdate()
        .executeTakeFirst();
      if (!rule) {
        throw new ConflictResponseInputError("not_found", "conflict-response rule was not found");
      }
      if (!paused) {
        const draft = parseConflictResponseDraft(rule.rule_document);
        const selectedCalendars = await loadConflictCalendarSelection(
          transaction,
          organizationId,
          draft
        );
        const responseProviderIdentity = providerCalendarIdentity(selectedCalendars.response);
        await lockProtectedSourceCalendars(
          transaction,
          organizationId,
          [
            `response-provider:${responseProviderIdentity}`,
            draft.response_calendar_id,
            ...draft.availability_calendar_ids,
            ...selectedCalendars.availability.map((calendar) =>
              providerCalendarProtectionKey(providerCalendarIdentity(calendar))
            )
          ]
        );
        await requireNoCopyPolicies(
          transaction,
          organizationId,
          selectedCalendars.availability
        );
      }
      const nextStatus = paused ? "paused" : "active";
      await transaction.updateTable("conflict_response_rules").set({
        status: nextStatus,
        safe_error_code: null,
        updated_at: now
      }).where("organization_id", "=", organizationId).where("id", "=", id).executeTakeFirstOrThrow();
      if (paused) {
        await transaction.updateTable("invitation_response_actions").set({
          status: "held",
          safe_error_code: "rule_paused",
          updated_at: now
        }).where("organization_id", "=", organizationId)
          .where("rule_id", "=", id)
          .where("status", "=", "pending")
          .execute();
      } else {
        await this.jobs.enqueue(
          organizationId,
          "reconcile_conflict_response_rule",
          `conflict-response-rule:${id}:revision:${rule.revision}`,
          { rule_id: id },
          now,
          transaction
        );
      }
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: actorKind,
        action: paused ? "conflict_response_rule.paused" : "conflict_response_rule.resumed",
        target_type: "conflict_response_rule",
        target_id: id,
        reason_code: "user_command",
        before_hash: rule.rule_hash,
        after_hash: rule.rule_hash,
        detail: auditActorDetail(
          { previous_status: rule.status, status: nextStatus },
          actorKind,
          actorTokenId
        )
      }).executeTakeFirstOrThrow();
    });
  }

  public async requestReconcile(
    organizationId: string,
    id: string,
    principalId: string,
    now = new Date(),
    actorKind: ConflictResponseActorKind = "user",
    actorTokenId: string | null = null
  ): Promise<string | null> {
    requireLocalId(id, "conflict-response rule");
    return this.db.transaction().execute(async (transaction) => {
      const rule = await transaction.selectFrom("conflict_response_rules")
        .select(["id", "revision", "status", "rule_hash"])
        .where("organization_id", "=", organizationId)
        .where("id", "=", id)
        .where("status", "!=", "deleted")
        .executeTakeFirst();
      if (!rule) {
        throw new ConflictResponseInputError("not_found", "conflict-response rule was not found");
      }
      if (rule.status !== "active") {
        throw new ConflictResponseInputError("rule_paused", "resume the rule before reconciling it");
      }
      const job = await this.jobs.enqueue(
        organizationId,
        "reconcile_conflict_response_rule",
        `conflict-response-rule:${id}:revision:${rule.revision}`,
        { rule_id: id },
        now,
        transaction
      );
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: actorKind,
        action: "conflict_response_rule.reconcile_requested",
        target_type: "conflict_response_rule",
        target_id: id,
        reason_code: "user_command",
        before_hash: rule.rule_hash,
        after_hash: rule.rule_hash,
        detail: auditActorDetail({ enqueued: job !== null }, actorKind, actorTokenId)
      }).executeTakeFirstOrThrow();
      return job;
    });
  }

  public async remove(
    organizationId: string,
    principalId: string,
    id: string,
    now = new Date(),
    actorKind: ConflictResponseActorKind = "user",
    actorTokenId: string | null = null
  ): Promise<void> {
    requireLocalId(id, "conflict-response rule");
    await this.db.transaction().execute(async (transaction) => {
      const rule = await transaction.selectFrom("conflict_response_rules")
        .select([
          "status",
          "rule_hash",
          "response_calendar_id",
          "response_provider_identity"
        ])
        .where("organization_id", "=", organizationId)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      if (!rule) {
        throw new ConflictResponseInputError("not_found", "conflict-response rule was not found");
      }
      if (rule.status === "deleted") return;
      const availability = await transaction
        .selectFrom("conflict_response_availability_calendars")
        .select(["calendar_endpoint_id", "provider_calendar_identity"])
        .where("organization_id", "=", organizationId)
        .where("rule_id", "=", id)
        .execute();
      await lockProtectedSourceCalendars(
        transaction,
        organizationId,
        [
          `response-provider:${rule.response_provider_identity}`,
          rule.response_calendar_id,
          ...availability.map((row) => row.calendar_endpoint_id),
          ...availability.map((row) =>
            providerCalendarProtectionKey(row.provider_calendar_identity)
          )
        ]
      );
      await transaction.updateTable("invitation_response_actions").set({
        status: "superseded",
        safe_error_code: "rule_deleted",
        updated_at: now
      }).where("organization_id", "=", organizationId)
        .where("rule_id", "=", id)
        .where("status", "in", ["pending", "held"])
        .execute();
      await transaction.updateTable("conflict_response_rules").set({
        status: "deleted",
        safe_error_code: null,
        updated_at: now
      }).where("organization_id", "=", organizationId)
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: actorKind,
        action: "conflict_response_rule.deleted",
        target_type: "conflict_response_rule",
        target_id: id,
        reason_code: "user_command",
        before_hash: rule.rule_hash,
        after_hash: null,
        detail: auditActorDetail(
          { pending_actions_superseded: true },
          actorKind,
          actorTokenId
        )
      }).executeTakeFirstOrThrow();
    });
  }
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function requireLocalId(value: string, field: string): void {
  if (!isUuid(value)) {
    throw new ConflictResponseInputError(
      "invalid_request",
      `${field} identifier is invalid`
    );
  }
}

function isLiveResponseRuleUniquenessError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23505"
    && "constraint" in error
    && (
      error.constraint === "conflict_response_rules_one_live_response_idx"
      || error.constraint === "conflict_response_rules_one_live_provider_idx"
    );
}

function auditActorDetail(
  detail: Readonly<Record<string, unknown>>,
  actorKind: ConflictResponseActorKind,
  actorTokenId: string | null
): Readonly<Record<string, unknown>> {
  return actorKind === "api_token" && actorTokenId
    ? { ...detail, api_token_id: actorTokenId }
    : detail;
}
