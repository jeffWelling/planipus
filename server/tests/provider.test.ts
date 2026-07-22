import type { DesiredCopy, SourceObservation } from "@planipus/calendar-sync";
import { describe, expect, it } from "vitest";

import { FakeCalendarProvider } from "../src/providers/fake.js";
import { GoogleCalendarProvider } from "../src/providers/google/calendar.js";
import { serializeGoogleDesiredCopy, serializeGooglePlanningEvent } from "../src/providers/google/serializer.js";
import type { ManagedPlanningEvent } from "../src/planning/types.js";
import {
  effectPolicyExecutionDisposition,
  eventBelongsToProjection,
  managedEventId
} from "../src/sync/effects.js";
import { policyCapabilitiesForRole } from "../src/sync/coordinator.js";
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
    provider.setObservations("personal", Array.from({ length: 101 }, () => observation));
    const first = await provider.listEvents("token", "personal", {});
    const second = await provider.listEvents("token", "personal", { pageToken: first.nextPageToken ?? "100" });
    expect(first.observations).toHaveLength(100);
    expect(second.observations).toHaveLength(1);
    expect(second.nextSyncToken).toBe("fake-sync-101");
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
    expect(policyCapabilitiesForRole("destination", true, true)).toEqual({ readable: false, writable: true });
    expect(policyCapabilitiesForRole("both", true, true)).toEqual({ readable: true, writable: true });
    expect(policyCapabilitiesForRole("both", true, false)).toEqual({ readable: true, writable: false });
  });

  it("fences provider effects by the current policy status and revision", () => {
    expect(effectPolicyExecutionDisposition("active", 3, 3)).toBe("execute");
    expect(effectPolicyExecutionDisposition("paused", 3, 3)).toBe("defer_paused");
    expect(effectPolicyExecutionDisposition("active", 4, 3)).toBe("defer_revision");
    expect(effectPolicyExecutionDisposition("deleted", 4, 3)).toBe("supersede_deleted");
  });
});
