import { Temporal } from "temporal-polyfill";
import type {
  HoursEvaluationInput,
  HoursEvaluationResult,
  HoursMaterializationInput,
  HoursMaterializationResult,
  HoursProfile,
  InstantInterval,
  LocalInterval,
  ReasonCode,
} from "./types.js";

interface ConcreteInterval {
  start: Temporal.Instant;
  end: Temporal.Instant;
}

interface ResolvedInstant {
  instant: Temporal.Instant;
  diagnostic?: ReasonCode;
}

class DstResolutionError extends Error {}

function instantString(value: Temporal.Instant): string {
  return value.toString({ smallestUnit: "second" });
}

function compareInstant(left: Temporal.Instant, right: Temporal.Instant): number {
  return Temporal.Instant.compare(left, right);
}

function resolveLocal(
  date: Temporal.PlainDate,
  timeText: string,
  profile: HoursProfile,
): ResolvedInstant {
  const time = Temporal.PlainTime.from(timeText);
  const fields = {
    timeZone: profile.timezone,
    year: date.year,
    month: date.month,
    day: date.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
    millisecond: time.millisecond,
    microsecond: time.microsecond,
    nanosecond: time.nanosecond,
  };

  try {
    return {
      instant: Temporal.ZonedDateTime.from(fields, { disambiguation: "reject" }).toInstant(),
    };
  } catch {
    let earlier: Temporal.ZonedDateTime;
    let later: Temporal.ZonedDateTime;
    try {
      earlier = Temporal.ZonedDateTime.from(fields, { disambiguation: "earlier" });
      later = Temporal.ZonedDateTime.from(fields, { disambiguation: "later" });
    } catch (error) {
      throw new DstResolutionError(`Invalid local time or timezone: ${String(error)}`);
    }

    const requested = date.toPlainDateTime(time);
    const ambiguous = earlier.toPlainDateTime().equals(requested) && later.toPlainDateTime().equals(requested);
    if (ambiguous) {
      if (profile.dst_resolution.ambiguous === "earlier_offset") {
        return { instant: earlier.toInstant(), diagnostic: "dst_ambiguous_earlier" };
      }
      return { instant: later.toInstant(), diagnostic: "dst_ambiguous_later" };
    }

    if (profile.dst_resolution.nonexistent === "reject") {
      throw new DstResolutionError("Nonexistent local time rejected by hours profile");
    }
    return { instant: later.toInstant(), diagnostic: "dst_nonexistent_shifted" };
  }
}

function materialize(
  date: Temporal.PlainDate,
  local: LocalInterval,
  profile: HoursProfile,
  diagnostics: ReasonCode[],
): ConcreteInterval | undefined {
  const start = resolveLocal(date, local.start, profile);
  const endDate = date.add({ days: local.end_day_offset });
  const end = resolveLocal(endDate, local.end, profile);
  if (start.diagnostic !== undefined) diagnostics.push(start.diagnostic);
  if (end.diagnostic !== undefined) diagnostics.push(end.diagnostic);
  if (compareInstant(start.instant, end.instant) >= 0) return undefined;
  return { start: start.instant, end: end.instant };
}

function subtractInterval(base: ConcreteInterval, removal: ConcreteInterval): ConcreteInterval[] {
  if (compareInstant(removal.end, base.start) <= 0 || compareInstant(removal.start, base.end) >= 0) {
    return [base];
  }
  const parts: ConcreteInterval[] = [];
  if (compareInstant(removal.start, base.start) > 0) {
    parts.push({ start: base.start, end: removal.start });
  }
  if (compareInstant(removal.end, base.end) < 0) {
    parts.push({ start: removal.end, end: base.end });
  }
  return parts;
}

function intervalsForDate(
  date: Temporal.PlainDate,
  profile: HoursProfile,
  diagnostics: ReasonCode[],
): ConcreteInterval[] {
  const dateText = date.toString();
  const exception = profile.exceptions.find((item) => item.date === dateText);
  const weekly = profile.weekly
    .filter((item) => item.weekday === date.dayOfWeek)
    .map(({ start, end, end_day_offset }) => ({ start, end, end_day_offset }));

  if (exception?.kind === "closed") return [];
  const localIntervals = exception?.kind === "replace"
    ? exception.intervals
    : exception?.kind === "add"
      ? [...weekly, ...exception.intervals]
      : weekly;

  let concrete = localIntervals
    .map((interval) => materialize(date, interval, profile, diagnostics))
    .filter((interval): interval is ConcreteInterval => interval !== undefined);

  if (exception?.kind === "remove") {
    const removals = exception.intervals
      .map((interval) => materialize(date, interval, profile, diagnostics))
      .filter((interval): interval is ConcreteInterval => interval !== undefined);
    for (const removal of removals) {
      concrete = concrete.flatMap((base) => subtractInterval(base, removal));
    }
  }
  return concrete;
}

function deduplicateAndSort(intervals: ConcreteInterval[]): ConcreteInterval[] {
  const byKey = new Map<string, ConcreteInterval>();
  for (const interval of intervals) {
    byKey.set(`${instantString(interval.start)}/${instantString(interval.end)}`, interval);
  }
  return [...byKey.values()].sort((left, right) => {
    const startOrder = compareInstant(left.start, right.start);
    return startOrder === 0 ? compareInstant(left.end, right.end) : startOrder;
  });
}

function publicIntervals(intervals: ConcreteInterval[]): InstantInterval[] {
  return intervals.map(({ start, end }) => ({ start: instantString(start), end: instantString(end) }));
}

export function evaluateHours(input: HoursEvaluationInput): HoursEvaluationResult {
  const eventStart = Temporal.Instant.from(input.event.start);
  const eventEnd = Temporal.Instant.from(input.event.end);
  if (compareInstant(eventStart, eventEnd) >= 0) {
    return {
      included: false,
      reason_code: "invalid_hours_profile",
      concrete_intervals: [],
      matched_intervals: [],
      diagnostics: [],
    };
  }
  if (input.mode === "all_times") {
    return {
      included: true,
      reason_code: "all_times",
      concrete_intervals: [],
      matched_intervals: [],
      diagnostics: [],
    };
  }
  if (input.profile === undefined) {
    return {
      included: false,
      reason_code: "invalid_hours_profile",
      concrete_intervals: [],
      matched_intervals: [],
      diagnostics: [],
    };
  }

  const diagnostics: ReasonCode[] = [];
  try {
    const localStart = eventStart.toZonedDateTimeISO(input.profile.timezone).toPlainDate().subtract({ days: 1 });
    const localEnd = eventEnd.toZonedDateTimeISO(input.profile.timezone).toPlainDate();
    const concrete: ConcreteInterval[] = [];
    let date = localStart;
    let days = 0;
    while (Temporal.PlainDate.compare(date, localEnd) <= 0) {
      if (days > 370) throw new DstResolutionError("Hours evaluation exceeds bounded range");
      concrete.push(...intervalsForDate(date, input.profile, diagnostics));
      date = date.add({ days: 1 });
      days += 1;
    }

    const sorted = deduplicateAndSort(concrete);
    const overlaps = sorted.filter(
      ({ start, end }) => compareInstant(eventStart, end) < 0 && compareInstant(start, eventEnd) < 0,
    );
    const contained = sorted.filter(
      ({ start, end }) => compareInstant(start, eventStart) <= 0 && compareInstant(eventEnd, end) <= 0,
    );
    const included = input.mode === "overlaps_profile" ? overlaps.length > 0 : contained.length > 0;
    const matched = input.mode === "overlaps_profile" ? overlaps : contained;
    const reason_code: ReasonCode = included
      ? input.mode === "overlaps_profile"
        ? "overlaps_hours"
        : "contained_in_hours"
      : input.mode === "overlaps_profile"
        ? "outside_hours"
        : "not_contained_in_hours";
    return {
      included,
      reason_code,
      concrete_intervals: publicIntervals(sorted),
      matched_intervals: publicIntervals(matched),
      diagnostics: [...new Set(diagnostics)],
    };
  } catch (error) {
    if (!(error instanceof DstResolutionError)) {
      return {
        included: false,
        reason_code: "invalid_hours_profile",
        concrete_intervals: [],
        matched_intervals: [],
        diagnostics: [],
      };
    }
    return {
      included: false,
      reason_code: "dst_resolution_rejected",
      concrete_intervals: [],
      matched_intervals: [],
      diagnostics: ["dst_resolution_rejected"],
    };
  }
}

export function materializeHours(
  input: HoursMaterializationInput,
): HoursMaterializationResult {
  const diagnostics: ReasonCode[] = [];
  try {
    let date = Temporal.PlainDate.from(input.start_date);
    const end = Temporal.PlainDate.from(input.end_date_exclusive);
    if (Temporal.PlainDate.compare(date, end) >= 0) {
      return { concrete_intervals: [], diagnostics: [] };
    }
    const concrete: ConcreteInterval[] = [];
    let days = 0;
    while (Temporal.PlainDate.compare(date, end) < 0) {
      if (days > 370) throw new DstResolutionError("Hours materialization exceeds bounded range");
      concrete.push(...intervalsForDate(date, input.profile, diagnostics));
      date = date.add({ days: 1 });
      days += 1;
    }
    return {
      concrete_intervals: publicIntervals(deduplicateAndSort(concrete)),
      diagnostics: [...new Set(diagnostics)],
    };
  } catch {
    return {
      concrete_intervals: [],
      diagnostics: ["dst_resolution_rejected"],
    };
  }
}
