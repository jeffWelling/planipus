# New-session handoff

Updated: 2026-07-21  
Committed product name: **Planipus**  
Status: substantial credential-free implementation; pre-release gates remain

This file is the fastest safe entry point for a new build session. Read it
before changing architecture or provider behavior. `STATE.md` is the concise
truth; this handoff explains how to continue.

## Do not reopen these decisions casually

1. P0 is Reclaim-style, directed cross-account Calendar Sync—not automatic task
   planning. A personal source event is copied to a work destination only when
   it matches work-hours and selection policy, with selected privacy disclosure.
2. The source remains authoritative. A managed destination copy is a projection
   and must never become a new source or send invitations/reminders.
3. Planipus for Mac and Planipus Server are autonomous products. They share
   behavior fixtures but no account, token, database, API, session, pairing,
   storage format, process or continuity promise.
4. The Mac stops syncing when quit, asleep, offline, powered off or replaced.
   Closing its window may leave the menu-bar app running; explicit Quit stops it.
5. Keeper is AGPL and absolutely excluded from implementation reuse. Do not
   import, copy, adapt, execute or derive Keeper code, tests, fixtures, schema,
   migrations, assets, dependencies, lockfiles, images, runtime or Git history.
   Its recorded feature behavior is research only.
6. Apache-2.0 plus DCO is the engineering license decision. Public distribution
   still needs complete dependency/license/provenance review.
7. Server uses Node 24, strict TypeScript, Fastify, PostgreSQL durable jobs, and
   React. Valkey is not part of P0. Mac uses native SwiftUI and direct Google
   OAuth; it must not embed the Server or a local web service.
8. No-copy conflict response is a separate Server aggregate: provider free/busy
   may decline only a future timed work invitation still at `needs_action`, with
   exact revalidation and no personal event copy/content/identity persistence.
9. Strict-private personal setup uses Google role `availability` (CalendarList +
   `calendar.freebusy`; the grant cannot list events and role guards prevent
   event sync/bridge-source use). Its endpoint is `readable=false` with
   `capabilities.freebusy_readable=true`; `readable` means event content. Work
   response uses `both`. Every selected
   private availability calendar is protected from active bridges in either
   direction and across delegated Google aliases; an inbound bridge blocks even
   when paused. Mutation paths share local-endpoint and canonical provider-
   calendar advisory locks. Same-calendar alias bridges fail closed. An outbound
   bridge may be paused, but older copies remain/disclosed. Rule DELETE
   supersedes pending/held work and permits resume without cleaning old copies
   or reversing declines. Availability OAuth rejects retained broader Calendar
   grants with `oauth_scope_overbroad` and a missing returned set with
   `oauth_scope_unverified`; revoke the prior Google grant and reconnect rather
   than claiming the downgrade succeeded.
10. MCP is a separate stdio process that calls only the authoritative Server
    HTTPS/loopback API. API tokens are one-time-displayed, hashed, expiring and
    scoped. Apply requires both token scope and MCP process opt-in. There is no
    remote MCP transport or Mac MCP/API relationship.
11. Live Google invitation declines remain off by default. Google documents
    propagation of `responseStatus`, not guaranteed organizer comment delivery.
    Planipus deliberately avoids broad `sendUpdates=all` guest updates, while
    `sendUpdates=none` still does not prove zero mail. Preview/list/capabilities
    expose separate provider-write and message-delivery state; Google activation
    fails while writes are disabled, and fake writes are labeled simulated.
    A verified declined RSVP whose comment is not retained remains applied with
    `decline_comment_not_retained`, consumes budget, and is not retried. A
    pending action whose initial exact GET already sees self declined uses the
    same applied/budgeted recovery without PATCH; accepted/tentative remain held.
12. Private busy bases use domain-separated HMAC. Rotation has no multi-key
    verification: expire previews and supersede/recompute pending/held actions.
    Automatic declines are capped at 20 per rolling 24 hours across historical
    rules for one durable response-provider identity, counted from immutable
    `invitation_response.declined` audit facts rather than mutable action rows.

The binding behavior is `CALENDAR-SYNC.md`; the executable contract under
`../conformance/calendar-sync/v1` wins over incidental implementation behavior.

## What exists

### Shared contract and engine

- `conformance/calendar-sync/v1/manifest.json` indexes 91 Planipus-authored
  cases. Schemas, privacy/reason/disclosure registries and grouped cases live
  beside it.
- `packages/calendar-sync` is the independent TypeScript implementation. It
  evaluates work-hours in named timezones, including DST gap/fold rules;
  selection; privacy compilation; validation; and projection reconciliation.
- The current shared baseline is 96 passing tests (rerun on this uncommitted
  feature worktree). Never change a
  fixture merely to make an implementation pass; fix the implementation or use
  the contract change process in ADR-002.

### Server edition

- `server/migrations/0001_initial.sql` defines organization/session, encrypted
  OAuth transaction/connection, calendar, hours, policy/preview, observation,
  cursor, projection, outbox, scheduled-job, subscription/inbox and audit state.
  `0002_destination_verification.sql` adds the bounded verification cursor;
  `0003_recovery_basis.sql` binds projections/effects to source+tombstone state
  and records the current explicitly recoverable operation.
- `0004`/`0005` add planning rules and retained job-window lookup; `0006` adds
  hashed scoped API tokens; `0007` adds conflict previews/rules/selected
  availability endpoints/work-side response actions; `0008` adds the
  availability-only connection role without rewriting historical rows; `0009`
  enforces one live rule per local work response endpoint; `0010` adds the bounded
  unanswered-invitation candidate index; and `0011` moves new private snapshot/
  action basis values to domain-separated HMAC. `0012` stores the durable
  response-provider identity, prevents delegated aliases from owning multiple
  live controllers, and carries the 24-hour budget across historical rules;
  `0013` indexes the immutable verified-decline facts used by that budget; and
  `0014` persists canonical bridge/protected-availability provider identities,
  blocks alias self-copy/no-copy bypass, and quarantines historical alias self-
  copy work with deterministic audit while leaving old copies for review.
- `server/src/api` exposes authenticated session, Google connection, overview,
  calendar, policy preview/activation/control, manual sync, health and protected
  metrics behavior. The same process serves `web/dist` with SPA fallback.
- `server/src/auth/api-token.ts` and API routes expose owner-issued expiring
  `read|propose|apply` machine credentials and actor-preserving authorization.
- The API adds process-local actor windows (read 600/minute, apply 120/minute,
  propose 30/10 minutes) and conflict preview adds a 10-live-row/principal
  preflight. Both return safe 429 + `Retry-After`; shared multi-replica and
  concurrency-hard limits remain release work.
- `server/src/conflict-response` owns strict no-copy draft/preview/input hashing,
  service lifecycle and reconcile/apply coordination. It uses provider free/busy
  and exact work invitation revalidation; it never creates a private placeholder.
  Rule retirement is idempotent and exposed through API/MCP.
- `server/src/providers/google/oauth.ts` treats source/both → no-event-read
  reauthorization as an atomic privacy transition. Dependencies fail with
  `availability_role_change_blocked`; otherwise it purges observations/cursors,
  retires subscription/sync work, restricts endpoints, and audits counts while
  sync finalization revalidates the locked role. Bridge and historical-reference
  blockers currently have no self-service retirement/purge, so operators must
  keep the broader role or use a distinct dedicated availability account rather
  than force the transition.
- `server/src/calendar-protection-lock.ts` serializes conflict activation and
  bridge activation/resume by tenant/calendar, locking both bridge endpoints.
  Active outbound bridges may pause before protection; inbound bridge copies
  block even when paused.
- `mcp/` is the official-SDK stdio adapter with a fixed API-only client, strict
  schemas, safe errors, static resources, read/proposal default, and opt-in apply
  tools including `activate_sync_policy` and `retire_conflict_response_rule`. It
  has no Server-internal imports. Its 300-second deadline covers bounded provider
  fan-out; GET timeout is `api_timeout`, while POST/DELETE timeout is unknown
  outcome and requires a state read before retry.
- `server/src/providers/google` owns OAuth/token and Calendar v3 serialization.
  Availability/source/destination/both roles request the least capability
  required. Availability has no event-list access and is not source-synced;
  existing source/both grants need reauthorization for free/busy.
  Provider access/refresh tokens remain inside versioned AES-GCM envelopes.
- `server/src/sync` implements bounded occurrence reads, transactional
  observations/cursors, source-authoritative reconciliation, durable effects,
  If-Match writes, marker-verified timeout ambiguity recovery, idempotent deletes
  and calendar-wide stale-generation cleanup. A 15-minute/100-item verifier
  repairs owned destination drift, rotates deleted IDs/generations, and holds
  ownership mismatches; explicit recovery remains read-before-write. Every
  effect carries the source hash+tombstone basis used to derive it and is
  superseded/reconciled without provider access if that basis is stale.
- `server/src/jobs`, `scheduler.ts` and the worker command use PostgreSQL leases;
  no external queue can lose canonical intent. Each loop leases one scheduled
  job and one effect. Scheduled jobs renew every lease/3 and immediately before
  terminal state; a stale owner writes no transition and the worker stays alive.
  An in-flight provider call cannot be cancelled, so idempotency, ambiguity
  verification, reconciliation, and provider-I/O-under-lock release work remain.
- A successful work response-calendar sync immediately enqueues active conflict-
  rule reconciliation; scheduled 15-minute reconciliation remains the fallback.
- `web` is the calm React setup/health interface. Its exact contract is the
  implemented `/api/v1` adapter in `web/src/api.ts`, not the future endpoints
  still catalogued in `API.md`.
  It now includes Private replies and owner-only API-token/MCP settings. Preserve
  the rule-scoped zero-new-copy, surviving paused-bridge-copy, broader-source-
  role, write-disabled, and provider-delivery caveats. Capability fields are
  authoritative: Google activation/resume is refused while writes are off; fake
  writes are simulated; enabled Google message delivery remains unverified.
- `deploy/helm/planipus` provides solo (PostgreSQL sidecar + RWO PVC) and standard
  (external PostgreSQL) profiles for one replica with API/scheduler/worker
  containers from one artifact. Defaults use invalid registries and fake
  provider intentionally; operators must opt into reviewed images and Google.
  Solo PostgreSQL listens on loopback and keeps its initialization administrator
  Secret out of every application container.

### Native Mac edition

- `macos/Package.swift` defines App/Core/Google/Store/Secrets/Sync/Design and
  test-support modules. `PlanipusApp` is a native SwiftUI/MenuBarExtra executable.
- Google installed-app OAuth uses `ASWebAuthenticationSession`, state, PKCE,
  exact callback, direct token refresh/revoke/user-info, and per-account
  non-synchronizing Keychain secrets.
- Accounts and calendar endpoints are explicit identities. Every provider read
  and destination mutation routes using the endpoint's owning account, which is
  essential for personal→employer sync and identical calendar names.
- The coordinator/evaluator/repository/outbox runtime is direct and local. There
  is no Planipus Server URL or fallback.
- Production persistence uses the exactly pinned SQLCipher-managed GRDB 7.11.1
  and SQLCipher.swift 4.17.0 packages. Five transactional migrations store
  accounts, full bridge policy/hours, a stable installation identity, cursors,
  observations, staged batches, projections and outbox effects.
- A separate random 32-byte SQLCipher key is held in a non-synchronizing,
  device-bound Keychain item. Startup authenticates/migrates the store, restores
  configuration, retains the real coordinator, and enables policies only after
  durable save. Missing/wrong keys fail without replacing an existing database;
  the in-memory repository remains test-only.
- Roles are selected before OAuth. Source-only accounts request read-only event
  scope; destinations request event-write scope. Persisted grants and Keychain
  credential presence are revalidated before scheduling. Account pairs are
  explicit, and one quarantined ownership mismatch cannot starve another bridge.

## Build commands

From the repository root:

```sh
npm install
npm run verify
swift test --package-path macos
swift build -c release --package-path macos
npm run gate
```

`npm run verify` is the clean-checkout Node gate: ordered workspace builds,
type-checks/tests, web build, documentation and provenance. `npm run gate` adds
Swift tests/release build and Helm lint/render checks. Do not publish a green
claim from an individual workspace test when the full gate is available.

Toolchain contract:

- Node.js `>=24 <25`, npm 11;
- PostgreSQL 16 or newer for local/integration use (chart currently selects a
  reviewed/pinned image only at release time);
- Swift 6.1 or newer on macOS;
- Helm 3 for chart checks.

## Local Server procedure

1. Create an empty PostgreSQL database.
2. Copy `.env.example` to `.env` and replace every `CHANGE_ME`.
3. Generate a 32-byte random key, encode it once as base64, and set
   `PLANIPUS_MASTER_KEY`. Never copy a documentation placeholder into a real
   environment.
4. Generate an unrelated unpredictable bootstrap token of at least 32
   characters. Treat it like an owner password.
5. Keep `PLANIPUS_PROVIDER_MODE=fake` until credential-free flows pass.
6. Run `npm run build`, then `npm run seed:fake` for the idempotent Personal→Work
   demo (it refuses production and Google mode).
7. Run `npm run dev:server` and open `http://127.0.0.1:8080`.

The development launcher builds shared, Server and web workspaces, waits for the
database, migrates, and starts the API. Bootstrap consumes the configured token
to create a browser session; subsequent mutations require the session's CSRF
token and same origin.

Real Google mode requires a Google web OAuth client, exact callback
`<PLANIPUS_PUBLIC_URL>/api/v1/connections/google/callback`, HTTPS outside
loopback, and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Create separately
labeled personal/source and employer/destination connections for bridges. For
no-copy privacy, use personal `availability` plus work `both`; old source/both
grants need explicit free/busy reauthorization. Never place those
credentials in Git, fixtures, screenshots, logs or evidence files.

To exercise MCP, create a `read` + `propose` token in Settings, copy its one-time
plaintext into the MCP host's private environment, build `@planipus/mcp`, and
launch `mcp/dist/src/stdio.js` with `PLANIPUS_API_URL`,
`PLANIPUS_API_TOKEN`, and `PLANIPUS_MCP_ENABLE_APPLY=false`. Use HTTPS except
loopback. Apply requires a separate deliberate token/flag. Do not expose stdio
through ingress and do not expect this process to control the Mac edition.

Production process types are `api`, `scheduler`, and `worker` in `Procfile` and
Cloud Native Buildpacks metadata. All run migrations through the same
advisory-lock/retry wrapper. Only API/web is exposed.

## Kubernetes procedure

Read `deploy/helm/planipus/README.md`. Create the Secret named by
`existingSecret` outside Helm. Solo needs `DATABASE_URL`,
`POSTGRES_PASSWORD`, bootstrap token and master key, plus a separate Secret
named by `postgresql.existingAdminSecret`; only the PostgreSQL sidecar receives
that administrator password. Standard omits both PostgreSQL password Secrets
and points `DATABASE_URL` to the external service. Google credentials are needed
only in Google mode.

Before install:

1. replace the deliberately invalid application and PostgreSQL registries;
2. pin immutable image digests and inspect both images/SBOMs;
3. configure public HTTPS/ingress and the exact OAuth callback;
4. narrow NetworkPolicy ingress and add only the required external-database
   egress for standard mode;
5. arrange PostgreSQL backup and a restore target before connecting calendars;
6. render, server-side dry-run and pass restricted Pod Security admission;
7. prove restore/upgrade reconciliation cannot duplicate destination events.

Do not add replicas before the singleton assumptions, leases, OAuth callback
and rolling-migration behavior have a separate scaling ADR and chaos proof.

## Native Mac continuation procedure

ADR-005's encrypted production-store slice is implemented. Preserve these
properties when extending it: configure the key before any schema access, never
replace an unreadable existing database, keep Keychain secrets separate from
non-secret SQLCipher rows, make cursor/page/outbox commits transactional, and
never substitute the in-memory repository in production.

Continue its lifecycle work in this order:

1. design atomic database-key rotation and interrupted-rekey recovery, with a
   byte-for-byte no-overwrite guarantee on failure;
2. design a coordinated, explicit reset/uninstall workflow for the database,
   database-key item and OAuth items;
3. specify an authenticated encrypted export/import container that excludes
   provider credentials by default and supports schema/version validation;
4. implement replacement-Mac recovery only after reconnect plus destination
   provenance scan can adopt unambiguous copies and preview ambiguity;
5. inject crashes after provider writes and around local commits, then prove
   relaunch, sleep/wake, offline catch-up, cursor 410 and rotation behavior;
6. measure database and sync performance/energy, then prove clean-machine
   packaging, entitlements, signing and notarization.

The Swift conformance runner already executes every canonical manifest case and
validates reason/disclosure vocabulary. Keep that 91-case closed-corpus gate in
CI; do not create a second “native” vocabulary or handpicked sample corpus.

OAuth configuration is an installed-app relationship, separate from Server's
web client. A distributed client secret is not treated as confidential, but
refresh tokens are. Entitlements must remain outgoing-network + scoped
Keychain/app-container only; no listener, daemon, LaunchAgent or privileged
helper.

## Current test and evidence boundary

Credential-free Node/Swift builds and component suites have passed during this
implementation. The final exact counts and command outputs are captured in
`evidence/2026-07-21-build-verification.md` after the consolidated gate. One
moderate npm advisory was reported at install; complete advisory
classification/SBOM evidence is still missing.

Those baseline counts predate API-token/MCP/conflict-response work. Focused
tests now exist; the latest focused MCP typecheck and 31 tests in four files pass.
The earlier MCP build-artifact pass predates final edits and must be rerun.
No consolidated post-edit gate or real-PostgreSQL
0001–0014 lifecycle is claimed until recorded in
`evidence/2026-07-21-mcp-api-conflict-response.md`. The direct `uuid` is 11.1.1;
the known remaining moderate Hono Windows static-serving advisory is unreachable
in stdio-only MCP and accepted pending upstream. The current online audit could
not reach the registry and must be rerun.

No live Google accounts, third-viewer privacy identity, public image, cluster,
signed/notarized Mac app, backup restore or 30-day dogfood proof exists yet.
Tests using a fake provider establish deterministic semantics and recovery
logic; they do not prove Google consent, API quirks, destination ACL visibility,
quota behavior or operational safety.

## Highest-priority unfinished work

Work in this order unless a new ADR changes risk:

1. Complete the independent Claude Opus architecture/security/behavior review.
   `evidence/2026-07-21-claude-opus-review.md` records the logged-out local
   client, external-transfer privacy block, exact safe continuation, and local
   pre-review fixes; it does **not** yet contain Claude output.
2. Finish the Mac encrypted-store lifecycle: rekey/recovery/reset/export and
   durable crash/relaunch/sleep/offline proofs.
3. Run disposable two-account + third-viewer Google matrices independently for
   Server and Mac. Include create/update/time move/recurrence exception/delete,
   hours/DST, privacy presets, already-invited, revoke, cursor 410, timeout and
   identical calendar names.
4. Prove Mac durable crash/relaunch/sleep/offline behavior and Server
   backup/restore/upgrade behavior without duplicate provider writes.
5. Run the API/MCP/no-copy gate: 0001–0014 PostgreSQL service/worker lifecycle,
   token/MCP rotation/E2E, availability-role no-event-sync/privacy inspection,
   and disposable Google comment/mail/concurrent-RSVP/recurrence evidence. Keep
   the invitation-decline flag false until it passes.
6. Build the Server image in the intended trusted build path, inspect it, deploy
   both chart profiles, and capture probe/drain/resource/NetworkPolicy evidence.
7. Complete accessibility, energy, security, advisory, SBOM, notices, signing,
   provenance, legal and dogfood gates before a public release.

Resolved final-review defect: cursor generations are now calendar-wide across
query fingerprints. A new fingerprint starts above all cursor/observation
generations, so its completed full scan can tombstone unseen rows from an older
fingerprint. The opt-in real-PostgreSQL test seeds generation 1, runs an empty
replacement full scan, and proves generation 2 tombstones the old observation.

## External-state truth

- No production Google OAuth application or calendar connection has been made.
- No image was built/pushed; no Kubernetes resource was applied.
- A public repository exists at `https://github.com/jeffWelling/planipus` with
  baseline `main`; this feature work is on `codex/mcp-auto-decline` and remains
  uncommitted/unpushed unless current Git state proves otherwise. There is no
  domain/package/trademark registration, release, external contribution, signed
  binary or notarization.
- Inspect `git status`, provenance and secrets before commit/push; preserve
  unrelated user changes.
- `spikes/go-reference` is frozen, superseded and not an implementation input.

## Reading order after this handoff

1. `STATE.md`, `TODO.md`, and `CONFLICT-RESPONSE-AND-MCP.md` for current truth,
   the new feature contract, and open gates.
2. `CALENDAR-SYNC.md` and `conformance/calendar-sync/v1/README.md` for bridge behavior.
3. `CLEAN-ROOM-POLICY.md`, `REUSE-MAP.md`, ADR-001 through ADR-005.
4. `ARCHITECTURE.md`, `MACOS-AND-KUBERNETES.md`, `DATA-MODEL.md`, `API.md`.
5. `SECURITY.md`, `TEST-STRATEGY.md`, `OPERATIONS.md`, `FOUNDATION-GATE.md`.
6. Dated files under `evidence/`, especially build verification, the MCP/API/
   conflict-response ledger, and the pending Opus review/provenance record.

Historical `PLAN-ALPHA.md` is immutable context from a superseded direction. It
must not override this handoff or the accepted ADRs.
