import type { SourceObservation } from "@planipus/calendar-sync";
import { describe, expect, it } from "vitest";

import {
  conflictActionBasisDocument,
  conflictPreviewResult,
  conflictSnapshotDocument,
  intervalsOverlap,
  isEligibleWorkInvitation,
  workInvitationCandidate
} from "../src/conflict-response/engine.js";
import type {
  ConflictCalendarBinding,
  ConflictResponseDraft,
  WorkObservationRow
} from "../src/conflict-response/types.js";
import {
  DEFAULT_CONFLICT_HORIZON_DAYS,
  DEFAULT_DECLINE_MESSAGE
} from "../src/conflict-response/types.js";
import {
  ConflictResponseInputError,
  parseConflictResponseDraft
} from "../src/conflict-response/validation.js";
import {
  queryOpaqueAvailability,
  requireDistinctProviderCalendars
} from "../src/conflict-response/inputs.js";
import { FakeCalendarProvider } from "../src/providers/fake.js";
import { fakeAccessTokenForConnection } from "../src/providers/fake-token.js";
import { ProviderRouter } from "../src/providers/router.js";

const now = new Date("2026-07-21T16:00:00.000Z");
const horizonEnd = new Date("2026-09-19T16:00:00.000Z");
const WORK_CALENDAR_ID = "00000000-0000-7000-8000-000000000201";
const PERSONAL_CALENDAR_ID = "00000000-0000-7000-8000-000000000202";
const A_PERSONAL_CALENDAR_ID = "00000000-0000-7000-8000-000000000203";
const Z_PERSONAL_CALENDAR_ID = "00000000-0000-7000-8000-000000000204";
const draft: ConflictResponseDraft = {
  name: "Keep personal time personal",
  response_calendar_id: WORK_CALENDAR_ID,
  availability_calendar_ids: [PERSONAL_CALENDAR_ID],
  decline_message: "I have a private conflict. Please choose another time.",
  horizon_days: 60
};
const responseCalendar: ConflictCalendarBinding = {
  id: "work-calendar",
  connection_id: "work-connection",
  remote_id: "work@example.invalid",
  name: "Work",
  readable: true,
  writable: true,
  provider: "fake",
  connection_status: "active",
  intended_role: "both"
};
const availabilityCalendar: ConflictCalendarBinding = {
  id: "personal-calendar",
  connection_id: "personal-connection",
  remote_id: "personal@example.invalid",
  name: "Personal secrets",
  readable: true,
  writable: false,
  provider: "fake",
  connection_status: "active",
  intended_role: "source"
};

describe("conflict-response draft validation", () => {
  it("normalizes safe text, sorts calendar IDs, and supplies explicit defaults", () => {
    expect(parseConflictResponseDraft({
      name: "  Quiet time  ",
      response_calendar_id: WORK_CALENDAR_ID,
      availability_calendar_ids: [Z_PERSONAL_CALENDAR_ID, A_PERSONAL_CALENDAR_ID]
    })).toEqual({
      name: "Quiet time",
      response_calendar_id: WORK_CALENDAR_ID,
      availability_calendar_ids: [A_PERSONAL_CALENDAR_ID, Z_PERSONAL_CALENDAR_ID],
      decline_message: DEFAULT_DECLINE_MESSAGE,
      horizon_days: DEFAULT_CONFLICT_HORIZON_DAYS
    });
  });

  it("rejects unknown fields instead of silently weakening a rule", () => {
    expect(() => parseConflictResponseDraft({
      ...draft,
      copy_personal_events: true
    })).toThrowError(new ConflictResponseInputError(
      "invalid_conflict_response_rule",
      "unsupported conflict-response field: copy_personal_events"
    ));
  });

  it.each([
    [{ ...draft, availability_calendar_ids: [] }, "at least one"],
    [{ ...draft, availability_calendar_ids: [PERSONAL_CALENDAR_ID, PERSONAL_CALENDAR_ID] }, "unique"],
    [{ ...draft, availability_calendar_ids: [WORK_CALENDAR_ID] }, "cannot also"],
    [{ ...draft, horizon_days: 0 }, "horizon days"],
    [{ ...draft, horizon_days: 91 }, "horizon days"],
    [{ ...draft, decline_message: "" }, "decline message"],
    [{ ...draft, decline_message: "quiet\nplease" }, "decline message"],
    [{ ...draft, response_calendar_id: ` ${WORK_CALENDAR_ID}` }, "response calendar"]
  ])("rejects invalid no-copy configuration %#", (value, message) => {
    expect(() => parseConflictResponseDraft(value)).toThrow(message as string);
  });
});

describe("work invitation safety policy", () => {
  it("accepts only a future, confirmed, timed provider invitation awaiting self response", () => {
    expect(isEligibleWorkInvitation(invitation(), now, horizonEnd)).toBe(true);
  });

  it.each([
    ["organizer", { relationship: { role: "organizer", response: "accepted" } }],
    ["accepted", { relationship: { role: "attendee", response: "accepted" } }],
    ["tentative", { relationship: { role: "attendee", response: "tentative" } }],
    ["already declined", { relationship: { role: "attendee", response: "declined" } }],
    ["transparent/free", { availability: "free" }],
    ["cancelled", { lifecycle: "cancelled" }],
    ["Planipus-managed", { origin: "planipus_managed" }],
    ["all-day", {
      timing: {
        kind: "all_day",
        start_date: "2026-07-22",
        end_date: "2026-07-23",
        timezone: "America/Vancouver"
      }
    }],
    ["already started", {
      timing: {
        kind: "timed",
        start_instant: "2026-07-21T15:30:00.000Z",
        end_instant: "2026-07-21T16:30:00.000Z",
        start_tzid: "America/Vancouver",
        end_tzid: "America/Vancouver"
      }
    }],
    ["outside horizon", {
      timing: {
        kind: "timed",
        start_instant: "2026-09-19T16:00:00.000Z",
        end_instant: "2026-09-19T17:00:00.000Z",
        start_tzid: "America/Vancouver",
        end_tzid: "America/Vancouver"
      }
    }],
    ["an oversized timed range", {
      timing: {
        kind: "timed",
        start_instant: "2026-07-22T17:00:00.000Z",
        end_instant: "2026-07-30T17:00:00.001Z",
        start_tzid: "America/Vancouver",
        end_tzid: "America/Vancouver"
      }
    }],
    ["ending outside the horizon", {
      timing: {
        kind: "timed",
        start_instant: "2026-09-18T17:00:00.000Z",
        end_instant: "2026-09-20T17:00:00.000Z",
        start_tzid: "America/Vancouver",
        end_tzid: "America/Vancouver"
      }
    }]
  ])("rejects an invitation that is %s", (_label, override) => {
    expect(isEligibleWorkInvitation({ ...invitation(), ...override } as SourceObservation, now, horizonEnd))
      .toBe(false);
  });

  it("binds the normalized event to the exact stored remote work event", () => {
    const row = observationRow();
    expect(workInvitationCandidate(row, now, horizonEnd)).toMatchObject({
      observation_id: "observation-1",
      remote_event_id: "work-event-1",
      remote_revision: "etag-1"
    });
    expect(workInvitationCandidate({
      ...row,
      remote_event_id: "different-work-event"
    }, now, horizonEnd)).toBeNull();
  });
});

describe("private free/busy conflict decisions", () => {
  it("rejects the same Google calendar exposed through distinct local connections", () => {
    const googleResponse: ConflictCalendarBinding = {
      ...responseCalendar,
      id: "local-work-one",
      connection_id: "google-connection-one",
      remote_id: "shared@example.invalid",
      provider: "google"
    };
    const aliasedAvailability: ConflictCalendarBinding = {
      ...availabilityCalendar,
      id: "local-work-two",
      connection_id: "google-connection-two",
      remote_id: "shared@example.invalid",
      provider: "google"
    };
    expect(() => requireDistinctProviderCalendars(googleResponse, [aliasedAvailability]))
      .toThrowError(expect.objectContaining({ code: "same_provider_calendar" }));
  });

  it("groups provider free/busy reads by credential without materializing personal events", async () => {
    const provider = new FakeCalendarProvider();
    const secondCalendar: ConflictCalendarBinding = {
      ...availabilityCalendar,
      id: "family-calendar",
      connection_id: "family-connection",
      remote_id: "family@example.invalid",
      name: "Family"
    };
    provider.setFreeBusy(
      availabilityCalendar.remote_id,
      [{ start: "2026-07-22T17:30:00.000Z", end: "2026-07-22T18:30:00.000Z" }],
      fakeAccessTokenForConnection(availabilityCalendar.connection_id)
    );
    provider.setFreeBusy(
      secondCalendar.remote_id,
      [{ start: "2026-07-23T17:30:00.000Z", end: "2026-07-23T18:30:00.000Z" }],
      fakeAccessTokenForConnection(secondCalendar.connection_id)
    );
    const result = await queryOpaqueAvailability(
      {
        providers: new ProviderRouter(undefined, provider),
        tokens: {
          accessToken: async (_organizationId, connectionId) =>
            fakeAccessTokenForConnection(connectionId)
        }
      },
      "organization-1",
      [secondCalendar, availabilityCalendar],
      "2026-07-21T16:00:00.000Z",
      "2026-09-19T16:00:00.000Z"
    );
    expect(result).toEqual([
      {
        calendar_id: "family-calendar",
        start: "2026-07-23T17:30:00.000Z",
        end: "2026-07-23T18:30:00.000Z"
      },
      {
        calendar_id: "personal-calendar",
        start: "2026-07-22T17:30:00.000Z",
        end: "2026-07-22T18:30:00.000Z"
      }
    ]);
  });

  it("fails closed when provider free/busy covers a different time window", async () => {
    const provider = new FakeCalendarProvider();
    provider.queryFreeBusy = async (_accessToken, request) => ({
      timeMin: "2026-07-20T16:00:00.000Z",
      timeMax: request.timeMax,
      calendars: request.calendarIds.map((calendarId) => ({ calendarId, busy: [] }))
    });

    await expect(queryOpaqueAvailability(
      {
        providers: new ProviderRouter(undefined, provider),
        tokens: {
          accessToken: async () => fakeAccessTokenForConnection(availabilityCalendar.connection_id)
        }
      },
      "organization-1",
      [availabilityCalendar],
      "2026-07-21T16:00:00.000Z",
      "2026-09-19T16:00:00.000Z"
    )).rejects.toMatchObject({ code: "freebusy_bounds_invalid" });
  });

  it("fails closed when a provider returns a busy interval outside the requested window", async () => {
    const provider = new FakeCalendarProvider();
    provider.queryFreeBusy = async (_accessToken, request) => ({
      timeMin: request.timeMin,
      timeMax: request.timeMax,
      calendars: request.calendarIds.map((calendarId) => ({
        calendarId,
        busy: [{
          start: "2026-07-20T16:00:00.000Z",
          end: "2026-07-21T17:00:00.000Z"
        }]
      }))
    });

    await expect(queryOpaqueAvailability(
      {
        providers: new ProviderRouter(undefined, provider),
        tokens: {
          accessToken: async () => fakeAccessTokenForConnection(availabilityCalendar.connection_id)
        }
      },
      "organization-1",
      [availabilityCalendar],
      "2026-07-21T16:00:00.000Z",
      "2026-09-19T16:00:00.000Z"
    )).rejects.toMatchObject({ code: "freebusy_bounds_invalid" });
  });

  it("uses half-open intervals so back-to-back meetings do not conflict", () => {
    expect(intervalsOverlap(
      "2026-07-22T17:00:00.000Z",
      "2026-07-22T18:00:00.000Z",
      "2026-07-22T18:00:00.000Z",
      "2026-07-22T19:00:00.000Z"
    )).toBe(false);
    expect(intervalsOverlap(
      "2026-07-22T17:00:00.000Z",
      "2026-07-22T18:00:00.000Z",
      "2026-07-22T17:59:59.999Z",
      "2026-07-22T19:00:00.000Z"
    )).toBe(true);
  });

  it("returns time-only preview examples and holds conflicts without a revision", () => {
    const candidate = workInvitationCandidate(observationRow(), now, horizonEnd);
    const unguarded = candidate ? { ...candidate, observation_id: "observation-2", remote_revision: null } : null;
    expect(candidate).not.toBeNull();
    expect(unguarded).not.toBeNull();
    const result = conflictPreviewResult(
      [candidate!, unguarded!],
      [{
        calendar_id: "personal-calendar",
        start: "2026-07-22T17:30:00.000Z",
        end: "2026-07-22T18:30:00.000Z"
      }]
    );
    expect(result).toMatchObject({ invitation_count: 2, conflict_count: 2, held_count: 1 });
    expect(result.examples[0]).toEqual({
      start_at: "2026-07-22T17:00:00.000Z",
      end_at: "2026-07-22T18:00:00.000Z"
    });
    expect(Object.keys(result.examples[0] ?? {})).toEqual(["start_at", "end_at"]);
  });

  it("includes rolling-budget overflow in the preview held count", () => {
    const candidate = workInvitationCandidate(observationRow(), now, horizonEnd)!;
    const invitations = Array.from({ length: 22 }, (_, index) => ({
      ...candidate,
      observation_id: `observation-${index}`
    }));
    const result = conflictPreviewResult(invitations, [{
      calendar_id: "personal-calendar",
      start: "2026-07-22T17:30:00.000Z",
      end: "2026-07-22T18:30:00.000Z"
    }], 3);

    expect(result).toMatchObject({
      conflict_count: 22,
      held_count: 5,
      budget_held_count: 5
    });
    expect(result.warnings).toContain("automatic_decline_budget_will_hold_excess");
  });

  it("creates deterministic preview and action bases without personal event identity or content", () => {
    const candidate = workInvitationCandidate(observationRow(), now, horizonEnd)!;
    const busy = [{
      calendar_id: "personal-calendar",
      start: "2026-07-22T17:30:00.000Z",
      end: "2026-07-22T18:30:00.000Z"
    }];
    const snapshot = conflictSnapshotDocument({
      draft,
      reference_at: now.toISOString(),
      horizon_end: horizonEnd.toISOString(),
      availability_end: horizonEnd.toISOString(),
      response_calendar: responseCalendar,
      availability_calendars: [availabilityCalendar],
      invitations: [candidate],
      busy,
      automatic_declines_applied_last_24_hours: 0
    });
    const actionBasis = conflictActionBasisDocument({
      rule_id: "rule-1",
      rule_revision: 1,
      invitation: candidate,
      overlapping_busy: busy
    });
    const serialized = JSON.stringify({ snapshot, actionBasis });
    expect(serialized).not.toContain("Dentist appointment");
    expect(serialized).not.toContain("personal-event-id");
    expect(serialized).not.toContain("work-event-1");
    expect(serialized).not.toContain("Personal secrets");
    expect(serialized).not.toContain("personal@example.invalid");
    expect(serialized).toContain("observation-hash-1");
    expect(serialized).toContain("personal-calendar");
  });
});

function invitation(): SourceObservation {
  return {
    source_event_ref: "work-event-1",
    source_occurrence_ref: "",
    remote_revision: "etag-1",
    lifecycle: "confirmed",
    origin: "provider_original",
    timing: {
      kind: "timed",
      start_instant: "2026-07-22T17:00:00.000Z",
      end_instant: "2026-07-22T18:00:00.000Z",
      start_tzid: "America/Vancouver",
      end_tzid: "America/Vancouver"
    },
    availability: "busy",
    relationship: { role: "attendee", response: "needs_action" },
    destination_identity_invited: false,
    content: { summary: "Work event that must not enter an action basis" }
  };
}

function observationRow(): WorkObservationRow {
  return {
    id: "observation-1",
    remote_event_id: "work-event-1",
    recurrence_identity: "",
    remote_etag: "etag-1",
    observation_hash: "observation-hash-1",
    normalized_event: invitation()
  };
}
