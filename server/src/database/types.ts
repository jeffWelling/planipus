import type { ColumnType, Generated, JSONColumnType } from "kysely";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type GeneratedNullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
// PostgreSQL jsonb values used by this schema are documents (objects or arrays),
// never top-level scalar values. `object` keeps strongly typed domain documents
// insertable without weakening the whole database surface to `any`.
// node-postgres serializes a top-level JavaScript Array as a PostgreSQL array
// literal, which jsonb rejects. Array-shaped documents are therefore inserted
// as explicit JSON text while reads remain parsed objects/arrays.
type Json = JSONColumnType<object, object | string, object | string>;

export interface OrganizationTable {
  id: string;
  slug: string;
  name: string;
  default_timezone: string;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface PrincipalTable {
  id: string;
  email_normalized: string;
  display_name: string;
  status: "active" | "disabled";
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface MembershipTable {
  organization_id: string;
  principal_id: string;
  role: "owner" | "member";
  created_at: GeneratedTimestamp;
}

export interface BrowserSessionTable {
  id: string;
  principal_id: string;
  organization_id: string;
  token_hash: string;
  expires_at: Timestamp;
  last_seen_at: Timestamp;
  revoked_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

export interface OAuthTransactionTable {
  id: string;
  principal_id: string;
  organization_id: string;
  state_hash: string;
  verifier_envelope: Json;
  intent_envelope: Json;
  redirect_uri: string;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

export interface ProviderConnectionTable {
  id: string;
  organization_id: string;
  owner_principal_id: string;
  provider: "google" | "fake";
  remote_subject: string;
  account_label: string;
  display_label: string;
  intended_role: "source" | "destination" | "both";
  email_masked: string;
  credential_envelope: Json;
  key_version: string;
  scopes: Json;
  status: "active" | "action_required" | "revoked";
  last_success_at: Timestamp | null;
  safe_error_code: string | null;
  version: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface CalendarEndpointTable {
  id: string;
  organization_id: string;
  connection_id: string;
  remote_id: string;
  name: string;
  timezone: string;
  access_role: string;
  readable: boolean;
  writable: boolean;
  primary_calendar: boolean;
  capabilities: Json;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface HoursProfileTable {
  id: string;
  organization_id: string;
  name: string;
  timezone: string;
  dst_resolution: Json;
  weekly_intervals: Json;
  exceptions: Json;
  version: Generated<number>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface SyncPolicyTable {
  id: string;
  organization_id: string;
  name: string;
  source_calendar_id: string;
  destination_calendar_id: string;
  hours_profile_id: string | null;
  status: "active" | "paused" | "deleted";
  revision: number;
  policy_document: Json;
  policy_hash: string;
  last_success_at: Timestamp | null;
  safe_error_code: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface PolicyPreviewTable {
  id: string;
  organization_id: string;
  principal_id: string;
  policy_document: Json;
  policy_hash: string;
  source_cursor_fingerprint: string;
  result_document: Json;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

export interface SourceObservationTable {
  id: string;
  organization_id: string;
  calendar_endpoint_id: string;
  remote_event_id: string;
  recurrence_identity: string;
  remote_etag: string | null;
  normalized_event: Json;
  observation_hash: string;
  managed_copy: boolean;
  tombstone: boolean;
  sync_generation: number;
  observed_at: Timestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface SyncCursorTable {
  id: string;
  organization_id: string;
  calendar_endpoint_id: string;
  query_fingerprint: string;
  sync_token: string | null;
  generation: number;
  state: "full_required" | "syncing" | "ready" | "action_required";
  last_started_at: Timestamp | null;
  last_full_sync_at: Timestamp | null;
  last_success_at: Timestamp | null;
  safe_error_code: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ProjectionTable {
  id: string;
  organization_id: string;
  policy_id: string;
  policy_revision: number;
  source_observation_id: string;
  source_basis_hash: Generated<string | null>;
  recovery_operation: Generated<"create" | "update" | "delete" | null>;
  recurrence_identity: string;
  destination_calendar_id: string;
  destination_event_id: string | null;
  destination_etag: string | null;
  generation: number;
  intent_sequence: number;
  desired_hash: string | null;
  desired_state: Json | null;
  status: string;
  ownership: "attached" | "detached" | "ambiguous";
  last_success_at: Timestamp | null;
  last_verified_at: GeneratedNullableTimestamp;
  safe_error_code: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface OutboxEffectTable {
  id: string;
  organization_id: string;
  policy_id: string;
  projection_id: string;
  source_basis_hash: Generated<string | null>;
  policy_revision: number;
  operation: "create" | "update" | "delete";
  idempotency_key: string;
  desired_state: Json | null;
  state: "pending" | "leased" | "retry" | "succeeded" | "dead";
  attempt_count: number;
  run_after: Timestamp;
  lease_owner: string | null;
  lease_expires_at: Timestamp | null;
  ambiguous: boolean;
  safe_error_code: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ScheduledJobTable {
  id: string;
  organization_id: string;
  kind: string;
  dedupe_key: string;
  payload: Json;
  state: "pending" | "leased" | "retry" | "succeeded" | "dead";
  attempt_count: number;
  run_after: Timestamp;
  lease_owner: string | null;
  lease_expires_at: Timestamp | null;
  safe_error_code: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ProviderSubscriptionTable {
  id: string;
  organization_id: string;
  calendar_endpoint_id: string;
  channel_id: string;
  resource_id: string | null;
  token_hash: string;
  expires_at: Timestamp | null;
  status: string;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface SyncNoticeTable {
  id: string;
  organization_id: string;
  policy_id: string;
  projection_id: string;
  kind: "copy_edit_reverted" | "copy_delete_restored" | "copy_edit_held" | "copy_delete_held";
  status: Generated<"unread" | "acknowledged" | "resolved">;
  resolution: "restore" | "keep_and_detach" | null;
  detail: Json;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface AuditFactTable {
  id: string;
  organization_id: string;
  principal_id: string | null;
  actor_kind: "user" | "sync" | "recovery";
  action: string;
  target_type: string;
  target_id: string;
  reason_code: string;
  before_hash: string | null;
  after_hash: string | null;
  detail: Json;
  created_at: GeneratedTimestamp;
}

export interface PlanningPreviewTable {
  id: string;
  organization_id: string;
  principal_id: string;
  rule_kind: "availability_boundary" | "smart_meeting";
  draft_document: Json;
  draft_hash: string;
  input_snapshot_hash: string;
  result_document: Json;
  planning_reference_at: Timestamp;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: GeneratedTimestamp;
}

export interface PlanningRuleTable {
  id: string;
  organization_id: string;
  owner_principal_id: string;
  kind: "availability_boundary" | "smart_meeting";
  name: string;
  target_calendar_id: string;
  status: "active" | "paused" | "deleting" | "deleted";
  revision: number;
  rule_document: Json;
  rule_hash: string;
  last_planned_at: Timestamp | null;
  last_success_at: Timestamp | null;
  safe_error_code: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface PlannedEventTable {
  id: string;
  organization_id: string;
  rule_id: string;
  rule_revision: number;
  occurrence_key: string;
  destination_calendar_id: string;
  generation: number;
  intent_sequence: number;
  destination_event_id: string | null;
  destination_etag: string | null;
  desired_hash: string | null;
  desired_state: Json | null;
  status:
    | "pending_create"
    | "pending_update"
    | "pending_delete"
    | "converged"
    | "held"
    | "unmet"
    | "skipped"
    | "deleted";
  send_updates: boolean;
  reason_code: string;
  last_success_at: Timestamp | null;
  last_verified_at: Timestamp | null;
  safe_error_code: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface PlanningSuggestionTable {
  id: string;
  organization_id: string;
  rule_id: string;
  planned_event_id: string;
  kind: "move" | "shorten" | "skip";
  basis_hash: string;
  proposed_state: Json | null;
  reason_code: string;
  status: "pending" | "accepted" | "dismissed" | "expired";
  expires_at: Timestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface DatabaseSchema {
  organizations: OrganizationTable;
  principals: PrincipalTable;
  memberships: MembershipTable;
  browser_sessions: BrowserSessionTable;
  oauth_transactions: OAuthTransactionTable;
  provider_connections: ProviderConnectionTable;
  calendar_endpoints: CalendarEndpointTable;
  hours_profiles: HoursProfileTable;
  sync_policies: SyncPolicyTable;
  policy_previews: PolicyPreviewTable;
  source_observations: SourceObservationTable;
  sync_cursors: SyncCursorTable;
  projections: ProjectionTable;
  outbox_effects: OutboxEffectTable;
  scheduled_jobs: ScheduledJobTable;
  provider_subscriptions: ProviderSubscriptionTable;
  sync_notices: SyncNoticeTable;
  audit_facts: AuditFactTable;
  planning_previews: PlanningPreviewTable;
  planning_rules: PlanningRuleTable;
  planned_events: PlannedEventTable;
  planning_suggestions: PlanningSuggestionTable;
}
