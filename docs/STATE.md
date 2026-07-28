# Current state

Updated: 2026-07-21

## Product truth

Planipus is a calm, self-hosted calendar orchestrator with broad Reclaim-parity
intent. Its release-critical wedge remains a directed Google Calendar policy:
when a qualifying event on a source calendar overlaps configured work hours,
Planipus maintains a destination copy on a different Google account using an
explicit privacy preset. The source event is authoritative. The destination
copy is availability, not a second editable calendar record.

Protected Hours, provider-visible availability fences, and Smart Meetings are
now active scope, not deferred research. Current implementations of those
features are Server-only alphas. They do not make the bridge release-ready and
do not exist in the Mac edition. Tasks, habits, focus, links, buffers, team
policy, analytics, and assistants remain later parity modules.

Planipus for Mac and Planipus Server are autonomous editions. They share this
repository, product contract, and provider-neutral conformance data, but they do
not share accounts, credentials, state, storage, an API, or runtime. The Mac
edition stops syncing whenever the app cannot run. The Server edition runs
continuously only while its own Kubernetes workload is healthy.

## Implemented in this worktree

### Shared behavioral contract

- `conformance/calendar-sync/v1` contains versioned JSON schemas, registries,
  disclosure manifests, provider-neutral examples, and 91 deterministic cases
  covering hours/DST, selection, privacy, validation, and reconciliation.
- `packages/calendar-sync` implements the TypeScript evaluator, projection and
  reconciliation contract. Its most recent completed baseline was 96 passing
  tests, including the conformance corpus.
- The provenance gate scans source, conformance data, package manifests and
  lockfiles for excluded-donor traces. Keeper remains behavior research only;
  no Keeper code, tests, fixtures, schema, assets, dependencies, runtime, or
  history are permitted.

### Planipus Server

- A strict TypeScript/Fastify application with bootstrap authentication,
  HttpOnly sessions, CSRF protection, secure-origin checks, redacted errors,
  protected health/metrics, and an original JSON API.
- PostgreSQL migrations and repositories for users, sessions, encrypted OAuth
  credentials, provider connections, calendars, hours, policies, observations,
  projections, cursors, durable jobs/outbox, previews, and audit activity.
- Versioned AES-GCM envelope encryption for provider credentials, with
  authenticated context and key-version support.
- Google OAuth with state/PKCE, minimum source/destination scopes by connection
  role, exact callback handling, account identity/calendar discovery, refresh,
  failed-grant detection that requires reauthorization, and a fake provider for
  credential-free tests. Provider-grant revocation is not yet implemented.
- Directed-policy preview and activation, bounded full and incremental reads,
  cursor recovery, occurrence materialization, source reconciliation, durable
  conditional destination effects, ambiguity recovery, retries, pause/resume,
  manual sync, daily safety refresh, and calendar-wide generation tombstoning
  that remains monotonic when a query fingerprint changes.
- Every queued destination effect is bound to the exact source-observation hash
  plus tombstone state. The worker locks and rechecks that basis before any
  provider call; stale or pre-migration intents are superseded locally and the
  latest source is reconciled instead of writing stale details or recreating a
  deleted source.
- A bounded 15-minute destination verifier restores owned manual edits, replaces
  deleted copies under a fresh deterministic generation, and holds every marker
  mismatch without writing. Explicit UI/API recovery rechecks held copies before
  retrying; repeated intent payloads remain distinct through a monotonic sequence.
- Configurable per-policy destination-edit behavior (`destination_edits`):
  direct edits/deletions of managed copies restore with a recorded sync notice
  by default, restore silently, or hold untouched for an explicit
  restore/keep-and-detach decision through the notices API
  (`GET /api/v1/notices`, acknowledge, resolve). Holds keep the person's direct
  change in place, survive safety reconciliation, and resolve only through
  marker-verified ambiguous recovery or detach. The React interface does not
  yet render notices, and the Mac edition has not yet adopted the
  destination-edit modes; both currently keep the previous restore-only
  behavior surface.
- A responsive React interface for bootstrap login, labeled account
  connections, source/destination selection, work-hours and privacy policy,
  disclosure preview, activation, health, activity, and Sync Now. The Server
  can serve the compiled interface itself.
- A Server planning schema for rules, expiring previews, durable desired events,
  occurrence provenance/generation, conflict suggestions, and audit facts.
- A deterministic planning engine for two active rule kinds:
  `availability_boundary` creates rolling private Busy intervals before/after
  work or on closed days; `smart_meeting` chooses recurring candidate slots
  inside an explicit timezone-aware window while avoiding selected Busy
  observations. It excludes past slots, reports unmet occurrences instead of
  scheduling outside the window, and warns when a required attendee's
  availability is unknown.
- Planning preview/activation uses a semantic availability snapshot hash and
  rejects a stale preview. The hash follows capabilities, readiness, and sorted
  Busy intervals—not provider refresh timestamps, title-only changes, or
  pending/converged bookkeeping. Planned provider events use distinct ownership
  markers and durable jobs, with create/update/delete primitives, pause/resume,
  manual and scheduled replanning, safe ownership holds, and suggestion expiry.
- Smart Meeting preparation now requires a `ready` sync cursor with a success in
  the prior 30 minutes for every selected availability calendar. Other active
  Smart Meeting planned events count as Busy. An observed Google event carrying
  the current rule's private marker is excluded so the rule does not conflict
  with its own provider copy.
- Replanning enforces the configured 24-hour no-move window. Pending move/skip
  suggestions are listed in the UI with accept/dismiss actions; accepting a
  skip queues cancellation. Removing a rule expires its suggestions and queues
  cleanup of its marker-owned events. Resuming re-enqueues pending provider
  effects.
- Every planning effect job carries the expected intent sequence. The worker
  locks and compares it to current state before provider access, so an older
  queued move/create/delete cannot overwrite a later accepted suggestion,
  removal, or replan.
- The responsive Server UI now has **Protect** and **Meet** surfaces. Protect
  previews a 21-day after-hours fence with optional mornings/weekends. Meet
  previews six weekly occurrences, selected availability calendars, one
  optionally entered attendee, and conflict modes `suggest`, `auto_move`, or
  `keep_with_warning`. The API reports all three feature families as `alpha`.
- Smart Meeting `suggest` is the default and models Reclaim 2.0's safer
  suggest-first behavior. Reclaim 1.0-style `auto_move` is an explicit option,
  not the default.
- Fake-provider planning writes remain enabled for tests. Real Google planning
  writes are disabled by default and require
  `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`; the live invitation lifecycle
  gate has not passed.
- Fake-provider discovery, observations, bridge events, and planning events are
  connection-scoped, matching the real provider trust boundary. The idempotent
  demo seed restores canonical Personal/Work capabilities and safely removes
  only unreferenced endpoint shapes created by the former cross-account bug.
- Helm solo and standard profiles, separate API/scheduler/worker processes,
  bounded migration retry, CI, source-only Cloud Native Buildpacks output, and
  operational examples. Solo PostgreSQL is loopback-only and initializes a
  separate non-superuser application owner from an admin-only Secret. No release
  image has yet been built or deployed.

### Planipus for Mac

- A native SwiftUI/MenuBarExtra application split into App, Core, Google,
  Store, Secrets, Sync, Design, and test-support modules. It contains no Server
  URL, embedded web server, PostgreSQL/Valkey runtime, daemon, LaunchAgent, or
  Mac-to-Server pairing path.
- Installed-app Google OAuth through `ASWebAuthenticationSession`, with
  state/PKCE/exact callback validation, per-account Keychain secrets, token
  refresh, revoke, user-info discovery, and redaction-safe errors.
- Native provider, evaluator, projection, repository, outbox and coordinator
  foundations; explicit account/calendar endpoints route personal-source and
  employer-destination operations to separate OAuth identities.
- A manifest-driven native evaluator executes all 91 canonical v1 cases and
  matches the shared reason/privacy/disclosure registries and SHA-256 vector.
- A native onboarding, policy, preview, health and menu-bar shell that states
  the uptime limitation honestly.
- No Protected Hours availability-fence or Smart Meeting engine, persistence,
  provider path, or UI exists on Mac yet. The Mac must not imply otherwise or
  call Server to obtain those features.
- A production GRDB repository backed by exactly pinned SQLCipher packages,
  five transactional migrations, and a separate random 32-byte database key in
  a non-synchronizing, device-bound Keychain item. It durably stores account and
  bridge configuration, installation identity, cursors, observations, staged
  batches, projections, and outbox effects.
- App startup authenticates and migrates the encrypted database, restores
  non-secret configuration, retains the real coordinator, and schedules only
  after a durable save. Missing/wrong database keys fail without replacing or
  modifying an existing file; preview mode explicitly closes production state.
- Account roles are selected before OAuth: source-only connections request
  read-only event access, destinations request event-write access, and persisted
  granted scopes plus Keychain credential presence are checked before a policy
  is scheduled. Multiple explicit account pairs can create independent bridges.
- A real network-path monitor drives offline lifecycle state. Destination
  ownership mismatches enter a durable terminal quarantine, remain visible as
  action-needed, and cannot starve unrelated bridge effects.

## Verification status

The implementation is credential-free and pre-release. On 2026-07-21 the
current worktree's Node test command passed 96 shared tests and 76 Server tests;
one opt-in Server integration test was skipped by its normal environment gate.
The same current worktree's separately run isolated-schema PostgreSQL test
passed. The
integrated native baseline passed 58 Swift tests and a release build. The listed
credential-free compiled Server UI
flow—login, two fake accounts, hours/privacy preview, activation, Sync Now,
pause/resume and worker completion—passed against a real local PostgreSQL with
no browser console errors. Exact procedures and the two database-only defects
found/fixed are in `docs/evidence/2026-07-21-build-verification.md`.

The planning alpha has credential-free engine, API, validation, migration, and
provider-serialization tests plus a compiled-browser/PostgreSQL/scheduler/worker
fake-provider walkthrough: 15 fence blocks and five Smart Meetings converged,
and one elapsed-window meeting remained explicitly unmet. Details are in
`docs/evidence/2026-07-21-planning-browser-verification.md`. There is still no
live-provider evidence. Planipus has not written an availability fence or Smart
Meeting to Google. Its current limits are material:

- planning Hours are copied into each rule; reusable named Hours, multiple daily
  ranges, and date exceptions are not yet exposed;
- the Server UI supports a narrow weekly Smart Meeting form; the backend stores
  P1–P4 priority but does not use it to rank slots. The 24-hour no-move window
  is now enforced;
- selected availability comes from normalized observations behind a ready,
  at-most-30-minute-old cursor gate. Live completeness and external-attendee
  availability are not yet proven;
- Smart Meetings are independent planned provider events, not demonstrated
  recurrence-master/exception parity;
- suggest-first replanning now lists expiring move/skip proposals and supports
  accept/dismiss, including accepted-skip cancellation. It does not yet offer
  choose-another-time or complete at-click rule/provider/availability basis
  revalidation;
- rule removal cleans up owned events, but rule editing/detach, impact preview,
  planning-event drift verification, complete ambiguity recovery, and live
  invitation/update behavior are incomplete;
- fake-provider planning is enabled, but Google planning effects are intentionally
  no-ops unless `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`; and
- `auto_move` can drive an update path but has no live notification, RSVP,
  concurrency, manual-move, or recurrence evidence and is not release-ready.

The disposable local PostgreSQL instance used for development, integration,
seed, and browser verification is not a deployment recommendation. CI is
configured to run the isolated-schema PostgreSQL regression against a
PostgreSQL 17.7 service, but no hosted CI run exists yet.

The Node install reported one moderate advisory. No critical/high result was
reported by installation, but a complete release advisory/SBOM review has not
been performed. Public binaries and images must not be described as reviewed
until that evidence exists.

The requested Claude Code Opus review is still pending: the installed client is
logged out, and workspace privacy policy blocked transmitting the full private
worktree through an external model gateway without renewed owner approval. The
attempt, non-review status, exact continuation, and maintainer pre-review fixes
are recorded in `docs/evidence/2026-07-21-claude-opus-review.md`.

## Known release blockers

1. Finish the Mac encrypted-store lifecycle: atomic key rotation and interrupted
   rekey recovery, coordinated reset/uninstall, authenticated export/import,
   replacement-Mac recovery, and crash/relaunch/sleep/wake/offline proof. A lost
   device-bound database key is currently unrecoverable by design.
2. Extend the native UI/domain beyond the declared v1 corpus where needed:
   editable date exceptions and DST choice, source-timezone all-day semantics,
   and the complete canonical policy lifecycle.
3. Exercise both editions against two real Google accounts, including OAuth
   consent/scopes, create/update/move/recurrence/delete, 410 recovery, quota,
   revoke and identical-calendar-name cases.
4. Inspect every privacy preset using an ordinary third Google viewer; owner
   visibility is not sufficient privacy evidence.
5. Build and inspect the non-root multi-architecture Server image; deploy both
   Helm profiles; prove readiness, drain, NetworkPolicy, backup/restore,
   upgrade/rollback and no-duplicate recovery.
6. Produce release SBOM, source/build provenance, checksums, dependency notices,
   advisory classification and compatibility/legal review.
7. Complete accessibility/energy/clean-VM/notarization work for Mac and the
   independent 30-day dogfood/recovery drills for both editions.
8. Finish availability-fence lifecycle and evidence: reusable Hours/exceptions,
   rule edit/detach and removal impact preview, drift repair, complete
   ownership/ambiguity recovery, live private visibility,
   no-invitation/reminder proof, and rolling-horizon/DST behavior.
9. Finish Smart Meeting suggest-first lifecycle: live-proven complete selected
   availability plus external-attendee mapping, at-click stale-basis checks,
   choose-another-time, effective priority, recurrence/RSVP semantics,
   invitation update evidence, and safe explicit automatic-move opt-in.

## Repository and external-state truth

- The implementation is local and uncommitted unless the current Git status
  says otherwise. Preserve unrelated user changes and review provenance before
  the first commit.
- No production OAuth client, Google account connection, domain, package,
  trademark registration, public image, cluster deployment, signed binary, or
  external contribution has been created by this work.
- `spikes/go-reference/` is a frozen artifact from a superseded direction and
  is not part of either product edition.

Google-to-Google Calendar Sync is the release-critical active wedge. Server
Protected Hours, availability fences, and Smart Meetings are also active alpha
scope. Outlook and CalDAV parity follow. Tasks, habits, focus, booking, buffers,
teams, analytics, and assistants remain future modules and must not dilute the
sync/recovery/privacy gates.
