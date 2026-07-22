import type { DesiredCopy, SourceObservation } from "@planipus/calendar-sync";
import type { ManagedPlanningEvent } from "../planning/types.js";

export interface ProviderCalendar {
  readonly remoteId: string;
  readonly name: string;
  readonly timezone: string;
  readonly accessRole: string;
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
