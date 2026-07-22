import { describe, expect, it } from "vitest";

import type { PolicyEvaluationResult } from "@planipus/calendar-sync";

import { sharedPolicyRuntime } from "../src/policy/runtime.js";
import { sourceObservationBasisHash } from "../src/sync/basis.js";
import { projectionPersistenceForResult } from "../src/sync/reconciliation.js";

describe("projection reconciliation persistence", () => {
  it("preserves the last validated desired copy and reason across an ownership hold", () => {
    const desiredState = {
      timing: {
        kind: "timed",
        start_instant: "2026-07-21T18:00:00Z",
        end_instant: "2026-07-21T19:00:00Z",
        start_tzid: "UTC",
        end_tzid: "UTC"
      },
      provenance: {
        version: 1,
        policy_ref: "policy-1",
        projection_ref: "projection-1",
        generation: 3
      }
    };
    const held: PolicyEvaluationResult = {
      selection: "held",
      operation: "none",
      primary_reason_code: "ambiguous_ownership",
      reason_codes: ["ambiguous_ownership"],
      warnings: []
    };

    expect(projectionPersistenceForResult(held, {
      desired_hash: "sha256:previous",
      desired_state: desiredState,
      safe_error_code: "ownership_mismatch"
    })).toEqual({
      desiredHash: "sha256:previous",
      desiredState,
      safeErrorCode: "ownership_mismatch"
    });
  });

  it("does not retain old desired evidence for a normal exclusion", () => {
    const excluded: PolicyEvaluationResult = {
      selection: "excluded",
      operation: "none",
      primary_reason_code: "outside_hours",
      reason_codes: ["outside_hours"],
      warnings: []
    };

    expect(projectionPersistenceForResult(excluded, {
      desired_hash: "sha256:previous",
      desired_state: { stale: true },
      safe_error_code: "old_error"
    })).toEqual({
      desiredHash: null,
      desiredState: null,
      safeErrorCode: null
    });
  });

  it("binds tombstone state into every effect authorization basis", () => {
    const live = sourceObservationBasisHash(sharedPolicyRuntime, "sha256:observation", false);
    const tombstone = sourceObservationBasisHash(sharedPolicyRuntime, "sha256:observation", true);
    expect(live).not.toBe(tombstone);
  });
});
