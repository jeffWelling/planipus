# Roadmap

Planipus ships two autonomous editions. Milestones prefixed **E** define shared
behavioral evidence, **S** deliver the clean-room Kubernetes Server, and
**M** deliver the native local Mac application. The tracks may proceed in
parallel after E0. Neither edition waits for, connects to, or upgrades the
other.

Version numbers are edition-specific (`Planipus for Mac 0.x`, `Planipus Server
0.x`). A shared product-family announcement may bundle releases, but version
skew has no protocol consequence because there is no Mac↔server protocol.

Planipus's intended scope is broad Reclaim-class calendar orchestration.
Roadmap order is nevertheless asymmetric: the directed privacy-preserving
calendar bridge is the **release-critical wedge** for each edition. Protected
Hours, availability fences, and Smart Meetings are active Server work and may
advance in parallel, but neither their existence nor an alpha label can waive
the bridge's two-account, ordinary-viewer, recovery, and packaging gates.

## E0 — edition boundary and conformance (first gate)

Goal: make it impossible to rebuild the rejected client/server design or let
the independent policy engines drift silently.

Deliverables:

- authoritative two-edition topology and threat boundaries;
- requirement tags for common, Mac-only, and Server-only behavior;
- `conformance/calendar-sync/v1` schemas, reason-code registry, privacy preset
  versions, disclosure manifest schema, and canonical JSON serialization;
- at least 50 fixtures covering hours/DST, privacy, RSVP, free/all-day,
  recurrence, overrides, duplicates, loops, detach, cursor loss, and replay;
- fixture runner contract for Swift and TypeScript;
- separate release evidence templates and support statements;
- no native-auth, server-profile, device-session, SSE, or generated server API
  task remains for the Mac edition; and
- a versioned scope record distinguishes Reclaim 1.0's opt-in automatic Smart
  Meeting movement from Reclaim 2.0's suggest-first attendee safety model.

Exit: reviewers draw two isolated boxes; both test runners can consume the same
fixtures; disclosure-changing fixture edits require security review.

## S0 — clean-room Server foundation (Server 0.1)

Goal: establish a reproducible original Server from approved components.

Deliverables:

- adopt the clean-room policy, select the project license, and establish
  contributor provenance, SBOM and third-party-notice gates;
- select/pin runtime, HTTP/schema, database/migration, auth, PostgreSQL jobs and UI
  components through the reuse ledger;
- establish a reproducible original workspace with type checks, builds and tests;
- classify/remediate all production critical/high advisories in selected components;
- envelope-encrypt Google/Microsoft tokens with migration, rotation, restore,
  redaction, and compromise tests;
- remove community feature dependence on billing, analytics, license server, or
  phone-home behavior;
- establish test PostgreSQL/provider fixtures and CI evidence retention.

Exit: Foundation Gate A–C passes; no live account is connected before provenance,
credential and dependency gates.

## S1 — Google Calendar Sync contract (Server 0.2)

Goal: make the original Server solve the defining use case precisely.

Deliverables:

- original policy-first schema and migrations;
- named hours profiles, local-date exceptions, IANA timezone/DST evaluation;
- versioned Busy/generic/selected/full privacy presets and disclosure preview;
- source/destination identity, RSVP, all-day/free, already-invited, `#nosync`,
  destination-edit, detach, cleanup, duplicate, and loop semantics;
- Google payload visibility/transparency/reminder/attendee handling;
- durable outbox, cursor transaction, ambiguous-effect, watch renewal, polling
  safety, and restore reconciliation;
- calm web setup, policy preview, health, pause, error, cleanup, and disconnect.

Exit: two live Google accounts plus an ordinary third-viewer identity pass
create/update/move/recurrence/delete and disclosure tests.

## S1C — API/MCP and no-copy conflict-response alpha (active Server track)

Goal: let a self-hoster protect work from private conflicts without placing a
personal placeholder on the work calendar, and expose the same Server authority
to local MCP clients without a database/provider bypass.

Implemented foundation in the current worktree:

- scoped, expiring, digest-only API tokens with one-time plaintext, owner-only
  browser administration, tenant/principal binding, audit and revocation;
- bearer read/propose/apply boundaries on documented Server routes, rejecting
  ambiguous browser+bearer credentials;
- process-local per-actor read/apply/propose windows, safe 429/`Retry-After`, and
  a 10-live-conflict-preview/principal preflight;
- official-SDK MCP stdio process that calls only the authoritative HTTPS/
  loopback API, with fixed resources/read/proposal tools by default and apply
  tools behind both an API scope and process opt-in;
- strict-private Google `availability` role, CalendarList/free-busy only, never
  event-synced, with distinct event-read/free-busy capability flags; source/both
  can also supply free/busy after reauthorization;
- atomic source/both → no-event-read privacy downgrade that blocks live/
  historical dependencies, otherwise purges observations/cursors, retires sync
  work, restricts endpoints, audits counts, and closes in-flight sync races;
- provider free/busy and exact conditional self-attendee response ports;
- immutable privacy-safe preview, conflict rule and durable work-response action
  model, fresh free/busy and exact invitation revalidation, idempotency and
  ambiguous-write verification;
- fail-closed organizer/answered/cancelled/all-day/started/changed/no-overlap
  semantics and protected-calendar exclusion from active bridges in either
  direction (including paused inbound-copy rejection), with shared advisory
  locks closing activation/resume races and disclosure of paused outbound copies;
- keyed private snapshot/action bases, bounded/fresh invitation candidates, one
  durable response-provider controller, a 20-per-rolling-24-hour historical
  decline budget backed by immutable verified-decline audit facts, immediate
  response-sync-triggered reconciliation plus scheduler fallback, idempotent rule
  retirement, and conservative no-PATCH recovery/applied-with-warning handling
  when an exact provider read already sees declined but the comment is not
  retained;
- canonical Google-global calendar identity for bridges and protected
  availability, alias-aware no-copy locks/checks, same-calendar alias rejection,
  historical self-copy quarantine/audit, subject-serialized first-connect, and
  overbroad or unreported availability-grant refusal;
- single-item scheduled-job/effect lease limits per worker loop, with heartbeat/
  final conditional renewal and non-fatal lease-loss handling;
- Server Private replies and API-token/MCP settings UI; and
- separate preview/list/capability fields for provider-write and message-delivery
  state, with Google activation refused while the write gate is off and fake
  writes labeled simulated.

Required hardening/evidence:

- record the opt-in real-PostgreSQL 0001–0014 service/coordinator lifecycle and
  protected-calendar activation race in the consolidated gate, then extend it to
  scheduler/worker process faults, uncancellable in-flight provider calls,
  restore, duplicate jobs and concurrent provider response;
- SQL/job/audit/log/metric/API/MCP/backup inspection proving no personal event
  identity/content and no event sync for availability-only accounts;
- real-PostgreSQL role-downgrade dependency/purge/in-flight-sync proof and a
  supported historical-reference cleanup design (until then, fail closed and
  recommend a separate dedicated availability account);
- seeded 0013→0014 alias self-copy quarantine/effect/job/audit/copy-preservation
  upgrade proof, all alias lock winner orders, and live Google old-grant revoke/
  availability-only reconnect/downgrade evidence;
- complete health, held repair, edit/retention/export, bridge-copy cleanup,
  token rotation, and multi-key private-HMAC rotation;
- packaged MCP-host E2E, current online audit and upstream Hono advisory tracking;
- shared persistent multi-replica limits, concurrency-hard preview quotas, and
  planning/public-specific abuse controls;
- disposable Google consent/reauthorization, comment visibility, actual mail/
  calendar notification, recurrence instance, precondition, ambiguity, quota,
  auth and cleanup matrix; and
- remote Streamable HTTP only after a separate OAuth/resource-server, security,
  rate-limit and deployment ADR. Stdio may not be proxied into that role.

Exit: an availability-only personal account and both-role work account pass the
full preview → active rule → conditional RSVP lifecycle in a restored Server;
no personal event content/copy is present; organizer/comment/notification
behavior is documented from live evidence; token/MCP least privilege is proven;
and the live-write flag may be promoted deliberately. This does not replace the
bridge S1 exit and creates no Mac capability.

## S1P — Protected Hours and Smart Meetings alpha (active Server track)

Goal: turn the first broader Reclaim-parity behaviors into honest, deterministic
Server features without claiming that the bridge or planner is release-ready.

Implemented foundation in the current worktree:

- PostgreSQL planning rules, expiring previews, planned events, suggestions,
  provenance generations, durable jobs, and audit facts;
- validated availability-fence and Smart Meeting documents;
- deterministic timezone-aware materialization using the shared Hours engine;
- after-work/before-work/closed-day private Busy fences with no attendees or
  reminders;
- Smart Meeting candidate search inside an explicit weekly window, selected
  calendar Busy observations, preferred-time scoring, min/max duration,
  past-slot exclusion, explicit unmet results, and
  unknown-attendee-availability warnings;
- a 30-minute freshness gate requiring a ready sync cursor for every selected
  availability calendar, other active Smart Meeting occurrences included as
  Busy, and same-rule observed Google events excluded by private marker;
- a configured 24-hour no-move lock, actionable move/skip suggestion shelf with
  accept/dismiss and skip cancellation, plus suggestion expiry/audit;
- preview/activation, owned provider create/update/delete primitives,
  pause/resume with pending-write re-enqueue, manual and 15-minute-window
  scheduled replan, and rule removal with owned-event cleanup;
- intent-sequence checks that turn superseded provider jobs into no-ops;
- Google planning writes disabled unless
  `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true` (the fake provider remains
  writable);
- Protect/Meet browser screens; and
- alpha capability reporting plus engine/API/provider tests.

Required hardening:

- promote Working/Meeting/Personal/Custom/one-off Hours to reusable versioned
  policy objects with multiple day ranges and exceptions;
- live-prove that the ready-cursor freshness gate represents complete provider
  coverage; add external-attendee free/busy discovery/mapping where
  authorization permits;
- extend the implemented suggestion list/accept/dismiss flow with
  choose-another-time, complete at-click rule/provider/availability/lock basis
  validation, stale rejection, and recompute;
- keep `suggest` as the Reclaim 2.0-style default. Treat `auto_move` as explicit
  Reclaim 1.0-style opt-in and prevent release until notification, RSVP,
  concurrency, lock-window, and recurrence tests pass;
- enforce priority or remove it from effective UI claims; the no-move lock is
  now enforced;
- implement rule edit/detach, a full removal impact preview, planned-event drift
  verification, and complete ambiguity recovery; rule removal already queues
  marker-verified owned-event cleanup;
- expose the Google planning-write gate in capabilities and UX so a disabled
  deployment cannot present queued local intent as a created provider event;
- decide and test provider recurrence-series semantics instead of presenting
  independent rolling events as full recurrence parity;
- complete keyboard/screen-reader/responsive UX and calm action-needed flows;
  and
- run live Google tests covering private fence visibility, zero fence mail,
  meeting invitations/updates, external attendees, conflict suggestions,
  automatic-move opt-in, pause/replan, quota, and recovery.

Exit: the Server can demonstrate the complete suggestion-first lifecycle and
availability-fence ownership against live Google accounts. This exit does not
replace S1's bridge exit or S2's operational release exit.

## S2 — Kubernetes release (Server 0.3)

Goal: make the independent web service trustworthy to operate.

Deliverables:

- solo StatefulSet profile: API, scheduler, worker, and PostgreSQL containers,
  one RWO PVC, non-root security contexts, probes and resources;
- standard profile with external PostgreSQL and identical features;
- stable HTTPS/OAuth callback guidance, secrets contracts, network policy,
  structured redacted logs, Prometheus metrics, optional traces;
- migrations, graceful drain, backup, restore, upgrade, rollback, reconcile, and
  no-duplicate runbooks/tests;
- multi-architecture signed images, Helm/Kustomize assets, SBOM, provenance,
  checksums, source tag and notices;
- 30-day server dogfood and restore drill.

Exit: a clean cluster install and a restored install independently repeat the
defining Google scenario without any Mac application.

## M0 — native feasibility and safety foundation (Mac 0.1)

Goal: prove the local architecture before UI breadth.

Deliverables:

- sandboxed SwiftUI workspace with App/Core/Google/Store/Secrets/Sync modules;
- GRDB pinned and audited; SQLCipher build, migration, key-loss, performance,
  backup, license, notarization, and clean-machine spike;
- installed-app Google OAuth using system browser, state, PKCE, distinct identity
  labels, non-synchronizing Keychain items, revoke/disconnect and log-redaction;
- local schema/migrations for policies, observations, projections, cursors,
  durable effects, audit and health;
- full/incremental Google sync, cursor transaction, HTTP 410 recovery, poll
  jitter/backoff and safety reconciliation;
- crash ambiguity proof: remote write followed by local crash converges without
  a second copy;
- sleep/wake, offline/reconnect, quit/relaunch tests and truthful timestamps;
- idle/running energy, memory, CPU and provider-quota budgets.

Exit: a signed development build connects two disposable Google identities and
passes local exact-once recovery tests. No Planipus Server traffic or component
exists in the binary/process tree.

## M1 — complete native Google flow (Mac 0.2)

Goal: make the local app sufficient for the defining user journey while it is
running.

Deliverables:

- pure Swift policy engine passing all shared conformance cases;
- unmistakably native onboarding and account/calendar identity chooser;
- hours/privacy/selection editor with source→destination sentence, safe default,
  field disclosure, candidate preview and explicit activation;
- projection health, actual last success, offline/delayed/action-needed states,
  retry, pause, detach, cleanup and disconnect;
- MenuBarExtra with Sync Now and explicit Quit semantics;
- optional privacy-safe notifications and no event detail in menus/logs;
- live personal Google→work Google create/update/move/recurrence/delete tests;
- ordinary coworker/viewer privacy verification for every preset;
- keyboard, VoiceOver, contrast, reduced-motion, zoom, timezone, and identical-
  calendar-name coverage.

Exit: the app demonstrates that a source change made while Quit is not copied,
then catches up exactly once after relaunch. Product copy never claims otherwise.

## M2 — recovery, packaging and public Mac release (Mac 0.3)

Goal: make local ownership recoverable and distributable.

Deliverables:

- explicit encrypted local backup/export with version/checksum and no provider
  refresh tokens by default;
- restore/new-Mac flow that reconnects accounts, scans destination provenance,
  adopts safe copies, previews ambiguity and prevents duplicate/delete storms;
- database/key rotation, corrupt-store recovery, OAuth revocation, uninstall and
  residual-Keychain documentation/tests;
- hardened runtime, App Sandbox entitlement inspection, Developer ID signature,
  notarization, staple, DMG, checksum, SBOM/license manifest and source tag;
- clean-VM install, upgrade, downgrade refusal, uninstall and macOS support
  matrix evidence;
- 30-day Mac dogfood across sleep, network loss, Quit, crash, clock/timezone/DST
  changes and revoked credentials.

Exit: public native artifact meets MAC-001–MAC-012 independently of Kubernetes.

## E1 — product-family release audit

Goal: show shared behavior without implying shared operation.

Required evidence:

- Swift and TypeScript conformance reports from exact release commits;
- separate Mac and Server threat-model reviews and penetration findings;
- two-account/third-viewer evidence for each edition;
- independence test: install both, connect different accounts, revoke/delete one,
  and prove the other is unchanged;
- documentation audit for forbidden continuity, pairing, and takeover claims;
- license/notices/SBOM/reproducibility evidence for both artifacts;
- published known limitations, including the Mac uptime requirement; and
- separate Server evidence for availability fences and Smart Meetings whenever
  those alpha capabilities are included in a public artifact; absence on Mac is
  stated explicitly until the native P1 planning acceptance is implemented.

## Broad-parity expansion order

The active S1P track can proceed before P0 closes, but public parity claims and
new breadth follow this risk order:

1. finish the release-critical Google bridge independently in Server and Mac;
2. finish Server Protected Hours/availability fences and Reclaim 2.0-style
   Smart Meeting suggestion review/apply plus no-copy conflict-response live
   proof, then decide native Mac sequencing;
3. Outlook bridge and planning-policy parity;
4. CalDAV bridge compatibility matrix;
5. ICS/native JSON export and public Server API completeness;
6. buffers and individual/team/round-robin scheduling links;
7. habits, adaptive tasks, and focus goals on the reusable Hours/priority/preview
   substrate;
8. meeting quality, teams, aggregate analytics, assistants, and hosted-service
   conveniences.

Adding a provider to Server does not automatically promise it for Mac, or vice
versa. Each edition gets its own requirement, implementation, security review,
live provider matrix, and release note.

## Explicit non-goals through 1.0

- Mac as a client/control panel for Server;
- account/configuration synchronization between editions;
- local background helper that runs after Quit;
- embedding Keeper or Server runtime/PostgreSQL/Valkey components in the native app;
- running both editions as authorities for the same source→destination route;
- feature gates tied to commercial subscriptions;
- representing Meeting Hours as a universal block on arbitrary provider
  invitations;
- exposing the stdio MCP process as a remote HTTP service, or allowing MCP to
  bypass Server API authorization;
- claiming no personal event persistence when a selected personal account uses
  source/both for an independent bridge rather than strict availability-only;
- silently auto-moving attendee events under a suggest-first policy;
- calling independent rolling planned events complete recurrence-series parity;
- AI dependency, tasks, habits, focus, booking, or team optimization before the
  common Hours/preview/ownership substrate and Calendar Sync P0 are reliable.
