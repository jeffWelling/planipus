# Architecture

## Product topology

Planipus has two autonomous editions, with no connecting arrow:

- **Planipus for Mac** is a native SwiftUI/AppKit application with direct Google
  OAuth/API access, Keychain credentials, an encrypted local SQLite database,
  and an in-process Swift sync engine. It synchronizes only while the app and
  Mac are running and online.
- **Planipus Server** is an original TypeScript web service with its own
  credentials, PostgreSQL, durable jobs, policies, workers, and browser/API surfaces
  in Kubernetes.

They do not pair or share identities, configuration, state, sessions, APIs, or
runtime code. They share the Calendar Sync behavior contract, reason codes, and
language-neutral conformance fixtures. See `MACOS-AND-KUBERNETES.md`.

## Server-edition foundation shape

Planipus Server is a clean-room original implementation. It composes reviewed,
license-compatible infrastructure and libraries but does not use Keeper source,
schema, tests, assets, dependencies, Git history, or runtime. Exact packages are
selected by the reuse ledger/foundation gate, not copied from any donor.

| Implemented server area | Responsibility | Reviewed building blocks |
|---|---|---|
| `web` | calm account/policy/preview/health UI | React and Vite with original Planipus design |
| `server/src/api` | bootstrap/session, account/calendar/policy/planning APIs and static UI | Fastify, explicit boundary checks, secure cookies and CSRF/origin checks; centralized request/response schemas remain backlog |
| `server/src/scheduler.ts` | discovery, source safety sync, destination verification, policy/planning reconciliation and retention scheduling | original scheduler plus PostgreSQL durable jobs |
| `server/src/commands/worker.ts` and `server/src/jobs` | leased jobs, calendar-bridge effects, and planning-event application | PostgreSQL `SKIP LOCKED` leases; bridge writes use `outbox_effects`, planning writes use `planned_events` plus `scheduled_jobs` |
| `server/src/providers` | OAuth, provider normalization and mutations | documented Google APIs and original adapters |
| `server/src/sync` | ingestion, reconciliation, ambiguity recovery and cleanup generations | original Planipus orchestration |
| `server/src/planning` | alpha availability-boundary and Smart Meeting preview, placement, reconciliation and provider-write coordination | original deterministic TypeScript engine using the shared hours materializer; separate ownership tables from Calendar Sync |
| `server/migrations` and `server/src/database` | original schema/migrations/encryption boundary | PostgreSQL, Kysely and `pg` |
| `packages/calendar-sync` | provider-neutral policy/projection contract | original TypeScript implementation |
| `conformance/calendar-sync/v1` | language-neutral behavior seam | Planipus-authored JSON schemas and 91 cases |

## Mac-edition foundation shape

Planipus for Mac is independently implemented in Swift because it owns a local
runtime rather than controlling the Server service:

| Module | Responsibility |
|---|---|
| `PlanipusApp` | native windows, menu bar, onboarding, status, accessibility |
| `PlanipusCore` | pure policy/hours/privacy evaluation and conformance fixtures |
| `PlanipusGoogle` | installed-app OAuth, Calendar API, incremental sync, effects |
| `PlanipusStore` | GRDB migrations and SQLCipher-encrypted local state |
| `PlanipusSecrets` | non-synchronizing Keychain tokens and database key |
| `PlanipusSync` | in-process polling, durable outbox, reconciliation and recovery |

There is no embedded Server service, Postgres, Valkey, local HTTP API, daemon,
LaunchAgent, or Mac↔server protocol. Quit/sleep/offline stops work. Wake,
relaunch, and network restoration trigger incremental catch-up and safe
reconciliation.

## One authority per installation

Within either installation, provider calendars remain authoritative for
original events and that installation is the only authority for its managed
copies and Planipus-created planning events. Do not configure the same directed
policy or planning rule in both editions: because they are independent, doing
so creates competing writes. No Keeper, AGPL planner, Fluxure, FluidCalendar,
Cal.rs, vdirsyncer, or other sync/planning service is incorporated into or run
as a Planipus component for the same route. Standards-based interoperability
with a separately operated calendar service is not source reuse.

```text
Google source account/calendar
  -> provider ingestion
  -> normalized source observation
  -> directed policy evaluation (hours + selection + privacy)
  -> desired copy + diff
  -> durable outbox
  -> Google destination write
  -> projection mapping/result/audit
```

There is no solver in this Calendar Sync path. The system decides whether and
how to project a source event; it does not choose a new time. The Server now has
a separate alpha planning path described below. Its tables, ownership markers,
provider port, and jobs do not reuse `sync_policies`, `projections`, or
`outbox_effects`.

## Server solo deployment

One StatefulSet pod, one replica, one RWO PVC:

- `api`, `scheduler`, and `worker`: distinct containers using one Planipus application
  image with different commands and independent health/shutdown;
- `postgres`: canonical accounts, encrypted credentials, calendars, policies,
  observations, projections, planning previews/rules/events/suggestions,
  outbox, scheduled jobs, sessions, and audit.

Only API/web HTTP is exposed. Sidecars bind loopback. The profile is
fate-shared and intentionally not HA. The standard profile uses the same app
image with external PostgreSQL. Valkey is not part of P0 and may be introduced
only by a later measured ADR for reconstructible cache, lease, or fanout work.

The container layout is a Planipus design, not a donor adaptation. It is chosen
to make security contexts, upgrades, probes, and backup ownership explicit.

## Server application boundaries

### Credential service

Owns encrypted OAuth/CalDAV envelopes, key versions, decrypt-on-use, refresh,
rewrap, revoke, and deletion. Provider adapters receive a short-lived secret
handle/result, not database token columns. General queries/API/queue payloads
cannot access plaintext tokens.

### Provider adapter

Owns provider authorization, account/calendar discovery, change cursors/watch,
normalization, conditional create/update/delete, visibility/transparency,
recurrence, and error classification. It does not decide work hours or privacy.

### Policy service

Owns directed source/destination, hours, selection, privacy preset/transform,
revision, preview, activation, pause, detach, and cleanup. It compiles a source
observation into `omit` or a provider-neutral desired copy.

### Reconciliation service

Compares desired copies with durable projections and observed destination state;
emits idempotent create/update/delete effects; records attempts/results; handles
retries, stale policy revisions, source tombstones, destination drift, and full
resync. A separate bounded destination verifier reads the exact remote IDs of
the oldest due attached projections. It does not list or ingest destination
calendars as policy sources.

### Provider effect worker

Consumes durable effect IDs, reloads current policy/projection, rejects stale
effects, obtains scoped credentials, performs conditional provider calls, and
records results. Queue payloads contain identifiers, not event details/tokens.

### Alpha planning service and coordinator

The alpha planning module owns two rule kinds:

- `availability_boundary` materializes private/default opaque blocks before or
  after a same-day work window and optionally over closed days; and
- `smart_meeting` deterministically chooses one independent provider event per
  cadence window from explicitly selected readable calendar observations.

`PlanningService.preview` parses a bounded draft, checks that the target
calendar is active and writable, requires every selected availability calendar
to have an active readable connection and a ready sync no more than 30 minutes
old, loads confirmed/busy/non-declined timed observations, computes an input
old, loads confirmed/busy/non-declined timed observations and materializes
all-day busy observations in their calendar timezone, computes an input snapshot
hash, and stores a ten-minute preview. Other active Smart Meeting
desired events on the selected availability or target calendars also participate
as busy time. Activation locks and consumes that preview, rebuilds the input
snapshot at the persisted planning reference instant, rejects a mismatch or a
meeting that has since started as `preview_stale`, creates one `planning_rule`
plus its `planned_events`, and enqueues identifier-only
`apply_planned_event` jobs transactionally.

`PlanningCoordinator` handles `reconcile_planning_rule` and
`apply_planned_event`. The scheduler offers every active rule one deduplicated
reconciliation job per 15-minute window. Reconciliation recomputes desired
occurrences under a rule lock and records create/update/delete intent in
`planned_events`. The provider application path uses a deterministic Google
event ID, private extended-property ownership markers, conditional revisions,
intent sequence, and a generation bump before recreating a missing previously attached event.
Missing/mismatched ownership or a precondition conflict becomes `held`; it is
never adopted by ID alone.

Rule removal moves the rule to `deleting` and atomically turns future/current
attached or possibly in-flight events into delete intent; it reaches `deleted`
after the last cleanup succeeds. Past occurrences are retained at the provider.
Suggestion queries expose pending, unexpired proposals; accepting one rechecks
the basis, no-move window, fresh availability, and proposed result before it
replaces desired state and queues the next intent. Dismissal retains the current
event. Resuming a rule explicitly re-enqueues any pending create/update/delete
intent in addition to rule reconciliation.

Smart Meetings with attendees intentionally differ from Calendar Sync copies:
they serialize attendees and use Google `sendUpdates=all`; availability fences
have no attendees and use `sendUpdates=none`. Both disable reminders. This
notification side effect must be visible in preview and testing and must never
be confused with P0's no-invitation projection contract.

The full `SOLVER.md` contract is not implemented. The current alpha engine has
no tasks, dependencies, focus optimization, fairness, booking, constraint
solver, immutable plan-operation aggregate, or organization planning revision.

## Core records

- `provider_connection`: one independently authorized account;
- `calendar_endpoint`: provider calendar and capabilities;
- `hours_profile` / `hours_exception`;
- `sync_policy` / policy revision;
- `source_observation`: normalized current provider event/occurrence;
- `projection`: source+policy to destination-copy identity/state;
- `outbox_effect`: desired idempotent provider operation;
- `sync_cursor`: full/incremental read token, query fingerprint, and generation;
- `provider_subscription` / `inbox_event`: watch channel and notification-ingress state;
- `audit_fact`: privacy-safe actor/config/effect record.
- `planning_preview`: expiring draft, input snapshot, and result;
- `planning_rule`: active/paused/deleting/deleted owner intent and target calendar;
- `planned_event`: per-occurrence desired state, ownership generation, provider
  identity/revision, and apply status;
- `planning_suggestion`: expiring proposed move/shorten/skip record.

Detailed fields and migrations are in `DATA-MODEL.md` and
`CALENDAR-SYNC.md`.

## Policy evaluation

Evaluation is a pure deterministic function:

```text
evaluate(source observation, policy revision, hours profile, destination capabilities)
  -> omit(reason)
  | desired copy(normalized fields, disclosure manifest, provenance)
```

Order matters:

1. enabled/pause/horizon;
2. provider ownership and managed-copy loop marker;
3. source override and already-invited duplicate rule;
4. all-day/free/RSVP/type selection;
5. work-hours evaluation;
6. versioned privacy transform;
7. destination capability validation;
8. canonical desired hash and disclosure manifest.

The disclosure manifest lists every source field read and destination field
written. Tests compare it to actual provider payloads.

## Reconciliation consistency

PostgreSQL is canonical. A source observation and cursor page commit
transactionally. Cursor advances only after every page observation/tombstone is
durable. Desired effects are inserted in the same transaction that advances
local reconciliation state.

Provider calls occur after commit. Each effect has an idempotency key derived
from policy, projection, operation, desired hash, and generation. On ambiguous
timeout the worker reads destination state/mapping before retry. Provider
preconditions are used where available.

Source deletion/exclusion creates a delete effect for an attached copy. Direct
destination deletion is treated as drift and recreated by default. A deleted
Google custom ID is not reused: recovery increments the projection generation,
rewrites provenance and desired hash, and creates at the new deterministic ID.
The same generation transition is used when an ambiguous create retry or an
owned-edit update re-read confirms that the event disappeared between
verification and execution.
An owned destination edit retains its generation and is conditionally restored
from durable desired state. Any missing or mismatched ownership marker holds the
projection for review; identifier equality alone never authorizes a write. `detach`
ends management without deleting the copy; `exclude source event` ends the
projection and deletes the managed copy. Destination changes never write back to
the source in P0.

Planning-event consistency is similar in intent but currently uses a different,
smaller mechanism. Desired state lives on `planned_events`; `scheduled_jobs`
leases the apply command; the provider call and local completion update currently
occur inside one PostgreSQL transaction while the planning rows are locked.
Deterministic IDs make an ambiguous create discoverable on retry, and delete is
idempotent. There is no planning-specific outbox row, destination-verification
pass, or recovery API yet.

## Alpha planning limitations that affect architecture claims

The planning slice is useful implementation evidence, not a production solver
claim. The following gaps are explicit:

- `priority` and `lock_before_minutes` are accepted and stored but are not used
  by placement scoring. The coordinator does enforce `lock_before_minutes` when
  an existing future event's desired state changes, and provider apply separately
  holds a Smart Meeting that has reached its start. A `suggest` rule held by the
  window can fall through to automatic update after expiry because suggestion
  creation currently requires `converged` state. `priority` has no effect.
- Required-attendee availability can be absent; the engine emits a warning but
  still schedules and can send the invitation. Optional-attendee availability
  is not scored separately. All selected busy intervals are pooled rather than
  modeled per attendee.
- The target/organizer calendar is not automatically included in availability.
  Callers must select it explicitly.
- Candidate step alignment is based on the UTC epoch. Hour-sized steps can land
  on non-hour local minutes in half/quarter-hour-offset zones.
- Smart Meeting occurrences are independent events, not an RFC 5545/provider
  recurring series. RSVP-driven replanning, cadence-preserving series edits,
  conferencing, and attendee fairness are not implemented.
- `suggest` records proposals that can be listed, accepted, or dismissed and
  otherwise expire after 14 days. Acceptance revalidates current basis,
  no-move window, fresh availability and the occurrence result. Composite
  foreign keys bind the suggestion to an event of the same rule and organization.
  `keep_with_warning` and ownership/precondition holds have no recovery command.
- Pausing does not remove existing events. An apply job that observes a paused
  rule succeeds without writing; resume now re-enqueues pending event intents.
  An active rule can retry an unchanged `target_unavailable` hold on later
  reconciliation. Other unchanged held events do not receive that recovery.
- There is no edit/get-one API. Rule removal exists and increments the revision,
  but has no cleanup preview or detach choice and can send attendee cancellations.
  Target/precondition cleanup failures retry through the job queue; an ownership
  mismatch becomes a dead action-needed job and there is no removal-recovery
  endpoint. Deleted/stale planned-event rows have no implemented purge.
- Planning provider I/O is performed while database row locks are held. The
  20-second provider timeout can extend transactions and must be moved behind a
  committed outbox/effect boundary before scale or production claims.
- `/api/v1/overview`, detailed health, and metrics do not currently include
  planning holds, suggestions, lag, or pending/dead planning work separately.
- Service/coordinator/provider-write behavior lacks real-PostgreSQL and live
  Google end-to-end coverage; current tests prove only parser/engine examples,
  route delegation, migration text, and provider serialization primitives.
- In Google provider mode the entire planning API is hidden unless
  `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`; fake mode enables it for local
  development. Disabling the flag does not repair already-pending planning rows.

## Loop and duplicate defense

- reject source=destination;
- mark copies using provider-private extended properties or safe category/UID
  fallback;
- store durable projection mapping independent of markers;
- exclude recognized Planipus copies from source ingestion for any policy;
- skip when destination identity is already a source attendee by default;
- validate policy graph and test reciprocal routes;
- never use a transformed title/time alone as identity.

## Push and safety reconciliation

Google watch notifications are hints, not the database log. Store channel,
resource, expiration, renewal state, and opaque sync cursor. Notifications
enqueue bounded sync; duplicates/coalescing are normal. Periodic safety sync and
cursor-expiration full resync guarantee convergence.

Destination calendars have a separate safety path because a source cursor
cannot reveal a manual edit or deletion of its copy. Every 15-minute scheduler
window enqueues one organization-scoped verification job. A job claims at most
100 oldest-due converged projections using `last_verified_at`, reads by durable
event ID, and writes only by the ordered outbox. Unchanged revisions are no-ops;
transient verification failures leave the last converged state intact for a
later bounded retry.

Polling providers use ETag/CTag/delta/Last-Modified where available with
published latency. “Real time” is only claimed from measured live tests.

## Security boundaries

- provider payloads, ICS/XML, event text, and webhooks are untrusted input;
- user-configured URLs are SSRF-sensitive;
- privacy transformation occurs before provider effect serialization/logging;
- redacted modes must not place source details into queue, audit, metrics, trace,
  error, or destination extended properties;
- master encryption key is operator-supplied and versioned;
- OAuth callback origins/state/PKCE and trusted proxies are explicit;
- source read and destination write permissions are independently explained;
- destination-domain administrators may see private event details; UI must not
  promise otherwise.

## Extension rule

Outlook and CalDAV implement the same provider port and policy decisions after
Google P0. The alpha planning module is already physically separate and cannot
import Calendar Sync ownership rows or bypass provider ownership checks.
Expanding it into the full solver, booking, task, workflow, or assistant product
still requires requirements/ADR evidence and a durable post-commit effect
boundary. Keeper and other excluded AGPL/copy-left application material remain
behavior research only and cannot supply code, schemas, tests, dependencies,
assets, containers, or implementation templates.
