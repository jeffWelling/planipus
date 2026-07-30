import type { DesiredCopy, SourceObservation } from "@planipus/calendar-sync";

import type {
  CalendarProvider,
  ProviderBusyInterval,
  ProviderEventLookup,
  ProviderCalendar,
  ProviderDeclineInvitationRequest,
  ProviderDeclineInvitationResult,
  ProviderEventPage,
  ProviderFreeBusyRequest,
  ProviderFreeBusyResult,
  ProviderPlanningEventLookup,
  ProviderWriteResult
} from "./types.js";
import { ProviderError } from "./types.js";
import type { ManagedPlanningEvent } from "../planning/types.js";
import { DEFAULT_FAKE_ACCESS_TOKEN } from "./fake-token.js";

interface FakeStoredEvent {
  desired: DesiredCopy | null;
  revision: number;
}

interface FakeStoredPlanningEvent {
  desired: ManagedPlanningEvent;
  revision: number;
}

interface FakeStoredInvitation {
  readonly organizerSelf: boolean;
  readonly selfAttendeeEmail: string | null;
  readonly cancelled: boolean;
  readonly responseStatus: "accepted" | "tentative" | "declined" | "needs_action";
  readonly comment: string;
  readonly revision: number;
}

export interface FakeInvitationFixture {
  readonly organizerSelf?: boolean;
  readonly selfAttendeeEmail?: string | null;
  readonly cancelled?: boolean;
  readonly responseStatus?: FakeStoredInvitation["responseStatus"];
  readonly comment?: string;
  readonly revision?: number;
}

export type FakeFailure = "timeout_after_write" | "rate_limited" | "precondition" | "gone_cursor" | "unauthorized";

export class FakeCalendarProvider implements CalendarProvider {
  private readonly calendars = new Map<string, Map<string, ProviderCalendar>>();
  private readonly events = new Map<string, FakeStoredEvent>();
  private readonly observations = new Map<string, Map<string, SourceObservation[]>>();
  private readonly freeBusy = new Map<string, Map<string, ProviderBusyInterval[]>>();
  private readonly invitations = new Map<string, FakeStoredInvitation>();
  private readonly planningEvents = new Map<string, FakeStoredPlanningEvent>();
  private readonly seenAccessTokens = new Map<string, Set<string>>();
  private nextFailure: FakeFailure | null = null;

  public addCalendar(
    calendar: ProviderCalendar,
    accessToken = DEFAULT_FAKE_ACCESS_TOKEN
  ): void {
    this.calendarBucket(accessToken).set(calendar.remoteId, calendar);
  }

  public setObservations(
    calendarId: string,
    values: readonly SourceObservation[],
    accessToken = DEFAULT_FAKE_ACCESS_TOKEN
  ): void {
    this.observationBucket(accessToken).set(calendarId, [...values]);
  }

  public setFreeBusy(
    calendarId: string,
    values: readonly ProviderBusyInterval[],
    accessToken = DEFAULT_FAKE_ACCESS_TOKEN
  ): void {
    this.freeBusyBucket(accessToken).set(calendarId, [...values]);
  }

  public setInvitation(
    calendarId: string,
    eventId: string,
    fixture: FakeInvitationFixture = {},
    accessToken = DEFAULT_FAKE_ACCESS_TOKEN
  ): void {
    this.invitations.set(this.key(accessToken, calendarId, eventId), {
      organizerSelf: fixture.organizerSelf ?? false,
      selfAttendeeEmail: fixture.selfAttendeeEmail === undefined
        ? "self@example.invalid"
        : fixture.selfAttendeeEmail,
      cancelled: fixture.cancelled ?? false,
      responseStatus: fixture.responseStatus ?? "needs_action",
      comment: fixture.comment ?? "",
      revision: fixture.revision ?? 1
    });
  }

  public failNext(failure: FakeFailure): void {
    this.nextFailure = failure;
  }

  /** Test/development hook for a user-owned event that happens to occupy a
   * deterministic Planipus ID. Recovery must never adopt or overwrite it. */
  public setUnmanagedEvent(calendarId: string, eventId: string, accessToken?: string): void {
    const token = this.accessTokenForHook(calendarId, accessToken);
    this.events.set(this.key(token, calendarId, eventId), { desired: null, revision: 1 });
  }

  /** Test/development hooks that model direct destination edits without going
   * through Planipus. Editing preserves private ownership markers, as Google
   * Calendar's normal UI does; deleting removes the event entirely. */
  public simulateManualEdit(
    calendarId: string,
    eventId: string,
    transform: (current: DesiredCopy) => DesiredCopy,
    accessToken?: string
  ): void {
    const key = this.key(this.accessTokenForHook(calendarId, accessToken), calendarId, eventId);
    const event = this.events.get(key);
    if (!event?.desired) {
      throw new Error("cannot manually edit a missing or unmanaged fake event");
    }
    this.events.set(key, {
      desired: transform(event.desired),
      revision: event.revision + 1
    });
  }

  public simulateManualDelete(calendarId: string, eventId: string, accessToken?: string): void {
    const token = this.accessTokenForHook(calendarId, accessToken);
    this.events.delete(this.key(token, calendarId, eventId));
  }

  public async listCalendars(accessToken: string): Promise<readonly ProviderCalendar[]> {
    this.maybeFailAuthentication();
    return [...(this.calendars.get(accessToken) ?? new Map()).values()];
  }

  public async queryFreeBusy(
    accessToken: string,
    request: ProviderFreeBusyRequest
  ): Promise<ProviderFreeBusyResult> {
    this.maybeFailAuthentication();
    assertFreeBusyRequest(request);
    const values = this.freeBusy.get(accessToken);
    return {
      timeMin: request.timeMin,
      timeMax: request.timeMax,
      calendars: request.calendarIds.map((calendarId) => ({
        calendarId,
        busy: [...(values?.get(calendarId) ?? [])]
      }))
    };
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
    this.maybeFailAuthentication();
    if (this.consumeFailure("gone_cursor")) {
      throw new ProviderError("cursor_gone", "fake cursor expired", false, false, 410);
    }
    const values = this.observations.get(accessToken)?.get(calendarId) ?? [];
    const offset = request.pageToken ? Number(request.pageToken) : 0;
    const page = values.slice(offset, offset + 100);
    const next = offset + page.length < values.length ? String(offset + page.length) : null;
    return {
      observations: page,
      nextPageToken: next,
      nextSyncToken: next ? null : `fake-sync-${values.length}`
    };
  }

  public async getEvent(accessToken: string, calendarId: string, eventId: string): Promise<ProviderEventLookup | null> {
    this.maybeFailAuthentication();
    this.rememberAccessToken(calendarId, accessToken);
    const event = this.events.get(this.key(accessToken, calendarId, eventId));
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
    accessToken: string,
    calendarId: string,
    eventId: string,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult> {
    this.maybeFailBeforeWrite();
    this.rememberAccessToken(calendarId, accessToken);
    const key = this.key(accessToken, calendarId, eventId);
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
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    desired: DesiredCopy
  ): Promise<ProviderWriteResult> {
    this.maybeFailBeforeWrite();
    this.rememberAccessToken(calendarId, accessToken);
    const key = this.key(accessToken, calendarId, eventId);
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
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null
  ): Promise<void> {
    this.maybeFailBeforeWrite();
    this.rememberAccessToken(calendarId, accessToken);
    const key = this.key(accessToken, calendarId, eventId);
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

  public async declineInvitation(
    accessToken: string,
    calendarId: string,
    eventId: string,
    request: ProviderDeclineInvitationRequest
  ): Promise<ProviderDeclineInvitationResult> {
    this.maybeFailBeforeWrite();
    this.rememberAccessToken(calendarId, accessToken);
    const key = this.key(accessToken, calendarId, eventId);
    const event = this.invitations.get(key);
    if (!event) {
      throw new ProviderError("not_found", "fake invitation is missing", false, false, 404);
    }
    requireRespondableInvitation(event);
    if (event.responseStatus === "declined" && event.comment === request.comment) {
      return declineResult(eventId, event, false);
    }
    if (event.responseStatus !== "needs_action") {
      throw new ProviderError(
        "invitation_already_answered",
        "fake invitation already has an attendee response",
        false
      );
    }
    if (request.expectedRevision && request.expectedRevision !== String(event.revision)) {
      throw new ProviderError("precondition_failed", "fake invitation revision changed", false, false, 412);
    }
    const updated: FakeStoredInvitation = {
      ...event,
      responseStatus: "declined",
      comment: request.comment,
      revision: event.revision + 1
    };
    this.invitations.set(key, updated);
    // Model read-after-ambiguous-write recovery inside this idempotent provider
    // operation: the state is known to match, so no blind retry is needed.
    this.consumeFailure("timeout_after_write");
    return declineResult(eventId, updated, true);
  }

  public async getPlanningEvent(
    accessToken: string,
    calendarId: string,
    eventId: string
  ): Promise<ProviderPlanningEventLookup | null> {
    this.maybeFailAuthentication();
    this.rememberAccessToken(calendarId, accessToken);
    const event = this.planningEvents.get(this.key(accessToken, calendarId, eventId));
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
    accessToken: string,
    calendarId: string,
    eventId: string,
    desired: ManagedPlanningEvent
  ): Promise<ProviderWriteResult> {
    this.maybeFailBeforeWrite();
    this.rememberAccessToken(calendarId, accessToken);
    const key = this.key(accessToken, calendarId, eventId);
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
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    desired: ManagedPlanningEvent
  ): Promise<ProviderWriteResult> {
    this.maybeFailBeforeWrite();
    this.rememberAccessToken(calendarId, accessToken);
    const key = this.key(accessToken, calendarId, eventId);
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
    accessToken: string,
    calendarId: string,
    eventId: string,
    expectedRevision: string | null,
    _sendUpdates: boolean
  ): Promise<void> {
    this.maybeFailBeforeWrite();
    this.rememberAccessToken(calendarId, accessToken);
    const key = this.key(accessToken, calendarId, eventId);
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

  public planningDesired(
    calendarId: string,
    eventId: string,
    accessToken?: string
  ): ManagedPlanningEvent | null {
    const token = this.accessTokenForHook(calendarId, accessToken);
    return this.planningEvents.get(this.key(token, calendarId, eventId))?.desired ?? null;
  }

  public desired(calendarId: string, eventId: string, accessToken?: string): DesiredCopy | null {
    const token = this.accessTokenForHook(calendarId, accessToken);
    return this.events.get(this.key(token, calendarId, eventId))?.desired ?? null;
  }

  public invitation(
    calendarId: string,
    eventId: string,
    accessToken?: string
  ): FakeInvitationFixture | null {
    const token = this.accessTokenForHook(calendarId, accessToken);
    const event = this.invitations.get(this.key(token, calendarId, eventId));
    return event ? { ...event } : null;
  }

  private key(accessToken: string, calendarId: string, eventId: string): string {
    return `${accessToken}\u0000${calendarId}\u0000${eventId}`;
  }

  private rememberAccessToken(calendarId: string, accessToken: string): void {
    const tokens = this.seenAccessTokens.get(calendarId) ?? new Set<string>();
    tokens.add(accessToken);
    this.seenAccessTokens.set(calendarId, tokens);
  }

  private accessTokenForHook(calendarId: string, explicit?: string): string {
    if (explicit) return explicit;
    const tokens = this.seenAccessTokens.get(calendarId);
    if (!tokens || tokens.size === 0) return DEFAULT_FAKE_ACCESS_TOKEN;
    if (tokens.size === 1) return tokens.values().next().value ?? DEFAULT_FAKE_ACCESS_TOKEN;
    throw new Error("fake provider hook requires an access token for an ambiguous calendar ID");
  }

  private calendarBucket(accessToken: string): Map<string, ProviderCalendar> {
    const existing = this.calendars.get(accessToken);
    if (existing) return existing;
    const bucket = new Map<string, ProviderCalendar>();
    this.calendars.set(accessToken, bucket);
    return bucket;
  }

  private observationBucket(accessToken: string): Map<string, SourceObservation[]> {
    const existing = this.observations.get(accessToken);
    if (existing) return existing;
    const bucket = new Map<string, SourceObservation[]>();
    this.observations.set(accessToken, bucket);
    return bucket;
  }

  private freeBusyBucket(accessToken: string): Map<string, ProviderBusyInterval[]> {
    const existing = this.freeBusy.get(accessToken);
    if (existing) return existing;
    const bucket = new Map<string, ProviderBusyInterval[]>();
    this.freeBusy.set(accessToken, bucket);
    return bucket;
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

function assertFreeBusyRequest(request: ProviderFreeBusyRequest): void {
  const minimum = Date.parse(request.timeMin);
  const maximum = Date.parse(request.timeMax);
  if (
    request.calendarIds.length < 1
    || request.calendarIds.length > 50
    || new Set(request.calendarIds).size !== request.calendarIds.length
    || request.calendarIds.some((calendarId) => calendarId.length < 1)
    || !Number.isFinite(minimum)
    || !Number.isFinite(maximum)
    || minimum >= maximum
  ) {
    throw new ProviderError("invalid_freebusy_request", "free/busy request is invalid", false);
  }
}

function requireRespondableInvitation(event: FakeStoredInvitation): void {
  if (event.cancelled) {
    throw new ProviderError("invitation_cancelled", "invitation is cancelled", false, false, 410);
  }
  if (event.organizerSelf || !event.selfAttendeeEmail) {
    throw new ProviderError("not_invitation", "event is not an invitation for this identity", false);
  }
}

function declineResult(
  eventId: string,
  event: FakeStoredInvitation,
  changed: boolean
): ProviderDeclineInvitationResult {
  return {
    remoteEventId: eventId,
    remoteRevision: String(event.revision),
    responseStatus: "declined",
    comment: event.comment,
    commentRetained: true,
    changed
  };
}
