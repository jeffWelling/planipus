import type { SourceObservation } from "@planipus/calendar-sync";

export const DEFAULT_DECLINE_MESSAGE =
  "I have a private conflict at that time. Please choose another time.";
export const DEFAULT_CONFLICT_HORIZON_DAYS = 60;
export const MAX_AVAILABILITY_CALENDARS = 32;
export const MAX_AUTOMATIC_DECLINES_PER_24_HOURS = 20;

/**
 * A no-copy conflict-response rule. Availability calendars are read only
 * through the provider's free/busy endpoint; their event records are never
 * materialized into this aggregate.
 */
export interface ConflictResponseDraft {
  readonly name: string;
  readonly response_calendar_id: string;
  readonly availability_calendar_ids: readonly string[];
  readonly decline_message: string;
  readonly horizon_days: number;
}

export interface ConflictTimeExample {
  readonly start_at: string;
  readonly end_at: string;
}

export interface ConflictResponsePreviewResult {
  /** Future, unanswered, timed invitations on the response calendar. */
  readonly invitation_count: number;
  /** Invitations that overlap at least one opaque free/busy interval. */
  readonly conflict_count: number;
  /** Conflicts held for a missing revision guard or rolling-budget overflow. */
  readonly held_count: number;
  /** Subset of held conflicts exceeding the provider-calendar rolling budget. */
  readonly budget_held_count: number;
  /** Deliberately time-only: no title, event ID, or personal event detail. */
  readonly examples: readonly ConflictTimeExample[];
  readonly warnings: readonly string[];
}

export interface ConflictResponsePreviewDocument extends ConflictResponsePreviewResult {
  readonly preview_token: string;
  readonly expires_at: string;
  readonly provider_writes_enabled: boolean;
  readonly message_delivery: "simulated" | "unverified_google";
}

export interface ConflictResponseRuleDocument {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "paused";
  readonly response_calendar_id: string;
  readonly response_calendar_name: string;
  readonly availability_calendar_count: number;
  readonly decline_message: string;
  readonly horizon_days: number;
  readonly pending_count: number;
  readonly declined_count: number;
  readonly held_count: number;
  readonly last_evaluated_at: string | null;
  readonly last_success_at: string | null;
  readonly safe_error_code: string | null;
  readonly provider_writes_enabled: boolean;
  readonly message_delivery: "simulated" | "unverified_google";
}

/** The minimum work-side data needed to decide whether an RSVP is safe. */
export interface WorkInvitationCandidate {
  readonly observation_id: string;
  readonly remote_event_id: string;
  readonly recurrence_identity: string;
  readonly observation_hash: string;
  readonly remote_revision: string | null;
  readonly start_at: string;
  readonly end_at: string;
}

export interface WorkObservationRow {
  readonly id: string;
  readonly remote_event_id: string;
  readonly recurrence_identity: string;
  readonly remote_etag: string | null;
  readonly observation_hash: string;
  readonly normalized_event: unknown;
}

export interface ConflictBusyInterval {
  /** A local calendar endpoint identity, never a personal event identity. */
  readonly calendar_id: string;
  readonly start: string;
  readonly end: string;
}

export interface ConflictCalendarBinding {
  readonly id: string;
  readonly connection_id: string;
  readonly remote_id: string;
  readonly name: string;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly capabilities?: unknown;
  readonly scopes?: unknown;
  readonly provider: "google" | "fake";
  readonly connection_status: string;
  readonly intended_role: string;
}

export interface ConflictResponsePreparedInput {
  readonly response_calendar: ConflictCalendarBinding;
  readonly availability_calendars: readonly ConflictCalendarBinding[];
  readonly invitations: readonly WorkInvitationCandidate[];
  readonly busy: readonly ConflictBusyInterval[];
  readonly conflicts: readonly {
    readonly invitation: WorkInvitationCandidate;
    readonly overlapping_busy: readonly ConflictBusyInterval[];
  }[];
  readonly snapshot_hash: string;
  readonly result: ConflictResponsePreviewResult;
}

export type ConflictResponseActorKind = "user" | "api_token";

export function asSourceObservation(value: unknown): SourceObservation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as SourceObservation;
}
