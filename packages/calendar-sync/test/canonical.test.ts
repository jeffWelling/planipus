import { describe, expect, it } from "vitest";
import { canonicalizeJson, materializeHours, sha256Canonical } from "../src/index.js";

describe("canonical JSON", () => {
  it("sorts keys, normalizes strings to NFC, and hashes deterministically", () => {
    const value = { b: 2, a: "e\u0301" };
    expect(canonicalizeJson(value)).toBe("{\"a\":\"é\",\"b\":2}");
    expect(sha256Canonical(value)).toBe(
      "sha256:06c264c46ad5ada9493abd3aa2383fb205ae99d7d0bad40b03a43bfec8a1b8de",
    );
  });

  it("rejects unsafe integers and NFC-equivalent duplicate keys", () => {
    expect(() => canonicalizeJson(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integers/);
    expect(() => canonicalizeJson({ é: 1, "e\u0301": 2 })).toThrow(/duplicate keys/);
  });
});

describe("hours materialization", () => {
  it("materializes local weekly windows across a daylight-saving boundary", () => {
    const result = materializeHours({
      profile: {
        profile_ref: "meeting-hours",
        revision: 1,
        timezone: "America/Vancouver",
        dst_resolution: {
          ambiguous: "earlier_offset",
          nonexistent: "shift_forward_by_gap",
        },
        weekly: [
          { weekday: 7, start: "01:30:00", end: "03:30:00", end_day_offset: 0 },
        ],
        exceptions: [],
      },
      start_date: "2026-03-08",
      end_date_exclusive: "2026-03-09",
    });

    expect(result.concrete_intervals).toEqual([
      { start: "2026-03-08T09:30:00Z", end: "2026-03-08T10:30:00Z" },
    ]);
    expect(result.diagnostics).toEqual([]);
  });
});
