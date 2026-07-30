import type { DesiredCopy, SourceObservation } from "@planipus/calendar-sync";
import type { ManagedPlanningEvent } from "../planning/types.js";

export interface ProviderCalendar {
  readonly remoteId: string;
  readonly name: string;
  readonly timezone: string;
  readonly accessRole: string;
  /** Provider ACL permits opaque free/busy reads, even if event listing is forbidden. */
  readonly freeBusyReadable?: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly primary: boolean;
}

export interface ProviderEventPage {
  readonly observations: readonly SourceObservation[];
  readonly nextPageToken: string | null;
  readonly nextSyncToken: string | null;
}

export interface ProviderWriteResult {
  readonly remoteEventId: string;
  readonly remoteRevision: string;
}

/** A provider-calculated opaque availability interval. No event identity or
 * content crosses this boundary. */
export interface ProviderBusyInterval {
  readonly start: string;
  readonly end: string;
}

export interface ProviderFreeBusyRequest {
  readonly calendarIds: readonly string[];
  readonly timeMin: string;
  readonly timeMax: string;
}

export interface ProviderFreeBusyCalendar {
  readonly calendarId: string;
  readonly busy: readonly ProviderBusyInterval[];
}

export interface ProviderFreeBusyResult {
  readonly timeMin: string;
  readonly timeMax: string;
  readonly calendars: readonly ProviderFreeBusyCalendar[];
}

export interface ProviderDeclineInvitationRequest {
  /** The revision observed by the caller. A mismatch must not be overwritten. */
  readonly expectedRevision: string | null;
  /** Exact static attendee response comment. An empty string clears a comment. */
  readonly comment: string;
}

export interface ProviderDeclineInvitationResult extends ProviderWriteResult {
  readonly responseStatus: "declined";
  readonly comment: string;
  /** Whether the provider retained the requested attendee response comment. */
  readonly commentRetained: boolean;
  /** False when the attendee response already exactly matched the request. */
  readonly changed: boolean;
}

export interface ProviderManagedIdentity {
  readonly policyRef: string;
  readonly projectionRef: string;
  readonly generation: number;
}

export interface ProviderEventLookup extends ProviderWriteResult {
  readonly managedIdentity: ProviderManagedIdentity | null;
}

export interface ProviderPlanningIdentity {
  readonly kind: ManagedPlanningEvent["provenance"]["kind"];
  readonly ruleRef: string;
  readonly plannedEventRef: string;
  readonly occurrenceKey: string;
  readonly generation: number;
  readonly intentSequence: number;
}

export interface ProviderPlanningEventLookup extends ProviderWriteResult {
  readonly managedIdentity: ProviderPlanningIdentity | null;
}

export interface CalendarProvider {
  listCalendars(accessToken: string): Promise<readonly ProviderCalendar[]>;
  queryFreeBusy(
    accessToken: string,
    request: ProviderFreeBusyRequest
  ): Promise<ProviderFreeBusyResult>;
  listEvents(
    accessToken: string,
    calendarId: string,
    request: {
      readonly pageToken?: string;
      readonly syncToken?: string;
      readonly timeMin?: string;
      readonly timeMax?: string;
    }
  ): Promise<ProviderEventPage>;
  getEvent(accessToken: string, calendarId: string, eventId: string): Promise<ProviderEventLookup | null>;
  createEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult>;
  updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult>;
  deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null
  ): Promise<void>;
  declineInvitation(
    accessToken: string,
    calendarId: string,
    eventId: string,
    request: ProviderDeclineInvitationRequest
  ): Promise<ProviderDeclineInvitationResult>;
  getPlanningEvent(
    accessToken: string,
    calendarId: string,
    eventId: string
  ): Promise<ProviderPlanningEventLookup | null>;
  createPlanningEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    desired: ManagedPlanningEvent
  ): Promise<ProviderWriteResult>;
  updatePlanningEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    desired: ManagedPlanningEvent
  ): Promise<ProviderWriteResult>;
  deletePlanningEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    sendUpdates: boolean
  ): Promise<void>;
}

export class ProviderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly ambiguous = false,
    public readonly status: number | null = null
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
