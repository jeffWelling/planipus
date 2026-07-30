import {
  DEFAULT_CONFLICT_HORIZON_DAYS,
  DEFAULT_DECLINE_MESSAGE,
  MAX_AVAILABILITY_CALENDARS,
  type ConflictResponseDraft
} from "./types.js";
import { isUuid } from "../foundation.js";

const ALLOWED_DRAFT_FIELDS = new Set([
  "name",
  "response_calendar_id",
  "availability_calendar_ids",
  "decline_message",
  "horizon_days"
]);

export class ConflictResponseInputError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "ConflictResponseInputError";
  }
}

/** Parse a complete canonical rule and reject misspelled or future fields. */
export function parseConflictResponseDraft(value: unknown): ConflictResponseDraft {
  if (!isRecord(value)) throw invalid("conflict-response rule must be an object");
  for (const key of Object.keys(value)) {
    if (!ALLOWED_DRAFT_FIELDS.has(key)) {
      throw invalid(`unsupported conflict-response field: ${key}`);
    }
  }
  const responseCalendarId = identifier(value["response_calendar_id"], "response calendar");
  const availabilityCalendarIds = identifiers(
    value["availability_calendar_ids"],
    "availability calendars",
    MAX_AVAILABILITY_CALENDARS
  );
  if (availabilityCalendarIds.length === 0) {
    throw invalid("at least one availability calendar is required");
  }
  if (availabilityCalendarIds.includes(responseCalendarId)) {
    throw invalid("the response calendar cannot also be an availability calendar");
  }
  return {
    name: text(value["name"], "name", 160),
    response_calendar_id: responseCalendarId,
    availability_calendar_ids: availabilityCalendarIds.sort(compareText),
    decline_message: text(
      value["decline_message"] ?? DEFAULT_DECLINE_MESSAGE,
      "decline message",
      500
    ),
    horizon_days: integer(
      value["horizon_days"] ?? DEFAULT_CONFLICT_HORIZON_DAYS,
      "horizon days",
      1,
      90
    )
  };
}

function identifiers(value: unknown, field: string, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit) throw invalid(`${field} are invalid`);
  const result = value.map((item) => identifier(item, field));
  if (new Set(result).size !== result.length) throw invalid(`${field} must be unique`);
  return result;
}

function identifier(value: unknown, field: string): string {
  if (!isUuid(value)) {
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

function integer(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw invalid(`${field} is invalid`);
  }
  return Number(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(message: string): ConflictResponseInputError {
  return new ConflictResponseInputError("invalid_conflict_response_rule", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
