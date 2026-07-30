import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import type { DatabaseSchema } from "../src/database/types.js";
import {
  PolicyInputError,
  PolicyService,
  compilePolicyDraft,
  type PolicyDraft
} from "../src/policy/service.js";
import { sharedPolicyRuntime } from "../src/policy/runtime.js";
import { calendarSyncQueryFingerprint } from "../src/sync/query.js";

const SOURCE_CALENDAR_ID = "00000000-0000-7000-8000-000000000101";
const DESTINATION_CALENDAR_ID = "00000000-0000-7000-8000-000000000102";

const DRAFT: PolicyDraft = {
  name: "Calendar bridge",
  source_calendar_id: SOURCE_CALENDAR_ID,
  destination_calendar_id: DESTINATION_CALENDAR_ID,
  hours: { mode: "overlaps_profile" },
  hours_profile: {
    name: "Weekday work hours",
    timezone: "America/Vancouver",
    dst_resolution: {
      ambiguous: "earlier_offset",
      nonexistent: "shift_forward_by_gap"
    },
    weekly: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday: weekday as 1 | 2 | 3 | 4 | 5,
      start: "09:00:00",
      end: "17:00:00",
      end_day_offset: 0 as const
    })),
    exceptions: []
  },
  privacy: {
    preset: "busy_only",
    preset_version: 1,
    generic_summary: "Busy",
    copy_summary: false,
    copy_description: false,
    copy_location: false,
    copy_conference: false,
    copy_attendees: false,
    copy_organizer: false
  },
  selection: {
    timed: "include",
    all_day: "skip",
    free_events: "skip_when_redacted",
    tentative: "busy",
    unanswered: "free",
    skip_when_destination_identity_invited: true,
    source_exclusion_marker: "#nosync",
    manual_exclusions: []
  },
  destination: {},
  horizon: { past_days: 30, future_days: 365 }
};

describe("PolicyService inline hours", () => {
  it("previews inline weekday hours and atomically materializes a dedicated profile on activation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-21T16:00:00.000Z");
    try {
      const fixture = policyDatabase();
      const policies = new PolicyService(fixture.db, sharedPolicyRuntime);
      const preview = await policies.preview("organization-1", "principal-1", DRAFT);
      expect(preview.counts).toMatchObject({ create: 1, update: 0, delete: 0, unchanged: 0, excluded: 0 });

      const activated = await policies.activate("organization-1", "principal-1", preview.preview_token);
      const profile = fixture.inserted("hours_profiles")[0];
      const policy = fixture.inserted("sync_policies")[0];
      expect(profile).toMatchObject({
        name: "Weekday work hours",
        timezone: "America/Vancouver",
        dst_resolution: {
          ambiguous: "earlier_offset",
          nonexistent: "shift_forward_by_gap"
        }
      });
      expect(policy?.["id"]).toBe(activated.id);
      expect(policy?.["hours_profile_id"]).toBe(profile?.["id"]);
      expect(policy?.["policy_document"]).toMatchObject({
        hours_profile_id: profile?.["id"],
        hours: { mode: "overlaps_profile", profile_ref: profile?.["id"] }
      });
      expect(policy?.["policy_document"]).not.toHaveProperty("hours_profile");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed inline time intervals even when the source currently has no events", async () => {
    const fixture = policyDatabase();
    const policies = new PolicyService(fixture.db, sharedPolicyRuntime);
    const invalid: PolicyDraft = {
      ...DRAFT,
      hours_profile: {
        ...DRAFT.hours_profile!,
        weekly: [{ weekday: 1, start: "9am", end: "17:00:00", end_day_offset: 0 }]
      }
    };
    await expect(policies.preview("organization-1", "principal-1", invalid))
      .rejects.toMatchObject({ code: "invalid_hours_profile" } satisfies Partial<PolicyInputError>);
  });

  it("compiles a resolved inline profile reference into the shared contract", () => {
    expect(compilePolicyDraft(DRAFT, "preview", 1, "active", "inline:profile").hours)
      .toEqual({ mode: "overlaps_profile", profile_ref: "inline:profile" });
  });

  it.each(["full_required", "syncing", "action_required"] as const)(
    "refuses a preview while the current source cursor is %s",
    async (cursorState) => {
      const fixture = policyDatabase({ cursorState });
      const policies = new PolicyService(fixture.db, sharedPolicyRuntime);
      await expect(policies.preview("organization-1", "principal-1", DRAFT))
        .rejects.toMatchObject({ code: "source_sync_incomplete" } satisfies Partial<PolicyInputError>);
      expect(fixture.inserted("policy_previews")).toHaveLength(0);
    }
  );

  it("refuses to mint an activatable token for a truncated preview", async () => {
    const fixture = policyDatabase({ observationCount: 5_001 });
    const policies = new PolicyService(fixture.db, sharedPolicyRuntime);
    await expect(policies.preview("organization-1", "principal-1", DRAFT))
      .rejects.toMatchObject({ code: "preview_incomplete" } satisfies Partial<PolicyInputError>);
    expect(fixture.inserted("policy_previews")).toHaveLength(0);
  });

  it("revalidates account roles and the completed cursor inside activation", async () => {
    const fixture = policyDatabase();
    const policies = new PolicyService(fixture.db, sharedPolicyRuntime);
    const rolePreview = await policies.preview("organization-1", "principal-1", DRAFT);
    fixture.setDestinationRole("source");
    await expect(policies.activate("organization-1", "principal-1", rolePreview.preview_token))
      .rejects.toMatchObject({ code: "calendar_capability" } satisfies Partial<PolicyInputError>);

    fixture.setDestinationRole("destination");
    const cursorPreview = await policies.preview("organization-1", "principal-1", DRAFT);
    fixture.setCursor("syncing", "ready-token");
    await expect(policies.activate("organization-1", "principal-1", cursorPreview.preview_token))
      .rejects.toMatchObject({ code: "preview_stale" } satisfies Partial<PolicyInputError>);
    expect(fixture.inserted("sync_policies")).toHaveLength(0);
  });

  it("refuses every outbound bridge before and after preview when a no-copy rule protects its source", async () => {
    const immediate = policyDatabase({ conflictRule: true });
    await expect(new PolicyService(immediate.db, sharedPolicyRuntime)
      .preview("organization-1", "principal-1", DRAFT))
      .rejects.toMatchObject({ code: "no_copy_rule_conflict" } satisfies Partial<PolicyInputError>);

    const raced = policyDatabase();
    const policies = new PolicyService(raced.db, sharedPolicyRuntime);
    const preview = await policies.preview("organization-1", "principal-1", DRAFT);
    raced.setConflictRule(true);
    await expect(policies.activate("organization-1", "principal-1", preview.preview_token))
      .rejects.toMatchObject({ code: "no_copy_rule_conflict" } satisfies Partial<PolicyInputError>);
    expect(raced.inserted("sync_policies")).toHaveLength(0);
  });
});

interface PolicyDatabaseOptions {
  readonly cursorState?: "full_required" | "syncing" | "ready" | "action_required";
  readonly cursorToken?: string | null;
  readonly observationCount?: number;
  readonly conflictRule?: boolean;
}

function policyDatabase(options: PolicyDatabaseOptions = {}): {
  readonly db: Kysely<DatabaseSchema>;
  inserted(table: string): Array<Record<string, unknown>>;
  setDestinationRole(role: "source" | "destination" | "both"): void;
  setConflictRule(present: boolean): void;
  setCursor(state: "full_required" | "syncing" | "ready" | "action_required", token: string | null): void;
} {
  const values = new Map<string, Array<Record<string, unknown>>>();
  const previews: Array<Record<string, unknown>> = [];
  const database: Record<string, unknown> = {};
  let destinationRole: "source" | "destination" | "both" = "destination";
  let cursorState = options.cursorState ?? "ready";
  let cursorToken = options.cursorToken === undefined ? "ready-token" : options.cursorToken;
  let conflictRule = options.conflictRule ?? false;

  const inserted = (table: string): Array<Record<string, unknown>> => {
    const existing = values.get(table);
    if (existing) return existing;
    const created: Array<Record<string, unknown>> = [];
    values.set(table, created);
    return created;
  };

  database["transaction"] = () => ({
    execute: async (callback: (transaction: unknown) => unknown) => callback(database)
  });
  database["selectFrom"] = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const method of ["innerJoin", "select", "selectAll", "where", "orderBy", "limit", "forUpdate"]) {
      builder[method] = chain;
    }
    const rows = (): Array<Record<string, unknown>> => {
      switch (table) {
        case "calendar_endpoints": return [
          {
            id: SOURCE_CALENDAR_ID,
            connection_id: "source-connection",
            remote_id: "source-primary",
            readable: true,
            writable: false,
            provider: "fake",
            intended_role: "source",
            connection_status: "active",
            capabilities: {}
          },
          {
            id: DESTINATION_CALENDAR_ID,
            connection_id: "destination-connection",
            remote_id: "destination-primary",
            readable: false,
            writable: true,
            provider: "fake",
            intended_role: destinationRole,
            connection_status: "active",
            capabilities: { private_visibility: true }
          }
        ];
        case "source_observations": return Array.from(
          { length: options.observationCount ?? 1 },
          (_, index) => ({
          id: `observation-${index + 1}`,
          observation_hash: "source-hash",
          normalized_event: {
            source_event_ref: `event-${index + 1}`,
            source_occurrence_ref: "",
            remote_revision: "etag-1",
            lifecycle: "confirmed",
            origin: "provider_original",
            timing: {
              kind: "timed",
              start_instant: "2026-07-21T17:00:00.000Z",
              end_instant: "2026-07-21T18:00:00.000Z",
              start_tzid: "America/Vancouver",
              end_tzid: "America/Vancouver"
            },
            availability: "busy",
            relationship: { role: "organizer", response: "accepted" },
            destination_identity_invited: false,
            content: { summary: "Private appointment" }
          }
        }));
        case "sync_cursors": return [{
          query_fingerprint: calendarSyncQueryFingerprint(sharedPolicyRuntime, "fake", "source-primary"),
          generation: 1,
          sync_token: cursorToken,
          state: cursorState
        }];
        case "policy_previews": return previews;
        case "conflict_response_rules": return conflictRule ? [{ id: "no-copy-rule" }] : [];
        default: return [];
      }
    };
    builder["execute"] = async () => rows();
    builder["executeTakeFirst"] = async () => rows()[0];
    builder["executeTakeFirstOrThrow"] = async () => {
      const first = rows()[0];
      if (!first) throw new Error(`missing fixture row for ${table}`);
      return first;
    };
    return builder;
  };
  database["insertInto"] = (table: string) => {
    let row: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder["values"] = (next: Record<string, unknown>) => {
      row = next;
      return builder;
    };
    builder["onConflict"] = () => builder;
    builder["returning"] = () => builder;
    builder["executeTakeFirstOrThrow"] = async () => {
      inserted(table).push(row);
      if (table === "policy_previews") previews.push(row);
      return { id: row["id"] };
    };
    builder["executeTakeFirst"] = async () => {
      inserted(table).push(row);
      return { id: row["id"] };
    };
    return builder;
  };
  database["updateTable"] = (table: string) => {
    let update: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder["set"] = (next: Record<string, unknown>) => {
      update = next;
      return builder;
    };
    builder["where"] = () => builder;
    const apply = () => {
      if (table === "policy_previews" && previews[0]) Object.assign(previews[0], update);
      return { numUpdatedRows: 1n };
    };
    builder["execute"] = async () => apply();
    builder["executeTakeFirstOrThrow"] = async () => apply();
    return builder;
  };

  return {
    db: database as unknown as Kysely<DatabaseSchema>,
    inserted,
    setDestinationRole(role) {
      destinationRole = role;
    },
    setConflictRule(present) {
      conflictRule = present;
    },
    setCursor(state, token) {
      cursorState = state;
      cursorToken = token;
    }
  };
}
