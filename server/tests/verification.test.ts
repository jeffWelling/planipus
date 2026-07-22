import type { DesiredCopy } from "@planipus/calendar-sync";
import { describe, expect, it } from "vitest";

import { FakeCalendarProvider } from "../src/providers/fake.js";
import type { ProviderEventLookup } from "../src/providers/types.js";
import { managedEventId } from "../src/sync/effects.js";
import {
  classifyDestinationVerification,
  destinationRepairGeneration
} from "../src/sync/verification.js";

const desired: DesiredCopy = {
  timing: {
    kind: "timed",
    start_instant: "2026-07-20T17:00:00Z",
    end_instant: "2026-07-20T18:00:00Z",
    start_tzid: "UTC",
    end_tzid: "UTC"
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

const target = {
  policyId: "policy-1",
  projectionId: "projection-1",
  generation: 1,
  destinationRevision: "etag-1"
};

function owned(revision: string): ProviderEventLookup {
  return {
    remoteEventId: "pmanaged1",
    remoteRevision: revision,
    managedIdentity: {
      policyRef: "policy-1",
      projectionRef: "projection-1",
      generation: 1
    }
  };
}

describe("destination verification", () => {
  it("distinguishes current, deleted, edited, and non-owned destination state", () => {
    expect(classifyDestinationVerification(target, owned("etag-1"))).toEqual({
      kind: "current",
      observedRevision: "etag-1"
    });
    expect(classifyDestinationVerification(target, null)).toEqual({ kind: "missing" });
    expect(classifyDestinationVerification(target, owned("etag-2"))).toEqual({
      kind: "drifted",
      observedRevision: "etag-2"
    });
    expect(classifyDestinationVerification(target, {
      ...owned("foreign-1"),
      managedIdentity: null
    })).toEqual({
      kind: "ownership_mismatch",
      observedRevision: "foreign-1"
    });
    expect(classifyDestinationVerification(target, {
      ...owned("wrong-generation"),
      managedIdentity: { ...owned("unused").managedIdentity!, generation: 2 }
    })).toEqual({
      kind: "ownership_mismatch",
      observedRevision: "wrong-generation"
    });
  });

  it("models manual edits as owned revision drift and manual deletion as absence", async () => {
    const provider = new FakeCalendarProvider();
    await provider.createEvent("token", "work", "pmanaged1", desired);
    provider.simulateManualEdit("work", "pmanaged1", (event) => ({
      ...event,
      summary: "Edited directly in destination"
    }));
    const edited = await provider.getEvent("token", "work", "pmanaged1");
    expect(edited?.managedIdentity).toEqual({
      policyRef: "policy-1",
      projectionRef: "projection-1",
      generation: 1
    });
    expect(classifyDestinationVerification(
      { ...target, destinationRevision: "1" },
      edited
    )).toEqual({ kind: "drifted", observedRevision: "2" });

    provider.simulateManualDelete("work", "pmanaged1");
    await expect(provider.getEvent("token", "work", "pmanaged1")).resolves.toBeNull();
    expect(classifyDestinationVerification(target, null)).toEqual({ kind: "missing" });
  });

  it("never treats an event occupying the deterministic ID as owned by ID alone", async () => {
    const provider = new FakeCalendarProvider();
    provider.setUnmanagedEvent("work", "pmanaged1", "token");
    const observed = await provider.getEvent("token", "work", "pmanaged1");
    expect(classifyDestinationVerification(target, observed)).toMatchObject({
      kind: "ownership_mismatch"
    });
    expect(provider.desired("work", "pmanaged1")).toBeNull();
  });

  it("repairs a deleted destination with a new generation, ID, and matching provenance", () => {
    const repair = destinationRepairGeneration(desired, 1, "missing");
    const deletedId = managedEventId("018fa0b0-1234-7abc-8def-0123456789ab", 1);
    const replacementId = managedEventId(
      "018fa0b0-1234-7abc-8def-0123456789ab",
      repair.generation
    );

    expect(repair.generation).toBe(2);
    expect(repair.desiredState.provenance.generation).toBe(2);
    expect(replacementId).not.toBe(deletedId);
    expect(repair.desiredState.provenance).toMatchObject({
      policy_ref: "policy-1",
      projection_ref: "projection-1",
      generation: 2
    });

    const driftRepair = destinationRepairGeneration(desired, 1, "drifted");
    expect(driftRepair.generation).toBe(1);
    expect(driftRepair.desiredState).toBe(desired);
  });
});
