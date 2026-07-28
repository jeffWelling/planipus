import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESTINATION_EDIT_POLICY,
  isDestinationEditPolicy,
  normalizeDestinationEditPolicy,
  planDestinationEditResponse,
  type DestinationEditPolicy
} from "../src/index.js";

function policy(
  onEdit: DestinationEditPolicy["on_edit"],
  onDelete: DestinationEditPolicy["on_delete"]
): DestinationEditPolicy {
  return { version: 1, on_edit: onEdit, on_delete: onDelete };
}

describe("destination edit policy", () => {
  it("defaults to notifying on both edits and deletions", () => {
    expect(DEFAULT_DESTINATION_EDIT_POLICY).toEqual({
      version: 1,
      on_edit: "restore_and_notify",
      on_delete: "restore_and_notify"
    });
  });

  it("validates only complete versioned mode pairs", () => {
    expect(isDestinationEditPolicy(policy("restore", "hold_for_review"))).toBe(true);
    expect(isDestinationEditPolicy(undefined)).toBe(false);
    expect(isDestinationEditPolicy(null)).toBe(false);
    expect(isDestinationEditPolicy([])).toBe(false);
    expect(isDestinationEditPolicy({ version: 1, on_edit: "restore" })).toBe(false);
    expect(isDestinationEditPolicy({ version: 2, on_edit: "restore", on_delete: "restore" })).toBe(false);
    expect(isDestinationEditPolicy({ version: 1, on_edit: "revert", on_delete: "restore" })).toBe(false);
  });

  it("normalizes absent or unrecognized stored values to the default", () => {
    expect(normalizeDestinationEditPolicy(undefined)).toEqual(DEFAULT_DESTINATION_EDIT_POLICY);
    expect(normalizeDestinationEditPolicy({ on_edit: "restore" })).toEqual(DEFAULT_DESTINATION_EDIT_POLICY);
    const explicit = policy("hold_for_review", "restore");
    expect(normalizeDestinationEditPolicy(explicit)).toBe(explicit);
  });

  it("repairs silently in restore mode", () => {
    expect(planDestinationEditResponse(policy("restore", "restore"), "drifted")).toEqual({
      response: "repair",
      notice: null,
      safe_error_code: "destination_drift"
    });
    expect(planDestinationEditResponse(policy("restore", "restore"), "missing")).toEqual({
      response: "repair",
      notice: null,
      safe_error_code: "destination_missing"
    });
  });

  it("repairs with a notice in restore_and_notify mode", () => {
    expect(planDestinationEditResponse(DEFAULT_DESTINATION_EDIT_POLICY, "drifted")).toEqual({
      response: "repair",
      notice: "copy_edit_reverted",
      safe_error_code: "destination_drift"
    });
    expect(planDestinationEditResponse(DEFAULT_DESTINATION_EDIT_POLICY, "missing")).toEqual({
      response: "repair",
      notice: "copy_delete_restored",
      safe_error_code: "destination_missing"
    });
  });

  it("holds with a notice in hold_for_review mode", () => {
    expect(planDestinationEditResponse(policy("hold_for_review", "hold_for_review"), "drifted")).toEqual({
      response: "hold",
      notice: "copy_edit_held",
      safe_error_code: "destination_edit_held"
    });
    expect(planDestinationEditResponse(policy("hold_for_review", "hold_for_review"), "missing")).toEqual({
      response: "hold",
      notice: "copy_delete_held",
      safe_error_code: "destination_delete_held"
    });
  });

  it("applies edit and delete modes independently", () => {
    const mixed = policy("hold_for_review", "restore");
    expect(planDestinationEditResponse(mixed, "drifted").response).toBe("hold");
    expect(planDestinationEditResponse(mixed, "missing")).toEqual({
      response: "repair",
      notice: null,
      safe_error_code: "destination_missing"
    });
  });
});
