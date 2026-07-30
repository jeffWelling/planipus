# Current implementation testing

Status snapshot: **2026-07-21**. This document inventories executable evidence
for the repository as it exists now, with particular attention to planning,
API-token/MCP, and no-copy conflict-response work through migrations 0004–0014. It
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

Focused machine/no-copy feedback:

```text
npm run typecheck --workspace @planipus/mcp
npm run test --workspace @planipus/mcp
npm run test --workspace @planipus/server -- \
  conflict-response.test.ts api.test.ts provider.test.ts oauth.test.ts \
  config.test.ts migration.test.ts
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
| `server/tests/postgres.integration.test.ts` | Applies migrations 0001–0014 in an isolated schema; exercises conflict preview → activate → reconcile → exact fake-provider decline; proves immutable audit budget survives mutable action reuse and retirement/recreation, dropped-comment applied/action warning, preview/held behavior at 20; rejects delegated-alias self-copy/no-copy bypass in both bridge directions and observes the canonical provider-calendar activation lock race | Opt-in real-PostgreSQL evidence; fresh migration only, not an upgrade fixture containing a historical alias self-copy; it does not run the conflict path through scheduler/worker lease/fault/restore scenarios, race concurrent budget reservations, inspect every privacy surface, exercise planning provider effects, or call live Google |

The broader calendar-sync tests provide useful primitives—interval handling,
provider error mapping, queue behavior, bridge reconciliation, privacy transforms
and source cursor logic—but they do not automatically prove planning behavior.
Planning uses different tables, desired state, jobs, provider methods, ownership
markers, attendee payloads, and notification semantics.

## Current automated API/MCP/conflict-response coverage

These tests are present in the worktree. Their presence describes intended
fixture/unit evidence; use the dated evidence ledger for whether the consolidated
commands passed after all feature edits settled.

| Artifact | What is exercised | Evidence boundary |
|---|---|---|
| `server/tests/leased-job.test.ts` | scheduled-job heartbeat at lease/3, final conditional renewal before success/failure, lease-loss no-transition, and transient renewal-error handling | fake timers/mocked queue; no real slow provider, process termination, database partition, competing worker, or effect-lease proof |
| `mcp/tests/config.test.ts` | HTTPS/loopback URL rules, required token, secret-safe diagnostics, strict apply boolean/default off, 300-second deadline | Process configuration only; no real Server/slow provider fan-out |
| `mcp/tests/api-client.test.ts` | fixed-origin bearer GET/POST/DELETE, read-timeout versus mutation-unknown outcome, response cap, redirect/content/error safety, no-content result | mocked Fetch; no TLS/ingress/token database, outer-host timeout, or explicit 429/`Retry-After` assertion |
| `mcp/tests/server.test.ts` | static read/propose default, conflict input defaults/strictness, open-world/non-read-only conflict-preview annotations, safe errors, API route mapping, opt-in apply tools including activation and conflict-rule retirement, fixed resources | in-memory SDK transport/mocked API; no provider effect |
| `mcp/tests/boundary.test.ts` | MCP package has no Server-internal/database dependency | source/import boundary, not runtime egress proof |
| `server/tests/api.test.ts` | bearer scope enforcement, mixed credential rejection, browser-only issue/list/revoke, conflict propose/apply/retire actor routing, and 30-per-10-minute propose limit before provider contact | dependency-mocked Fastify API; not PostgreSQL token lifetime/concurrency, read/apply limit matrix, restart/replica bypass, provider write/message states, or disabled-write activation behavior |
| `server/tests/conflict-response.test.ts` | strict draft/defaults, eligible future work invitations, exact remote binding, grouped free/busy, half-open overlap, time-only preview, HMAC-shaped private bases, canonical alias distinctness, and budget warning | pure/input tests; no durable coordinator/provider write lifecycle or historical-provider budget race |
| `server/tests/provider.test.ts` | fake isolation/idempotency/ambiguity; Google free/busy mapping/errors; self-attendee decline/comment, pending-action already-declined no-PATCH recovery, accepted/tentative/organizer/cancelled fail-closed cases, ambiguous network/5xx/malformed-response verification, and verified decline with unretained comment | fake/mocked HTTP only; no proof that an initial recovery writes coordinator audit/budget/warning exactly once under concurrency, and no live organizer/mail behavior |
| `server/tests/oauth.test.ts` | role-specific Google scope sets including availability-only free/busy, role rejection, overbroad retained-Calendar-scope rejection, missing reported availability-scope rejection, other-role requested-scope fallback, and detection of source/both → no-event-read transitions | pure validation/mocked OAuth client/intent; no PostgreSQL first-connect lock/purge/dependency transaction, in-flight sync race, live consent screen, Google grant revocation, or reconnect proof |
| `server/tests/config.test.ts` | experimental Google invitation-decline flag defaults false and only accepts strict boolean | parser only |
| `server/tests/migration.test.ts` | token hash/scope/expiry shape, private-safe response-action schema, availability role, HMAC, candidate/provider identity, immutable-decline-audit index, and migration 0014 canonical identity/self-copy quarantine/audit text | SQL text inspection; no actual upgrade containing a historical alias self-copy; fresh real migration belongs to the opt-in PostgreSQL suite |

The opt-in PostgreSQL suite now provides a direct
`ConflictResponseService`/`ConflictResponseCoordinator` fake-provider lifecycle
and proves that a protected-calendar advisory lock serializes a conflict-rule/
bridge activation race across delegated aliases. The 2026-07-22 focused fresh
0001–0014 run passed one file/one test in 7.76 seconds. It is not yet recorded as
part of the consolidated gate and does not execute a seeded 0013→0014 historical
self-copy quarantine upgrade, durable scheduler/worker process path, duplicate/
leased jobs, crash ambiguity, pause/resume, restore, or complete SQL/privacy
inspection.

The highest missing release layer is live Google. `sendUpdates=none` is a request,
not proof of comment delivery or zero mail/calendar notification. Keep
`PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE=false` outside disposable tests.

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

### API token, MCP, and conflict-response release plan

- Record the opt-in fresh 0001–0014 PostgreSQL run and add an explicit upgrade
  run; extend it to token digest-only storage, tenant foreign keys, expiry/
  revocation, active membership, and action uniqueness/state constraints.
- Race each canonical protected private calendar against bridge activation and
  resume through different Google aliases, as source and destination in both
  winner orders. Prove the shared endpoint/provider-identity advisory locks
  prevent two active configurations, multi-calendar acquisition cannot deadlock,
  and restore checks detect any imported cross-table violation. Pause
  an existing bridge, prove protection succeeds while its managed copies remain/
  are disclosed, then prove resume fails while the rule is non-deleted.
- Prove one live controller across delegated aliases of the same Google calendar;
  retire/recreate it and prove the historical provider-identity budget neither
  resets nor races above 20. Prove idempotent DELETE supersedes pending/held,
  preserves applied actions, and permits a formerly blocked bridge to resume.
- Mutate/reuse/supersede/reschedule action rows after an applied decline and prove
  immutable `invitation_response.declined` audit facts preserve the 20/24-hour
  provider-identity count. Race reservations at 19/20 without exceeding 20.
  Hold a provider call across a transaction boundary and prove the audit fact's
  `clock_timestamp()` reflects verification completion rather than transaction
  start.
- Exercise source/both → availability role reauthorization on PostgreSQL:
  each live dependency and each historical projection/action reference must fail
  `availability_role_change_blocked`; a clear transition must purge observations/
  cursors, retire subscriptions/jobs, restrict endpoints, audit exact counts, and
  defeat first-connect/reauthorization, activation, calendar-discovery, cursor-
  initialization, page-persistence, and finalization races under the documented
  subject/connection/calendar lock order.
- Race two first-connect callbacks for the same organization/Google subject and
  prove exactly one authoritative connection ID/credential decision. Feed an
  availability callback each broader Calendar scope Google may retain and an
  omitted scope set; prove `oauth_scope_overbroad`/`oauth_scope_unverified`,
  unchanged role/data, manual grant revocation, fresh reconnect, narrow returned
  scope, then the guarded purge. Keep the live Google
  revoke/downgrade result open until archived.
- Upgrade a seeded 0013 database containing an active and a paused delegated-
  alias self-copy bridge. Prove 0014 marks each policy deleted with
  `same_provider_calendar`, dead-letters pending/leased/retry effects, completes
  pending/leased/retry reconcile jobs, emits exactly one deterministic
  `policy.quarantined_same_provider_calendar` fact with
  `historical_copies_untouched:true`, preserves destination copies for review,
  and rejects every new non-deleted equality.
- Exercise preview → stale/activate → reconcile → apply through the real worker
  with fake provider, including duplicate jobs, lease loss, timeout-after-write,
  changed rule/observation/revision/RSVP, pause/resume, and no-overlap supersede.
- Run competing workers against a provider call longer than one original lease.
  Prove scheduled-job renewal every lease/3 plus final conditional renewal,
  at most one scheduled job and one effect leased per loop, no stale-owner
  terminal transition, and continued worker service after ownership loss.
  Separately prove an uncancellable in-flight call converges through provider
  idempotency/conditional writes, ambiguity verification, and reconciliation.
- Inspect SQL, job JSON, audit, logs, metrics, HTTP, and MCP result snapshots for
  forbidden personal event identity/content. Repeat with strict `availability`
  role and prove the sync coordinator creates no source observations for it.
- Cross tenant and actor matrices: expired/revoked token, disabled principal,
  removed membership, read/propose/apply hierarchy, cookie+bearer ambiguity,
  browser-only token/OAuth/session/planning/sync routes, and apply double gate.
- Exercise read 600/minute, apply 120/minute, and propose 30/10-minute actor
  windows for browser sessions/tokens/tenants, safe 429 + numeric `Retry-After`
  through HTTP/MCP, restart/replica bypass, map-cardinality cleanup, and a shared
  persistent replacement. Race conflict preview creation at nine/ten live rows;
  enforce or explicitly retain the preflight-only concurrency limitation.
- Prove `read` cannot trigger a conflict preview and that `propose` contacts only
  the selected provider free/busy boundary, returns bounded time-only inference,
  performs no mutation, and is labeled as sensitive provider-contacting access.
- Verify preview/list/capability write and message-delivery fields in fake and
  Google modes; Google activation/resume must fail while writes are disabled,
  and enabling RSVP writes must leave message delivery unverified.
- Simulate an initial exact GET where a pending action already sees RSVP
  declined, with both exact and absent/different comments. Prove no PATCH,
  `changed=false`, applied action, ordinary immutable audit/budget consumption,
  exact warning propagation, and idempotent retry. Explicitly record the accepted
  conservative over-attribution of a manual decline. Accepted/tentative remain
  held. Then simulate a post-write verification where RSVP is declined but the
  requested comment is absent/different. Prove applied action/rule warning
  `decline_comment_not_retained`, immutable audit/budget consumption, no retry,
  and continued `unverified_google` message delivery. Exercise network failure,
  write-side 5xx, and malformed/failed response-body reads followed by exact GET
  verification.
- Exercise every MCP tool/resource against a real local API using an expiring test
  token; prove API remains authoritative, apply tools are absent by default, and
  process stdout contains protocol frames only.
- Run a bounded slow 32-calendar/four-lane preview under the 300-second MCP
  deadline. Abort GET and POST/DELETE paths during request and response-body read;
  prove GET returns `api_timeout`, mutation returns
  `api_timeout_outcome_unknown`, and the host reads state before retrying.
- Restore active/paused/pending/held/applied rules with writes disabled, rotate
  API tokens, reauthorize old Google grants, and reconcile without auto-accepting
  or issuing a duplicate RSVP.
- Prove response-calendar sync immediately enqueues deduplicated conflict-rule
  reconciliation while the 15-minute scheduler remains a working fallback.
- Inject slow/hung free/busy and RSVP provider calls while observing transaction
  age, protected-calendar/action locks, worker lease expiry, termination, and retry;
  use the result to move provider I/O behind a committed intent boundary.

### Disposable live Google no-copy gate

Use separate organizer, work-attendee, personal-availability, and ordinary
observer identities. Verify minimal availability OAuth scope, old-grant
reauthorization, free/busy mapping, one-off/recurring-instance response, exact
self attendee/`responseStatus`, best-effort comment visibility, mail and calendar notifications with
`sendUpdates=none`, accepted/tentative/declined/cancelled/organizer fail-closed,
412/404/410/429, timeout-after-commit, and cleanup. Record assertions and opaque
IDs only. This gate is separate from the Smart Meeting live suite below.

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
