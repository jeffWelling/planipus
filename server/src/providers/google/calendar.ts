import type {
  EventTiming,
  SourceObservation,
  DesiredCopy
} from "@planipus/calendar-sync";

import type {
  CalendarProvider,
  ProviderCalendar,
  ProviderEventLookup,
  ProviderEventPage,
  ProviderPlanningEventLookup,
  ProviderWriteResult
} from "../types.js";
import { ProviderError } from "../types.js";
import { serializeGoogleDesiredCopy, serializeGooglePlanningEvent } from "./serializer.js";
import type { ManagedPlanningEvent } from "../../planning/types.js";

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
}

interface GoogleCalendarListEntry {
  id?: string;
  summary?: string;
  timeZone?: string;
  accessRole?: string;
  primary?: boolean;
  deleted?: boolean;
}

interface GoogleEventsResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  transparency?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string; timeZone?: string };
  organizer?: { email?: string; self?: boolean };
  attendees?: { email?: string; self?: boolean; responseStatus?: string; comment?: string }[];
  extendedProperties?: { private?: Record<string, string> };
}

const API = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarProvider implements CalendarProvider {
  public constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  public async listCalendars(accessToken: string): Promise<readonly ProviderCalendar[]> {
    const values: ProviderCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${API}/users/me/calendarList`);
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("showDeleted", "false");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }
      const response = await this.request<GoogleCalendarListResponse>(url, accessToken, { method: "GET" }, false);
      for (const item of response.items ?? []) {
        if (!item.id || item.deleted) {
          continue;
        }
        const accessRole = item.accessRole ?? "none";
        values.push({
          remoteId: item.id,
          name: item.summary ?? "Calendar",
          timezone: item.timeZone ?? "UTC",
          accessRole,
          readable: accessRole === "reader" || accessRole === "writer" || accessRole === "owner",
          writable: accessRole === "writer" || accessRole === "owner",
          primary: item.primary === true
        });
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
    return values;
  }

  public async listEvents(
    accessToken: string,
    calendarId: string,
    request: {
      readonly pageToken?: string;
      readonly syncToken?: string;
      readonly timeMin?: string;
      readonly timeMax?: string;
    }
  ): Promise<ProviderEventPage> {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("maxResults", "1000");
    url.searchParams.set("showDeleted", "true");
    // Materialize recurring instances. The shared v1 contract evaluates and
    // projects occurrences, not a recurrence master as one oversized event.
    url.searchParams.set("singleEvents", "true");
    if (request.pageToken) {
      url.searchParams.set("pageToken", request.pageToken);
    }
    if (request.syncToken) {
      url.searchParams.set("syncToken", request.syncToken);
    } else if (request.timeMin) {
      url.searchParams.set("timeMin", request.timeMin);
      if (request.timeMax) {
        url.searchParams.set("timeMax", request.timeMax);
      }
    }
    const response = await this.request<GoogleEventsResponse>(url, accessToken, { method: "GET" }, false);
    return {
      observations: (response.items ?? []).flatMap((event) => {
        const normalized = normalizeGoogleEvent(event, response.timeZone ?? "UTC");
        return normalized ? [normalized] : [];
      }),
      nextPageToken: response.nextPageToken ?? null,
      nextSyncToken: response.nextSyncToken ?? null
    };
  }

  public async getEvent(accessToken: string, calendarId: string, eventId: string): Promise<ProviderEventLookup | null> {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    try {
      const event = await this.request<GoogleEvent>(url, accessToken, { method: "GET" }, false);
      const result = requireWriteResult(event);
      return { ...result, managedIdentity: managedIdentity(event) };
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  public async createEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult> {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("sendUpdates", "none");
    const event = await this.request<GoogleEvent>(
      url,
      accessToken,
      {
        method: "POST",
        headers: { "content-type": "application/json", "if-none-match": "*" },
        body: JSON.stringify(serializeGoogleDesiredCopy(desired, eventId))
      },
      true
    );
    return requireWriteResult(event);
  }

  public async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult> {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    url.searchParams.set("sendUpdates", "none");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (expectedRevision) {
      headers["if-match"] = expectedRevision;
    }
    const event = await this.request<GoogleEvent>(
      url,
      accessToken,
      // Use the full-resource update contract. A merge PATCH that omits an old
      // description/location would retain those sensitive fields when a policy
      // tightens from shared details to busy-only.
      { method: "PUT", headers, body: JSON.stringify(serializeGoogleDesiredCopy(desired)) },
      true
    );
    return requireWriteResult(event);
  }

  public async deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null
  ): Promise<void> {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    url.searchParams.set("sendUpdates", "none");
    const headers: Record<string, string> = {};
    if (expectedRevision) {
      headers["if-match"] = expectedRevision;
    }
    try {
      await this.request<void>(url, accessToken, { method: "DELETE", headers }, true);
    } catch (error) {
      // Delete is an idempotent desired-state operation.
      if (error instanceof ProviderError && (error.status === 404 || error.status === 410)) {
        return;
      }
      throw error;
    }
  }

  public async getPlanningEvent(
    accessToken: string,
    calendarId: string,
    eventId: string
  ): Promise<ProviderPlanningEventLookup | null> {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    try {
      const event = await this.request<GoogleEvent>(url, accessToken, { method: "GET" }, false);
      return { ...requireWriteResult(event), managedIdentity: planningIdentity(event) };
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return null;
      throw error;
    }
  }

  public async createPlanningEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    desired: ManagedPlanningEvent
  ): Promise<ProviderWriteResult> {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("sendUpdates", desired.write_controls.send_updates ? "all" : "none");
    const event = await this.request<GoogleEvent>(url, accessToken, {
      method: "POST",
      headers: { "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify(serializeGooglePlanningEvent(desired, eventId))
    }, true);
    return requireWriteResult(event);
  }

  public async updatePlanningEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    desired: ManagedPlanningEvent
  ): Promise<ProviderWriteResult> {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    url.searchParams.set("sendUpdates", desired.write_controls.send_updates ? "all" : "none");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (expectedRevision) headers["if-match"] = expectedRevision;
    const event = await this.request<GoogleEvent>(url, accessToken, {
      method: "PUT",
      headers,
      body: JSON.stringify(serializeGooglePlanningEvent(desired))
    }, true);
    return requireWriteResult(event);
  }

  public async deletePlanningEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    sendUpdates: boolean
  ): Promise<void> {
    const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    url.searchParams.set("sendUpdates", sendUpdates ? "all" : "none");
    const headers: Record<string, string> = {};
    if (expectedRevision) headers["if-match"] = expectedRevision;
    try {
      await this.request<void>(url, accessToken, { method: "DELETE", headers }, true);
    } catch (error) {
      if (error instanceof ProviderError && (error.status === 404 || error.status === 410)) return;
      throw error;
    }
  }

  private async request<T>(url: URL, accessToken: string, init: RequestInit, write: boolean): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: { ...init.headers, authorization: `Bearer ${accessToken}`, accept: "application/json" }
      });
    } catch (error) {
      throw new ProviderError(
        write ? "ambiguous_network_error" : "provider_network_error",
        error instanceof Error ? error.message : "Google request failed",
        true,
        write
      );
    }
    if (!response.ok) {
      const status = response.status;
      const retryable = status === 429 || status >= 500;
      const code = status === 401
        ? "provider_auth"
        : status === 410
          ? "cursor_gone"
          : status === 409 || status === 412
            ? "precondition_failed"
            : retryable
              ? "provider_throttled"
              : `provider_http_${status}`;
      throw new ProviderError(code, `Google Calendar request failed with HTTP ${status}`, retryable, false, status);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (text.length > 5_000_000) {
      throw new ProviderError("response_too_large", "Google Calendar response exceeded the safety limit", false);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError("malformed_response", "Google Calendar returned malformed JSON", false);
    }
  }
}

function requireWriteResult(event: GoogleEvent): ProviderWriteResult {
  if (!event.id || !event.etag) {
    throw new ProviderError("malformed_response", "Google write result did not contain an ID and revision", false);
  }
  return { remoteEventId: event.id, remoteRevision: event.etag };
}

function managedIdentity(event: GoogleEvent): ProviderEventLookup["managedIdentity"] {
  const markers = event.extendedProperties?.private;
  const generation = Number(markers?.["planipus_generation"]);
  if (
    markers?.["planipus_version"] !== "1"
    || !markers["planipus_policy"]
    || !markers["planipus_projection"]
    || !Number.isSafeInteger(generation)
    || generation < 1
  ) {
    return null;
  }
  return {
    policyRef: markers["planipus_policy"],
    projectionRef: markers["planipus_projection"],
    generation
  };
}

function planningIdentity(event: GoogleEvent): ProviderPlanningEventLookup["managedIdentity"] {
  const markers = event.extendedProperties?.private;
  const generation = Number(markers?.["planipus_generation"]);
  const intentSequence = Number(markers?.["planipus_intent"]);
  const kind = markers?.["planipus_kind"];
  if (
    markers?.["planipus_version"] !== "1"
    || (kind !== "availability_boundary" && kind !== "smart_meeting")
    || !markers["planipus_rule"]
    || !markers["planipus_planned_event"]
    || !markers["planipus_occurrence"]
    || !Number.isSafeInteger(generation)
    || generation < 1
    || !Number.isSafeInteger(intentSequence)
    || intentSequence < 1
  ) {
    return null;
  }
  return {
    kind,
    ruleRef: markers["planipus_rule"],
    plannedEventRef: markers["planipus_planned_event"],
    occurrenceKey: markers["planipus_occurrence"],
    generation,
    intentSequence
  };
}

function normalizeGoogleEvent(event: GoogleEvent, calendarTimezone: string): SourceObservation | null {
  if (!event.id) {
    return null;
  }
  const timing = normalizeTiming(event, calendarTimezone);
  const selfAttendee = event.attendees?.find((attendee) => attendee.self === true);
  const response = selfAttendee?.responseStatus === "accepted"
    ? "accepted"
    : selfAttendee?.responseStatus === "tentative"
      ? "tentative"
      : selfAttendee?.responseStatus === "declined"
        ? "declined"
        : selfAttendee
          ? "needs_action"
          : "not_applicable";
  const lifecycle = event.status === "cancelled" ? "cancelled" : "confirmed";
  return {
    source_event_ref: event.id,
    source_occurrence_ref: event.originalStartTime?.dateTime ?? event.originalStartTime?.date ?? "",
    remote_revision: event.etag ?? "",
    lifecycle,
    origin: event.extendedProperties?.private?.["planipus_version"] ? "planipus_managed" : "provider_original",
    ...(timing ? { timing } : {}),
    availability: event.transparency === "transparent" ? "free" : "busy",
    relationship: {
      role: event.organizer?.self ? "organizer" : selfAttendee ? "attendee" : "none",
      response,
      ...(selfAttendee?.comment ? { response_note: selfAttendee.comment } : {})
    },
    destination_identity_invited: false,
    content: {
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.description ? { description: event.description } : {}),
      ...(event.location ? { location: event.location } : {}),
      ...(event.hangoutLink ? { conference: event.hangoutLink } : {})
    },
    ...(event.attendees ? { attendees: event.attendees.flatMap((attendee) => attendee.email ? [attendee.email] : []) } : {}),
    ...(event.organizer?.email ? { organizer: event.organizer.email } : {}),
    ...(event.htmlLink ? { source_url: event.htmlLink } : {}),
    provider_metadata: {
      recurring_event_ref: event.recurringEventId ?? null,
      planipus_planning_kind: event.extendedProperties?.private?.["planipus_kind"] ?? null,
      planipus_rule_ref: event.extendedProperties?.private?.["planipus_rule"] ?? null,
      planipus_planned_event_ref: event.extendedProperties?.private?.["planipus_planned_event"] ?? null
    }
  };
}

function normalizeTiming(event: GoogleEvent, calendarTimezone: string): EventTiming | null {
  if (event.start?.date && event.end?.date) {
    return {
      kind: "all_day",
      start_date: event.start.date,
      end_date: event.end.date,
      timezone: event.start.timeZone ?? event.end.timeZone ?? calendarTimezone
    };
  }
  if (event.start?.dateTime && event.end?.dateTime) {
    return {
      kind: "timed",
      start_instant: new Date(event.start.dateTime).toISOString(),
      end_instant: new Date(event.end.dateTime).toISOString(),
      start_tzid: event.start.timeZone ?? "UTC",
      end_tzid: event.end.timeZone ?? event.start.timeZone ?? "UTC"
    };
  }
  return null;
}
