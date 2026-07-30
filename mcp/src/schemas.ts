import * as z from "zod/v4";

const localId = z.uuid("must be a Planipus UUID");
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const localInterval = z.object({
  start: clock,
  end: clock,
  end_day_offset: z.union([z.literal(0), z.literal(1)])
}).strict();
const hoursException = z.discriminatedUnion("kind", [
  z.object({ date: localDate, kind: z.literal("closed") }).strict(),
  z.object({
    date: localDate,
    kind: z.enum(["replace", "add", "remove"]),
    intervals: z.array(localInterval).max(24)
  }).strict()
]);
const inlineHoursProfile = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(100),
  dst_resolution: z.object({
    ambiguous: z.enum(["earlier_offset", "later_offset"]),
    nonexistent: z.enum(["reject", "shift_forward_by_gap"])
  }).strict(),
  weekly: z.array(localInterval.extend({ weekday: z.number().int().min(1).max(7) })).max(168),
  exceptions: z.array(hoursException).max(732)
}).strict();

export const emptyInputSchema = z.object({}).strict();

export const policyIdInputSchema = z.object({
  policy_id: localId
}).strict();

export const conflictResponseRuleIdInputSchema = z.object({
  rule_id: localId
}).strict();

export const previewTokenInputSchema = z.object({
  preview_token: localId
}).strict();

export const syncPolicyDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  source_calendar_id: localId,
  destination_calendar_id: localId,
  hours_profile_id: localId.nullable().optional(),
  hours: z.object({
    mode: z.enum(["all_times", "overlaps_profile", "contained_in_profile"]),
    profile_ref: localId.optional()
  }).strict().optional(),
  hours_profile: inlineHoursProfile.optional(),
  privacy: z.object({
    preset: z.enum(["busy_only", "commitment", "private_details", "shared_details"]),
    preset_version: z.literal(1),
    generic_summary: z.string().trim().min(1).max(160),
    copy_summary: z.boolean(),
    copy_description: z.boolean(),
    copy_location: z.boolean(),
    copy_conference: z.boolean(),
    copy_attendees: z.boolean(),
    copy_organizer: z.boolean()
  }).strict(),
  selection: z.object({
    timed: z.enum(["include", "skip"]),
    all_day: z.enum(["skip", "busy_only", "all"]),
    free_events: z.enum(["skip_when_redacted", "preserve_free", "force_busy"]),
    tentative: z.enum(["busy", "free", "omit"]),
    unanswered: z.enum(["busy", "free", "omit"]),
    skip_when_destination_identity_invited: z.boolean(),
    source_exclusion_marker: z.string().max(160),
    manual_exclusions: z.array(z.string().min(1).max(500)).max(1_000)
  }).strict(),
  destination: z.object({
    color: z.string().trim().min(1).max(100).optional()
  }).strict().optional(),
  horizon: z.object({
    past_days: z.number().int().min(0).max(3_650),
    future_days: z.number().int().min(0).max(3_650)
  }).strict().optional()
}).strict();

export const conflictResponseDraftSchema = z.object({
  name: z.string().trim().min(1).max(160),
  response_calendar_id: localId,
  availability_calendar_ids: z.array(localId)
    .min(1)
    .max(32)
    .refine((ids) => new Set(ids).size === ids.length, "calendar identifiers must be unique"),
  decline_message: z.string().trim().min(1).max(500)
    .default("I have a private conflict at that time. Please choose another time."),
  horizon_days: z.number().int().min(1).max(90).default(60)
}).strict();

export const toolOutputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    status: z.number().int().nullable(),
    request_id: z.string().nullable(),
    retry_after_seconds: z.number().int().nullable()
  }).strict().optional()
}).strict();
