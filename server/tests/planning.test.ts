import { describe, expect, it } from "vitest";

import { planScheduling } from "../src/planning/engine.js";
import type { AvailabilityBoundaryDraft, SmartMeetingDraft } from "../src/planning/types.js";
import { parsePlanningDraft, PlanningInputError } from "../src/planning/validation.js";

const boundary: AvailabilityBoundaryDraft = {
  kind: "availability_boundary",
  name: "Keep evenings quiet",
  target_calendar_id: "work-calendar",
  timezone: "America/Vancouver",
  working_days: [1, 2, 3, 4, 5],
  workday_start: "09:00:00",
  workday_end: "17:00:00",
  protect_before_work: false,
  protect_after_work: true,
  protect_closed_days: false,
  title: "Personal time",
  visibility: "private",
  horizon_days: 2
};

const meeting: SmartMeetingDraft = {
  kind: "smart_meeting",
  name: "Weekly one-to-one",
  target_calendar_id: "work-calendar",
  timezone: "America/Vancouver",
  start_date: "2026-07-20",
  weekdays: [2],
  window_start: "09:00:00",
  window_end: "17:00:00",
  preferred_time: "10:00:00",
  cadence_weeks: 1,
  occurrence_count: 2,
  minimum_duration_minutes: 30,
  maximum_duration_minutes: 60,
  start_step_minutes: 15,
  priority: 2,
  attendees: [{
    email: "teammate@example.invalid",
    required: true,
    availability_calendar_id: "teammate-calendar"
  }],
  availability_calendar_ids: ["owner-calendar", "teammate-calendar"],
  conflict_policy: "suggest",
  lock_before_minutes: 1_440,
  visibility: "default"
};

describe("availability boundary planner", () => {
  it("creates private busy blocks only after configured work hours", () => {
    const result = planScheduling({
      draft: boundary,
      now: "2026-07-20T16:00:00.000Z",
      busy: [],
      known_availability_calendar_ids: []
    });
    expect(result.scheduled_count).toBe(2);
    expect(result.occurrences.map((item) => item.event?.timing)).toEqual([
      {
        start_instant: "2026-07-21T00:00:00Z",
        end_instant: "2026-07-21T07:00:00Z",
        timezone: "America/Vancouver"
      },
      {
        start_instant: "2026-07-22T00:00:00Z",
        end_instant: "2026-07-22T07:00:00Z",
        timezone: "America/Vancouver"
      }
    ]);
    expect(result.occurrences.every((item) => item.event?.visibility === "private")).toBe(true);
    expect(result.occurrences.every((item) => item.event?.attendees.length === 0)).toBe(true);
  });
});

describe("Smart Meeting planner", () => {
  it("chooses the closest mutual opening inside meeting hours deterministically", () => {
    const input = {
      draft: meeting,
      now: "2026-07-20T16:00:00.000Z",
      busy: [{
        calendar_id: "teammate-calendar",
        start: "2026-07-21T16:00:00.000Z",
        end: "2026-07-21T18:30:00.000Z"
      }],
      known_availability_calendar_ids: ["owner-calendar", "teammate-calendar"]
    } as const;
    const first = planScheduling(input);
    const second = planScheduling(input);
    expect(second).toEqual(first);
    expect(first.scheduled_count).toBe(2);
    expect(first.occurrences[0]?.event?.timing).toEqual({
      start_instant: "2026-07-21T18:30:00.000Z",
      end_instant: "2026-07-21T19:30:00.000Z",
      timezone: "America/Vancouver"
    });
    expect(first.occurrences[0]?.reason_code).toBe("closest_mutual_opening");
  });

  it("reports an unmet occurrence rather than escaping protected hours", () => {
    const result = planScheduling({
      draft: { ...meeting, occurrence_count: 1, lock_before_minutes: 0 },
      now: "2026-07-20T16:00:00.000Z",
      busy: [{
        calendar_id: "owner-calendar",
        start: "2026-07-21T16:00:00.000Z",
        end: "2026-07-22T00:00:00.000Z"
      }],
      known_availability_calendar_ids: ["owner-calendar", "teammate-calendar"]
    });
    expect(result.scheduled_count).toBe(0);
    expect(result.unmet_count).toBe(1);
    expect(result.occurrences[0]?.reason_code).toBe("no_mutual_time_inside_meeting_hours");
  });

  it("warns when a required attendee has no connected availability calendar", () => {
    const result = planScheduling({
      draft: {
        ...meeting,
        occurrence_count: 1,
        attendees: [{ email: "external@example.net", required: true }]
      },
      now: "2026-07-20T16:00:00.000Z",
      busy: [],
      known_availability_calendar_ids: ["owner-calendar", "teammate-calendar"]
    });
    expect(result.warnings).toContain("required_attendee_availability_unknown");
  });

  it("never chooses a slot that has already started", () => {
    const result = planScheduling({
      draft: { ...meeting, occurrence_count: 1, lock_before_minutes: 0 },
      now: "2026-07-21T18:00:00.000Z",
      busy: [],
      known_availability_calendar_ids: ["owner-calendar", "teammate-calendar"]
    });
    expect(result.occurrences[0]?.event?.timing.start_instant).toBe("2026-07-21T18:00:00.000Z");
  });
});

describe("planning input validation", () => {
  it("rejects after-hours windows that run backwards", () => {
    expect(() => parsePlanningDraft({
      ...boundary,
      workday_start: "17:00",
      workday_end: "09:00"
    })).toThrow(PlanningInputError);
  });

  it("normalizes clock values and safe defaults", () => {
    expect(parsePlanningDraft({
      ...boundary,
      workday_start: "09:00",
      workday_end: "17:00"
    })).toMatchObject({
      workday_start: "09:00:00",
      workday_end: "17:00:00",
      protect_after_work: true
    });
  });
});
