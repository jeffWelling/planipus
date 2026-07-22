import type { DesiredCopy } from "@planipus/calendar-sync";
import type { ManagedPlanningEvent } from "../../planning/types.js";

export interface GoogleEventWrite {
  readonly id?: string;
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly start: Readonly<Record<string, string>>;
  readonly end: Readonly<Record<string, string>>;
  readonly transparency: "opaque" | "transparent";
  readonly visibility: "private" | "default";
  readonly colorId?: string;
  readonly reminders: { readonly useDefault: false };
  readonly attendees?: readonly { readonly email: string; readonly optional: boolean }[];
  readonly extendedProperties: {
    readonly private: Readonly<Record<string, string>>;
  };
}

export function serializeGooglePlanningEvent(
  desired: ManagedPlanningEvent,
  eventId?: string
): GoogleEventWrite {
  return {
    ...(eventId ? { id: eventId } : {}),
    summary: desired.summary,
    ...(desired.description ? { description: desired.description } : {}),
    ...(desired.location ? { location: desired.location } : {}),
    start: {
      dateTime: desired.timing.start_instant,
      timeZone: desired.timing.timezone
    },
    end: {
      dateTime: desired.timing.end_instant,
      timeZone: desired.timing.timezone
    },
    transparency: desired.transparency,
    visibility: desired.visibility,
    ...(desired.attendees.length > 0 ? { attendees: desired.attendees } : {}),
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        planipus_version: "1",
        planipus_kind: desired.provenance.kind,
        planipus_rule: desired.provenance.rule_ref,
        planipus_planned_event: desired.provenance.planned_event_ref,
        planipus_occurrence: desired.provenance.occurrence_key,
        planipus_generation: String(desired.provenance.generation),
        planipus_intent: String(desired.provenance.intent_sequence)
      }
    }
  };
}

export function serializeGoogleDesiredCopy(desired: DesiredCopy, eventId?: string): GoogleEventWrite {
  if (desired.conference) {
    throw new Error("unsupported_google_conference_copy");
  }
  const timing = desired.timing.kind === "timed"
    ? {
        start: { dateTime: desired.timing.start_instant, timeZone: desired.timing.start_tzid },
        end: { dateTime: desired.timing.end_instant, timeZone: desired.timing.end_tzid }
      }
    : {
        start: { date: desired.timing.start_date },
        end: { date: desired.timing.end_date }
      };
  return {
    ...(eventId ? { id: eventId } : {}),
    summary: desired.summary,
    ...(desired.description ? { description: desired.description } : {}),
    ...(desired.location ? { location: desired.location } : {}),
    ...timing,
    transparency: desired.transparency,
    visibility: desired.visibility,
    ...(desired.color ? { colorId: desired.color } : {}),
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        planipus_version: "1",
        planipus_policy: desired.provenance.policy_ref,
        planipus_projection: desired.provenance.projection_ref,
        planipus_generation: String(desired.provenance.generation)
      }
    }
  };
}
