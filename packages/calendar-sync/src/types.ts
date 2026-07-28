import type { DestinationEditPolicy } from "./destination-edits.js";

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type InstantString = string;
export type LocalDateString = string;
export type LocalTimeString = string;

export interface InstantInterval {
  start: InstantString;
  end: InstantString;
}

export interface LocalInterval {
  start: LocalTimeString;
  end: LocalTimeString;
  end_day_offset: 0 | 1;
}

export interface WeeklyInterval extends LocalInterval {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export type HoursException =
  | { date: LocalDateString; kind: "closed" }
  | { date: LocalDateString; kind: "replace" | "add" | "remove"; intervals: LocalInterval[] };

export interface HoursProfile {
  profile_ref: string;
  revision: number;
  timezone: string;
  dst_resolution: {
    ambiguous: "earlier_offset" | "later_offset";
    nonexistent: "reject" | "shift_forward_by_gap";
  };
  weekly: WeeklyInterval[];
  exceptions: HoursException[];
}

export type HoursMode = "all_times" | "overlaps_profile" | "contained_in_profile";

export interface HoursEvaluationInput {
  mode: HoursMode;
  event: InstantInterval;
  profile?: HoursProfile;
}

export interface HoursEvaluationResult {
  included: boolean;
  reason_code: ReasonCode;
  concrete_intervals: InstantInterval[];
  matched_intervals: InstantInterval[];
  diagnostics: ReasonCode[];
}

/** Materialize a named hours profile over local calendar dates. This is the
 * shared DST-aware primitive used by both bridge filtering and higher-level
 * scheduling features. The end date is exclusive. */
export interface HoursMaterializationInput {
  profile: HoursProfile;
  start_date: LocalDateString;
  end_date_exclusive: LocalDateString;
}

export interface HoursMaterializationResult {
  concrete_intervals: InstantInterval[];
  diagnostics: ReasonCode[];
}

export interface TimedTiming {
  kind: "timed";
  start_instant: InstantString;
  end_instant: InstantString;
  start_tzid: string;
  end_tzid: string;
}

export interface AllDayTiming {
  kind: "all_day";
  start_date: LocalDateString;
  end_date: LocalDateString;
  timezone: string;
}

export type EventTiming = TimedTiming | AllDayTiming;

export interface EventContent {
  summary?: string;
  description?: string;
  location?: string;
  conference?: string;
}

export interface SourceObservation {
  source_event_ref: string;
  source_occurrence_ref: string;
  remote_revision: string;
  lifecycle: "confirmed" | "cancelled" | "deleted";
  origin: "provider_original" | "planipus_managed";
  timing?: EventTiming;
  recurrence?: {
    mode: "materialized_occurrence";
    series_ref: string;
    original_start: InstantString | LocalDateString;
  };
  availability?: "busy" | "free";
  relationship: {
    role: "organizer" | "attendee" | "none";
    response: "accepted" | "tentative" | "declined" | "needs_action" | "not_applicable";
    response_note?: string;
  };
  destination_identity_invited: boolean;
  content: EventContent;
  attendees?: string[];
  organizer?: string;
  attachments?: string[];
  source_url?: string;
  provider_metadata?: Record<string, JsonValue>;
}

export interface PrivacyPolicy {
  preset: "busy_only" | "commitment" | "private_details" | "shared_details";
  preset_version: 1;
  generic_summary: string;
  copy_summary: boolean;
  copy_description: boolean;
  copy_location: boolean;
  copy_conference: boolean;
  copy_attendees: boolean;
  copy_organizer: boolean;
}

export interface SelectionPolicy {
  timed: "include" | "skip";
  all_day: "skip" | "busy_only" | "all";
  free_events: "skip_when_redacted" | "preserve_free" | "force_busy";
  tentative: "busy" | "free" | "omit";
  unanswered: "busy" | "free" | "omit";
  skip_when_destination_identity_invited: boolean;
  source_exclusion_marker: string;
  manual_exclusions: string[];
}

export interface SyncPolicy {
  policy_ref: string;
  revision: number;
  state: "active" | "paused" | "disabled" | "review_required";
  source_calendar_ref: string;
  destination_calendar_ref: string;
  hours: {
    mode: HoursMode;
    profile_ref?: string;
  };
  privacy: PrivacyPolicy;
  selection: SelectionPolicy;
  destination: {
    color?: string;
  };
  /** How direct edits/deletions of managed destination copies are handled.
   * Absent means the notify-by-default behavior; the evaluator ignores this
   * field because destination divergence is observed by verification, not by
   * source evaluation. */
  destination_edits?: DestinationEditPolicy;
}

export interface DestinationCapabilities {
  writable: boolean;
  private_visibility: boolean;
  conference_copy: boolean;
  color: boolean;
}

export interface DesiredCopy {
  timing: EventTiming;
  summary: string;
  description?: string;
  location?: string;
  conference?: string;
  transparency: "opaque" | "transparent";
  visibility: "private" | "default";
  color?: string;
  reminders: [];
  write_controls: {
    send_notifications: false;
  };
  provenance: {
    version: 1;
    policy_ref: string;
    projection_ref: string;
    generation: number;
  };
}

export interface DisclosureManifest {
  version: 1;
  preset: { id: PrivacyPolicy["preset"]; version: 1 };
  source_fields_read: string[];
  source_fields_disclosed: string[];
  destination_fields_written: string[];
  source_fields_omitted: string[];
}

export interface ProjectionInput {
  ownership: "none" | "attached" | "detached" | "ambiguous";
  projection_ref?: string;
  generation?: number;
  destination_event_ref?: string;
  destination_exists?: boolean;
  desired_fingerprint?: string;
  observed_copy?: DesiredCopy;
}

export interface PolicyEvaluationInput {
  now: InstantString;
  horizon: InstantInterval;
  candidate_projection_ref: string;
  policy: SyncPolicy;
  hours_profile?: HoursProfile;
  source: SourceObservation;
  projection: ProjectionInput;
  destination_capabilities: DestinationCapabilities;
}

export type EvaluationSelection = "included" | "excluded" | "held" | "invalid";
export type EvaluationOperation = "create" | "update" | "delete" | "none";

export interface PolicyEvaluationResult {
  selection: EvaluationSelection;
  operation: EvaluationOperation;
  primary_reason_code: ReasonCode;
  reason_codes: ReasonCode[];
  desired_copy?: DesiredCopy;
  desired_fingerprint?: string;
  disclosure_manifest?: DisclosureManifest;
  warnings: ReasonCode[];
}

export type ReasonCode =
  | "policy_disabled"
  | "policy_paused"
  | "policy_review_required"
  | "invalid_same_calendar"
  | "invalid_unwritable_destination"
  | "invalid_hours_profile"
  | "invalid_source_event"
  | "invalid_privacy_transform"
  | "unsupported_destination_capability"
  | "outside_horizon"
  | "source_deleted"
  | "source_cancelled"
  | "managed_copy"
  | "manual_exclusion"
  | "nosync"
  | "already_invited"
  | "timed_event_disabled"
  | "timed_event_included"
  | "all_day"
  | "all_day_free"
  | "all_day_busy_included"
  | "all_day_included"
  | "free"
  | "free_preserved"
  | "free_forced_busy"
  | "rsvp_declined"
  | "rsvp_accepted"
  | "rsvp_tentative_busy"
  | "rsvp_tentative_free"
  | "rsvp_unanswered_busy"
  | "rsvp_unanswered_free"
  | "organizer_assumed_accepted"
  | "rsvp_unanswered_omitted"
  | "rsvp_tentative_omitted"
  | "all_times"
  | "overlaps_hours"
  | "contained_in_hours"
  | "outside_hours"
  | "not_contained_in_hours"
  | "dst_ambiguous_earlier"
  | "dst_ambiguous_later"
  | "dst_nonexistent_shifted"
  | "dst_resolution_rejected"
  | "privacy_busy_only"
  | "privacy_commitment"
  | "privacy_private_details"
  | "privacy_shared_details"
  | "create_missing_copy"
  | "update_source_change"
  | "restore_destination_missing"
  | "restore_destination_drift"
  | "delete_source_removed"
  | "delete_policy_exclusion"
  | "no_change"
  | "detached_no_action"
  | "ambiguous_ownership";
