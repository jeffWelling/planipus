import { Temporal } from "temporal-polyfill";
import { canonicalizeJson, sha256Canonical } from "./canonical.js";
import { evaluateHours } from "./hours.js";
import type {
  DesiredCopy,
  DisclosureManifest,
  EventTiming,
  JsonValue,
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  PrivacyPolicy,
  ReasonCode,
} from "./types.js";

const OMITTED_SOURCE_FIELDS = [
  "/attachments",
  "/attendees",
  "/content/description",
  "/content/summary",
  "/content/location",
  "/content/conference",
  "/organizer",
  "/provider_metadata",
  "/source_url",
] as const;

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(asJson(left)) === canonicalizeJson(asJson(right));
}

function privacyReason(preset: PrivacyPolicy["preset"]): ReasonCode {
  switch (preset) {
    case "busy_only": return "privacy_busy_only";
    case "commitment": return "privacy_commitment";
    case "private_details": return "privacy_private_details";
    case "shared_details": return "privacy_shared_details";
  }
}

function result(
  selection: PolicyEvaluationResult["selection"],
  operation: PolicyEvaluationResult["operation"],
  primary: ReasonCode,
  reasons: ReasonCode[],
  warnings: ReasonCode[] = [],
): PolicyEvaluationResult {
  return {
    selection,
    operation,
    primary_reason_code: primary,
    reason_codes: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
  };
}

function excluded(
  input: PolicyEvaluationInput,
  code: ReasonCode,
  sourceRemoved = false,
): PolicyEvaluationResult {
  if (input.projection.ownership === "detached") {
    return result("excluded", "none", "detached_no_action", [code, "detached_no_action"]);
  }
  if (input.projection.ownership === "ambiguous") {
    return result("held", "none", "ambiguous_ownership", [code, "ambiguous_ownership"]);
  }
  if (input.projection.ownership === "attached") {
    const effectReason = sourceRemoved ? "delete_source_removed" : "delete_policy_exclusion";
    return result("excluded", "delete", effectReason, [code, effectReason]);
  }
  return result("excluded", "none", code, [code]);
}

function containsNoSync(input: PolicyEvaluationInput): boolean {
  const marker = input.policy.selection.source_exclusion_marker.normalize("NFC").toLowerCase();
  if (marker.length === 0) return false;
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "iu");
  const fields = [
    input.source.content.summary,
    input.source.content.description,
    input.source.relationship.response_note,
  ];
  return fields.some((field) => field !== undefined && expression.test(field.normalize("NFC").toLowerCase()));
}

function timingInterval(timing: EventTiming): { start: string; end: string } {
  if (timing.kind === "timed") {
    return { start: timing.start_instant, end: timing.end_instant };
  }
  const startDate = Temporal.PlainDate.from(timing.start_date);
  const endDate = Temporal.PlainDate.from(timing.end_date);
  const start = Temporal.ZonedDateTime.from({
    timeZone: timing.timezone,
    year: startDate.year,
    month: startDate.month,
    day: startDate.day,
    hour: 0,
  }).toInstant();
  const end = Temporal.ZonedDateTime.from({
    timeZone: timing.timezone,
    year: endDate.year,
    month: endDate.month,
    day: endDate.day,
    hour: 0,
  }).toInstant();
  return { start: start.toString({ smallestUnit: "second" }), end: end.toString({ smallestUnit: "second" }) };
}

function overlaps(left: { start: string; end: string }, right: { start: string; end: string }): boolean {
  const leftStart = Temporal.Instant.from(left.start);
  const leftEnd = Temporal.Instant.from(left.end);
  const rightStart = Temporal.Instant.from(right.start);
  const rightEnd = Temporal.Instant.from(right.end);
  return Temporal.Instant.compare(leftStart, leftEnd) < 0
    && Temporal.Instant.compare(rightStart, rightEnd) < 0
    && Temporal.Instant.compare(leftStart, rightEnd) < 0
    && Temporal.Instant.compare(rightStart, leftEnd) < 0;
}

function validate(input: PolicyEvaluationInput): ReasonCode | undefined {
  if (input.policy.source_calendar_ref === input.policy.destination_calendar_ref) return "invalid_same_calendar";
  if (!input.destination_capabilities.writable) return "invalid_unwritable_destination";
  const privacy = input.policy.privacy;
  if (privacy.copy_attendees || privacy.copy_organizer) return "invalid_privacy_transform";
  if ((privacy.preset === "busy_only" || privacy.preset === "commitment")
      && (privacy.copy_summary || privacy.copy_description || privacy.copy_location || privacy.copy_conference)) {
    return "invalid_privacy_transform";
  }
  if (privacy.generic_summary.normalize("NFC").trim().length === 0) return "invalid_privacy_transform";
  if (privacy.preset !== "shared_details" && !input.destination_capabilities.private_visibility) {
    return "unsupported_destination_capability";
  }
  if (privacy.copy_conference && !input.destination_capabilities.conference_copy) {
    return "unsupported_destination_capability";
  }
  if (input.policy.destination.color !== undefined && !input.destination_capabilities.color) {
    return "unsupported_destination_capability";
  }
  if (input.source.lifecycle === "confirmed" && input.source.timing === undefined) return "invalid_source_event";
  if (input.policy.hours.mode !== "all_times") {
    if (input.hours_profile === undefined || input.policy.hours.profile_ref !== input.hours_profile.profile_ref) {
      return "invalid_hours_profile";
    }
  }
  return undefined;
}

function effectiveAvailability(input: PolicyEvaluationInput): {
  availability?: "busy" | "free";
  reason?: ReasonCode;
  omitted?: ReasonCode;
} {
  const relationship = input.source.relationship;
  if (relationship.role === "organizer") {
    return { availability: "busy", reason: "organizer_assumed_accepted" };
  }
  if (relationship.role === "attendee") {
    switch (relationship.response) {
      case "declined": return { omitted: "rsvp_declined" };
      case "accepted": return { availability: "busy", reason: "rsvp_accepted" };
      case "tentative":
        if (input.policy.selection.tentative === "omit") return { omitted: "rsvp_tentative_omitted" };
        return input.policy.selection.tentative === "busy"
          ? { availability: "busy", reason: "rsvp_tentative_busy" }
          : { availability: "free", reason: "rsvp_tentative_free" };
      case "needs_action":
        if (input.policy.selection.unanswered === "omit") return { omitted: "rsvp_unanswered_omitted" };
        return input.policy.selection.unanswered === "busy"
          ? { availability: "busy", reason: "rsvp_unanswered_busy" }
          : { availability: "free", reason: "rsvp_unanswered_free" };
      case "not_applicable": break;
    }
  }
  return { availability: input.source.availability ?? "busy" };
}

function transform(
  input: PolicyEvaluationInput,
  availability: "busy" | "free",
): { desired: DesiredCopy; disclosure: DisclosureManifest } {
  const privacy = input.policy.privacy;
  const timing = input.source.timing;
  if (timing === undefined) throw new TypeError("Confirmed source requires timing");
  const details = privacy.preset === "private_details" || privacy.preset === "shared_details";
  const desired: DesiredCopy = {
    timing,
    summary: details && privacy.copy_summary
      ? (input.source.content.summary ?? "")
      : privacy.generic_summary,
    transparency: availability === "free" ? "transparent" : "opaque",
    visibility: privacy.preset === "shared_details" ? "default" : "private",
    reminders: [],
    write_controls: { send_notifications: false },
    provenance: {
      version: 1,
      policy_ref: input.policy.policy_ref,
      projection_ref: input.projection.projection_ref ?? input.candidate_projection_ref,
      generation: input.projection.generation ?? 1,
    },
  };
  if (details && privacy.copy_description && input.source.content.description !== undefined) {
    desired.description = input.source.content.description;
  }
  if (details && privacy.copy_location && input.source.content.location !== undefined) {
    desired.location = input.source.content.location;
  }
  if (details && privacy.copy_conference && input.source.content.conference !== undefined) {
    desired.conference = input.source.content.conference;
  }
  if (input.policy.destination.color !== undefined) desired.color = input.policy.destination.color;

  const sourceFieldsRead = [
    "/availability",
    "/content/description",
    "/content/summary",
    "/destination_identity_invited",
    "/origin",
    ...(input.source.recurrence === undefined ? [] : ["/recurrence"]),
    "/relationship",
    "/timing",
  ];
  const disclosed = ["/timing"];
  if (details && privacy.copy_summary) disclosed.push("/content/summary");
  if (details && privacy.copy_description) disclosed.push("/content/description");
  if (details && privacy.copy_location) {
    disclosed.push("/content/location");
    sourceFieldsRead.push("/content/location");
  }
  if (details && privacy.copy_conference) {
    disclosed.push("/content/conference");
    sourceFieldsRead.push("/content/conference");
  }
  const destinationFields = Object.keys(desired).map((field) => `/${field}`);
  const disclosure: DisclosureManifest = {
    version: 1,
    preset: { id: privacy.preset, version: 1 },
    source_fields_read: sortedUnique(sourceFieldsRead),
    source_fields_disclosed: sortedUnique(disclosed),
    destination_fields_written: sortedUnique(destinationFields),
    source_fields_omitted: OMITTED_SOURCE_FIELDS.filter((field) => !disclosed.includes(field)).sort(),
  };
  return { desired, disclosure };
}

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
  const invalid = validate(input);
  if (invalid !== undefined) return result("invalid", "none", invalid, [invalid]);
  if (input.policy.state === "paused") return result("held", "none", "policy_paused", ["policy_paused"]);
  if (input.policy.state === "disabled") return result("excluded", "none", "policy_disabled", ["policy_disabled"]);
  if (input.policy.state === "review_required") {
    return result("held", "none", "policy_review_required", ["policy_review_required"]);
  }
  if (input.source.lifecycle === "deleted") return excluded(input, "source_deleted", true);
  if (input.source.lifecycle === "cancelled") return excluded(input, "source_cancelled", true);
  if (input.source.origin === "planipus_managed") return excluded(input, "managed_copy");
  if (input.policy.selection.manual_exclusions.includes(input.source.source_event_ref)) {
    return excluded(input, "manual_exclusion");
  }
  if (containsNoSync(input)) return excluded(input, "nosync");
  if (input.policy.selection.skip_when_destination_identity_invited && input.source.destination_identity_invited) {
    return excluded(input, "already_invited");
  }

  const response = effectiveAvailability(input);
  if (response.omitted !== undefined) return excluded(input, response.omitted);
  let availability = response.availability ?? "busy";
  const timing = input.source.timing;
  if (timing === undefined) return result("invalid", "none", "invalid_source_event", ["invalid_source_event"]);
  if (!overlaps(timingInterval(timing), input.horizon)) return excluded(input, "outside_horizon");

  const selectionReasons: ReasonCode[] = [];
  if (response.reason !== undefined) selectionReasons.push(response.reason);
  if (timing.kind === "timed") {
    if (input.policy.selection.timed === "skip") return excluded(input, "timed_event_disabled");
    selectionReasons.push("timed_event_included");
  } else {
    if (input.policy.selection.all_day === "skip") return excluded(input, "all_day");
    if (input.policy.selection.all_day === "busy_only" && availability === "free") {
      return excluded(input, "all_day_free");
    }
    selectionReasons.push(input.policy.selection.all_day === "busy_only" ? "all_day_busy_included" : "all_day_included");
  }

  const warnings: ReasonCode[] = [];
  if (availability === "free") {
    const redacted = input.policy.privacy.preset === "busy_only" || input.policy.privacy.preset === "commitment";
    switch (input.policy.selection.free_events) {
      case "skip_when_redacted":
        if (redacted) return excluded(input, "free");
        selectionReasons.push("free_preserved");
        break;
      case "preserve_free":
        selectionReasons.push("free_preserved");
        break;
      case "force_busy":
        availability = "busy";
        selectionReasons.push("free_forced_busy");
        warnings.push("free_forced_busy");
        break;
    }
  }

  if (timing.kind === "timed") {
    const hours = evaluateHours({
      mode: input.policy.hours.mode,
      event: { start: timing.start_instant, end: timing.end_instant },
      ...(input.hours_profile === undefined ? {} : { profile: input.hours_profile }),
    });
    if (!hours.included) return excluded(input, hours.reason_code);
    selectionReasons.push(...hours.diagnostics, hours.reason_code);
  }

  if (input.projection.ownership === "detached") {
    return result("included", "none", "detached_no_action", [...selectionReasons, "detached_no_action"], warnings);
  }
  if (input.projection.ownership === "ambiguous") {
    return result("held", "none", "ambiguous_ownership", [...selectionReasons, "ambiguous_ownership"], warnings);
  }

  const { desired, disclosure } = transform(input, availability);
  const desiredFingerprint = sha256Canonical(asJson(desired));
  let operation: PolicyEvaluationResult["operation"];
  let operationReason: ReasonCode;
  if (input.projection.ownership === "none") {
    operation = "create";
    operationReason = "create_missing_copy";
  } else if (input.projection.destination_exists === false) {
    operation = "create";
    operationReason = "restore_destination_missing";
  } else if (input.projection.observed_copy !== undefined && !sameJson(input.projection.observed_copy, desired)) {
    operation = "update";
    operationReason = "restore_destination_drift";
  } else if (input.projection.desired_fingerprint !== undefined
      && input.projection.desired_fingerprint !== desiredFingerprint) {
    operation = "update";
    operationReason = "update_source_change";
  } else {
    operation = "none";
    operationReason = "no_change";
  }
  return {
    selection: "included",
    operation,
    primary_reason_code: operationReason,
    reason_codes: [...new Set([...selectionReasons, privacyReason(input.policy.privacy.preset), operationReason])],
    desired_copy: desired,
    desired_fingerprint: desiredFingerprint,
    disclosure_manifest: disclosure,
    warnings: [...new Set(warnings)],
  };
}
