import type { SourceObservation } from "@planipus/calendar-sync";

import type {
  ConflictBusyInterval,
  ConflictCalendarBinding,
  ConflictResponseDraft,
  ConflictResponsePreviewResult,
  WorkInvitationCandidate,
  WorkObservationRow
} from "./types.js";
import {
  asSourceObservation,
  MAX_AUTOMATIC_DECLINES_PER_24_HOURS
} from "./types.js";

export const PREVIEW_EXAMPLE_LIMIT = 3;
export const MAX_DECLINABLE_INVITATION_MILLISECONDS = 7 * 24 * 60 * 60_000;

export function workInvitationCandidate(
  row: WorkObservationRow,
  now: Date,
  horizonEnd: Date
): WorkInvitationCandidate | null {
  const event = asSourceObservation(row.normalized_event);
  if (!event || !isEligibleWorkInvitation(event, now, horizonEnd)) return null;
  if (event.source_event_ref !== row.remote_event_id) return null;
  const timing = event.timing;
  if (!timing || timing.kind !== "timed") return null;
  return {
    observation_id: row.id,
    remote_event_id: row.remote_event_id,
    recurrence_identity: row.recurrence_identity,
    observation_hash: row.observation_hash,
    remote_revision: row.remote_etag,
    start_at: canonicalInstant(timing.start_instant),
    end_at: canonicalInstant(timing.end_instant)
  };
}

export function isEligibleWorkInvitation(
  event: SourceObservation,
  now: Date,
  horizonEnd: Date
): boolean {
  if (event.lifecycle !== "confirmed" || event.origin !== "provider_original") return false;
  if (event.availability !== "busy") return false;
  if (event.relationship.role !== "attendee" || event.relationship.response !== "needs_action") {
    return false;
  }
  if (event.timing?.kind !== "timed") return false;
  const start = Date.parse(event.timing.start_instant);
  const end = Date.parse(event.timing.end_instant);
  return Number.isFinite(start)
    && Number.isFinite(end)
    && start < end
    && start > now.getTime()
    && start < horizonEnd.getTime()
    && end <= horizonEnd.getTime()
    && end - start <= MAX_DECLINABLE_INVITATION_MILLISECONDS;
}

export function intervalsOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string
): boolean {
  const leftStartMs = Date.parse(leftStart);
  const leftEndMs = Date.parse(leftEnd);
  const rightStartMs = Date.parse(rightStart);
  const rightEndMs = Date.parse(rightEnd);
  if (
    !Number.isFinite(leftStartMs)
    || !Number.isFinite(leftEndMs)
    || !Number.isFinite(rightStartMs)
    || !Number.isFinite(rightEndMs)
    || leftStartMs >= leftEndMs
    || rightStartMs >= rightEndMs
  ) {
    return false;
  }
  return leftStartMs < rightEndMs && rightStartMs < leftEndMs;
}

export function overlappingBusyIntervals(
  invitation: WorkInvitationCandidate,
  busy: readonly ConflictBusyInterval[]
): readonly ConflictBusyInterval[] {
  return busy.filter((interval) => intervalsOverlap(
    invitation.start_at,
    invitation.end_at,
    interval.start,
    interval.end
  ));
}

export function conflictPreviewResult(
  invitations: readonly WorkInvitationCandidate[],
  busy: readonly ConflictBusyInterval[],
  automaticDeclinesAppliedLast24Hours = 0
): ConflictResponsePreviewResult {
  const conflicts = invitations.flatMap((invitation) => {
    const overlap = overlappingBusyIntervals(invitation, busy);
    return overlap.length > 0 ? [{ invitation, overlap }] : [];
  });
  const revisionGuardHeldCount = conflicts.filter(
    ({ invitation }) => !invitation.remote_revision
  ).length;
  const guardedConflictCount = conflicts.length - revisionGuardHeldCount;
  const remainingBudget = Math.max(
    0,
    MAX_AUTOMATIC_DECLINES_PER_24_HOURS - automaticDeclinesAppliedLast24Hours
  );
  const budgetHeldCount = Math.max(0, guardedConflictCount - remainingBudget);
  return {
    invitation_count: invitations.length,
    conflict_count: conflicts.length,
    held_count: revisionGuardHeldCount + budgetHeldCount,
    budget_held_count: budgetHeldCount,
    examples: conflicts.slice(0, PREVIEW_EXAMPLE_LIMIT).map(({ invitation }) => ({
      start_at: invitation.start_at,
      end_at: invitation.end_at
    })),
    warnings: [
      "This private-reply rule creates no event copies or event-detail copies; existing paused-bridge copies may remain.",
      "Only future invitations that are still awaiting your response can be declined.",
      ...(budgetHeldCount > 0
        ? ["automatic_decline_budget_will_hold_excess"]
        : [])
    ]
  };
}

/**
 * Canonical private-safe preview basis. Busy times and work observation hashes
 * are used in memory and reduced to one opaque hash before persistence.
 */
export function conflictSnapshotDocument(input: {
  readonly draft: ConflictResponseDraft;
  readonly reference_at: string;
  readonly horizon_end: string;
  readonly availability_end: string;
  readonly response_calendar: ConflictCalendarBinding;
  readonly availability_calendars: readonly ConflictCalendarBinding[];
  readonly invitations: readonly WorkInvitationCandidate[];
  readonly busy: readonly ConflictBusyInterval[];
  readonly automatic_declines_applied_last_24_hours: number;
}): object {
  return {
    version: 1,
    draft: input.draft,
    reference_at: input.reference_at,
    horizon_end: input.horizon_end,
    availability_end: input.availability_end,
    automatic_declines_applied_last_24_hours:
      input.automatic_declines_applied_last_24_hours,
    response_calendar: capabilityDocument(input.response_calendar),
    availability_calendars: input.availability_calendars
      .map(capabilityDocument)
      .sort((left, right) => compareText(left.id, right.id)),
    work_invitations: input.invitations
      .map((invitation) => ({
        observation_hash: invitation.observation_hash,
        remote_revision_present: invitation.remote_revision !== null,
        start_at: invitation.start_at,
        end_at: invitation.end_at
      }))
      .sort((left, right) =>
        compareText(left.start_at, right.start_at)
        || compareText(left.end_at, right.end_at)
        || compareText(left.observation_hash, right.observation_hash)
      ),
    busy: input.busy
      .map((interval) => ({
        calendar_id: interval.calendar_id,
        start: interval.start,
        end: interval.end
      }))
      .sort((left, right) =>
        compareText(left.calendar_id, right.calendar_id)
        || compareText(left.start, right.start)
        || compareText(left.end, right.end)
      )
  };
}

/** Only opaque calendar identity, times, and hashes enter the action basis. */
export function conflictActionBasisDocument(input: {
  readonly rule_id: string;
  readonly rule_revision: number;
  readonly invitation: WorkInvitationCandidate;
  readonly overlapping_busy: readonly ConflictBusyInterval[];
}): object {
  return {
    version: 1,
    rule_id: input.rule_id,
    rule_revision: input.rule_revision,
    work_observation_hash: input.invitation.observation_hash,
    work_start_at: input.invitation.start_at,
    work_end_at: input.invitation.end_at,
    busy: input.overlapping_busy
      .map((interval) => ({
        calendar_id: interval.calendar_id,
        start: interval.start,
        end: interval.end
      }))
      .sort((left, right) =>
        compareText(left.calendar_id, right.calendar_id)
        || compareText(left.start, right.start)
        || compareText(left.end, right.end)
      )
  };
}

function capabilityDocument(calendar: ConflictCalendarBinding): {
  readonly id: string;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly provider: string;
  readonly connection_status: string;
  readonly intended_role: string;
} {
  return {
    id: calendar.id,
    readable: calendar.readable,
    writable: calendar.writable,
    provider: calendar.provider,
    connection_status: calendar.connection_status,
    intended_role: calendar.intended_role
  };
}

function canonicalInstant(value: string): string {
  return new Date(value).toISOString();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
