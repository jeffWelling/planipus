# Product requirements

Planipus targets broad Reclaim-class calendar orchestration while shipping in a
trust-first order. Each requirement is testable. **P0** is the release-critical
cross-account Calendar Sync wedge. **P1** is active parity work, including
Protected Hours, provider-visible availability fences, Smart Meetings, and
provider expansion. **P2** is subsequent tasks, habits, focus, booking, team,
and assistant breadth. An implemented P1 alpha does not satisfy or bypass a P0
release gate.

Unless a requirement says otherwise, Protected Hours, availability fences, and
Smart Meetings currently target Planipus Server. They require a separate Mac
requirement and native implementation before being claimed for Planipus for Mac.

## Scheduling core

| ID | Pri | Requirement / acceptance test |
|---|---:|---|
| SCH-001 | P1 | Given fixed events and flexible items in a bounded horizon, every returned placement is inside an allowed window and overlaps no immutable or selected Busy interval. Priority/lock ordering is enforced before those fields are exposed as effective controls. Property-tested across at least 10,000 generated schedules before release. |
| SCH-002 | P1 | Same input, configuration, timezone database, and engine version produce byte-equivalent placements and explanations. |
| SCH-003 | P2 | Items support earliest start, hard/soft deadline, P1–P4 priority, duration, minimum chunk, maximum chunk, minimum break, allowed hours, ideal time, energy, context, dependencies, and lock state. |
| SCH-004 | P2 | A preview reports placements, moves, deletions, unmet items, violated soft constraints, capacity shortfall in minutes, per-change reason, and overall score before any external write. |
| SCH-005 | P2 | Apply fails without partial writes when the base revision is stale; provider writes are idempotent and retry-safe. |
| SCH-006 | P2 | Long work can split across blocks/days while respecting min/max chunk and dependency order. Sum of blocks equals remaining effort. |
| SCH-007 | P2 | Recurring flexible items support RFC 5545-equivalent daily/weekly/monthly/custom cadence and per-instance overrides. |
| SCH-008 | P2 | Progressive defense can publish an item as free, tentative, or busy according to remaining opportunity and policy. |
| SCH-009 | P2 | Optimizing one person's schedule never worsens another attendee's score beyond an administrator-defined bound without explicit approval. |
| SCH-010 | P2 | The solver can optimize 500 users, 50,000 candidate items, and a 12-week horizon within 5 minutes on the documented reference hardware. |

## Hours and availability protection — active P1 acceptance

- Working, Meeting, Personal, Custom, and one-off Hours are represented as
  versioned timezone-aware policies with multiple intervals per day and dated
  exceptions. A rule references an Hours revision rather than silently copying
  a mutable global default. DST gap/fold behavior is explicit and shared with
  Calendar Sync.
- Meeting Hours are a hard boundary for Planipus-created meeting candidates.
  The UI and API never claim that Hours alone reject or hide arbitrary provider
  invitations created outside Planipus.
- A Server user can preview and activate an availability fence before work,
  after work, and/or on closed days for a bounded rolling horizon. Every fence
  event is Busy, has no attendees or reminders, defaults to provider-private
  visibility, and carries planning-rule/event/occurrence/generation provenance.
- Fence reconciliation creates, updates, verifies, and removes only
  marker-matched Planipus events; it converges after horizon movement,
  pause/resume, rule edit/delete, provider timeout, manual edit/delete, cursor
  loss, backup/restore, and disconnect. Foreign or ambiguous events are held for
  review, never adopted or overwritten by time/ID alone.
- Preview reports exact fence count, intervals, target calendar, visibility,
  horizon, and zero invitations/reminders. Material edits and cleanup require a
  fresh preview; ordinary rolling-horizon renewal does not.
- Credential-free engine, PostgreSQL, API, provider-serialization, and browser
  tests are supplemented by live Google owner and ordinary-viewer evidence
  proving Busy/private presentation, no mail/reminders, marker ownership,
  pause/resume, cleanup, DST, and rolling renewal.

## Work, routines, and focus

| ID | Pri | Requirement / acceptance test |
|---|---:|---|
| WRK-001 | P2 | Users can create, edit, complete, reopen, snooze, lock, split, and delete tasks; audit records contain before/after and actor. |
| WRK-002 | P2 | Projects support sections, assignments, dependencies, milestones, templates, statuses, estimates, actual time, tags, and saved views. |
| WRK-003 | P2 | Habits/routines accept frequency, occurrence target, min/max duration, allowed/ideal time, skip policy, dependencies, and defense policy. |
| WRK-004 | P2 | Focus goals support proactive/reactive mode, weekly target, daily min/max, block min/max, no-meeting periods, and qualifying work categories. |
| WRK-005 | P2 | Focus execution includes one-task mode, timer/Pomodoro, notes, interruption tracking, planned-vs-actual, and Slack/Teams/DND adapter hooks. |
| WRK-006 | P2 | Morning, shutdown, and weekly review flows can be enabled independently and completed entirely by keyboard. |
| WRK-007 | P2 | Capacity view shows planned, available, overbooked, at-risk, and unallocated hours per person/team/project for past and future periods. |

## Meetings and booking

| ID | Pri | Requirement / acceptance test |
|---|---:|---|
| MTG-001 | P1 | A Smart Meeting accepts required/optional attendees, cadence, ideal day/time, min/max length, Meeting Hours, P1–P4 priority, timezone, selected availability calendars, lock window, and unschedulable policy. The configured no-move window is enforced for existing occurrences; unsupported priority/ranking controls are not displayed as effective. |
| MTG-002 | P1 | Initial preview deterministically chooses the closest valid opening across selected availability calendars inside Meeting Hours, never returns a slot that has already started, may shorten only to the configured minimum, reports rejected candidates, and returns an explicit unmet occurrence instead of escaping protected time. Missing required-attendee availability produces a visible warning and cannot be represented as proven mutual availability. |
| MTG-003 | P2 | Booking pages support custom slug, one or multiple hosts, durations, locations/conferencing, availability, horizon, notice, buffers, daily/weekly caps, questions, reminders, cancellation, and rescheduling. |
| MTG-004 | P2 | Team booking supports collective, round-robin, preferred owner, weighted load balancing, attribute routing, and an explanation of host selection. |
| MTG-005 | P2 | Priority-aware availability may offer a lower-priority flexible block but never an immutable event; displacement is included in the booking preview/policy. |
| MTG-006 | P2 | Workflows send email/webhook notifications before/after booking and can be replayed idempotently. SMS/WhatsApp are adapters, not core dependencies. |
| MTG-007 | P2 | Meeting quality flags missing agenda/link, excess attendees, recurring meetings with low attendance, back-to-back load, and policy violations without reading private descriptions by default. |

Active P1 Smart Meeting acceptance further requires:

- conflict handling distinguishes Reclaim-version semantics. Default `suggest`
  follows Reclaim 2.0: create an expiring, basis-bound proposal and do not mutate
  or notify attendees until the user reviews and applies it. Explicit
  `auto_move` follows Reclaim 1.0-style behavior and is disabled from release
  until provider notification, stale-basis, concurrent-edit, lock-window, RSVP,
  and recurrence tests pass. `keep_with_warning` preserves the event and
  exposes the conflict;
- suggestions have list/detail/review/apply/dismiss/expire APIs and UI. Apply
  revalidates provider revision, availability snapshot, rule revision, lock
  window, and occurrence identity; stale suggestions fail closed and recompute.
  The current Server alpha implements expiring list/accept/dismiss actions,
  including accepted-skip cancellation and intent-sequence-gated provider jobs;
  it still needs complete at-click basis/provider/availability revalidation and
  choose-another-time;
- Smart Meeting creation, movement, skip/delete, pause/resume, rule edit/delete,
  manual move/lock, recurrence split, organizer/attendee RSVP, invitation
  updates, ambiguous provider writes, and ownership recovery converge without
  duplicate invitations or unauthorized attendee changes. Independent
  materialized events may not be marketed as complete recurrence parity;
- every selected availability calendar has a `ready` sync cursor with a success
  no older than 30 minutes. Other active Smart Meeting planned events count as
  Busy, while an observed Google event carrying the current rule's private
  marker is excluded to avoid self-conflict; and
- real Google planning writes remain fail-closed by default. They require
  `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true` until live invitation,
  cancellation, privacy, concurrency, and recovery evidence passes. The fake
  provider remains writable for credential-free testing.

## Calendar and integration

| ID | Pri | Requirement / acceptance test |
|---|---:|---|
| CAL-001 | P1 | Google Calendar, Microsoft 365/Outlook, and CalDAV support two-way event sync; iCloud, Fastmail, Nextcloud, and generic CalDAV pass the published conformance suite. |
| CAL-002 | P1 | Initial and incremental sync preserve recurrence master/instances/exceptions, attendees/RSVP, free-busy, all-day dates, timezone, conferencing, location, reminders, and deletions. |
| CAL-003 | P1 | Reconciliation detects dropped webhooks, expired sync tokens, remote edits, duplicates, and tombstones; convergence is demonstrated under fault-injection tests. |
| CAL-004 | P1 | Calendar mirror policies independently choose source/target, direction, busy state, title transformation, description/location removal, color, and exclusion filters. |
| CAL-005 | P2 | Todoist, Google Tasks, Microsoft To Do, Linear, Jira, Asana, ClickUp, GitHub, Notion, and generic webhook/import adapters implement declared field mapping and conflict rules. |
| CAL-006 | P1 | Import/export supports iCalendar/ICS, VTODO where available, CSV tasks, and a complete versioned project-native JSON export. |
| CAL-007 | P1 | Planipus Server's public REST API and webhooks cover every Server browser action; OpenAPI is versioned and backward-compatibility tested. The autonomous Mac edition does not call or implement this API. |
| CAL-008 | P1 | Planipus Server MCP exposes read and propose operations by default; apply requires a separate capability and follows the same preview/audit policy as Server UI/API. Mac has no MCP service in P0. |
| CAL-009 | P0 | A user can connect two or more independent Google accounts (for example employer and personal), select a source and destination calendar, and activate one directed sync policy. Policy creation/material changes preview projected creates/updates/deletes; qualifying routine source changes then reconcile automatically without per-event approval. |
| CAL-010 | P0 | A policy selects `all_times`, timezone-aware `overlaps_profile`, or `contained_in_profile` against a named weekly hours profile plus local-date exceptions. Changing hours reconciles existing copies. Boundary, overnight, multi-day, DST gap/fold, and cross-timezone tests pass. |
| CAL-011 | P0 | Each directed policy independently selects versioned `busy_only`, generic `commitment`, `private_details`, or `shared_details` privacy. Provider payload and third-viewer tests prove exact title/description/location/conference/attendee/organizer/visibility/transparency/reminder disclosure. |
| CAL-012 | P0 | Per-policy event selection covers timed/all-day/free events, accepted/tentative/declined/unanswered RSVP, organizer-without-attendee, already-invited destination identity, `#nosync`, horizon, exclusions, and source deletion with deterministic documented outcomes. |
| CAL-013 | P0 | Managed copies have durable source-policy-destination provenance and idempotency. Duplicate/out-of-order notifications, cursor expiry, source edits/deletion, destination edits/deletion, retries, reciprocal policies, pause/detach/cleanup, disconnect/reconnect, backup/restore, and full resync converge without loops, duplicates, source mutation, or privacy escalation. |
| CAL-014 | P0 | One source calendar can feed multiple destinations using different hours/privacy/selection policies. Settings are stored on the directed policy—not globally on the source calendar—and each policy has independent revision, health, lag, pause, preview, audit, and cleanup state. |
| CAL-015 | P0 | A disposable live suite using personal-source, employer-destination, and ordinary-viewer Google identities proves create/update/move/resize/delete, recurrence, work-hours filtering, every privacy preset, no invitations/reminders, propagation latency, revoke/reconnect, and cleanup. |

## Assistant and automation

| ID | Pri | Requirement / acceptance test |
|---|---:|---|
| AI-001 | P2 | Core scheduling, sync, rules, analytics, and search work with no model configured and make no external model calls. |
| AI-002 | P2 | Natural language compiles to a documented typed command; UI displays parsed intent and proposed changes before execution. |
| AI-003 | P2 | Operators can select OpenAI-compatible, Anthropic-compatible, or local Ollama endpoints, limit which fields leave the instance, and disable storage. |
| AI-004 | P2 | Every model call audit records provider, model, purpose, fields disclosed by category, latency, token counts, and result—not secret keys or unredacted prompt by default. |
| AI-005 | P2 | Meeting agenda/task recommendations cite the events/tasks used and never add attendees, send messages, or write provider calendars without approval. |

## Identity, administration, and security

| ID | Pri | Requirement / acceptance test |
|---|---:|---|
| SEC-001 | P0 | Pod runs as non-root, drops all capabilities, uses RuntimeDefault seccomp, denies privilege escalation, has a read-only root filesystem, and passes restricted Pod Security admission. |
| SEC-002 | P0 | Authentication is mandatory outside explicit development mode. Single-user token is alpha-only; P1 supports OIDC and local recovery accounts. |
| SEC-003 | P1 | Organization roles include owner, admin, scheduler/delegate, member, analyst, and service account with least-privilege scopes. |
| SEC-004 | P0 | Provider/model secrets are envelope-encrypted with a rotatable external or Kubernetes-supplied master key and are never returned after creation. |
| SEC-005 | P1 | Audit is append-only, tamper-evident, filterable/exportable, retention-configurable, and includes login, config, provider, plan, apply, and data export/delete events. |
| SEC-006 | P1 | Account export and deletion complete within the operator-configured SLA and cover provider tokens, mirrors, analytics, assistant data, and backups. |
| SEC-007 | P0 | CSRF, SSRF, OAuth state/PKCE, webhook authenticity, rate limiting, content security policy, secure cookies, input bounds, and egress allowlists have automated negative tests. |
| SEC-008 | P2 | SAML/OIDC SSO, SCIM, policy-as-code, legal hold, data residency profiles, and audit sink export are available without a proprietary edition. |

## Native macOS edition

| ID | Pri | Requirement / acceptance test |
|---|---:|---|
| MAC-001 | P0 | Planipus for Mac is a native SwiftUI/AppKit application, not Electron, Catalyst, or a WebView shell. A user can complete connection, source/destination selection, hours, privacy, preview, activation, health, pause, detach, cleanup, and disconnect natively. |
| MAC-002 | P0 | Each Google identity is authorized directly by the Mac edition using the system browser, installed-app OAuth, state, and PKCE. Refresh credentials and the local database key are stored only in non-synchronizing Keychain items; short-lived access tokens remain in memory where practical. No distributed client secret is treated as confidential. |
| MAC-003 | P0 | The Mac edition has its own deterministic Swift policy engine, GRDB local store, encrypted-at-rest database, durable outbox, Google adapter, incremental cursors, and in-process scheduler. It has no Planipus Server URL, pairing flow, device session, remote Planipus API dependency, embedded web server, daemon, LaunchAgent, Server runtime, PostgreSQL, or Valkey. |
| MAC-004 | P0 | Synchronization performs no work while the application is quit, the Mac is asleep/powered off, or the network is unavailable. After wake/relaunch/reconnect, committed Google incremental cursors and reconciliation converge exactly once; HTTP 410 triggers a scoped full resync without duplicate or deletion storms. UI/help states this limitation and shows the real last-success time. |
| MAC-005 | P0 | Running online, the in-process coordinator polls Google incrementally with jitter/backoff, transactionally advances cursors, persists desired effects before provider writes, safely resolves ambiguous writes, and executes Sync Now without bypassing quota controls. A slower reconciliation detects missing/manually changed copies. |
| MAC-006 | P0 | The release app is sandboxed with outgoing-network and scoped-Keychain access. It has no Calendar/EventKit, Contacts, broad file, incoming-network, Apple Events, location, camera, microphone, privileged-helper, or APNs entitlement unless a later requirement/ADR explicitly adds one. The app container stores local data; explicit encrypted import/export uses user-selected file grants. |
| MAC-007 | P0 | A native menu-bar extra shows up-to-date/syncing/delayed/offline/action-needed/paused, actual last success, open-error, and Sync Now. Closing the main window may leave the menu-bar process running; choosing Quit stops sync. Material/destructive actions open the main preview flow. Optional notifications contain no event details. |
| MAC-008 | P0 | The full critical flow passes keyboard and VoiceOver tests plus light/dark, reduced motion, increased contrast, 200% zoom, multiple timezone, offline, stale, and identical-calendar-name scenarios. Direction and privacy never depend on color/arrow alone. |
| MAC-009 | P0 | Public Mac artifacts are Developer ID signed, hardened/sandboxed, notarized and stapled, distributed in a verified DMG with checksums, source tag, dependency/license manifest, and clean-VM install/upgrade/uninstall evidence. Updates are user-initiated by default. |
| MAC-010 | P0 | Planipus for Mac and Planipus Server are autonomous installations: no shared accounts, policies, credentials, state, backup, API, or takeover. Installing/revoking/deleting/versioning one cannot affect the other. A network test proves the Mac contacts providers but never a Planipus Server. |
| MAC-011 | P0 | A replaced Mac is presented as a new installation. Reconnection and optional encrypted backup restore scan destination provenance before creating effects; safely identifiable copies may be adopted, ambiguous copies require preview, and no recovery path blindly deletes or creates duplicates. Provider credentials are excluded from default portable export. |
| MAC-012 | P0 | The independent Swift implementation consumes the same language-neutral Calendar Sync conformance cases, reason codes, privacy preset versions, and disclosure manifests as the Server edition. Both suites must pass independently; no server API or storage compatibility substitutes for semantic proof. |

When P1 Protected Hours, availability fences, and Smart Meetings enter the Mac
edition, they use native Swift engines/storage/provider calls and Mac-specific
conformance fixtures. They never call, pair with, or depend on Planipus Server.
Until that implementation and live evidence exist, Mac UI, help, and releases
explicitly label those capabilities unavailable.

## Operations and open source

| ID | Pri | Requirement / acceptance test |
|---|---:|---|
| OPS-001 | P0 | A documented single-pod profile starts one StatefulSet replica containing API, scheduler, and worker containers from one Planipus image plus PostgreSQL on one RWO PVC, becomes ready within the measured published budget, and needs no SaaS dependency. API/web is the only externally served port. PostgreSQL is the durable job/outbox authority. |
| OPS-002 | P1 | External PostgreSQL scale profile supports rolling application upgrades, multiple API replicas, PostgreSQL worker leases/wake notifications, backup/restore, and zero duplicate provider writes during failover tests. An optional coordination/cache service requires a separate measured ADR and cannot own durable intent. |
| OPS-003 | P0 | Liveness, readiness, and Prometheus metrics endpoints exist under the documented API paths; logs are structured and redact configured secret/PII fields. |
| OPS-004 | P1 | ARM64 and AMD64 reproducible images publish with SBOM, provenance, signature, pinned base digest, and documented CVE response policy. |
| OPS-005 | P1 | Helm chart and Kustomize base configure ingress, solo sidecars or external persistence, secrets, network policy, resources, topology, backup, and restore without privileged pods. |
| OPS-006 | P0 | All shipped features are available under the selected OSI-approved Planipus license and have reviewed compatible third-party obligations; excluded donor material is absent. There are no open-core gates, phone-home activation, seat/entity caps, branding penalty, required billing, or required telemetry. |

## Explicit non-goals

- Replacing email/chat/project providers wholesale.
- Letting an LLM directly mutate calendars or bypass policy.
- Training a proprietary model on user calendar contents.
- Providing medical, payroll, or employee-surveillance conclusions from time data.
- Hiding team analytics at the individual level when aggregate data suffices.
