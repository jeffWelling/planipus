import type {
  ApiTokenScope,
  ApiTokenSummary,
  CalendarEndpoint,
  Capabilities,
  Connection,
  ConflictResponseDraft,
  ConflictResponsePreview,
  ConflictResponseRule,
  CreatedApiToken,
  Overview,
  Preview,
  PreviewRequest,
  Session,
  PlanningDraft,
  PlanningPreview,
  PlanningRule,
  PlanningSuggestion
} from "./types.js";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface SessionDocument {
  principal_id: string;
  organization_id: string;
  expires_at: string;
  csrf_token: string;
}

interface ConnectionDocument {
  id: string;
  provider: string;
  display_label?: string;
  intended_role: "availability" | "source" | "destination" | "both";
  email_masked: string;
  status: "active" | "action_required" | "revoked";
  last_success_at?: string | null;
  safe_error_code?: string | null;
  updated_at: string;
}

interface CalendarDocument {
  id: string;
  connection_id: string;
  name: string;
  timezone: string;
  readable: boolean;
  writable: boolean;
  capabilities?: unknown;
  primary_calendar: boolean;
}

interface OverviewDocument {
  installation_name: string;
  status: Overview["status"];
  last_success_at: string | null;
  pending_effect_count: number;
  connections: Array<ConnectionDocument & { calendars: CalendarDocument[] }>;
  bridges: Array<{
    id: string;
    source_label: string;
    source_calendar: string;
    destination_label: string;
    destination_calendar: string;
    hours_label: string;
    privacy_label: string;
    status: Overview["bridges"][number]["status"];
    managed_copy_count: number;
    last_success_at: string | null;
  }>;
  recent_activity: Array<{
    id: string;
    message: string;
    reason: string;
    occurred_at: string;
  }>;
}

interface PreviewDocument {
  preview_token: string;
  expires_at: string;
  counts: Record<string, number>;
  excluded_by_reason: Record<string, number>;
  disclosure?: {
    source_fields_disclosed?: string[];
    destination_fields_written?: string[];
  } | null;
}

interface PlanningPreviewDocument {
  preview_token: string;
  expires_at: string;
  kind: PlanningDraft["kind"];
  scheduled_count: number;
  unmet_count: number;
  warnings: string[];
  hours_summary: string;
  occurrences: Array<{
    occurrence_key: string;
    decision: "schedule" | "unmet";
    reason_code: string;
    rejected_candidate_count: number;
    event?: {
      summary: string;
      timing: { start_instant: string; end_instant: string };
    };
  }>;
}

interface PlanningRuleDocument {
  id: string;
  kind: PlanningDraft["kind"];
  name: string;
  status: "active" | "paused" | "deleting";
  target_calendar_id: string;
  target_calendar_name: string;
  rule: PlanningDraft;
  scheduled_count: number;
  unmet_count: number;
  pending_count: number;
  suggestion_count: number;
  next_occurrences: Array<{
    id: string;
    occurrence_key: string;
    status: string;
    reason_code: string;
    start_at: string | null;
    end_at: string | null;
  }>;
  last_success_at: string | null;
}

interface PlanningSuggestionDocument {
  id: string;
  rule_id: string;
  rule_name: string;
  planned_event_id: string;
  kind: "move" | "shorten" | "skip";
  reason_code: string;
  current_start_at: string | null;
  current_end_at: string | null;
  proposed_start_at: string | null;
  proposed_end_at: string | null;
  expires_at: string;
}

interface ConflictResponsePreviewDocument {
  preview_token: string;
  expires_at: string;
  invitation_count?: number;
  matching_invitation_count?: number;
  decline_count?: number;
  conflict_count?: number;
  held_count?: number;
  budget_held_count?: number;
  counts?: Record<string, number>;
  examples?: Array<{
    start_at: string;
    end_at: string;
  }>;
  candidate_times?: Array<{
    start_at: string;
    end_at: string;
  }>;
  warnings?: string[];
  provider_writes_enabled?: boolean;
  message_delivery?: "simulated" | "unverified_google";
}

interface ConflictResponseRuleDocument {
  id: string;
  name: string;
  status: "active" | "paused";
  response_calendar_id: string;
  response_calendar_name?: string;
  availability_calendar_ids?: string[];
  availability_calendars?: Array<{ id: string }>;
  availability_calendar_count?: number;
  decline_message: string;
  horizon_days: number;
  pending_count?: number;
  declined_count?: number;
  held_count?: number;
  last_evaluated_at?: string | null;
  last_success_at?: string | null;
  safe_error_code?: string | null;
  provider_writes_enabled?: boolean;
  message_delivery?: "simulated" | "unverified_google";
}

interface ApiTokenDocument {
  id: string;
  label: string;
  scopes: ApiTokenScope[];
  created_at?: string;
  expires_at?: string | null;
  last_used_at?: string | null;
  revoked_at?: string | null;
}

interface CreatedApiTokenDocument extends ApiTokenDocument {
  token?: string;
  plaintext_token?: string;
}

let csrfToken: string | undefined;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (csrfToken && !["GET", "HEAD"].includes(init.method ?? "GET")) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      message?: string;
      code?: string;
      error?: { code?: string; message?: string };
    };
    const code = problem.error?.code ?? problem.code;
    const message = problem.error?.message ?? problem.message ?? humanizeError(code, response.status);
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function humanizeError(code: string | undefined, status: number): string {
  if (!code) return `Request failed (${status})`;
  return code.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function sessionFrom(document: SessionDocument): Session {
  csrfToken = document.csrf_token;
  return {
    authenticated: true,
    csrfToken: document.csrf_token,
    displayName: "Owner"
  };
}

function mapCalendar(document: CalendarDocument): CalendarEndpoint {
  const freeBusyReadable = document.readable
    || (
      typeof document.capabilities === "object"
      && document.capabilities !== null
      && !Array.isArray(document.capabilities)
      && (document.capabilities as Record<string, unknown>)["freebusy_readable"] === true
    );
  return {
    id: document.id,
    connectionId: document.connection_id,
    name: document.name,
    primary: document.primary_calendar,
    readable: document.readable,
    freeBusyReadable,
    writable: document.writable,
    timeZone: document.timezone
  };
}

function mapConnection(
  document: ConnectionDocument,
  calendars: CalendarDocument[] = []
): Connection {
  return {
    id: document.id,
    label: document.display_label || (document.provider === "google" ? "Google" : "Calendar"),
    maskedEmail: document.email_masked,
    role: document.intended_role,
    status: document.status === "active" ? "connected" : document.status === "revoked" ? "revoked" : "attention",
    ...(document.last_success_at ? { lastSuccessAt: document.last_success_at } : {}),
    calendars: calendars.map(mapCalendar)
  };
}

function mapOverview(document: OverviewDocument): Overview {
  return {
    installationName: document.installation_name,
    status: document.status,
    ...(document.last_success_at ? { lastSuccessAt: document.last_success_at } : {}),
    pendingEffectCount: document.pending_effect_count,
    connections: document.connections.map((connection) => mapConnection(connection, connection.calendars)),
    bridges: document.bridges.map((bridge) => ({
      id: bridge.id,
      sourceLabel: bridge.source_label,
      sourceCalendar: bridge.source_calendar,
      destinationLabel: bridge.destination_label,
      destinationCalendar: bridge.destination_calendar,
      hoursLabel: bridge.hours_label,
      privacyLabel: bridge.privacy_label,
      status: bridge.status,
      managedCopyCount: bridge.managed_copy_count,
      ...(bridge.last_success_at ? { lastSuccessAt: bridge.last_success_at } : {})
    })),
    recentActivity: document.recent_activity.map((activity) => ({
      id: activity.id,
      message: activity.message,
      reason: activity.reason,
      occurredAt: activity.occurred_at
    }))
  };
}

function mapPlanningRule(document: PlanningRuleDocument): PlanningRule {
  return {
    id: document.id,
    kind: document.kind,
    name: document.name,
    status: document.status,
    targetCalendarId: document.target_calendar_id,
    targetCalendarName: document.target_calendar_name,
    rule: document.rule,
    scheduledCount: document.scheduled_count,
    unmetCount: document.unmet_count,
    pendingCount: document.pending_count,
    suggestionCount: document.suggestion_count,
    nextOccurrences: document.next_occurrences.map((occurrence) => ({
      id: occurrence.id,
      occurrenceKey: occurrence.occurrence_key,
      status: occurrence.status,
      reasonCode: occurrence.reason_code,
      ...(occurrence.start_at ? { startAt: occurrence.start_at } : {}),
      ...(occurrence.end_at ? { endAt: occurrence.end_at } : {})
    })),
    ...(document.last_success_at ? { lastSuccessAt: document.last_success_at } : {})
  };
}

function mapConflictResponseRule(document: ConflictResponseRuleDocument): ConflictResponseRule {
  const availabilityCalendarIds = document.availability_calendar_ids
    ?? document.availability_calendars?.map((calendar) => calendar.id)
    ?? [];
  return {
    id: document.id,
    name: document.name,
    status: document.status,
    responseCalendarId: document.response_calendar_id,
    ...(document.response_calendar_name ? { responseCalendarName: document.response_calendar_name } : {}),
    availabilityCalendarIds,
    availabilityCalendarCount: document.availability_calendar_count ?? availabilityCalendarIds.length,
    declineMessage: document.decline_message,
    horizonDays: document.horizon_days,
    pendingCount: document.pending_count ?? 0,
    declinedCount: document.declined_count ?? 0,
    heldCount: document.held_count ?? 0,
    providerWritesEnabled: document.provider_writes_enabled ?? false,
    messageDelivery: document.message_delivery ?? "unverified_google",
    ...(document.last_evaluated_at ? { lastEvaluatedAt: document.last_evaluated_at } : {}),
    ...(document.last_success_at ? { lastSuccessAt: document.last_success_at } : {}),
    ...(document.safe_error_code ? { safeErrorCode: document.safe_error_code } : {})
  };
}

function mapApiToken(document: ApiTokenDocument): ApiTokenSummary {
  return {
    id: document.id,
    label: document.label,
    scopes: document.scopes,
    createdAt: document.created_at ?? new Date().toISOString(),
    ...(document.expires_at ? { expiresAt: document.expires_at } : {}),
    ...(document.last_used_at ? { lastUsedAt: document.last_used_at } : {}),
    ...(document.revoked_at ? { revokedAt: document.revoked_at } : {})
  };
}

function clockTime(value: string): string {
  return /^\d{2}:\d{2}$/u.test(value) ? `${value}:00` : value;
}

function privacy(input: PreviewRequest) {
  const includeDetails = input.privacyPreset === "private_details" || input.privacyPreset === "shared_details";
  return {
    preset: input.privacyPreset,
    preset_version: 1 as const,
    generic_summary: input.privacyPreset === "busy_only" ? "Busy" : input.genericLabel,
    copy_summary: includeDetails,
    copy_description: includeDetails,
    copy_location: includeDetails,
    copy_conference: false,
    copy_attendees: false,
    copy_organizer: false
  };
}

function policyDraft(input: PreviewRequest) {
  const withProfile = input.hoursMode !== "all_times";
  return {
    name: "Calendar bridge",
    source_calendar_id: input.sourceCalendarId,
    destination_calendar_id: input.destinationCalendarId,
    hours: { mode: input.hoursMode },
    ...(withProfile ? {
      hours_profile: {
        name: "Weekday work hours",
        timezone: input.timeZone,
        dst_resolution: {
          ambiguous: "earlier_offset",
          nonexistent: "shift_forward_by_gap"
        },
        weekly: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          start: clockTime(input.weekdayStart),
          end: clockTime(input.weekdayEnd),
          end_day_offset: input.weekdayEnd > input.weekdayStart ? 0 : 1
        })),
        exceptions: []
      }
    } : {}),
    privacy: privacy(input),
    selection: {
      timed: "include",
      all_day: "skip",
      free_events: "skip_when_redacted",
      tentative: "busy",
      unanswered: "free",
      skip_when_destination_identity_invited: true,
      source_exclusion_marker: "#nosync",
      manual_exclusions: []
    },
    destination: {},
    horizon: { past_days: 30, future_days: 365 }
  };
}

export const api = {
  async session(): Promise<Session> {
    return sessionFrom(await request<SessionDocument>("/api/v1/session"));
  },

  async login(bootstrapToken: string): Promise<Session> {
    await request<{ expires_at: string }>("/api/v1/session/bootstrap", {
      method: "POST",
      body: JSON.stringify({ token: bootstrapToken })
    });
    return this.session();
  },

  async logout(): Promise<void> {
    await request<void>("/api/v1/session", { method: "DELETE" });
    csrfToken = undefined;
  },

  async overview(): Promise<Overview> {
    return mapOverview(await request<OverviewDocument>("/api/v1/overview"));
  },

  async capabilities(): Promise<Capabilities> {
    const value = await request<{
      calendar_bridges: Capabilities["calendarBridges"];
      availability_protection: Capabilities["availabilityProtection"];
      smart_meetings: Capabilities["smartMeetings"];
      conflict_auto_decline?: Capabilities["conflictAutoDecline"];
      conflict_auto_decline_provider_writes?: boolean;
      conflict_decline_message_delivery?: Capabilities["conflictDeclineMessageDelivery"];
      api_server?: Capabilities["apiServer"];
      mcp_server?: Capabilities["mcpServer"];
    }>("/api/v1/capabilities");
    return {
      calendarBridges: value.calendar_bridges,
      availabilityProtection: value.availability_protection,
      smartMeetings: value.smart_meetings,
      conflictAutoDecline: value.conflict_auto_decline ?? "unavailable",
      conflictAutoDeclineProviderWrites: value.conflict_auto_decline_provider_writes ?? false,
      conflictDeclineMessageDelivery: value.conflict_decline_message_delivery ?? "unverified_google",
      apiServer: value.api_server ?? "unavailable",
      mcpServer: value.mcp_server ?? "unavailable"
    };
  },

  async conflictResponseRules(): Promise<ConflictResponseRule[]> {
    return (await request<ConflictResponseRuleDocument[]>("/api/v1/conflict-response/rules"))
      .map(mapConflictResponseRule);
  },

  async previewConflictResponse(draft: ConflictResponseDraft): Promise<ConflictResponsePreview> {
    const value = await request<ConflictResponsePreviewDocument>("/api/v1/conflict-response/preview", {
      method: "POST",
      body: JSON.stringify(draft)
    });
    const examples = value.examples ?? value.candidate_times ?? [];
    const invitationCount = value.invitation_count
      ?? value.matching_invitation_count
      ?? value.decline_count
      ?? value.counts?.["decline"]
      ?? value.counts?.["invitation"]
      ?? 0;
    return {
      previewToken: value.preview_token,
      expiresAt: value.expires_at,
      invitationCount,
      conflictCount: value.conflict_count ?? value.counts?.["conflict"] ?? invitationCount,
      heldCount: value.held_count ?? value.counts?.["held"] ?? 0,
      budgetHeldCount: value.budget_held_count ?? 0,
      examples: examples.map((example) => ({ startAt: example.start_at, endAt: example.end_at })),
      warnings: value.warnings ?? [],
      providerWritesEnabled: value.provider_writes_enabled ?? false,
      messageDelivery: value.message_delivery ?? "unverified_google"
    };
  },

  activateConflictResponse: (previewToken: string) =>
    request<{ id: string }>("/api/v1/conflict-response/rules", {
      method: "POST",
      body: JSON.stringify({ preview_token: previewToken })
    }),
  pauseConflictResponse: (ruleId: string) =>
    request<void>(`/api/v1/conflict-response/rules/${encodeURIComponent(ruleId)}/pause`, { method: "POST" }),
  resumeConflictResponse: (ruleId: string) =>
    request<void>(`/api/v1/conflict-response/rules/${encodeURIComponent(ruleId)}/resume`, { method: "POST" }),
  reconcileConflictResponse: (ruleId: string) =>
    request<{ enqueued?: boolean }>(`/api/v1/conflict-response/rules/${encodeURIComponent(ruleId)}/reconcile`, { method: "POST" }),
  retireConflictResponse: (ruleId: string) =>
    request<void>(`/api/v1/conflict-response/rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" }),

  async apiTokens(): Promise<ApiTokenSummary[]> {
    return (await request<ApiTokenDocument[]>("/api/v1/api-tokens")).map(mapApiToken);
  },

  async createApiToken(input: {
    label: string;
    scopes: ApiTokenScope[];
    expiresInDays?: number;
  }): Promise<CreatedApiToken> {
    const document = await request<CreatedApiTokenDocument>("/api/v1/api-tokens", {
      method: "POST",
      body: JSON.stringify({
        label: input.label,
        scopes: input.scopes,
        ...(input.expiresInDays ? { expires_in_days: input.expiresInDays } : {})
      })
    });
    const token = document.token ?? document.plaintext_token;
    if (!token) throw new ApiError("The server did not return the one-time token value", 500, "token_value_missing");
    return { ...mapApiToken(document), token };
  },

  revokeApiToken: (tokenId: string) =>
    request<void>(`/api/v1/api-tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" }),

  async planningRules(): Promise<PlanningRule[]> {
    return (await request<PlanningRuleDocument[]>("/api/v1/planning/rules")).map(mapPlanningRule);
  },

  async previewPlanning(draft: PlanningDraft): Promise<PlanningPreview> {
    const value = await request<PlanningPreviewDocument>("/api/v1/planning/preview", {
      method: "POST",
      body: JSON.stringify(draft)
    });
    return {
      previewToken: value.preview_token,
      expiresAt: value.expires_at,
      kind: value.kind,
      scheduledCount: value.scheduled_count,
      unmetCount: value.unmet_count,
      warnings: value.warnings,
      hoursSummary: value.hours_summary,
      occurrences: value.occurrences.map((occurrence) => ({
        occurrenceKey: occurrence.occurrence_key,
        decision: occurrence.decision,
        reasonCode: occurrence.reason_code,
        rejectedCandidateCount: occurrence.rejected_candidate_count,
        ...(occurrence.event ? {
          startAt: occurrence.event.timing.start_instant,
          endAt: occurrence.event.timing.end_instant,
          summary: occurrence.event.summary
        } : {})
      }))
    };
  },

  async activatePlanning(previewToken: string): Promise<{ id: string }> {
    return request<{ id: string }>("/api/v1/planning/rules", {
      method: "POST",
      body: JSON.stringify({ preview_token: previewToken })
    });
  },

  pausePlanning: (ruleId: string) =>
    request<void>(`/api/v1/planning/rules/${encodeURIComponent(ruleId)}/pause`, { method: "POST" }),
  resumePlanning: (ruleId: string) =>
    request<void>(`/api/v1/planning/rules/${encodeURIComponent(ruleId)}/resume`, { method: "POST" }),
  replan: (ruleId: string) =>
    request<{ enqueued: boolean }>(`/api/v1/planning/rules/${encodeURIComponent(ruleId)}/replan`, { method: "POST" }),
  removePlanning: (ruleId: string) =>
    request<void>(`/api/v1/planning/rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" }),

  async planningSuggestions(): Promise<PlanningSuggestion[]> {
    const values = await request<PlanningSuggestionDocument[]>("/api/v1/planning/suggestions");
    return values.map((value) => ({
      id: value.id,
      ruleId: value.rule_id,
      ruleName: value.rule_name,
      plannedEventId: value.planned_event_id,
      kind: value.kind,
      reasonCode: value.reason_code,
      ...(value.current_start_at ? { currentStartAt: value.current_start_at } : {}),
      ...(value.current_end_at ? { currentEndAt: value.current_end_at } : {}),
      ...(value.proposed_start_at ? { proposedStartAt: value.proposed_start_at } : {}),
      ...(value.proposed_end_at ? { proposedEndAt: value.proposed_end_at } : {}),
      expiresAt: value.expires_at
    }));
  },
  acceptPlanningSuggestion: (suggestionId: string) =>
    request<void>(`/api/v1/planning/suggestions/${encodeURIComponent(suggestionId)}/accept`, { method: "POST" }),
  dismissPlanningSuggestion: (suggestionId: string) =>
    request<void>(`/api/v1/planning/suggestions/${encodeURIComponent(suggestionId)}/dismiss`, { method: "POST" }),

  async connections(): Promise<Connection[]> {
    const [connections, calendars] = await Promise.all([
      request<ConnectionDocument[]>("/api/v1/connections"),
      request<CalendarDocument[]>("/api/v1/calendars")
    ]);
    return connections.map((connection) => mapConnection(
      connection,
      calendars.filter((calendar) => calendar.connection_id === connection.id)
    ));
  },

  async beginGoogle(
    label: string,
    role: "availability" | "source" | "destination" | "both"
  ): Promise<void> {
    const authorization = await request<{ authorization_url: string }>("/api/v1/connections/google/authorize", {
      method: "POST",
      body: JSON.stringify({ label, role })
    });
    window.location.assign(authorization.authorization_url);
  },

  async preview(input: PreviewRequest): Promise<Preview> {
    const result = await request<PreviewDocument>("/api/v1/policies/preview", {
      method: "POST",
      body: JSON.stringify(policyDraft(input))
    });
    const disclosed = result.disclosure?.source_fields_disclosed ?? [];
    const preset = input.privacyPreset;
    return {
      id: result.preview_token,
      expiresAt: result.expires_at,
      creates: result.counts["create"] ?? 0,
      updates: result.counts["update"] ?? 0,
      deletes: result.counts["delete"] ?? 0,
      unchanged: result.counts["unchanged"] ?? 0,
      excluded: result.counts["excluded"] ?? 0,
      excludedByReason: Object.entries(result.excluded_by_reason).map(([reason, count]) => ({ reason, count })),
      sample: {
        summary: preset === "busy_only" ? "Busy" : preset === "commitment" ? input.genericLabel : "Source event title",
        visibility: preset === "shared_details" ? "default visibility" : "private",
        transparency: "busy",
        disclosedFields: disclosed.length > 0 ? disclosed : ["time", "availability"]
      }
    };
  },

  async activate(previewId: string): Promise<{ policyId: string }> {
    const policy = await request<{ id: string }>("/api/v1/policies", {
      method: "POST",
      body: JSON.stringify({ preview_token: previewId })
    });
    return { policyId: policy.id };
  },

  pause: (policyId: string) =>
    request<void>(`/api/v1/policies/${encodeURIComponent(policyId)}/pause`, { method: "POST" }),
  resume: (policyId: string) =>
    request<void>(`/api/v1/policies/${encodeURIComponent(policyId)}/resume`, { method: "POST" }),
  recover: (policyId: string) =>
    request<{ retried: number }>(`/api/v1/policies/${encodeURIComponent(policyId)}/recover`, { method: "POST" }),
  syncNow: () => request<void>("/api/v1/sync", { method: "POST" })
};

export { ApiError };
