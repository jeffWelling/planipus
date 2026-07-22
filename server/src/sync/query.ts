import type { PolicyRuntime } from "../policy/runtime.js";

export const FULL_SYNC_PAST_DAYS = 30;
export const FULL_SYNC_FUTURE_DAYS = 365;

/**
 * Cursor identity is part of the safety contract. Policy preview and calendar
 * ingestion must derive it from one implementation so a preview can never
 * mistake an obsolete, completed cursor for the query the current worker will
 * actually use.
 */
export function calendarSyncQueryFingerprint(
  runtime: Pick<PolicyRuntime, "hash">,
  provider: string,
  remoteCalendar: string
): string {
  return runtime.hash({
    version: 1,
    provider,
    remote_calendar: remoteCalendar,
    recurrence: "materialized_occurrences",
    deleted: true,
    full_sync_past_days: FULL_SYNC_PAST_DAYS,
    full_sync_future_days: FULL_SYNC_FUTURE_DAYS
  });
}
