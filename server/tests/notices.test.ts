import type { DesiredCopy } from "@planipus/calendar-sync";
import { describe, expect, it } from "vitest";

import { isDestinationEditHold, noticeDetailForDesiredCopy } from "../src/sync/notices.js";

const desired: DesiredCopy = {
  timing: {
    kind: "timed",
    start_instant: "2026-07-28T17:00:00Z",
    end_instant: "2026-07-28T18:00:00Z",
    start_tzid: "UTC",
    end_tzid: "UTC"
  },
  summary: "Busy",
  description: "Never disclosed by a notice",
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

describe("sync notices", () => {
  it("recognizes only attached destination-edit holds", () => {
    expect(isDestinationEditHold({
      status: "held",
      ownership: "attached",
      safe_error_code: "destination_edit_held"
    })).toBe(true);
    expect(isDestinationEditHold({
      status: "held",
      ownership: "attached",
      safe_error_code: "destination_delete_held"
    })).toBe(true);
    // Ownership-mismatch holds keep their own recovery path.
    expect(isDestinationEditHold({
      status: "held",
      ownership: "ambiguous",
      safe_error_code: "ownership_mismatch"
    })).toBe(false);
    expect(isDestinationEditHold({
      status: "converged",
      ownership: "attached",
      safe_error_code: "destination_edit_held"
    })).toBe(false);
    expect(isDestinationEditHold({
      status: "held",
      ownership: "attached",
      safe_error_code: null
    })).toBe(false);
  });

  it("limits notice detail to the copy's already-disclosed identity fields", () => {
    const detail = noticeDetailForDesiredCopy("drifted", desired);
    expect(detail).toEqual({
      observed: "drifted",
      copy_summary: "Busy",
      copy_timing: desired.timing
    });
    // The privacy-transformed summary/timing already exist on the destination
    // calendar; nothing else from the desired copy may leak into a notice.
    expect(Object.keys(detail).sort()).toEqual(["copy_summary", "copy_timing", "observed"]);
  });
});
