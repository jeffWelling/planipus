export type StatusTone = "current" | "syncing" | "delayed" | "paused" | "attention";

export interface Session {
  authenticated: boolean;
  csrfToken?: string;
  displayName?: string;
}

export interface CalendarEndpoint {
  id: string;
  connectionId: string;
  name: string;
  primary: boolean;
  readable: boolean;
  freeBusyReadable: boolean;
  writable: boolean;
  timeZone: string;
}

export interface Connection {
  id: string;
  label: string;
  maskedEmail: string;
  role: "availability" | "source" | "destination" | "both";
  status: "connected" | "attention" | "revoked";
  lastSuccessAt?: string;
  calendars: CalendarEndpoint[];
}

export interface Bridge {
  id: string;
  sourceLabel: string;
  sourceCalendar: string;
  destinationLabel: string;
  destinationCalendar: string;
  hoursLabel: string;
  privacyLabel: string;
  status: StatusTone;
  managedCopyCount: number;
  lastSuccessAt?: string;
}

export type SyncNoticeKind =
  | "copy_edit_reverted"
  | "copy_delete_restored"
  | "copy_edit_held"
  | "copy_delete_held";

export interface SyncNotice {
  id: string;
  kind: SyncNoticeKind;
  status: "unread" | "acknowledged" | "resolved";
  resolution?: "restore" | "keep_and_detach";
  policyId: string;
  policyName: string;
  destinationCalendar: string;
  destinationEventId?: string;
  requiresDecision: boolean;
  copySummary?: string;
  copyStartAt?: string;
  copyEndAt?: string;
  copyAllDay?: boolean;
  createdAt: string;
}

export interface Overview {
  installationName: string;
  status: StatusTone;
  lastSuccessAt?: string;
  pendingEffectCount: number;
  openNoticeCount: number;
  connections: Connection[];
  bridges: Bridge[];
  recentActivity: Array<{
    id: string;
    message: string;
    reason: string;
    occurredAt: string;
  }>;
}

export interface PreviewRequest {
  sourceCalendarId: string;
  destinationCalendarId: string;
  hoursMode: "all_times" | "overlaps_profile" | "contained_in_profile";
  timeZone: string;
  privacyPreset: "busy_only" | "commitment" | "private_details" | "shared_details";
  genericLabel: string;
  weekdayStart: string;
  weekdayEnd: string;
}

export interface Preview {
  id: string;
  expiresAt: string;
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  excluded: number;
  excludedByReason: Array<{ reason: string; count: number }>;
  sample: {
    summary: string;
    visibility: string;
    transparency: string;
    disclosedFields: string[];
  };
}

export interface Capabilities {
  calendarBridges: "alpha" | "unavailable";
  availabilityProtection: "alpha" | "unavailable";
  smartMeetings: "alpha" | "unavailable";
  conflictAutoDecline: "alpha" | "unavailable";
  conflictAutoDeclineProviderWrites: boolean;
  conflictDeclineMessageDelivery: "simulated" | "unverified_google";
  apiServer: "alpha" | "unavailable";
  mcpServer: "alpha" | "unavailable";
}

export interface ConflictResponseDraft {
  name: string;
  response_calendar_id: string;
  availability_calendar_ids: string[];
  decline_message: string;
  horizon_days: number;
}

export interface ConflictResponsePreview {
  previewToken: string;
  expiresAt: string;
  invitationCount: number;
  conflictCount: number;
  heldCount: number;
  budgetHeldCount: number;
  examples: Array<{
    startAt: string;
    endAt: string;
  }>;
  warnings: string[];
  providerWritesEnabled: boolean;
  messageDelivery: "simulated" | "unverified_google";
}

export interface ConflictResponseRule {
  id: string;
  name: string;
  status: "active" | "paused";
  responseCalendarId: string;
  responseCalendarName?: string;
  availabilityCalendarIds: string[];
  availabilityCalendarCount: number;
  declineMessage: string;
  horizonDays: number;
  pendingCount: number;
  declinedCount: number;
  heldCount: number;
  providerWritesEnabled: boolean;
  messageDelivery: "simulated" | "unverified_google";
  lastEvaluatedAt?: string;
  lastSuccessAt?: string;
  safeErrorCode?: string;
}

export type ApiTokenScope = "read" | "propose" | "apply";

export interface ApiTokenSummary {
  id: string;
  label: string;
  scopes: ApiTokenScope[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface CreatedApiToken extends ApiTokenSummary {
  token: string;
}

export interface AvailabilityBoundaryDraft {
  kind: "availability_boundary";
  name: string;
  target_calendar_id: string;
  timezone: string;
  working_days: number[];
  workday_start: string;
  workday_end: string;
  protect_before_work: boolean;
  protect_after_work: boolean;
  protect_closed_days: boolean;
  title: string;
  visibility: "private" | "default";
  horizon_days: number;
}

export interface SmartMeetingDraft {
  kind: "smart_meeting";
  name: string;
  target_calendar_id: string;
  timezone: string;
  start_date: string;
  weekdays: number[];
  window_start: string;
  window_end: string;
  preferred_time: string;
  cadence_weeks: number;
  occurrence_count: number;
  minimum_duration_minutes: number;
  maximum_duration_minutes: number;
  start_step_minutes: 15 | 30 | 60;
  priority: 1 | 2 | 3 | 4;
  attendees: Array<{
    email: string;
    required: boolean;
    availability_calendar_id?: string;
  }>;
  availability_calendar_ids: string[];
  conflict_policy: "suggest" | "auto_move" | "keep_with_warning";
  lock_before_minutes: number;
  description?: string;
  location?: string;
  visibility: "private" | "default";
}

export type PlanningDraft = AvailabilityBoundaryDraft | SmartMeetingDraft;

export interface PlanningPreview {
  previewToken: string;
  expiresAt: string;
  kind: PlanningDraft["kind"];
  scheduledCount: number;
  unmetCount: number;
  warnings: string[];
  hoursSummary: string;
  occurrences: Array<{
    occurrenceKey: string;
    decision: "schedule" | "unmet";
    reasonCode: string;
    rejectedCandidateCount: number;
    startAt?: string;
    endAt?: string;
    summary?: string;
  }>;
}

export interface PlanningRule {
  id: string;
  kind: PlanningDraft["kind"];
  name: string;
  status: "active" | "paused" | "deleting";
  targetCalendarId: string;
  targetCalendarName: string;
  rule: PlanningDraft;
  scheduledCount: number;
  unmetCount: number;
  pendingCount: number;
  suggestionCount: number;
  nextOccurrences: Array<{
    id: string;
    occurrenceKey: string;
    status: string;
    reasonCode: string;
    startAt?: string;
    endAt?: string;
  }>;
  lastSuccessAt?: string;
}

export interface PlanningSuggestion {
  id: string;
  ruleId: string;
  ruleName: string;
  plannedEventId: string;
  kind: "move" | "shorten" | "skip";
  reasonCode: string;
  currentStartAt?: string;
  currentEndAt?: string;
  proposedStartAt?: string;
  proposedEndAt?: string;
  expiresAt: string;
}
