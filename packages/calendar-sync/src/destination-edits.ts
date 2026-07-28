/**
 * Destination-edit policy: what Planipus does when a person edits or deletes a
 * managed destination copy directly instead of the authoritative source event.
 *
 * The source stays authoritative in every mode. A direct copy edit never
 * silently becomes the new truth (the Reclaim failure this feature exists to
 * prevent: a copy is moved, the real meeting does not move, and nobody is
 * told). The modes only choose how loudly the divergence is surfaced and
 * whether the user gets to confirm before the copy is written again.
 */

export type DestinationEditMode = "restore" | "restore_and_notify" | "hold_for_review";

export interface DestinationEditPolicy {
  version: 1;
  /** A managed copy was changed in place on the destination calendar. */
  on_edit: DestinationEditMode;
  /** A managed copy was deleted from the destination calendar. */
  on_delete: DestinationEditMode;
}

export const DEFAULT_DESTINATION_EDIT_POLICY: DestinationEditPolicy = {
  version: 1,
  on_edit: "restore_and_notify",
  on_delete: "restore_and_notify"
};

/** What verification observed on the destination. */
export type DestinationEditObservationKind = "drifted" | "missing";

export type DestinationEditNoticeKind =
  | "copy_edit_reverted"
  | "copy_delete_restored"
  | "copy_edit_held"
  | "copy_delete_held";

export type DestinationEditSafeErrorCode =
  | "destination_drift"
  | "destination_missing"
  | "destination_edit_held"
  | "destination_delete_held";

/** `repair` re-applies the source-authoritative desired state now; `hold`
 * freezes the projection, keeps the person's direct change on the destination,
 * and waits for an explicit restore or detach decision. `notice` is the
 * user-visible record to create, or null for the silent legacy behavior. */
export type DestinationEditResponse =
  | {
      response: "repair";
      notice: "copy_edit_reverted" | "copy_delete_restored" | null;
      safe_error_code: "destination_drift" | "destination_missing";
    }
  | {
      response: "hold";
      notice: "copy_edit_held" | "copy_delete_held";
      safe_error_code: "destination_edit_held" | "destination_delete_held";
    };

const MODES: readonly DestinationEditMode[] = ["restore", "restore_and_notify", "hold_for_review"];

export function isDestinationEditPolicy(value: unknown): value is DestinationEditPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate["version"] === 1
    && MODES.includes(candidate["on_edit"] as DestinationEditMode)
    && MODES.includes(candidate["on_delete"] as DestinationEditMode);
}

/**
 * Resolve a stored policy document field to an effective destination-edit
 * policy. Absent or unrecognized values fall back to the notify-by-default
 * behavior rather than failing verification of otherwise healthy copies.
 */
export function normalizeDestinationEditPolicy(value: unknown): DestinationEditPolicy {
  return isDestinationEditPolicy(value) ? value : DEFAULT_DESTINATION_EDIT_POLICY;
}

export function planDestinationEditResponse(
  policy: DestinationEditPolicy,
  observed: DestinationEditObservationKind
): DestinationEditResponse {
  const mode = observed === "drifted" ? policy.on_edit : policy.on_delete;
  if (mode === "hold_for_review") {
    return observed === "drifted"
      ? { response: "hold", notice: "copy_edit_held", safe_error_code: "destination_edit_held" }
      : { response: "hold", notice: "copy_delete_held", safe_error_code: "destination_delete_held" };
  }
  const notice = mode === "restore"
    ? null
    : observed === "drifted"
      ? "copy_edit_reverted" as const
      : "copy_delete_restored" as const;
  return {
    response: "repair",
    notice,
    safe_error_code: observed === "drifted" ? "destination_drift" : "destination_missing"
  };
}
