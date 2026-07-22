import { materializeHours, type HoursProfile, type InstantInterval, type WeeklyInterval } from "@planipus/calendar-sync";

import type {
  AvailabilityBoundaryDraft,
  ManagedPlanningEvent,
  PlannedOccurrenceTemplate,
  PlanningInput,
  PlanningResult,
  SmartMeetingDraft
} from "./types.js";

const DAY_MILLISECONDS = 86_400_000;

export function planScheduling(input: PlanningInput): PlanningResult {
  return input.draft.kind === "availability_boundary"
    ? planAvailabilityBoundary(input.draft, input.now)
    : planSmartMeeting(input.draft, input);
}

export function localDateAt(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

export function addLocalDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function planAvailabilityBoundary(
  draft: AvailabilityBoundaryDraft,
  now: string
): PlanningResult {
  const startDate = localDateAt(now, draft.timezone);
  const endDate = addLocalDays(startDate, draft.horizon_days);
  const working = new Set<number>(draft.working_days);
  const weekly: WeeklyInterval[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const typedWeekday = weekday as WeeklyInterval["weekday"];
    if (!working.has(weekday)) {
      if (draft.protect_closed_days) {
        weekly.push({ weekday: typedWeekday, start: "00:00:00", end: "00:00:00", end_day_offset: 1 });
      }
      continue;
    }
    if (draft.protect_before_work && draft.workday_start !== "00:00:00") {
      weekly.push({
        weekday: typedWeekday,
        start: "00:00:00",
        end: draft.workday_start,
        end_day_offset: 0
      });
    }
    if (draft.protect_after_work && draft.workday_end !== "00:00:00") {
      weekly.push({
        weekday: typedWeekday,
        start: draft.workday_end,
        end: "00:00:00",
        end_day_offset: 1
      });
    }
  }
  const profile = hoursProfile("availability-boundary-preview", draft.timezone, weekly);
  const materialized = materializeHours({
    profile,
    start_date: startDate,
    end_date_exclusive: endDate
  });
  const occurrences = materialized.concrete_intervals.map((interval) => ({
    occurrence_key: `boundary:${interval.start}`,
    decision: "schedule" as const,
    reason_code: "outside_working_hours",
    rejected_candidate_count: 0,
    event: eventTemplate(
      interval,
      draft.timezone,
      draft.title,
      draft.visibility,
      [],
      false
    )
  }));
  return {
    kind: draft.kind,
    occurrences,
    scheduled_count: occurrences.length,
    unmet_count: 0,
    warnings: materialized.diagnostics,
    hours_summary: `${draft.workday_start.slice(0, 5)}–${draft.workday_end.slice(0, 5)} · ${draft.timezone}`
  };
}

function planSmartMeeting(draft: SmartMeetingDraft, input: PlanningInput): PlanningResult {
  const requestedCalendars = new Set(draft.availability_calendar_ids);
  const knownCalendars = new Set(input.known_availability_calendar_ids);
  const missingCalendars = [...requestedCalendars].filter((calendar) => !knownCalendars.has(calendar));
  const warnings: string[] = missingCalendars.length > 0 ? ["availability_incomplete"] : [];
  if (draft.attendees.some((attendee) => attendee.required
    && (!attendee.availability_calendar_id || !knownCalendars.has(attendee.availability_calendar_id)))) {
    warnings.push("required_attendee_availability_unknown");
  }
  const weekly = draft.weekdays.map((weekday) => ({
    weekday,
    start: draft.window_start,
    end: draft.window_end,
    end_day_offset: draft.window_end > draft.window_start ? 0 as const : 1 as const
  }));
  const profile = hoursProfile("smart-meeting-preview", draft.timezone, weekly);
  const occurrences: PlannedOccurrenceTemplate[] = [];
  const used: InstantInterval[] = [];
  let windowStart = draft.start_date;
  for (let index = 0; index < draft.occurrence_count; index += 1) {
    const windowEnd = addLocalDays(windowStart, 7 * draft.cadence_weeks);
    const windows = materializeHours({
      profile,
      start_date: windowStart,
      end_date_exclusive: windowEnd
    });
    for (const diagnostic of windows.diagnostics) {
      if (!warnings.includes(diagnostic)) warnings.push(diagnostic);
    }
    const selected = chooseMeetingSlot(draft, windows.concrete_intervals, input.busy, used, input.now);
    const occurrenceKey = `week:${windowStart}`;
    if (!selected) {
      occurrences.push({
        occurrence_key: occurrenceKey,
        decision: "unmet",
        reason_code: "no_mutual_time_inside_meeting_hours",
        rejected_candidate_count: candidateCount(draft, windows.concrete_intervals)
      });
    } else {
      used.push(selected.interval);
      occurrences.push({
        occurrence_key: occurrenceKey,
        decision: "schedule",
        reason_code: selected.rejected > 0 ? "closest_mutual_opening" : "preferred_time_available",
        rejected_candidate_count: selected.rejected,
        event: eventTemplate(
          selected.interval,
          draft.timezone,
          draft.name,
          draft.visibility,
          draft.attendees.map((attendee) => ({ email: attendee.email, optional: !attendee.required })),
          draft.attendees.length > 0,
          draft.description,
          draft.location
        )
      });
    }
    windowStart = windowEnd;
  }
  return {
    kind: draft.kind,
    occurrences,
    scheduled_count: occurrences.filter((occurrence) => occurrence.decision === "schedule").length,
    unmet_count: occurrences.filter((occurrence) => occurrence.decision === "unmet").length,
    warnings,
    hours_summary: `${draft.window_start.slice(0, 5)}–${draft.window_end.slice(0, 5)} · ${draft.timezone}`
  };
}

function chooseMeetingSlot(
  draft: SmartMeetingDraft,
  windows: readonly InstantInterval[],
  busy: PlanningInput["busy"],
  used: readonly InstantInterval[],
  now: string
): { readonly interval: InstantInterval; readonly rejected: number } | null {
  const earliestStart = new Date(
    new Date(now).getTime() + draft.lock_before_minutes * 60_000
  ).toISOString();
  const durations: number[] = [];
  for (
    let duration = draft.maximum_duration_minutes;
    duration >= draft.minimum_duration_minutes;
    duration -= draft.start_step_minutes
  ) {
    durations.push(duration);
  }
  if (!durations.includes(draft.minimum_duration_minutes)) durations.push(draft.minimum_duration_minutes);
  const candidates: Array<{ interval: InstantInterval; score: number; rejectedBefore: number }> = [];
  let rejected = 0;
  for (const duration of durations) {
    for (const window of windows) {
      const start = alignToStep(new Date(window.start).getTime(), draft.start_step_minutes);
      const end = new Date(window.end).getTime();
      for (let cursor = start; cursor + duration * 60_000 <= end; cursor += draft.start_step_minutes * 60_000) {
        const candidate = {
          start: new Date(cursor).toISOString(),
          end: new Date(cursor + duration * 60_000).toISOString()
        };
        const conflict = candidate.start < earliestStart
          || busy.some((interval) => overlaps(candidate, interval))
          || used.some((interval) => overlaps(candidate, interval));
        if (conflict) {
          rejected += 1;
          continue;
        }
        const localMinutes = localMinuteOfDay(candidate.start, draft.timezone);
        const preferredMinutes = clockMinutes(draft.preferred_time);
        candidates.push({
          interval: candidate,
          score: Math.abs(localMinutes - preferredMinutes) + (draft.maximum_duration_minutes - duration) * 5,
          rejectedBefore: rejected
        });
      }
    }
    if (candidates.length > 0) break;
  }
  candidates.sort((left, right) => left.score - right.score
    || left.interval.start.localeCompare(right.interval.start)
    || left.interval.end.localeCompare(right.interval.end));
  const first = candidates[0];
  return first ? { interval: first.interval, rejected: first.rejectedBefore } : null;
}

function candidateCount(draft: SmartMeetingDraft, windows: readonly InstantInterval[]): number {
  return windows.reduce((total, window) => {
    const minutes = (new Date(window.end).getTime() - new Date(window.start).getTime()) / 60_000;
    return total + Math.max(0, Math.floor((minutes - draft.minimum_duration_minutes) / draft.start_step_minutes) + 1);
  }, 0);
}

function eventTemplate(
  interval: InstantInterval,
  timezone: string,
  summary: string,
  visibility: "private" | "default",
  attendees: readonly { readonly email: string; readonly optional: boolean }[],
  sendUpdates: boolean,
  description?: string,
  location?: string
): Omit<ManagedPlanningEvent, "provenance"> {
  return {
    timing: { start_instant: interval.start, end_instant: interval.end, timezone },
    summary,
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    transparency: "opaque",
    visibility,
    attendees,
    reminders: [],
    write_controls: { send_updates: sendUpdates }
  };
}

function hoursProfile(id: string, timezone: string, weekly: WeeklyInterval[]): HoursProfile {
  return {
    profile_ref: id,
    revision: 1,
    timezone,
    dst_resolution: {
      ambiguous: "earlier_offset",
      nonexistent: "shift_forward_by_gap"
    },
    weekly,
    exceptions: []
  };
}

function overlaps(left: InstantInterval, right: InstantInterval): boolean {
  return left.start < right.end && right.start < left.end;
}

function alignToStep(milliseconds: number, stepMinutes: number): number {
  const step = stepMinutes * 60_000;
  return Math.ceil(milliseconds / step) * step;
}

function clockMinutes(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function localMinuteOfDay(instant: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values["hour"]) * 60 + Number(values["minute"]);
}

export function planningHorizonEnd(now: string, days: number): string {
  return new Date(new Date(now).getTime() + days * DAY_MILLISECONDS).toISOString();
}
