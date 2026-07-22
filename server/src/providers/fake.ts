import type { DesiredCopy, SourceObservation } from "@planipus/calendar-sync";

import type {
  CalendarProvider,
  ProviderEventLookup,
  ProviderCalendar,
  ProviderEventPage,
  ProviderPlanningEventLookup,
  ProviderWriteResult
} from "./types.js";
import { ProviderError } from "./types.js";
import type { ManagedPlanningEvent } from "../planning/types.js";

interface FakeStoredEvent {
  desired: DesiredCopy | null;
  revision: number;
}

interface FakeStoredPlanningEvent {
  desired: ManagedPlanningEvent;
  revision: number;
}

export type FakeFailure = "timeout_after_write" | "rate_limited" | "precondition" | "gone_cursor" | "unauthorized";

export class FakeCalendarProvider implements CalendarProvider {
  private readonly calendars = new Map<string, ProviderCalendar>();
  private readonly events = new Map<string, FakeStoredEvent>();
  private readonly observations = new Map<string, SourceObservation[]>();
  private readonly planningEvents = new Map<string, FakeStoredPlanningEvent>();
  private nextFailure: FakeFailure | null = null;

  public addCalendar(calendar: ProviderCalendar): void {
    this.calendars.set(calendar.remoteId, calendar);
  }

  public setObservations(calendarId: string, values: readonly SourceObservation[]): void {
    this.observations.set(calendarId, [...values]);
  }

  public failNext(failure: FakeFailure): void {
    this.nextFailure = failure;
  }

  /** Test/development hook for a user-owned event that happens to occupy a
   * deterministic Planipus ID. Recovery must never adopt or overwrite it. */
  public setUnmanagedEvent(calendarId: string, eventId: string): void {
    this.events.set(this.key(calendarId, eventId), { desired: null, revision: 1 });
  }

  /** Test/development hooks that model direct destination edits without going
   * through Planipus. Editing preserves private ownership markers, as Google
   * Calendar's normal UI does; deleting removes the event entirely. */
  public simulateManualEdit(
    calendarId: string,
    eventId: string,
    transform: (current: DesiredCopy) => DesiredCopy
  ): void {
    const key = this.key(calendarId, eventId);
    const event = this.events.get(key);
    if (!event?.desired) {
      throw new Error("cannot manually edit a missing or unmanaged fake event");
    }
    this.events.set(key, {
      desired: transform(event.desired),
      revision: event.revision + 1
    });
  }

  public simulateManualDelete(calendarId: string, eventId: string): void {
    this.events.delete(this.key(calendarId, eventId));
  }

  public async listCalendars(_accessToken: string): Promise<readonly ProviderCalendar[]> {
    this.maybeFailAuthentication();
    return [...this.calendars.values()];
  }

  public async listEvents(
    _accessToken: string,
    calendarId: string,
    request: {
      readonly pageToken?: string;
      readonly syncToken?: string;
      readonly timeMin?: string;
      readonly timeMax?: string;
    }
  ): Promise<ProviderEventPage> {
    this.maybeFailAuthentication();
    if (this.consumeFailure("gone_cursor")) {
      throw new ProviderError("cursor_gone", "fake cursor expired", false, false, 410);
    }
    const values = this.observations.get(calendarId) ?? [];
    const offset = request.pageToken ? Number(request.pageToken) : 0;
    const page = values.slice(offset, offset + 100);
    const next = offset + page.length < values.length ? String(offset + page.length) : null;
    return {
      observations: page,
      nextPageToken: next,
      nextSyncToken: next ? null : `fake-sync-${values.length}`
    };
  }

  public async getEvent(_accessToken: string, calendarId: string, eventId: string): Promise<ProviderEventLookup | null> {
    this.maybeFailAuthentication();
    const event = this.events.get(this.key(calendarId, eventId));
    return event ? {
      remoteEventId: eventId,
      remoteRevision: String(event.revision),
      managedIdentity: event.desired ? {
        policyRef: event.desired.provenance.policy_ref,
        projectionRef: event.desired.provenance.projection_ref,
        generation: event.desired.provenance.generation
      } : null
    } : null;
  }

  public async createEvent(
    _accessToken: string,
    calendarId: string,
    eventId: string,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult> {
    this.maybeFailBeforeWrite();
    const key = this.key(calendarId, eventId);
    const existing = this.events.get(key);
    if (existing) {
      throw new ProviderError("precondition_failed", "fake create ID already exists", false, false, 412);
    }
    this.events.set(key, { desired, revision: 1 });
    if (this.consumeFailure("timeout_after_write")) {
      throw new ProviderError("ambiguous_timeout", "fake timeout after write", true, true);
    }
    return { remoteEventId: eventId, remoteRevision: "1" };
  }

  public async updateEvent(
    _accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult> {
    this.maybeFailBeforeWrite();
    const key = this.key(calendarId, eventId);
    const existing = this.events.get(key);
    if (!existing) {
      throw new ProviderError("not_found", "fake destination event missing", false, false, 404);
    }
    if (expectedRevision && expectedRevision !== String(existing.revision)) {
      throw new ProviderError("precondition_failed", "fake precondition failed", false, false, 412);
    }
    const revision = existing.revision + 1;
    this.events.set(key, { desired, revision });
    if (this.consumeFailure("timeout_after_write")) {
      throw new ProviderError("ambiguous_timeout", "fake timeout after write", true, true);
    }
    return { remoteEventId: eventId, remoteRevision: String(revision) };
  }

  public async deleteEvent(
    _accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null
  ): Promise<void> {
    this.maybeFailBeforeWrite();
    const key = this.key(calendarId, eventId);
    const existing = this.events.get(key);
    if (!existing) {
      return;
    }
    if (expectedRevision && expectedRevision !== String(existing.revision)) {
      throw new ProviderError("precondition_failed", "fake precondition failed", false, false, 412);
    }
    this.events.delete(key);
    if (this.consumeFailure("timeout_after_write")) {
      throw new ProviderError("ambiguous_timeout", "fake timeout after write", true, true);
    }
  }

  public async getPlanningEvent(
    _accessToken: string,
    calendarId: string,
    eventId: string
  ): Promise<ProviderPlanningEventLookup | null> {
    this.maybeFailAuthentication();
    const event = this.planningEvents.get(this.key(calendarId, eventId));
    if (!event) return null;
    return {
      remoteEventId: eventId,
      remoteRevision: String(event.revision),
      managedIdentity: {
        kind: event.desired.provenance.kind,
        ruleRef: event.desired.provenance.rule_ref,
        plannedEventRef: event.desired.provenance.planned_event_ref,
        occurrenceKey: event.desired.provenance.occurrence_key,
        generation: event.desired.provenance.generation,
        intentSequence: event.desired.provenance.intent_sequence
      }
    };
  }

  public async createPlanningEvent(
    _accessToken: string,
    calendarId: string,
    eventId: string,
    desired: ManagedPlanningEvent
  ): Promise<ProviderWriteResult> {
    this.maybeFailBeforeWrite();
    const key = this.key(calendarId, eventId);
    if (this.planningEvents.has(key) || this.events.has(key)) {
      throw new ProviderError("precondition_failed", "fake create ID already exists", false, false, 412);
    }
    this.planningEvents.set(key, { desired, revision: 1 });
    if (this.consumeFailure("timeout_after_write")) {
      throw new ProviderError("ambiguous_timeout", "fake timeout after write", true, true);
    }
    return { remoteEventId: eventId, remoteRevision: "1" };
  }

  public async updatePlanningEvent(
    _accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    desired: ManagedPlanningEvent
  ): Promise<ProviderWriteResult> {
    this.maybeFailBeforeWrite();
    const key = this.key(calendarId, eventId);
    const event = this.planningEvents.get(key);
    if (!event) throw new ProviderError("not_found", "fake planning event is missing", false, false, 404);
    if (expectedRevision && expectedRevision !== String(event.revision)) {
      throw new ProviderError("precondition_failed", "fake precondition failed", false, false, 412);
    }
    const revision = event.revision + 1;
    this.planningEvents.set(key, { desired, revision });
    if (this.consumeFailure("timeout_after_write")) {
      throw new ProviderError("ambiguous_timeout", "fake timeout after write", true, true);
    }
    return { remoteEventId: eventId, remoteRevision: String(revision) };
  }

  public async deletePlanningEvent(
    _accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    _sendUpdates: boolean
  ): Promise<void> {
    this.maybeFailBeforeWrite();
    const key = this.key(calendarId, eventId);
    const event = this.planningEvents.get(key);
    if (!event) return;
    if (expectedRevision && expectedRevision !== String(event.revision)) {
      throw new ProviderError("precondition_failed", "fake precondition failed", false, false, 412);
    }
    this.planningEvents.delete(key);
    if (this.consumeFailure("timeout_after_write")) {
      throw new ProviderError("ambiguous_timeout", "fake timeout after write", true, true);
    }
  }

  public planningDesired(calendarId: string, eventId: string): ManagedPlanningEvent | null {
    return this.planningEvents.get(this.key(calendarId, eventId))?.desired ?? null;
  }

  public desired(calendarId: string, eventId: string): DesiredCopy | null {
    return this.events.get(this.key(calendarId, eventId))?.desired ?? null;
  }

  private key(calendarId: string, eventId: string): string {
    return `${calendarId}\u0000${eventId}`;
  }

  private consumeFailure(expected: FakeFailure): boolean {
    if (this.nextFailure !== expected) {
      return false;
    }
    this.nextFailure = null;
    return true;
  }

  private maybeFailBeforeWrite(): void {
    this.maybeFailAuthentication();
    if (this.consumeFailure("rate_limited")) {
      throw new ProviderError("rate_limited", "fake provider rate limit", true, false, 429);
    }
    if (this.consumeFailure("precondition")) {
      throw new ProviderError("precondition_failed", "fake precondition failed", false, false, 412);
    }
  }

  private maybeFailAuthentication(): void {
    if (this.consumeFailure("unauthorized")) {
      throw new ProviderError("provider_auth", "fake provider authorization failed", false, false, 401);
    }
  }
}
