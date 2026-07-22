# ADR-002 — Calendar Sync v1 executable semantics

Status: accepted

Date: 2026-07-21

Owners/reviewers: Planipus maintainers; security review required for disclosure
changes

Requirements/risks: CAL-009–CAL-015, MAC-012

## Context

The product contract was complete enough to explain the feature but left small
differences between API examples, storage prose, and test language. The two
independent implementations need one exact provider-neutral oracle.

## Decision

`conformance/calendar-sync/v1` is the semantic authority. It uses JSON Schema
2020-12, registered reason codes, versioned privacy presets, disclosure
manifests, canonical JSON, and Planipus-authored cases.

The following v1 rules resolve prior ambiguity:

- free-event modes are `skip_when_redacted`, `preserve_free`, and `force_busy`;
- RSVP-derived availability is evaluated before the generic free-event rule;
- overnight intervals use `end_day_offset` and concrete half-open intervals;
- ambiguous local times select `earlier_offset` or `later_offset`; nonexistent
  local times use `reject` or `shift_forward_by_gap`;
- exceptions are `closed`, `replace`, `add`, or `remove`;
- `contained_in_profile` requires containment by one concrete interval;
- horizon selection uses positive instant overlap;
- all-day selection is decided before and bypasses timed-hours evaluation;
- preset v1 freezes exact copied/omitted fields; attendees and organizers are
  always rejected, reminders are absent, and provider writes send no updates;
- recurrence is materialized per occurrence inside the bounded horizon for P0;
- a marker prevents recursive ingestion but never establishes ownership;
- detach retains a safe loop-prevention marker and stops all management;
- Remove copy first creates a durable manual exclusion, then deletes the copy;
- pause emits no effects and leaves existing copies;
- unsupported required destination capabilities reject activation/effects;
- `#nosync` input is NFC-normalized, case-insensitive, and token-boundary aware;
- desired fingerprints are SHA-256 over canonical provider-neutral desired
  state, excluding provider revisions and nondeterministic values.

## Consequences

Both implementations must consume the exact cases and may use different
runtimes, stores, and algorithms. A disclosure change requires security review
and a preset/contract version change. Provider payload adapters are tested
separately from provider-neutral evaluation.

## Validation/revisit trigger

V1 is accepted when TypeScript and Swift independently pass every listed case.
Provider behavior that cannot be represented requires a versioned extension,
not an edition-specific interpretation.

## Supersedes / superseded by

Clarifies `CALENDAR-SYNC.md`, `API.md`, and `DATA-MODEL.md`; does not broaden P0.
