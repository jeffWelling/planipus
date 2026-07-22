import type {
  AvailabilityBoundaryDraft,
  PlanningDraft,
  SmartMeetingAttendee,
  SmartMeetingDraft
} from "./types.js";

export class PlanningInputError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PlanningInputError";
  }
}

export function parsePlanningDraft(value: unknown): PlanningDraft {
  if (!isRecord(value)) throw invalid("planning rule must be an object");
  if (value["kind"] === "availability_boundary") return parseBoundary(value);
  if (value["kind"] === "smart_meeting") return parseSmartMeeting(value);
  throw invalid("planning rule kind is unsupported");
}

function parseBoundary(value: Record<string, unknown>): AvailabilityBoundaryDraft {
  const name = text(value["name"], "name", 160);
  const target = id(value["target_calendar_id"], "target calendar");
  const timezone = timeZone(value["timezone"]);
  const workingDays = weekdays(value["working_days"], "working days");
  const workdayStart = clock(value["workday_start"], "workday start");
  const workdayEnd = clock(value["workday_end"], "workday end");
  if (workdayStart >= workdayEnd) throw invalid("workday end must be after workday start");
  const horizon = integer(value["horizon_days"], "horizon days", 1, 60);
  return {
    kind: "availability_boundary",
    name,
    target_calendar_id: target,
    timezone,
    working_days: workingDays,
    workday_start: workdayStart,
    workday_end: workdayEnd,
    protect_before_work: bool(value["protect_before_work"], false),
    protect_after_work: bool(value["protect_after_work"], true),
    protect_closed_days: bool(value["protect_closed_days"], false),
    title: text(value["title"] ?? "Personal time", "title", 160),
    visibility: visibility(value["visibility"]),
    horizon_days: horizon
  };
}

function parseSmartMeeting(value: Record<string, unknown>): SmartMeetingDraft {
  const minimum = integer(value["minimum_duration_minutes"], "minimum duration", 15, 480);
  const maximum = integer(value["maximum_duration_minutes"], "maximum duration", minimum, 480);
  const step = integer(value["start_step_minutes"], "start step", 15, 60);
  if (step !== 15 && step !== 30 && step !== 60) throw invalid("start step must be 15, 30, or 60 minutes");
  const windowStart = clock(value["window_start"], "meeting window start");
  const windowEnd = clock(value["window_end"], "meeting window end");
  if (windowStart >= windowEnd) throw invalid("meeting window end must be after its start");
  const preferred = clock(value["preferred_time"], "preferred time");
  if (preferred < windowStart || preferred >= windowEnd) {
    throw invalid("preferred time must be inside the meeting window");
  }
  const rawAttendees = value["attendees"] ?? [];
  if (!Array.isArray(rawAttendees) || rawAttendees.length > 25) throw invalid("attendees are invalid");
  const attendees = rawAttendees.map(parseAttendee);
  const emails = attendees.map((attendee) => attendee.email);
  if (new Set(emails).size !== emails.length) throw invalid("attendees must be unique");
  const availabilityCalendars = ids(value["availability_calendar_ids"], "availability calendars", 32);
  if (availabilityCalendars.length === 0) throw invalid("at least one availability calendar is required");
  const selectedAvailability = new Set(availabilityCalendars);
  if (attendees.some((attendee) => attendee.availability_calendar_id
    && !selectedAvailability.has(attendee.availability_calendar_id))) {
    throw invalid("attendee availability calendars must also be selected for availability");
  }
  return {
    kind: "smart_meeting",
    name: text(value["name"], "name", 160),
    target_calendar_id: id(value["target_calendar_id"], "target calendar"),
    timezone: timeZone(value["timezone"]),
    start_date: localDate(value["start_date"]),
    weekdays: weekdays(value["weekdays"], "meeting days"),
    window_start: windowStart,
    window_end: windowEnd,
    preferred_time: preferred,
    cadence_weeks: integer(value["cadence_weeks"], "cadence", 1, 12),
    occurrence_count: integer(value["occurrence_count"], "occurrence count", 1, 16),
    minimum_duration_minutes: minimum,
    maximum_duration_minutes: maximum,
    start_step_minutes: step,
    priority: priority(value["priority"]),
    attendees,
    availability_calendar_ids: availabilityCalendars,
    conflict_policy: conflictPolicy(value["conflict_policy"]),
    lock_before_minutes: integer(value["lock_before_minutes"], "lock window", 0, 10_080),
    ...(optionalText(value["description"], "description", 4_000) ? {
      description: optionalText(value["description"], "description", 4_000)
    } : {}),
    ...(optionalText(value["location"], "location", 500) ? {
      location: optionalText(value["location"], "location", 500)
    } : {}),
    visibility: visibility(value["visibility"])
  } as SmartMeetingDraft;
}

function parseAttendee(value: unknown): SmartMeetingAttendee {
  if (!isRecord(value)) throw invalid("attendee must be an object");
  const raw = text(value["email"], "attendee email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(raw)) throw invalid("attendee email is invalid");
  const calendar = value["availability_calendar_id"] === undefined
    ? undefined
    : id(value["availability_calendar_id"], "attendee availability calendar");
  return {
    email: raw,
    required: bool(value["required"], true),
    ...(calendar ? { availability_calendar_id: calendar } : {})
  };
}

function weekdays(value: unknown, field: string): (1 | 2 | 3 | 4 | 5 | 6 | 7)[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 7) throw invalid(`${field} are invalid`);
  const result = value.map((item) => integer(item, field, 1, 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7);
  if (new Set(result).size !== result.length) throw invalid(`${field} must be unique`);
  return result.sort((left, right) => left - right);
}

function ids(value: unknown, field: string, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit) throw invalid(`${field} are invalid`);
  const result = value.map((item) => id(item, field));
  if (new Set(result).size !== result.length) throw invalid(`${field} must be unique`);
  return result;
}

function id(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 200 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw invalid(`${field} is invalid`);
  }
  return value;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw invalid(`${field} is required`);
  const result = value.normalize("NFC").trim();
  if (result.length < 1 || [...result].length > max || /[\p{Cc}\p{Cf}]/u.test(result)) {
    throw invalid(`${field} is invalid`);
  }
  return result;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, field, max);
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw invalid(`${field} is invalid`);
  }
  return Number(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw invalid("boolean setting is invalid");
  return value;
}

function priority(value: unknown): 1 | 2 | 3 | 4 {
  const result = integer(value, "priority", 1, 4);
  return result as 1 | 2 | 3 | 4;
}

function visibility(value: unknown): "private" | "default" {
  if (value === undefined || value === "private") return "private";
  if (value === "default") return "default";
  throw invalid("visibility is invalid");
}

function conflictPolicy(value: unknown): SmartMeetingDraft["conflict_policy"] {
  if (value === undefined || value === "suggest") return "suggest";
  if (value === "auto_move" || value === "keep_with_warning") return value;
  throw invalid("conflict policy is invalid");
}

function clock(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u.test(value)) {
    throw invalid(`${field} is invalid`);
  }
  return value.length === 5 ? `${value}:00` : value;
}

function localDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw invalid("start date is invalid");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid("start date is invalid");
  }
  return value;
}

function timeZone(value: unknown): string {
  if (typeof value !== "string" || value.length > 100) throw invalid("timezone is invalid");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw invalid("timezone is invalid");
  }
  return value;
}

function invalid(message: string): PlanningInputError {
  return new PlanningInputError("invalid_planning_rule", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
