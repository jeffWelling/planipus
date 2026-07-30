import type { DesiredCopy, SourceObservation } from "@planipus/calendar-sync";
import { describe, expect, it } from "vitest";

import { FakeCalendarProvider } from "../src/providers/fake.js";
import { fakeAccessTokenForConnection } from "../src/providers/fake-token.js";
import { GoogleCalendarProvider } from "../src/providers/google/calendar.js";
import { serializeGoogleDesiredCopy, serializeGooglePlanningEvent } from "../src/providers/google/serializer.js";
import type { ManagedPlanningEvent } from "../src/planning/types.js";
import {
  effectPolicyExecutionDisposition,
  eventBelongsToProjection,
  managedEventId
} from "../src/sync/effects.js";
import {
  policyCapabilitiesForRole,
  roleCanSyncEventContent
} from "../src/sync/coordinator.js";
import {
  markDestinationIdentityInvitation,
  observationForEvaluation
} from "../src/sync/reconciliation.js";

const desired: DesiredCopy = {
  timing: {
    kind: "timed",
    start_instant: "2026-07-20T17:00:00Z",
    end_instant: "2026-07-20T18:00:00Z",
    start_tzid: "America/Vancouver",
    end_tzid: "America/Vancouver"
  },
  summary: "Busy",
  transparency: "opaque",
  visibility: "private",
  reminders: [],
  write_controls: { send_notifications: false },
  provenance: {
    version: 1,
    policy_ref: "policy-1",
    projection_ref: "projection-1",
    generation: 1
  }
};

const planned: ManagedPlanningEvent = {
  timing: {
    start_instant: "2026-07-21T18:30:00Z",
    end_instant: "2026-07-21T19:00:00Z",
    timezone: "America/Vancouver"
  },
  summary: "Weekly one-to-one",
  transparency: "opaque",
  visibility: "default",
  attendees: [{ email: "teammate@example.invalid", optional: false }],
  reminders: [],
  write_controls: { send_updates: true },
  provenance: {
    version: 1,
    kind: "smart_meeting",
    rule_ref: "rule-1",
    planned_event_ref: "planned-1",
    occurrence_key: "week:2026-07-20",
    generation: 1,
    intent_sequence: 1
  }
};

describe("provider boundary", () => {
  it("keeps Google freeBusyReader calendars available without granting event-list readability", async () => {
    const provider = new GoogleCalendarProvider(async () => new Response(JSON.stringify({
      items: [{
        id: "shared-freebusy",
        summary: "Shared availability",
        timeZone: "UTC",
        accessRole: "freeBusyReader"
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(provider.listCalendars("token")).resolves.toEqual([expect.objectContaining({
      remoteId: "shared-freebusy",
      accessRole: "freeBusyReader",
      freeBusyReadable: true,
      readable: false,
      writable: false
    })]);
  });

  it("keeps fake account calendar discovery isolated by connection", async () => {
    const provider = new FakeCalendarProvider();
    const personalToken = fakeAccessTokenForConnection("personal-connection");
    const workToken = fakeAccessTokenForConnection("work-connection");
    provider.addCalendar({
      remoteId: "primary",
      name: "Personal",
      timezone: "UTC",
      accessRole: "reader",
      readable: true,
      writable: false,
      primary: true
    }, personalToken);
    provider.addCalendar({
      remoteId: "primary",
      name: "Work",
      timezone: "UTC",
      accessRole: "owner",
      readable: true,
      writable: true,
      primary: true
    }, workToken);

    await expect(provider.listCalendars(personalToken)).resolves.toMatchObject([{ name: "Personal" }]);
    await expect(provider.listCalendars(workToken)).resolves.toMatchObject([{ name: "Work" }]);
    await expect(provider.listCalendars(fakeAccessTokenForConnection("unknown-connection")))
      .resolves.toEqual([]);
    await expect(provider.createEvent(
      personalToken,
      "primary",
      "same-event",
      { ...desired, summary: "Personal busy" }
    )).resolves.toMatchObject({ remoteRevision: "1" });
    await expect(provider.createEvent(
      workToken,
      "primary",
      "same-event",
      { ...desired, summary: "Work busy" }
    )).resolves.toMatchObject({ remoteRevision: "1" });
    expect(provider.desired("primary", "same-event", personalToken)?.summary).toBe("Personal busy");
    expect(provider.desired("primary", "same-event", workToken)?.summary).toBe("Work busy");
    await provider.deleteEvent(workToken, "primary", "same-event", "1");
    expect(provider.desired("primary", "same-event", personalToken)?.summary).toBe("Personal busy");
    expect(provider.desired("primary", "same-event", workToken)).toBeNull();

    await expect(provider.createPlanningEvent(
      personalToken,
      "primary",
      "same-planned-event",
      { ...planned, summary: "Personal meeting" }
    )).resolves.toMatchObject({ remoteRevision: "1" });
    await expect(provider.createPlanningEvent(
      workToken,
      "primary",
      "same-planned-event",
      { ...planned, summary: "Work meeting" }
    )).resolves.toMatchObject({ remoteRevision: "1" });
    expect(provider.planningDesired("primary", "same-planned-event", personalToken)?.summary)
      .toBe("Personal meeting");
    expect(provider.planningDesired("primary", "same-planned-event", workToken)?.summary)
      .toBe("Work meeting");
  });

  it("keeps free/busy and invitation responses isolated by fake account token", async () => {
    const provider = new FakeCalendarProvider();
    const personalToken = fakeAccessTokenForConnection("personal-connection");
    const workToken = fakeAccessTokenForConnection("work-connection");
    provider.setFreeBusy("primary", [{
      start: "2026-07-22T17:00:00Z",
      end: "2026-07-22T18:00:00Z"
    }], personalToken);
    provider.setFreeBusy("primary", [], workToken);
    provider.setInvitation("primary", "same-invitation", {
      selfAttendeeEmail: "personal@example.invalid"
    }, personalToken);
    provider.setInvitation("primary", "same-invitation", {
      selfAttendeeEmail: "work@example.invalid"
    }, workToken);

    const request = {
      calendarIds: ["primary"],
      timeMin: "2026-07-22T00:00:00Z",
      timeMax: "2026-07-23T00:00:00Z"
    } as const;
    await expect(provider.queryFreeBusy(personalToken, request)).resolves.toMatchObject({
      calendars: [{ busy: [{ start: "2026-07-22T17:00:00Z" }] }]
    });
    await expect(provider.queryFreeBusy(workToken, request)).resolves.toMatchObject({
      calendars: [{ busy: [] }]
    });
    await expect(provider.declineInvitation(workToken, "primary", "same-invitation", {
      expectedRevision: "1",
      comment: "I’m unavailable at that time."
    })).resolves.toMatchObject({ changed: true, responseStatus: "declined", remoteRevision: "2" });

    expect(provider.invitation("primary", "same-invitation", workToken)).toMatchObject({
      responseStatus: "declined",
      comment: "I’m unavailable at that time."
    });
    expect(provider.invitation("primary", "same-invitation", personalToken)).toMatchObject({
      responseStatus: "needs_action",
      comment: ""
    });
  });

  it("makes fake invitation decline idempotent and safely resolves an ambiguous write", async () => {
    const provider = new FakeCalendarProvider();
    provider.setInvitation("work", "invite-1", {}, "token");
    provider.failNext("timeout_after_write");
    const first = await provider.declineInvitation("token", "work", "invite-1", {
      expectedRevision: "1",
      comment: "Not available"
    });
    const second = await provider.declineInvitation("token", "work", "invite-1", {
      expectedRevision: "1",
      comment: "Not available"
    });
    expect(first).toMatchObject({ changed: true, remoteRevision: "2" });
    expect(second).toMatchObject({ changed: false, remoteRevision: "2" });
  });

  it.each([
    [{ organizerSelf: true }, "not_invitation"],
    [{ selfAttendeeEmail: null }, "not_invitation"],
    [{ cancelled: true }, "invitation_cancelled"],
    [{ responseStatus: "accepted" as const }, "invitation_already_answered"],
    [{ responseStatus: "tentative" as const }, "invitation_already_answered"],
    [{ responseStatus: "declined" as const, comment: "A different response" }, "invitation_already_answered"]
  ] as const)("rejects an unsafe fake invitation response %#", async (fixture, code) => {
    const provider = new FakeCalendarProvider();
    provider.setInvitation("work", "invite-unsafe", fixture, "token");
    await expect(provider.declineInvitation("token", "work", "invite-unsafe", {
      expectedRevision: "1",
      comment: "Unavailable"
    })).rejects.toMatchObject({ code });
  });

  it("recovers an ambiguous create through its deterministic identifier", async () => {
    const provider = new FakeCalendarProvider();
    provider.addCalendar({
      remoteId: "work",
      name: "Work",
      timezone: "UTC",
      accessRole: "owner",
      readable: true,
      writable: true,
      primary: true
    });
    provider.failNext("timeout_after_write");
    await expect(provider.createEvent("token", "work", "pmanaged1", desired))
      .rejects.toMatchObject({ ambiguous: true, retryable: true });
    await expect(provider.getEvent("token", "work", "pmanaged1")).resolves.toEqual({
      remoteEventId: "pmanaged1",
      remoteRevision: "1",
      managedIdentity: {
        policyRef: "policy-1",
        projectionRef: "projection-1",
        generation: 1
      }
    });
  });

  it("recovers an ambiguous update by reading and using the fresh revision", async () => {
    const provider = new FakeCalendarProvider();
    await provider.createEvent("token", "work", "pmanaged-update", desired);
    const changed = { ...desired, summary: "Still busy" };
    provider.failNext("timeout_after_write");
    await expect(provider.updateEvent("token", "work", "pmanaged-update", "1", changed))
      .rejects.toMatchObject({ ambiguous: true });
    const observed = await provider.getEvent("token", "work", "pmanaged-update");
    expect(observed?.remoteRevision).toBe("2");
    await expect(provider.updateEvent(
      "token",
      "work",
      "pmanaged-update",
      observed?.remoteRevision ?? null,
      changed
    )).resolves.toMatchObject({ remoteRevision: "3" });
  });

  it.each([
    ["unauthorized", "provider_auth", 401, false],
    ["gone_cursor", "cursor_gone", 410, false],
    ["rate_limited", "rate_limited", 429, true],
    ["precondition", "precondition_failed", 412, false]
  ] as const)("exposes safe injected %s failures", async (failure, code, status, retryable) => {
    const provider = new FakeCalendarProvider();
    provider.failNext(failure);
    const operation = failure === "gone_cursor"
      ? provider.listEvents("token", "source", {})
      : failure === "unauthorized"
        ? provider.listCalendars("token")
        : provider.createEvent("token", "destination", "pmanaged2", desired);
    await expect(operation).rejects.toMatchObject({ code, status, retryable });
  });

  it("paginates normalized source observations", async () => {
    const provider = new FakeCalendarProvider();
    const observation: SourceObservation = {
      source_event_ref: "source-1",
      source_occurrence_ref: "",
      remote_revision: "etag-1",
      lifecycle: "confirmed",
      origin: "provider_original",
      timing: desired.timing,
      availability: "busy",
      relationship: { role: "organizer", response: "accepted" },
      destination_identity_invited: false,
      content: { summary: "Private appointment" }
    };
    provider.setObservations("personal", Array.from({ length: 101 }, () => observation), "token");
    const first = await provider.listEvents("token", "personal", {});
    const second = await provider.listEvents("token", "personal", { pageToken: first.nextPageToken ?? "100" });
    const unrelated = await provider.listEvents("other-token", "personal", {});
    expect(first.observations).toHaveLength(100);
    expect(second.observations).toHaveLength(1);
    expect(second.nextSyncToken).toBe("fake-sync-101");
    expect(unrelated.observations).toHaveLength(0);
  });

  it("materializes recurring instances and preserves exception identities", async () => {
    let requestedUrl = "";
    const fetchStub: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        items: [
          {
            id: "series_20260720T170000Z",
            etag: "one",
            status: "confirmed",
            summary: "Weekly appointment",
            recurringEventId: "series",
            originalStartTime: { dateTime: "2026-07-20T17:00:00Z", timeZone: "UTC" },
            start: { dateTime: "2026-07-20T17:00:00Z", timeZone: "UTC" },
            end: { dateTime: "2026-07-20T18:00:00Z", timeZone: "UTC" }
          },
          {
            id: "series_20260727T170000Z",
            etag: "two",
            status: "confirmed",
            summary: "Moved appointment",
            recurringEventId: "series",
            originalStartTime: { dateTime: "2026-07-27T17:00:00Z", timeZone: "UTC" },
            start: { dateTime: "2026-07-27T19:00:00Z", timeZone: "UTC" },
            end: { dateTime: "2026-07-27T20:00:00Z", timeZone: "UTC" }
          }
        ],
        nextSyncToken: "sync-1"
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const provider = new GoogleCalendarProvider(fetchStub);
    const page = await provider.listEvents("access", "personal", {
      timeMin: "2026-07-01T00:00:00Z",
      timeMax: "2027-07-01T00:00:00Z"
    });

    const url = new URL(requestedUrl);
    expect(url.searchParams.get("singleEvents")).toBe("true");
    expect(url.searchParams.get("timeMax")).toBe("2027-07-01T00:00:00Z");
    expect(page.observations.map((item) => item.source_event_ref)).toEqual([
      "series_20260720T170000Z",
      "series_20260727T170000Z"
    ]);
    expect(page.observations.map((item) => item.source_occurrence_ref)).toEqual([
      "2026-07-20T17:00:00Z",
      "2026-07-27T17:00:00Z"
    ]);
    expect(page.observations[1]?.timing).toMatchObject({ start_instant: "2026-07-27T19:00:00.000Z" });
  });

  it("queries Google free/busy without requesting or returning event details", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const provider = new GoogleCalendarProvider(async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({
        timeMin: "2026-07-22T00:00:00Z",
        timeMax: "2026-07-23T00:00:00Z",
        calendars: {
          personal: {
            busy: [{
              start: "2026-07-22T11:00:00-07:00",
              end: "2026-07-22T12:00:00-07:00"
            }]
          },
          family: { busy: [] }
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const result = await provider.queryFreeBusy("personal-token", {
      calendarIds: ["personal", "family"],
      timeMin: "2026-07-22T00:00:00Z",
      timeMax: "2026-07-23T00:00:00Z"
    });

    const body = JSON.parse(String(requestedInit?.body)) as Record<string, unknown>;
    expect(new URL(requestedUrl).pathname).toBe("/calendar/v3/freeBusy");
    expect(requestedInit?.method).toBe("POST");
    expect(new Headers(requestedInit?.headers).get("authorization")).toBe("Bearer personal-token");
    expect(body).toEqual({
      timeMin: "2026-07-22T00:00:00Z",
      timeMax: "2026-07-23T00:00:00Z",
      timeZone: "UTC",
      calendarExpansionMax: 2,
      items: [{ id: "personal" }, { id: "family" }]
    });
    expect(JSON.stringify(body)).not.toMatch(/summary|description|location|attendee/iu);
    expect(result).toEqual({
      timeMin: "2026-07-22T00:00:00.000Z",
      timeMax: "2026-07-23T00:00:00.000Z",
      calendars: [{
        calendarId: "personal",
        busy: [{
          start: "2026-07-22T18:00:00.000Z",
          end: "2026-07-22T19:00:00.000Z"
        }]
      }, { calendarId: "family", busy: [] }]
    });
  });

  it("fails closed when Google reports a per-calendar free/busy error", async () => {
    const provider = new GoogleCalendarProvider(async () => new Response(JSON.stringify({
      timeMin: "2026-07-22T00:00:00Z",
      timeMax: "2026-07-23T00:00:00Z",
      calendars: { personal: { errors: [{ reason: "notFound" }] } }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(provider.queryFreeBusy("token", {
      calendarIds: ["personal"],
      timeMin: "2026-07-22T00:00:00Z",
      timeMax: "2026-07-23T00:00:00Z"
    })).rejects.toMatchObject({ code: "freebusy_unavailable", retryable: true });
  });

  it("declines only the signed-in Google attendee with a quiet exact comment", async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
    let getCalls = 0;
    const provider = new GoogleCalendarProvider(async (input, init) => {
      requests.push({ url: new URL(String(input)), init });
      if (init?.method === "GET") {
        getCalls += 1;
        const applied = getCalls === 2;
        return new Response(JSON.stringify({
          id: "instance-1",
          etag: applied ? "etag-2" : "etag-1",
          status: "confirmed",
          organizer: { self: false },
          attendees: [{
            email: "work@example.invalid",
            self: true,
            responseStatus: applied ? "declined" : "needsAction",
            ...(applied ? { comment: "I’m unavailable at that time." } : {})
          }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "instance-1", etag: "etag-2" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const result = await provider.declineInvitation("work-token", "work/calendar", "instance-1", {
      expectedRevision: "etag-1",
      comment: "I’m unavailable at that time."
    });

    expect(result).toMatchObject({
      remoteEventId: "instance-1",
      remoteRevision: "etag-2",
      responseStatus: "declined",
      comment: "I’m unavailable at that time.",
      changed: true
    });
    expect(requests).toHaveLength(3);
    expect(requests[0]?.url.searchParams.get("maxAttendees")).toBe("1");
    expect(requests[0]?.url.searchParams.get("fields")).not.toMatch(/summary|description|location/iu);
    expect(requests[1]?.url.pathname).toContain("/calendars/work%2Fcalendar/events/instance-1");
    expect(requests[1]?.url.searchParams.get("sendUpdates")).toBe("none");
    expect(requests[1]?.init?.method).toBe("PATCH");
    expect(new Headers(requests[1]?.init?.headers).get("if-match")).toBe("etag-1");
    expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe("Bearer work-token");
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      attendeesOmitted: true,
      attendees: [{
        email: "work@example.invalid",
        responseStatus: "declined",
        comment: "I’m unavailable at that time."
      }]
    });
    expect(requests[2]?.init?.method).toBe("GET");
    expect(requests[2]?.url.searchParams.get("fields")).toContain("attendees");
  });

  it("does not write when the Google attendee response and comment already match", async () => {
    let calls = 0;
    const provider = new GoogleCalendarProvider(async () => {
      calls += 1;
      return new Response(JSON.stringify({
        id: "invite-1",
        etag: "etag-7",
        status: "confirmed",
        organizer: { self: false },
        attendees: [{
          email: "work@example.invalid",
          self: true,
          responseStatus: "declined",
          comment: "Unavailable"
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(provider.declineInvitation("token", "work", "invite-1", {
      expectedRevision: "stale-etag-from-the-original-intent",
      comment: "Unavailable"
    })).resolves.toMatchObject({ changed: false, remoteRevision: "etag-7" });
    expect(calls).toBe(1);
  });

  it("recovers a pending intent when a prior process left the RSVP declined without its comment", async () => {
    let calls = 0;
    const provider = new GoogleCalendarProvider(async () => {
      calls += 1;
      return new Response(JSON.stringify({
        id: "invite-1",
        etag: "etag-after-crash",
        status: "confirmed",
        organizer: { self: false },
        attendees: [{
          email: "work@example.invalid",
          self: true,
          responseStatus: "declined"
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(provider.declineInvitation("token", "work", "invite-1", {
      expectedRevision: "etag-before-crash",
      comment: "Unavailable"
    })).resolves.toMatchObject({
      changed: false,
      responseStatus: "declined",
      commentRetained: false,
      remoteRevision: "etag-after-crash"
    });
    expect(calls).toBe(1);
  });

  it("recovers an ambiguous Google decline by reading the exact attendee response", async () => {
    let calls = 0;
    const provider = new GoogleCalendarProvider(async () => {
      calls += 1;
      if (calls === 2) throw new TypeError("socket closed after write");
      const applied = calls === 3;
      return new Response(JSON.stringify({
        id: "invite-1",
        etag: applied ? "etag-2" : "etag-1",
        status: "confirmed",
        organizer: { self: false },
        attendees: [{
          email: "work@example.invalid",
          self: true,
          responseStatus: applied ? "declined" : "needsAction",
          ...(applied ? { comment: "Unavailable" } : {})
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(provider.declineInvitation("token", "work", "invite-1", {
      expectedRevision: "etag-1",
      comment: "Unavailable"
    })).resolves.toMatchObject({ changed: true, remoteRevision: "etag-2" });
    expect(calls).toBe(3);
  });

  it("verifies a write-side Google 5xx that may have committed the decline", async () => {
    let calls = 0;
    const provider = new GoogleCalendarProvider(async () => {
      calls += 1;
      if (calls === 2) {
        return new Response(JSON.stringify({ error: { code: 500 } }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });
      }
      const applied = calls === 3;
      return new Response(JSON.stringify({
        id: "invite-1",
        etag: applied ? "etag-2" : "etag-1",
        status: "confirmed",
        organizer: { self: false },
        attendees: [{
          email: "work@example.invalid",
          self: true,
          responseStatus: applied ? "declined" : "needsAction"
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(provider.declineInvitation("token", "work", "invite-1", {
      expectedRevision: "etag-1",
      comment: "Unavailable"
    })).resolves.toMatchObject({
      changed: true,
      responseStatus: "declined",
      commentRetained: false,
      remoteRevision: "etag-2"
    });
    expect(calls).toBe(3);
  });

  it("treats malformed successful write bodies as ambiguous and verifies the exact RSVP", async () => {
    let calls = 0;
    const provider = new GoogleCalendarProvider(async () => {
      calls += 1;
      if (calls === 2) {
        return new Response("{not-json", {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      const applied = calls === 3;
      return new Response(JSON.stringify({
        id: "invite-1",
        etag: applied ? "etag-2" : "etag-1",
        status: "confirmed",
        organizer: { self: false },
        attendees: [{
          email: "work@example.invalid",
          self: true,
          responseStatus: applied ? "declined" : "needsAction",
          ...(applied ? { comment: "Unavailable" } : {})
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(provider.declineInvitation("token", "work", "invite-1", {
      expectedRevision: "etag-1",
      comment: "Unavailable"
    })).resolves.toMatchObject({ changed: true, remoteRevision: "etag-2" });
    expect(calls).toBe(3);
  });

  it("reports a durable decline with a warning when Google does not retain the configured comment", async () => {
    let calls = 0;
    const provider = new GoogleCalendarProvider(async () => {
      calls += 1;
      const applied = calls === 3;
      return new Response(JSON.stringify({
        id: "invite-1",
        etag: applied ? "etag-2" : "etag-1",
        status: "confirmed",
        organizer: { self: false },
        attendees: [{
          email: "work@example.invalid",
          self: true,
          responseStatus: applied ? "declined" : "needsAction"
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(provider.declineInvitation("token", "work", "invite-1", {
      expectedRevision: "etag-1",
      comment: "Unavailable"
    })).resolves.toMatchObject({
      responseStatus: "declined",
      remoteRevision: "etag-2",
      comment: "",
      commentRetained: false,
      changed: true
    });
    expect(calls).toBe(3);
  });

  it.each([
    [{ organizer: { self: true }, attendees: [{ email: "self@example.invalid", self: true }] }, "not_invitation"],
    [{ organizer: { self: false }, attendees: [{ email: "other@example.invalid", self: false }] }, "not_invitation"],
    [{ status: "cancelled", organizer: { self: false }, attendees: [{ email: "self@example.invalid", self: true }] }, "invitation_cancelled"],
    [{ organizer: { self: false }, attendees: [{ email: "self@example.invalid", self: true, responseStatus: "accepted" }] }, "invitation_already_answered"],
    [{ organizer: { self: false }, attendees: [{ email: "self@example.invalid", self: true, responseStatus: "tentative" }] }, "invitation_already_answered"]
  ] as const)("rejects an unsafe Google invitation response %#", async (event, code) => {
    const provider = new GoogleCalendarProvider(async () => new Response(JSON.stringify({
      id: "invite-unsafe",
      etag: "etag-1",
      status: "confirmed",
      ...event
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(provider.declineInvitation("token", "work", "invite-unsafe", {
      expectedRevision: "etag-1",
      comment: "Unavailable"
    })).rejects.toMatchObject({ code });
  });

  it("marks events already involving the destination account before policy evaluation", () => {
    const source: SourceObservation = {
      source_event_ref: "source-2",
      source_occurrence_ref: "",
      remote_revision: "etag-2",
      lifecycle: "confirmed",
      origin: "provider_original",
      timing: desired.timing,
      relationship: { role: "organizer", response: "accepted" },
      destination_identity_invited: false,
      content: {},
      attendees: ["COLLEAGUE@example.com", " Work.Account@Example.com "]
    };
    expect(markDestinationIdentityInvitation(source, "work.account@example.com"))
      .toMatchObject({ destination_identity_invited: true });
    expect(markDestinationIdentityInvitation({ ...source, attendees: [] }, "work.account@example.com"))
      .toMatchObject({ destination_identity_invited: false });
  });

  it("converts retained tombstones into deleted evaluation observations", () => {
    const source: SourceObservation = {
      source_event_ref: "source-3",
      source_occurrence_ref: "",
      remote_revision: "etag-3",
      lifecycle: "confirmed",
      origin: "provider_original",
      timing: desired.timing,
      relationship: { role: "none", response: "not_applicable" },
      destination_identity_invited: false,
      content: {}
    };
    expect(observationForEvaluation(source, true).lifecycle).toBe("deleted");
    expect(observationForEvaluation(source, false)).toBe(source);
  });

  it("serializes privacy-safe Google writes with provenance and no reminders or attendees", () => {
    const body = serializeGoogleDesiredCopy(desired, "pmanaged1");
    expect(body).toMatchObject({
      id: "pmanaged1",
      summary: "Busy",
      visibility: "private",
      reminders: { useDefault: false },
      extendedProperties: {
        private: {
          planipus_policy: "policy-1",
          planipus_projection: "projection-1"
        }
      }
    });
    expect(body).not.toHaveProperty("attendees");
    expect(body).not.toHaveProperty("conferenceData");
  });

  it("serializes Smart Meetings with explicit attendees and separate ownership markers", () => {
    const body = serializeGooglePlanningEvent(planned, "pmeeting1");
    expect(body).toMatchObject({
      id: "pmeeting1",
      summary: "Weekly one-to-one",
      attendees: [{ email: "teammate@example.invalid", optional: false }],
      reminders: { useDefault: false },
      extendedProperties: {
        private: {
          planipus_kind: "smart_meeting",
          planipus_rule: "rule-1",
          planipus_planned_event: "planned-1",
          planipus_occurrence: "week:2026-07-20"
        }
      }
    });
    expect(body.extendedProperties.private).not.toHaveProperty("planipus_policy");
  });

  it("recovers a fake Smart Meeting write through planning ownership", async () => {
    const provider = new FakeCalendarProvider();
    provider.failNext("timeout_after_write");
    await expect(provider.createPlanningEvent("token", "work", "pmeeting1", planned))
      .rejects.toMatchObject({ ambiguous: true, retryable: true });
    await expect(provider.getPlanningEvent("token", "work", "pmeeting1")).resolves.toMatchObject({
      remoteEventId: "pmeeting1",
      managedIdentity: {
        kind: "smart_meeting",
        ruleRef: "rule-1",
        plannedEventRef: "planned-1",
        generation: 1
      }
    });
  });

  it("reads Google private ownership markers for safe ambiguity recovery", async () => {
    const provider = new GoogleCalendarProvider(async () => new Response(JSON.stringify({
      id: "pmanaged1",
      etag: "etag-1",
      extendedProperties: {
        private: {
          planipus_version: "1",
          planipus_policy: "policy-1",
          planipus_projection: "projection-1",
          planipus_generation: "1"
        }
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(provider.getEvent("token", "work", "pmanaged1")).resolves.toEqual({
      remoteEventId: "pmanaged1",
      remoteRevision: "etag-1",
      managedIdentity: {
        policyRef: "policy-1",
        projectionRef: "projection-1",
        generation: 1
      }
    });
  });

  it("uses a full Google update so privacy tightening clears omitted details", async () => {
    let observedMethod = "";
    let observedBody: Record<string, unknown> = {};
    const provider = new GoogleCalendarProvider(async (_input, init) => {
      observedMethod = init?.method ?? "";
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "pmanaged1", etag: "etag-2" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    await provider.updateEvent("token", "work", "pmanaged1", "etag-1", desired);
    expect(observedMethod).toBe("PUT");
    expect(observedBody).not.toHaveProperty("description");
    expect(observedBody).not.toHaveProperty("location");
    expect(observedBody).toMatchObject({ summary: "Busy", reminders: { useDefault: false } });
  });

  it("treats Google 404 and 410 delete responses as idempotent success", async () => {
    for (const status of [404, 410]) {
      const provider = new GoogleCalendarProvider(async () => new Response("", { status }));
      await expect(provider.deleteEvent("token", "work", "pmanaged1", "etag-1"))
        .resolves.toBeUndefined();
    }
  });

  it("builds Google-compatible stable event identifiers", () => {
    const id = managedEventId("018fa0b0-1234-7abc-8def-0123456789ab", 12);
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/u);
    expect(managedEventId("018fa0b0-1234-7abc-8def-0123456789ab", 12)).toBe(id);
  });

  it("requires every private ownership marker before ambiguity recovery may write", () => {
    const owned = {
      remoteEventId: "pmanaged1",
      remoteRevision: "etag-1",
      managedIdentity: {
        policyRef: "policy-1",
        projectionRef: "projection-1",
        generation: 1
      }
    };
    expect(eventBelongsToProjection(owned, "policy-1", "projection-1", 1)).toBe(true);
    expect(eventBelongsToProjection({ ...owned, managedIdentity: null }, "policy-1", "projection-1", 1)).toBe(false);
    expect(eventBelongsToProjection(owned, "other-policy", "projection-1", 1)).toBe(false);
    expect(eventBelongsToProjection(owned, "policy-1", "other-projection", 1)).toBe(false);
    expect(eventBelongsToProjection(owned, "policy-1", "projection-1", 2)).toBe(false);
  });

  it("never promotes a connected account beyond its intended policy role", () => {
    expect(policyCapabilitiesForRole("source", true, true)).toEqual({ readable: true, writable: false });
    expect(policyCapabilitiesForRole("availability", true, true)).toEqual({ readable: false, writable: false });
    expect(policyCapabilitiesForRole("destination", true, true)).toEqual({ readable: false, writable: true });
    expect(policyCapabilitiesForRole("both", true, true)).toEqual({ readable: true, writable: true });
    expect(policyCapabilitiesForRole("both", true, false)).toEqual({ readable: true, writable: false });
    expect(policyCapabilitiesForRole("availability", false, false, true))
      .toEqual({ readable: false, writable: false });
    expect(policyCapabilitiesForRole("source", false, false, true))
      .toEqual({ readable: false, writable: false });
    expect(roleCanSyncEventContent("availability")).toBe(false);
    expect(roleCanSyncEventContent("destination")).toBe(false);
    expect(roleCanSyncEventContent("source")).toBe(true);
    expect(roleCanSyncEventContent("both")).toBe(true);
  });

  it("fences provider effects by the current policy status and revision", () => {
    expect(effectPolicyExecutionDisposition("active", 3, 3)).toBe("execute");
    expect(effectPolicyExecutionDisposition("paused", 3, 3)).toBe("defer_paused");
    expect(effectPolicyExecutionDisposition("active", 4, 3)).toBe("defer_revision");
    expect(effectPolicyExecutionDisposition("deleted", 4, 3)).toBe("supersede_deleted");
  });
});
