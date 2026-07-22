import type { HoursProfile, InstantInterval } from "@planipus/calendar-sync";

export type PlanningRuleKind = "availability_boundary" | "smart_meeting";

export interface AvailabilityBoundaryDraft {
  readonly kind: "availability_boundary";
  readonly name: string;
  readonly target_calendar_id: string;
  readonly timezone: string;
  readonly working_days: readonly (1 | 2 | 3 | 4 | 5 | 6 | 7)[];
  readonly workday_start: string;
  readonly workday_end: string;
  readonly protect_before_work: boolean;
  readonly protect_after_work: boolean;
  readonly protect_closed_days: boolean;
  readonly title: string;
  readonly visibility: "private" | "default";
  readonly horizon_days: number;
}

export interface SmartMeetingAttendee {
  readonly email: string;
  readonly required: boolean;
  readonly availability_calendar_id?: string;
}

export interface SmartMeetingDraft {
  readonly kind: "smart_meeting";
  readonly name: string;
  readonly target_calendar_id: string;
  readonly timezone: string;
  readonly start_date: string;
  readonly weekdays: readonly (1 | 2 | 3 | 4 | 5 | 6 | 7)[];
  readonly window_start: string;
  readonly window_end: string;
  readonly preferred_time: string;
  readonly cadence_weeks: number;
  readonly occurrence_count: number;
  readonly minimum_duration_minutes: number;
  readonly maximum_duration_minutes: number;
  readonly start_step_minutes: 15 | 30 | 60;
  readonly priority: 1 | 2 | 3 | 4;
  readonly attendees: readonly SmartMeetingAttendee[];
  readonly availability_calendar_ids: readonly string[];
  readonly conflict_policy: "suggest" | "auto_move" | "keep_with_warning";
  readonly lock_before_minutes: number;
  readonly description?: string;
  readonly location?: string;
  readonly visibility: "private" | "default";
}

export type PlanningDraft = AvailabilityBoundaryDraft | SmartMeetingDraft;

export interface PlanningBusyInterval extends InstantInterval {
  readonly calendar_id: string;
}

export interface ManagedPlanningEvent {
  readonly timing: {
    readonly start_instant: string;
    readonly end_instant: string;
    readonly timezone: string;
  };
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly transparency: "opaque" | "transparent";
  readonly visibility: "private" | "default";
  readonly attendees: readonly { readonly email: string; readonly optional: boolean }[];
  readonly reminders: readonly [];
  readonly write_controls: { readonly send_updates: boolean };
  readonly provenance: {
    readonly version: 1;
    readonly kind: PlanningRuleKind;
    readonly rule_ref: string;
    readonly planned_event_ref: string;
    readonly occurrence_key: string;
    readonly generation: number;
    readonly intent_sequence: number;
  };
}

export interface PlannedOccurrenceTemplate {
  readonly occurrence_key: string;
  readonly decision: "schedule" | "unmet";
  readonly reason_code: string;
  readonly event?: Omit<ManagedPlanningEvent, "provenance">;
  readonly rejected_candidate_count: number;
}

export interface PlanningResult {
  readonly kind: PlanningRuleKind;
  readonly occurrences: readonly PlannedOccurrenceTemplate[];
  readonly scheduled_count: number;
  readonly unmet_count: number;
  readonly warnings: readonly string[];
  readonly hours_summary: string;
}

export interface PlanningInput {
  readonly draft: PlanningDraft;
  readonly now: string;
  readonly busy: readonly PlanningBusyInterval[];
  readonly known_availability_calendar_ids: readonly string[];
}

export interface StoredHoursProfile {
  readonly id: string;
  readonly name: string;
  readonly profile: HoursProfile;
}
