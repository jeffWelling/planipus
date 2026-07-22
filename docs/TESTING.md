# Current implementation testing

Status snapshot: **2026-07-21**. This document inventories executable evidence
for the repository as it exists now, with particular attention to planning
migration 0004, scheduler-index migration 0005, and `server/src/planning`. It
complements the release-oriented
`TEST-STRATEGY.md`; it does not upgrade a feature from specified or implemented
to verified merely because a unit test exists.

Planipus remains a clean-room Apache-2.0 implementation. No Keeper source,
schema, migrations, tests, fixtures, generated artifacts, or other AGPL-licensed
implementation material may be copied, adapted, translated, linked, vendored,
or executed as a test oracle. Publicly observable behavior may inform an
independently authored requirement and Planipus-owned fixture.

## Reproducible local commands

Run from the repository root with the pinned Node 24/npm 11 toolchain and frozen
lockfile:

```text
npm run docs
npm run typecheck
npm test
npm run build
```

The full project gate also runs provenance and repository checks:

```text
./scripts/gate.sh
```

Focused planning feedback can be obtained without implying release readiness:

```text
npm run test --workspace @planipus/server -- \
  planning.test.ts api.test.ts provider.test.ts migration.test.ts
```

Record command, source revision, runtime versions, environment, exit status, and
test totals in a dated evidence file. A passing test with faked provider or
database dependencies is labeled fixture/unit evidence, not live or integration
evidence.

## Current automated planning coverage

| Artifact | What is exercised | Evidence boundary |
|---|---|---|
| `server/tests/planning.test.ts` | Availability Boundary after-hours output; Smart Meeting deterministic closest opening, full-window unmet result, missing required-attendee warning, no past start; backward-window rejection and clock normalization/defaults; semantic preview snapshots ignore refresh metadata, detect Busy/capability/readiness changes, and normalize calendar/interval order | Eleven example tests against the pure engine/parser/snapshot document; no property corpus, DST transition matrix, coordinator, database, or provider I/O |
| `server/tests/api.test.ts` | Authenticated/CSRF-protected preview and activation route delegation and response codes | Dependencies are mocked; no parser error matrix, preview persistence/staleness, lifecycle routes, ownership, rate limiting, or PostgreSQL transaction evidence |
| `server/tests/provider.test.ts` | Smart Meeting Google serialization with attendees and separate private markers; fake timeout-after-create followed by ownership readback; same-calendar/same-event-ID isolation across fake tokens for discovery, bridge events, and planning events | Serializer/fake adapter evidence only; no live invitations, update/delete notification observation, ETag conflict matrix, or recipient behavior |
| `server/tests/migration.test.ts` | Migration text contains the planning tables/kinds/occurrence uniqueness, planner/bridge separation, and the non-partial retained-job lookup index | Text inspection only; the opt-in PostgreSQL suite supplies actual migration execution |
| `server/tests/postgres.integration.test.ts` | Applies migrations 0001–0005 in an isolated schema; distinguishes and concurrently exercises historical-window `enqueueOnce` versus repeatable active-only enqueue; repairs an unreferenced legacy fake cross-account endpoint; exercises the existing bridge lifecycle/recovery suite | Opt-in real-PostgreSQL evidence; it still does not construct `PlanningService`/`PlanningCoordinator` or execute planning provider effects |

The broader calendar-sync tests provide useful primitives—interval handling,
provider error mapping, queue behavior, bridge reconciliation, privacy transforms
and source cursor logic—but they do not automatically prove planning behavior.
Planning uses different tables, desired state, jobs, provider methods, ownership
markers, attendee payloads, and notification semantics.

## Critical untested paths

There is currently no automated PlanningService or PlanningCoordinator test
against real PostgreSQL and no repeatable planning lifecycle regression through
a real scheduler/worker. A manual credential-free vertical slice passed and is
recorded in `docs/evidence/2026-07-21-planning-browser-verification.md`; it does
not replace the following highest-risk automated/live evidence:

1. preview creation/expiry/consumption, canonical snapshot hashing, stale conflict,
   concurrent activation, rollback, and replay;
2. scheduler deduplication, worker lease expiry/retry/dead transition, and
   transaction recovery for `reconcile_planning_rule`/`apply_planned_event`;
3. create/update/delete convergence, ambiguous provider outcomes, deterministic
   generation IDs, ETag precondition, ownership mismatch, and missing-event
   recreation through the actual coordinator;
4. `suggest`, `auto_move`, and `keep_with_warning`, including suggestion expiry,
   duplicate basis hashes, accept/dismiss/apply, stale-basis rejection, and
   same-rule integrity;
5. pause while apply is pending and resume re-enqueue; active target recovery;
   ownership/policy/no-move behavior, including suggest-first semantics after a
   lock expires;
6. periodic detection and repair policy for destination events edited/deleted
   outside Planipus—currently no planning destination verifier exists;
7. target calendar included in availability and same-rule private-marker
   exclusion; other planned events are currently pooled even when their calendars
   were not selected;
8. 30-minute ready-sync enforcement, all-day busy materialization, and unknown
   required attendee behavior, including the case where an attendee calendar is
   not selected;
9. attendee notifications for create, automatic move, shorten, skip/delete,
   pause/resume, and retry; RSVP/organizer/third-viewer outcomes;
10. authorization by rule owner/delegate and cross-tenant/ID enumeration for
    list/pause/resume/replan/delete and suggestion list/resolve;
11. strict unknown-field rejection, malformed non-UUID path IDs, payload bounds,
    duplicate attendee/calendar normalization, past dates, and unusual Unicode;
12. half/quarter-hour zones, DST gaps/folds, local-midnight preview activation,
    closed days, all allowed horizons/counts, and UTC-step alignment;
13. database invariants for owner organization membership and suggestion/event
    same-rule ownership, plus resolution basis revalidation;
14. provider latency while row locks are held, worker lease/termination behavior,
    concurrent replans, queue pressure, and dead-job observability;
15. restore with active/pending planning state, duplicate-instance ownership,
    `deleting` completion/holds/lifecycle races, preservation of past events,
    deletion/export/retention, and restricted-data leakage to logs/backups;
16. fake versus Google capability gating and behavior when
    `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING` is disabled with pending rows.

## Immediate test plan

### P0: correctness and notification safety

- Add a disposable PostgreSQL fixture that applies migrations 0001–0005 and
  constructs PlanningService/PlanningCoordinator with the fake provider.
- Reproduce pause-with-pending-apply then resume; require a new apply job and
  convergence. Require active target-unavailable recovery, explicit
  ownership/policy recovery, and preservation of suggest-first behavior after a
  no-move window expires.
- Include the target calendar as availability, ingest the already-managed event,
  and require it not to displace itself. Include a planned event on an unselected
  calendar and require it not to block the rule.
- Simulate timeout-before-write, timeout-after-write, 404/410, 412, ownership
  mismatch, revoked token, quota, and retry exhaustion for create/update/delete.
- Assert the exact `sendUpdates` value on every Smart Meeting and Availability
  Boundary provider operation. Keep invitations disabled in all CI fixtures by
  using reserved invalid domains/fakes.
- Add owner, same-organization non-owner, cross-organization, expired session,
  missing CSRF, and malformed-ID tests for every planning endpoint.
- Resolve a suggestion after its planned event changes and require
  `suggestion_stale`; reject any rule/event mismatch at the database boundary.
- Roll the cadence horizon past an attached Smart Meeting and require that an
  ended provider event is retained without `sendUpdates=all`; only genuinely
  future stale ownership may be cleaned according to explicit policy.
- Remove a rule while target access is unavailable or ownership is ambiguous;
  require durable retry/action-needed state and prevent pause/resume from
  changing a `deleting` rule.

### P1: engine properties and lifecycle

- Property-test that every returned event is positive duration, lies entirely in
  an allowed materialized window, never overlaps supplied busy intervals or
  another selected occurrence, and is stable for canonical identical input.
- Build a timezone corpus with DST gap/fold and UTC offsets divisible by 15 but
  not 60. Assert documented earlier-offset/shift-forward behavior and choose a
  local-window-relative alignment rule before changing current UTC alignment.
- Exercise all bounds and defaults for both rule kinds, strict unknown fields,
  and stable error classes.
- Test preview expiry and cleanup, suggestion creation/deduplication/expiry, stale
  occurrence deletion, generation advancement, and all planned-event states.
- Test scheduler 15-minute deduplication and worker retry/dead behavior using a
  controllable clock rather than sleeps.

### P2: operations and recovery

- Add planning state to authenticated status/metrics and test bounded labels and
  restricted-field redaction.
- Restore a dump containing active, paused, pending, held, unmet, deleted, and
  suggested records with provider writes paused; reconcile one account at a
  time and prove no duplicate managed IDs.
- Measure provider latency, open transaction duration, lock contention, queue age,
  and termination at the supported personal-load envelope before Kubernetes beta.
- Implement and test explicit rule/event/suggestion retention and organization
  deletion/export semantics.

## Disposable live Google gate

No Smart Meeting notification or privacy claim is releasable from fake adapters
alone. Use dedicated disposable accounts/calendars and non-human test recipients:

1. connect an organizer/target account and each selected availability account;
2. include a required attendee mailbox plus an uninvolved third viewer with the
   exact calendar role under test;
3. preview without writes and capture the disclosure/update summary;
4. activate one occurrence, observe organizer/attendee inboxes, provider event
   fields, visibility, reminders, ownership markers, and third-viewer display;
5. force `auto_move`, `suggest`, `keep_with_warning`, update, delete, timeout,
   ETag conflict, external edit/delete, token revoke, and retry cases;
6. verify invitation/cancellation count and contents, RSVP preservation, no
   duplicate provider events, and safe held/error status;
7. delete all disposable events/calendars and record cleanup evidence.

Never point this suite at employer or personal production calendars. Capture
opaque IDs and result assertions, not attendee addresses, event bodies, OAuth
tokens, email contents, or provider payloads in repository artifacts.

## Evidence and claim rules

- “Implemented” means code/schema exists; it does not imply integration or live
  provider proof.
- “Unit/fixture tested” names the exact file and behavior exercised.
- “Verified” requires the requirement's traceability gate, negative cases, and
  dated evidence at a pinned source revision.
- A general `npm test` pass does not certify privacy, invitation behavior,
  Kubernetes restore, tenancy, performance, or Google compatibility.
- Known failures and skipped live tests remain visible. Do not soften a release
  statement to hide missing credentials or an unavailable disposable tenant.
