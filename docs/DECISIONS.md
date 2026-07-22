# Decisions

## 2026-07-21 — Broad Reclaim parity; Calendar Sync remains the release wedge

Planipus is a broad calendar-orchestration product, not permanently a calendar
copy utility. The target includes Reclaim-class Hours, protected availability,
Smart Meetings, buffers, Scheduling Links, habits, Tasks, Focus, meeting
quality, and privacy-preserving team policy. This corrects the overly narrow
language that treated every planner behavior as optional research.

Implementation and release order remain trust-first. Directed cross-account
Calendar Sync is the release-critical wedge because it solves the owner's
defining multi-Google-account problem and carries the highest immediate privacy,
reconciliation, and recovery risk. Protected Hours, availability fences, and
Smart Meetings are active Server alpha scope and may proceed in parallel, but
they cannot waive the two-account/ordinary-viewer bridge gates or justify a
release claim by themselves. Later breadth must reuse common Hours, preview,
provenance, ownership, explanation, and recovery concepts rather than dilute
them.

The autonomous-edition decision still applies. Current planning features exist
only on Server. Mac does not gain them through a Server connection; it needs a
separate native requirement, Swift implementation, and live evidence.

## 2026-07-21 — Preview staleness follows scheduling semantics

An immutable preview must become stale when the inputs that can change its
outcome change—not whenever provider bookkeeping is refreshed. Planning
snapshot hashes therefore include target/availability capabilities, the ready
availability-calendar set, and sorted derived Busy intervals. They exclude
endpoint/cursor timestamps, non-scheduling event content, and planned-event
write status when desired Busy timing is unchanged.

Activation still rechecks capability/readiness and rejects changed Busy time.
This preserves the review-before-write contract without creating an impossible
race against ordinary discovery heartbeats or worker convergence.

Test fakes must preserve the same account boundary. Fake provider calendars,
observations, bridge events, and planning events are scoped by
connection-specific tokens; shared global provider state is prohibited because
it can manufacture cross-account capabilities or mutations that Google would
never return.

## 2026-07-21 — Protected Hours and availability fences are different controls

Working/Meeting/Personal/Custom/one-off Hours are reusable scheduling policy.
Meeting Hours are a hard candidate boundary for Planipus-created meeting
placements. They do not, by themselves, reject arbitrary provider invitations
or make external schedulers see the user as Busy.

An availability fence is the explicit provider-visible control: Planipus
creates private Busy events before/after the workday or on closed days. Fence
events contain no attendees or reminders and are mutable only through exact
planning provenance. Users preview activation and material/cleanup changes;
ordinary rolling-horizon renewal may reconcile automatically.

The current Server alpha stores the weekly window inside each rule and supports
preview, activation, rolling materialization, owned writes, pause/resume, and
replan. Rule removal now expires suggestions and queues marker-owned event
cleanup; resume re-enqueues pending effects and intent-sequence checks suppress
superseded writes. Reusable named Hours, multiple daily ranges, exceptions,
rule edit/detach, removal impact preview, drift verification, complete ambiguity
recovery, and live Google privacy/no-mail proof remain required. Therefore the
UI may say “availability fence,” but may not claim universal after-hours
protection.

## 2026-07-21 — Smart Meetings default to Reclaim 2.0-style suggestions

Reclaim has two materially different public behaviors. Reclaim 1.0 documents
automatic movement when an accepted conflict or qualifying decline appears.
Reclaim 2.0's June 2026 FAQ says attendee-visible rescheduling is suggest-first:
detect the problem, propose mutual alternatives, and wait for user action.
Planipus uses the safer 2.0 behavior as its default and names automatic movement
as a distinct 1.0-style opt-in policy.

A suggestion must be inert, basis-bound, expiring, reviewable, and revalidated
before apply. Applying it is the attendee-visible provider mutation and may send
notifications. Automatic movement cannot ship merely because a coordinator
code path exists; it needs notification, RSVP, lock-window, concurrent-edit,
recurrence, ambiguous-write, and live-provider evidence.

The current Server alpha deterministically previews independent recurring
occurrences inside Meeting Hours and excludes past slots. Every selected
availability calendar must have a ready sync cursor successful within 30
minutes; other active Smart Meeting occurrences count as Busy; and the current
rule's own observed provider event is excluded by private marker. The
coordinator enforces the configured 24-hour no-move window.

Expiring move/skip suggestions are now actionable: the UI lists current and
proposed times, supports accept/dismiss, and turns an accepted skip into owned
event cancellation. Removing a rule cleans up owned occurrences, resuming
re-enqueues pending effects, and expected intent sequences make superseded
provider jobs no-ops.

The alpha still does **not** prove external-attendee availability, use stored
P1–P4 priority in slot ranking, implement complete at-click suggestion-basis
revalidation or choose-another-time, implement full provider recurrence
semantics, or have live Google notification evidence. Real Google planning
writes for both fences and Smart Meetings therefore default off and require
`PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`; fake-provider planning remains
writable for tests. These are release blockers for Smart Meeting parity, not
documentation footnotes.

## 2026-07-21 — Apache-2.0 implementation license and DCO

Planipus source code, conformance fixtures, packaging, and documentation use
Apache-2.0. Contributions use Developer Certificate of Origin 1.1 sign-off plus
the project-specific excluded-donor provenance attestation in
`CONTRIBUTING.md`. This makes the intended permissive, downloadable,
self-hostable distribution explicit and avoids adopting an AGPL application
foundation.

This is an engineering selection, not legal advice. Public distribution and
external contribution intake remain blocked until a qualified review validates
the complete dependency graph, notices, trademark policy, macOS distribution,
and release artifacts. A future license change requires an ADR and contributor
rights analysis; code is not implicitly dual-licensed.

## 2026-07-21 — Node/PostgreSQL Server; Valkey deferred

Planipus Server uses Node.js 24 LTS, strict TypeScript, Fastify, React/Vite,
Kysely/`pg`, and a PostgreSQL durable outbox/job queue. API, scheduler, and
worker remain separate commands from one image. PostgreSQL is the only required
persistence service for P0; optional `LISTEN/NOTIFY` may reduce job latency.

Valkey is deferred. A later ADR may add it only for measured, reconstructible
cache/lease/fanout work. This supersedes the mandatory-Valkey part of the
2026-07-20 solo-pod decision. See ADR-003.

## 2026-07-21 — Maintained GRDB/SQLCipher foundation for Mac persistence

Planipus for Mac integrates the SQLCipher-managed `GRDB.swift` 7.11.1
package and its official `SQLCipher.swift` 4.17.0 dependency behind
`PlanipusStore`. This follows the OSS strategy: reuse a maintained SQLite layer
and reviewed encryption engine, while keeping Planipus-specific policy,
projection, cursor and outbox behavior original.

Integration does not mean the full persistence lifecycle gate has passed.
Package locking, encrypted-file inspection, migrations, durable transactions,
wrong/missing-key behavior and notices are implemented and tested. Key
rotation/interrupted rekey, recovery/export/import, replacement-Mac migration,
performance, clean-machine packaging, signing and notarization remain gated.
The runtime fails closed on an unreadable existing database and never silently
substitutes the in-memory repository. See ADR-005.

## 2026-07-21 — Destination drift is repaired only through owned projections

Planipus Server treats a destination event ID as an address, never as proof of
ownership. Every create, update, delete, ambiguity retry, drift repair, and
operator-requested recovery must read and match Planipus's private policy,
projection, and generation markers before mutating an existing provider event.
An absent or mismatched marker moves the projection to action-needed without a
write; it is never adopted merely because it occupies a deterministic ID.

A bounded oldest-first verifier checks managed destination copies independently
of source polling. Owned manual edits are restored from source-authoritative
desired state. A missing owned copy advances the projection generation and uses
a fresh deterministic provider ID. The same generation rotation applies after
an edit-to-delete race or disappearance during ambiguous-create recovery.
Explicit user recovery is read-before-write and may hold again while a foreign
event remains. A monotonic per-projection intent sequence prevents a later
A→B→A→B transition from colliding with an already-consumed outbox key.

Every effect also carries the hash of the source observation plus its separate
tombstone state. The worker locks the source and projection and rechecks that
basis before every provider call. A stale/null basis, changed revision, or
changed durable payload is superseded without provider access and reconciled
from current source state. Ambiguous projections are shadow-evaluated only to
refresh the explicit recovery payload; they remain held and cannot write until
the user requests a marker-verified recovery.

These rules prefer a visible, recoverable missing copy over overwriting an
unrelated event or silently suppressing a legitimate later intent. The fake
provider and opt-in real-PostgreSQL integration test are the current evidence;
the live Google collision/recovery matrix remains a release gate.

## 2026-07-21 — Solo PostgreSQL keeps administrator authority out of Planipus

The solo Kubernetes profile may co-locate PostgreSQL in the Planipus pod, but
the application processes receive only a dedicated database-owner role with
`NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, and `NOREPLICATION`. PostgreSQL
initialization receives a separate administrator Secret that is not mounted or
injected into API, scheduler, or worker containers. Administrator and
application usernames must differ, PostgreSQL listens on pod loopback, and
password authentication uses SCRAM.

All process types run the same advisory-lock migration path with bounded startup
retry. The official PostgreSQL entrypoint remains responsible for first-volume
initialization; existing-volume password changes require the documented
`ALTER ROLE` procedure because init scripts do not rerun. This is a development
and small self-hosting profile, not evidence of backup, restore, upgrade, or
high-availability safety.

## 2026-07-20 — Name: Planipus

The user selected the direction “calm personal software with a playful
self-hosted spin” and has now explicitly committed to **Planipus**
(`PLAN-ih-pus`) as the permanent product name: a distinct plan/platypus sound, lowercase-friendly
for CLI/image/chart use, with a restrained mascot called Pip.

Exact broad searches found no current software/calendar/package/repository or
obvious exact trademark result; results were biological/historical uses. This is
not formal mark clearance or a domain/package reservation. Repeat before launch;
collision risk can affect marks/domains, but does not reopen casual product naming.

## 2026-07-20 — Clean-room composition; Keeper is excluded

The owner has decided that Keeper's AGPL license rules out borrowing or reusing
any part of that project. This supersedes the Server foundation/fork decision
below. Keeper may be used only as historical behavior research; Planipus must
not import, fork, port, embed, execute, copy, adapt, or derive code, tests,
fixtures, assets, schema, dependencies, lockfiles, container/runtime, Git
history, or copied expression from it.

Planipus Server becomes an original TypeScript implementation composed from
reviewed compatible OSS/standards components. Planipus for Mac remains an
independent original Swift implementation. Both consume Planipus-authored JSON
conformance fixtures. Project license selection and legal/provenance review are
release gates; do not claim AGPL/fork/data compatibility.

`CLEAN-ROOM-POLICY.md` is binding. The historical research audit remains for
feature context only and must not be used as a coding template.

## 2026-07-20 — Autonomous Mac and Server editions

This supersedes the earlier client/server interpretation below. Planipus for
Mac and Planipus Server are independent installations in one product family.
They share behavioral specifications and conformance fixtures, but no accounts,
credentials, database, configuration, authentication, API, or running process.

The native SwiftUI Mac edition connects directly to Google using installed-app
OAuth, stores refresh credentials in non-synchronizing Keychain items, persists
encrypted local state, and runs an in-process Swift sync engine. It cannot sync
while the app is quit, the Mac is asleep/offline, or the Mac has been replaced.
It catches up safely when running and online. No LaunchAgent or helper continues
after Quit.

The separate original Server edition runs as a web service in Kubernetes
with its own web OAuth, PostgreSQL, workers, users, and policies. Its
continuity says nothing about a Mac installation. Keep both editions in one Git
repository rather than long-lived branches; the shared seam is canonical JSON
behavior fixtures, not a network API or binary library.

Full rationale and acceptance: `MACOS-AND-KUBERNETES.md`.

## 2026-07-20 — Native Mac client and Kubernetes server (superseded)

The rejected design treated the Mac app as a native client of one
Keeper-derived Kubernetes authority, with server pairing, device credentials,
OpenAPI/SSE, and server-owned provider tokens. That contradicts the requested
local Mac product. Do not implement its native-auth, server-profile, or
client/server compatibility artifacts.

## 2026-07-20 — Voided Keeper Server foundation proposal (superseded)

This decision is void as implementation guidance. It remains only to explain the
decision history that led to the stricter clean-room policy above.

The user clarified that the project's defining problem is Reclaim-style Calendar
Sync: copy personal events to an employer calendar only under configured hours
and privacy policy, then maintain those copies as source events change.

The now-voided decision had proposed adopting Keeper.sh at
`1c274dbe74fce3b8464c8686e1cec63c14e34557`
(`v2.13.5-1-g1c274db`) with full Git history under AGPL-3.0-only, gated by
`FOUNDATION-GATE.md`.

Why:

- Keeper already owns multiple accounts/providers, directed calendar mappings,
  normalized event state, destination copy identity, create/update/delete
  reconciliation, recurrence/timezones, web/API/workers, Postgres/Redis, and
  self-host packaging.
- Clean checkout: frozen install, 17 type tasks, five build tasks, and all 1,027
  tests passed.
- Missing P0 work is the actual product differentiation: per-policy work hours,
  Reclaim-equivalent privacy modes, RSVP/override/duplicate semantics, calm UI,
  and security/operations hardening.
- Fluxure is an adaptive planner with only one Google provider path; making it a
  calendar bridge would rebuild Keeper's core while carrying unrelated domains.

The proposed import would have been blocked until OAuth tokens were encrypted
and the dependency audit (100 advisories, including 2 critical/37 high) was
remediated/classified. That gate is historical only because Keeper is now
excluded from implementation.

This decision does not select Keeper for Planipus for Mac. The autonomous native
edition adopts Apple platform facilities, GRDB, and gated SQLCipher, and
implements its local Swift policy/sync boundary against shared fixtures.

## 2026-07-20 — Calendar Sync, not automatic planning, is P0 (scope wording partly superseded)

P0 means one directed source→destination policy. An event created on a personal
Google calendar is copied to an employer Google calendar only when it matches a
configured IANA-timezone hours profile and event-selection policy. The copy's
visibility is `Busy`, generic commitment, private selected/full details, or
shared selected/full details. It stays synchronized and loop-free.

Ordinary source changes reconcile automatically after policy activation.
Preview is required for policy creation/material changes, reconnect ambiguity,
and bulk cleanup—not for every source event edit. The retained decision is that
Calendar Sync is the release-critical P0 wedge and remains independent of any
planner. The statement that all planning is merely optional/deferred is
superseded by the 2026-07-21 broad-parity decision: protected-time fences and
Smart Meetings are active Server alpha scope; tasks, habits, focus, booking,
team optimization, and AI remain later modules.

## 2026-07-20 — Fluxure full-history fork (superseded)

This previously **superseded the Cal.rs-first decision** below. It is now
superseded by the clean-room Calendar Sync decision. Fluxure v1.0.86 at
`724d45c9766f483b97d4162039d34a0ad5252da7` with full history and evolve it as
Planipus under AGPL-3.0-only was selected when the product was interpreted as a
broad Reclaim-class adaptive planner.

Why the decision changed:

- Fluxure contains the closest coherent product, not merely a scheduler demo:
  task/habit/focus/link/booking domains, Google sync, analytics, web/API, jobs,
  self-host mode, and schedule actions.
- Its `@fluxure/engine` is a pure, provider/database-free package that already
  returns minimal calendar operations and covers chunks, dependencies, buffers,
  focus, locked/completed events, and schedule quality.
- A clean frozen install and configured production build succeeded. All 1,037
  tests passed: 166 shared, 201 engine, 158 web, 512 API.
- The two production dependency advisories found have patched versions and form
  a bounded first remediation.
- Cal.rs would require rebuilding the personal planning domain and engine in
  Rust. FluidCalendar would require security, test, scheduler, and domain repair.

Known Fluxure gaps are accepted as roadmap work, not hidden: Google-only,
personal booking, no organizations/teams/round-robin/OIDC/CalDAV/Graph, incomplete
and disabled smart meetings, greedy solver, no immutable revisioned preview/apply,
plan/billing gates, Postgres/Redis operational requirements, young bus factor.

FluidCalendar remains a possible narrowly reviewed MIT component; Cal.rs is an
AGPL behavior/interoperability reference only. Do not run either beside Planipus
as a schedule authority. Any original subsystem work or compatible component
reuse requires a review recorded in `REUSE-MAP.md`.

## 2026-07-20 — One-pod solo profile uses PostgreSQL/Valkey (partly superseded)

This **supersedes the SQLite-first decision** below. The solo Kubernetes profile
is one StatefulSet pod, one replica, one RWO PVC, with original Planipus
application containers plus PostgreSQL and Valkey sidecar containers.
PostgreSQL is canonical. Valkey runs queues/leases/cache only after the queue
gate passes, with AOF persisted until required jobs can reconstruct completely
from PostgreSQL intent/outbox.

ADR-003 supersedes the required-Valkey portion: P0 uses PostgreSQL-backed jobs
and omits the Valkey sidecar. The retained decision is one StatefulSet replica,
one RWO PVC, separate application commands, and no unsupported horizontal
scaling. This is an original Planipus operations decision, not a donor runtime
adoption.

## 2026-07-20 — Community source has no product-entitlement gates

No commercial/subscription/limit code defines Planipus community capabilities.
Finished features are available to every authorized self-host user:
no entity counts, seats, branding penalty, license service, upgrade prompts, or
required telemetry. Unfinished features remain behind technical readiness flags,
not billing state.

Optional future billing for hosted services must be a separate integration and
cannot change canonical community behavior.

## 2026-07-20 — Full history and attribution are product requirements (superseded)

This applied only to the voided fork/import path. Planipus must not import
Keeper history or become a Keeper downstream. The retained principle is narrower:
preserve attribution, license notices, source revision and update ledgers for
review-approved compatible components actually reused under `REUSE-MAP.md`.
Rebranding never rewrites real origin.

## 2026-07-20 — Name: Hourfold (rejected)

The first proposed name described folding demands into a week. The user rejected
it as terrible before publication. Retain this history only to prevent reuse; it
requires no runtime compatibility alias because it never shipped.

## 2026-07-20 — Independent codebase, interoperable ecosystem (superseded)

The initial audit considered FluidCalendar and Cal.diy too narrow/young and
proposed an independent compact core. This was superseded after source-level
audits of Fluxure and Cal.rs and again by the successful Fluxure clean-checkout
gate. It is now superseded by the clean-room Calendar Sync decision and must not
guide implementation.

## 2026-07-20 — Conditional Cal.rs fork (superseded)

The second foundation decision conditionally selected Cal.rs v1.14.0 at
`13a584f54fa6b7870b3e1dc7b4c658b6bd7254bd` because it has CalDAV/Google/EWS,
booking lifecycle, teams, round robin/collective availability, OIDC, CLI,
encrypted tokens, SQLite, non-root image, and extensive tests.

It was superseded after widening the audit and actually building/testing
Fluxure, which was itself later superseded by Keeper after the calendar-copy
clarification. Cal.rs is reference-only under the clean-room policy unless a
future legal/provenance ADR explicitly approves a compatible, narrow reuse path;
it is not the current fallback or running authority.

## 2026-07-20 — Go standard-library alpha (superseded before completion)

A partial Go spike explored deterministic preview/apply semantics. It is not a
shippable alpha, does not implement the specification, and must not receive
product work. Archive/remove it after clean-room Server and Mac baselines exist.

## 2026-07-20 — Deterministic core, optional AI (retained principle)

Calendar policy is inspectable, testable, and complete with model integrations
off. Any later planner remains deterministic at its mutation boundary.

## 2026-07-20 — Planner preview is a domain object (activated for narrow Server alpha)

The general planner remains later, but the principle now applies to Server
availability fences and Smart Meetings. Their activation uses immutable,
expiring, input-snapshot-bound previews. Conflict suggestions require a separate
review/apply object and may not be treated as ordinary automatic reconciliation.
Calendar Sync still uses immutable, expiring policy-impact previews for policy
activation/material changes; ordinary source changes reconcile automatically.

## 2026-07-20 — SQLite-first profile (superseded)

The Cal.rs direction selected one Rust/SQLite process and PVC. Superseded by the
Fluxure foundation and PostgreSQL/Valkey solo-pod decision. Retain only as
history; do not revive a SQLite Server profile without a new ADR.

## 2026-07-20 — Working almanac visual direction

Selected from Observatory, Transit Board, and Working Almanac. It is calm,
information-dense, tracker-free, and distinct from generic SaaS. The Planipus/Pip
brand adds restrained pond/natural warmth and small moments of playfulness, not
cartoon productivity gamification.
