# Test strategy and release evidence

Testing protects calendar integrity, time semantics, privacy, and recoverability.
Line coverage is a signal, not the target. Every requirement in
`REQUIREMENTS.md` maps to at least one automated test or a documented manual/
external verification with owner and release gate.

## Test layers

### Cross-edition conformance

Canonical JSON under `conformance/calendar-sync/v1` defines policy inputs,
source observations, existing projection facts, expected decision/reason codes,
disclosure manifest and provider-neutral desired copy. Independent Swift and
TypeScript runners must pass every applicable case. They may not call each
other. Any disclosure-changing golden update requires privacy/security review
and a preset/schema version change.

### Pure unit tests

Domain state transitions, authorization/policy decisions, recurrence, time
conversion, hours-window intersection, privacy transformations, field mapping, error
classification, encryption envelope format, token hashing, and webhook signatures.
Use fixed clock/IDs/randomness and table-driven edge cases.

### Property and model tests

Generate intervals, DST zones/dates, recurrence rules, policy combinations,
and provider change sequences. Assert calendar-sync invariants from
`CALENDAR-SYNC.md`. State-machine models cover source observation, policy
evaluation, projection create/update/delete/recreate, sync cursor pages, token
rotation, and jobs. Post-core planner tests follow `SOLVER.md` only if activated.
Persist failing seeds as regression cases.

### Repository/migration tests

Run repository contracts against disposable PostgreSQL at the oldest/current
supported major versions. Test transactions, optimistic versions, uniqueness,
lock timeout, process/database restart, backup, restore, prior-Planipus forward
upgrade, newer-schema refusal, and expand/backfill/contract migrations. Any
loss tests prove required jobs reconstruct from PostgreSQL intent/outbox.

### Adapter contract tests

Replay sanitized provider fixtures through real parsing/mapping/HTTP adapter code.
No SDK mock that simply returns the canonical object. Assert HTTP preconditions,
pagination, cursor commit, webhook dedupe, refresh, retries, idempotency,
recurrence, timezone, deletions, and privacy redaction.

### Service/API tests

Start the application with real temp database and fake outbound adapters. Test
auth, CSRF/origin, RBAC/delegation, validation, idempotency, ETag/If-Match,
pagination, rate limits, plan conflict, partial apply, public booking races,
webhooks, export/deletion, and structured error schema.

For machine access, include API-token one-time display/digest/expiry/revocation,
scope implication, active membership/tenant binding, cookie+bearer ambiguity,
browser-only routes, and actor-preserving audit. Start the stdio MCP adapter
against the real test API and prove fixed-origin API-only behavior, every tool/
resource mapping, bounded timeout/response/error handling, apply tools absent by
default, and API denial even when an MCP process flag exceeds token scope.

### Browser/accessibility tests

Critical flows at desktop and phone widths, keyboard only, screen-reader labels,
focus order/restoration, reduced motion, high zoom, dark/light themes, timezone
switch, slow/failing network, expired session, conflict, and partial provider
failure. Use semantic locators, not fragile CSS classes. Automated accessibility
checks do not replace manual screen-reader review.

### Native macOS tests

Build the autonomous sandboxed SwiftUI target with a pinned Xcode/Swift
toolchain. It has no Planipus Server test double because it never calls that
service. Test `PlanipusCore` against shared conformance fixtures and test the
Google adapter through a scripted local HTTP transport plus disposable live
accounts.

OAuth tests cover installed-app system-browser flow, high-entropy state, PKCE,
exact/wrong redirect, cancel/replay, missing refresh token, grant revocation,
account relabeling, and non-synchronizing Keychain create/read/rotate/delete.
Network, logs, database, export, diagnostics, crash reports and notifications
must not expose token/event detail/database key.

Store tests use real GRDB/SQLCipher databases and cover every migration,
concurrent actor access, transaction rollback, corrupt/truncated database,
wrong/missing/rotated key, explicit encrypted backup/restore, newer-schema
refusal and provider-credential exclusion. Inspect the on-disk file for absent
plaintext sentinel content.

Sync tests cover full/incremental pages, transactionally committed cursors,
HTTP 410 scoped reset, deletions/recurrence exceptions, jitter/backoff/quota,
durable effects, conditional writes, safety reconciliation and managed-copy
identity. Inject termination after a provider effect but before local commit;
restart must read/adopt the effect rather than duplicate it.

Lifecycle tests make source changes while the app is running, offline, asleep,
and fully Quit. Assert no provider request during the last three states, then
exactly-once catch-up after reconnect/wake/relaunch and an accurate last-success
timestamp. Closing the window while MenuBarExtra remains active is distinct from
Quit. New-Mac/lost-state tests reconnect accounts, scan provenance, adopt only
unambiguous copies and hold ambiguous effects for preview.

UI tests cover main window and MenuBarExtra, full keyboard and VoiceOver flow,
light/dark, reduced motion, increased contrast, zoom, locale/timezone, duplicate
calendar names, provider revocation, partial effects, honest offline/stopped
language, actual timestamps, and destructive confirmation.

Inspect signed entitlements and runtime sandbox: outgoing network, scoped
Keychain, app-container storage and explicit user-selected import/export are
present; EventKit, Contacts, incoming network, Apple Events, APNs, daemons,
LaunchAgents, and privileged helpers are absent. Inspect process tree, binary
dependencies and network capture for absence of Server runtime/PostgreSQL/Valkey/local server
and all Planipus Server traffic.

Release candidates are Developer ID signed, notarized, stapled, DMG/checksum
verified, and installed/upgraded/uninstalled in a clean VM on the supported
macOS matrix. Version skew with Server is irrelevant: instead, install both with
different accounts and prove install/revoke/delete/upgrade of either has no
effect on the other.

### Container/Kubernetes tests

Build pinned multi-stage image, inspect non-root config, scan, run read-only/drop-
capabilities, probes, SIGTERM, API/scheduler/worker/Postgres/PVC restart, backup/restore job,
NetworkPolicy, resource limits, one-replica solo admission, and upgrade rollout
in a disposable namespace.

### Optional live provider suites

Disposable accounts/calendars for CalDAV variants, Google, Graph, EWS, task,
chat, OIDC, SMTP, and conferencing. Names use a unique run prefix; cleanup is
verified. Live failures do not get waived as “provider flake” without evidence.

## Core scenario corpus

### Time and recurrence

- every DST transition shape in representative IANA zones;
- ambiguous/nonexistent local time policies;
- zones with half/quarter-hour offsets and historical changes;
- all-day across timezone views;
- RRULE DAILY/WEEKLY/MONTHLY/YEARLY, BYDAY/BYSETPOS/COUNT/UNTIL/EXDATE/RDATE;
- moved/cancelled occurrence and this-and-future limitations;
- leap day/month end and long events crossing midnight.

### Solver

- empty/free/fully busy horizon;
- exact-fit adjacent intervals and buffer/travel overlap;
- chunking/min gap/max chunks/day;
- dependency DAG and cycle rejection;
- urgent priority displacement and explicit unmet work;
- incremental repair stability/no-op;
- focus/context/energy scoring with factor explanation;
- multi-timezone attendee fairness;
- round-robin weighting/concurrency;
- deterministic output and cancellation/timeout.

### Calendar synchronization — release-critical P0

- first sync with pagination and crash before/after final cursor commit;
- duplicate/out-of-order/missing webhook plus safety poll;
- token refresh rotation and revoked grant;
- remote edit of managed event versus local desired state;
- ETag/change-key conflict and safe re-read/replan;
- tombstones, calendar removal, account disconnect/reconnect;
- personal event outside work hours creates no work projection;
- personal event overlapping work hours creates one full-duration projection;
- `busy_only`, `commitment`, `private_details`, and `shared_details` serialize
  exactly as specified, including Google visibility and reminders;
- free, all-day, declined, tentative, unanswered, already-invited, and `#nosync`
  cases follow policy;
- source edit/delete and destination-copy edit/delete converge deterministically;
- mirrored calendar recursion prevention and privacy fields;
- two policies are required for bidirectional flow and never create a loop;
- live three-identity Google suite proves source, destination-owner, and ordinary
  coworker views rather than trusting an API payload alone.

### No-copy conflict response — Server alpha release gate

- availability-only Google grant contains CalendarList plus `calendar.freebusy`;
  it cannot authorize `Events.list`, and role guards/source sync produce no
  observations or bridge-source capability for that connection;
- returned availability grant rejects every retained broader Calendar scope as
  `oauth_scope_overbroad` and an omitted scope set as
  `oauth_scope_unverified`; requested scopes are never availability proof. A live
  old-grant revoke and fresh narrow reconnect is proven. Concurrent first-connect
  callbacks for one organization/Google subject produce one authoritative
  connection decision;
- free/busy grouping returns only bounded intervals and per-calendar failures
  fail closed; half-open adjacent intervals do not conflict;
- preview returns time-only examples and immutable expiring/one-use stale-bound
  activation; no response action/provider write occurs during preview;
- preview/list/capabilities expose consistent provider-write and message-
  delivery state; fake is simulated, Google activation/resume fails while writes
  are off, and enabling Google writes leaves delivery unverified;
- every selected private availability calendar rejects every active outbound
  bridge and every active/paused inbound bridge across delegated aliases; race
  conflict activation against bridge activation/resume in both endpoint roles
  and winner orders to prove shared local/canonical advisory locks prevent
  invalid committed state;
- pause an existing bridge, prove no-copy activation succeeds while its older
  managed copies remain/disclosed, and prove bridge resume fails while the
  protection rule is non-deleted (including when that rule is paused);
- idempotent rule retirement supersedes pending/held actions, preserves applied
  declines, and permits bridge resume without cleaning legacy copies;
- underlying provider identity prevents a second live controller through a
  delegated Google alias, and the 20-per-24-hours budget counts historical rules
  across retirement/recreation and aliases under concurrency;
- bridge source/destination aliases for one Google calendar fail
  `same_provider_calendar`; an 0013→0014 upgrade fixture proves existing alias
  self-copy policies/effects/jobs are fail-closed quarantined, deterministic
  audit records `historical_copies_untouched:true`, and historical copies remain
  for review;
- immutable `invitation_response.declined` audit facts keep the budget after
  action reschedule/reuse/supersede; concurrent reservations at 19/20 never write
  a twenty-first automatic decline;
- availability-only endpoints report event-content `readable=false` and
  `capabilities.freebusy_readable=true`; API, MCP, and UI select on the latter;
- source/both → no-event-read reauthorization blocks every live feature and
  historical projection/action dependency; a clear PostgreSQL transition purges
  observations/cursors, retires subscriptions/jobs, restricts endpoints, audits
  counts, and wins against first-connect/reauthorization, activation, discovery,
  cursor-initialization, page-persistence, and finalization transactions with no
  deadlock or post-purge content;
- a newly materialized eligible event is future, confirmed, timed, provider-
  original, connected self attendee, and exactly `needs_action`; organizer,
  accepted, tentative, declined, cancelled, all-day, started, changed, malformed,
  and outside horizon do not create a new action;
- exact work observation/revision and fresh exact-interval free/busy are checked
  immediately before the provider GET/PATCH;
- self-attendee-only PATCH includes configured comment, `attendeesOmitted`,
  `If-Match`, and requested `sendUpdates=none`; a pending action whose initial
  exact GET already sees self declined sends no PATCH, becomes applied with
  `changed=false`, compares the comment exactly, appends the immutable fact, and
  consumes budget. Accepted/tentative are not overwritten;
- post-write verified `declined` with an absent/different comment is applied with
  `decline_comment_not_retained`, consumes immutable budget, is not retried, and
  does not mark message delivery verified; initial already-declined recovery with
  the same mismatch produces the same warning and conservatively may attribute a
  manual decline without overwriting it;
- duplicate/leased jobs, pause/resume, removed conflict, timeout before/after
  commit, write-side 5xx/response-read ambiguity followed by exact GET,
  verification-read failure, 404/410/412/429/auth/quota, and restore converge
  without duplicate or unconditional RSVP;
- successful work response-calendar sync immediately enqueues deduplicated rule
  reconciliation, with the scheduled 15-minute path proven as fallback;
- slow/hung provider calls prove bounded transaction/lock age, lease and
  termination behavior until provider I/O is moved behind committed intent;
- SQL, jobs, audit, logs, metrics, HTTP, backup, and MCP contain no personal
  event ID/content/copy; work-side target identity is narrowly allowed; and
- private snapshot/action HMACs resist offline enumeration from database-only
  material; controlled master-key rotation expires previews, supersedes/recomputes
  pending/held actions, and proves no old-basis job can apply without claiming
  multi-key verification; and
- disposable Google organizer/attendee/personal/observer accounts prove
  `responseStatus`, best-effort comment visibility and actual mail/calendar-
  notification behavior. Google does not guarantee organizer delivery of the
  attendee comment; keep the live flag false until this evidence exists.

### Security/privacy

- login/session fixation/rotation/logout/revocation;
- CSRF, CORS/origin, clickjacking/CSP, open redirect;
- RBAC/tenant boundary and ID enumeration;
- SSRF to loopback/private/link-local/metadata, DNS rebinding, redirect chains;
- webhook signature replay/timing and booking token brute force/rate limits;
- XSS in titles/descriptions/forms/provider payloads/Markdown/ICS;
- SQL/path/template injection and oversized/decompression payloads;
- log/metric/export/error redaction and encrypted backup behavior;
- API token plaintext appears once, never in storage/log/error/MCP output;
  expiry/revocation/membership and read/propose/apply boundaries hold;
- `read` cannot preview; `propose` is proven to contact only selected provider
  free/busy boundaries and return bounded privacy-safe overlap inference, with
  no mutation and clear audit/UX sensitivity labeling;
- actor limits enforce read 600/minute, apply 120/minute and propose 30/10
  minutes for browser/token/tenant matrices before provider contact, with safe
  429 + numeric `Retry-After`; restart/multi-replica bypass and map cardinality
  demonstrate why a shared persistent limiter remains required;
- conflict preview refuses a principal at 10 live unconsumed rows; concurrent
  creation is either database-hard or explicitly documented/tested as a
  preflight-only alpha limitation;
- MCP provider/event text cannot alter capability; remote HTTP transport is
  absent; origin/redirect/response limits prevent adapter pivot;
- MCP's 300-second deadline covers bounded 32-calendar/four-lane provider fan-
  out; read timeout is retryable `api_timeout`, while POST/DELETE timeout is
  `api_timeout_outcome_unknown` and a state read precedes any retry, including
  timeout during response-body consumption;
- assistant prompt injection cannot raise capability or disclose hidden data.

### Operations

- unclean shutdown and database integrity;
- disk full/read-only/permission loss;
- master-key missing/wrong/rotating;
- clock skew and expired webhook subscription;
- provider outage/quota storm with bounded queue/backoff;
- old binary/new DB refusal, rollback, restore to alternate node;
- offline startup with integrations disabled.

## Concurrency tests

Use deterministic barriers to race:

- two guests holding/confirming the same slot;
- plan apply versus incoming provider event;
- two workers leasing same job;
- booking confirmation versus calendar sync;
- task completion versus scheduler repair;
- membership revoke versus delegated apply;
- token/key rotation versus provider request;
- user RSVP/time change versus automatic conflict-response apply;
- rule pause/revision/availability change versus leased response job;
- preview creation at the per-principal limit and across API replicas;
- provider-identity alias activation and historical-budget reservation;
- scheduled-job heartbeat/final renewal versus a competing reclaim after the
  original lease interval; and
- duplicate idempotent POSTs.

The expected result is one winner or a defined merge/conflict, never duplicate
provider events or silent lost update. Run concurrency suites under race/thread
sanitizers where supported.
The worker leases at most one scheduled job and one effect per loop. Lease-loss
tests require the stale owner to make no terminal transition and continue
serving; the current owner remains authoritative. Because a provider call cannot
be cancelled mid-flight, also prove idempotent/conditional provider behavior,
ambiguity verification, and reconciliation converge after ownership loss.

## Golden files

Use reviewed golden data for canonical ICS parsing/serialization, public OpenAPI,
CLI JSON, plan explanations, localized email/ICS, audit JSONL, and selected
rendered HTML. Normalize volatile IDs/timestamps. A golden update requires a diff
review explaining semantic changes; never bulk accept after a failure.

## Performance budgets

Define per milestone and keep benchmark history. Initial targets on a documented
2-vCPU/2-GiB reference:

- ordinary authenticated API p95 below 250 ms excluding provider/model calls;
- public cached slot query p95 below 500 ms for 30-day/one-host range;
- personal 14-day solve with 200 fixed + 100 flexible items p95 below 2 s and
  below 256 MiB incremental memory;
- 20-attendee/30-day meeting search p95 below 5 s;
- webhook acknowledgement below 500 ms;
- idle app below 200 MiB RSS after stabilization;
- graceful shutdown within configured 30 s without losing leased jobs.

Budgets are not 1.0 guarantees until measured on the selected foundation. Any
change above 20% needs explanation or an accepted regression.

## Coverage policy

- Domain/solver/policy/encryption: high branch coverage and every invariant.
- Provider adapters: every error class and fixture scenario.
- Routes: every permission, validation, idempotency, and conflict branch.
- Templates/UI: critical flow coverage, not snapshot saturation.
- New bug: failing regression test first unless impossible; document exception.

Do not set one repository-wide percentage that encourages testing getters while
leaving recurrence untested.

## CI stages

1. format, lint, license/provenance, secret scan;
2. unit/property tests and docs link/schema checks;
3. MCP build/typecheck/unit/boundary tests plus Server workspace checks;
4. PostgreSQL repository/migrations and durable-job replay;
5. API/browser/accessibility;
6. release image build, SBOM, vulnerability scan, runtime restrictions;
7. Kubernetes smoke/backup/restore on release candidates;
8. scheduled live-provider/long-fuzz/benchmark suites.

Pull requests must not require proprietary cloud services for baseline CI.
Provider live suites use protected, least-privilege secrets and untrusted PRs
never receive them.

## Release evidence

Each release stores:

- source commit/tag, runtime lockfile hash, runtime version,
  image digest/architectures;
- tests by stage and ignored/quarantined list;
- migration paths tested and backup/restore result;
- SBOM, signatures/provenance, vulnerability disposition;
- benchmark comparison;
- provider conformance versions/dates;
- known issues and rollback instructions.

No “all tests passed” claim is made from a stale or different commit. Quarantined
tests have owner, issue, expiry, and cannot cover security, data integrity,
calendar writes, booking uniqueness, or migration.

## Definition of done for a feature

- requirement IDs and threat/risk references identified;
- domain/API/error/explanation semantics documented;
- unit/property/repository/API/UI tests proportionate to risk;
- accessibility, timezone, localization, and privacy considered;
- metrics/logs/runbook/degraded UX implemented;
- migration/export/deletion behavior implemented;
- docs and screenshots updated;
- no unsupported provider/production claim;
- clean install and upgrade verified.
