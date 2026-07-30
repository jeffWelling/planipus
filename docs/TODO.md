# Build backlog

Legend: `[ ]` pending, `[~]` implemented foundation but acceptance evidence is
incomplete, `[x]` complete, `[!]` release blocker.
Order work by the roadmap gates. Do not start live-provider mutation before its
credential, privacy, and duplicate-safety prerequisites pass.

The product scope is broad Reclaim-class orchestration, but the directed
calendar bridge remains the release-critical wedge. Protected Hours,
availability fences, Smart Meetings, no-copy conflict response, and API/MCP are active Server alpha work; they do
not turn an unfinished bridge into a release.

## E0 — correct the product boundary

- [x] Commit product name Planipus.
- [x] Define work-hours/privacy-controlled cross-account Calendar Sync as the
      release-critical P0 wedge, not the entire long-term product scope.
- [x] Add protected-hours availability fences and Smart Meetings to active
      Server scope; retain tasks/habits/focus/links/team breadth behind later
      gates.
- [x] Record the Reclaim version boundary: 1.0 may auto-move qualifying Smart
      Meetings; 2.0 is suggest-first for attendee-visible rescheduling.
- [x] Exclude Keeper from all implementation reuse; retain only behavior research.
- [x] Select clean-room composition from compatible OSS/platform components.
- [x] Define Planipus for Mac and Planipus Server as autonomous editions.
- [x] State that Mac synchronization stops during Quit/sleep/offline/power-off or
      after replacement and catches up only when it runs online again.
- [x] Reject server profiles, native-auth/device sessions, Mac↔server API/SSE,
      embedded Server runtime, and post-Quit background helpers.
- [x] Create `conformance/calendar-sync/v1/{schemas,cases,provider-payloads}`.
- [x] Define canonical JSON rules, fixture schema, reason-code registry,
      disclosure manifest, privacy preset versions, and change-control policy.
- [x] Port at least 50 Calendar Sync cases from the contract/research into
      provider-neutral fixtures.
- [x] Add TypeScript and Swift fixture runners in CI. Both execute all 91 cases
      and share the canonical SHA-256 test vector.
- [x] Label every requirement common, Mac-only, Server-only, or future.
- [x] Add separate Mac/Server threat models and release evidence templates.
- [~] Add contributor provenance attestation, license/SBOM policy scan and
      excluded-donor search gate.
- [x] Add lint/search gate for rejected terms and claims in active docs/code:
      `native-auth`, `server profile`, “continues while the Mac”, device session.

## S0 — clean-room Server foundation

- [x] Select Apache-2.0 plus DCO for implementation.
- [!] Obtain compatibility/legal-release review before accepting external
      implementation contributions or public distribution.
- [x] Create original TypeScript workspace and pin runtime/toolchain.
- [x] Select HTTP/schema, PostgreSQL/migration, auth and React UI foundations;
      use a PostgreSQL outbox/job queue and defer Valkey through ADR-003.
- [!] Classify selected production dependencies; eliminate every reachable
      critical/high issue or document a time-bounded, reviewed non-reachability.
- [~] Replace plaintext Google token columns with versioned authenticated
      encryption; test migration, rollback, rotation, rewrap, restore and logs.
- [x] Implement no analytics, billing, subscription limits, license checks,
      upgrade nags, hosted-service defaults, or undocumented egress.
- [~] Fix existing test warnings/open handles and establish quarantine policy.
- [~] Add fake-clock, fake-provider, PostgreSQL and network-fault harnesses.

## S1 — Server Google policy behavior

- [x] Add policy/hours/exception/privacy/projection/outbox/cursor/audit migrations.
- [x] Create original policy schema with safe-redacted activation defaults.
- [x] Implement deterministic hours interval evaluator and DST corpus.
- [x] Compile versioned privacy presets to exact Google payload/disclosure.
- [x] Move transformations from source calendar to directed policy.
- [x] Implement RSVP/all-day/free/type/`#nosync`/already-invited selection.
- [~] Add loop/provenance and destination manual-edit/detach/cleanup behavior.
- [x] Make cursor page and observations transactional; durable effects/outbox.
- [x] Add conditional effects and post-timeout read-before-retry.
- [~] Add Google watch renewal/recovery plus polling safety reconciliation.
- [~] Build web connection, identity, policy, preview, activation, health, pause,
      detach, cleanup, disconnect and error-recovery flows.
- [ ] Add complete Fastify request/response schemas, generated OpenAPI examples,
      contract drift tests, API idempotency keys and public-resource ETags.
- [!] Run two-account live Google create/update/move/recurrence/delete suite.
- [!] Verify each privacy preset from an ordinary third-viewer identity.

## S1C — Server API/MCP and no-copy conflict-response alpha

- [x] Add migration 0006 and a dedicated machine credential with one-time
      plaintext, digest-only storage, `read|propose|apply`, mandatory bounded
      expiry, revocation/last-use, active membership, tenant binding and audit.
- [x] Keep token issue/list/revoke owner-browser-only with exact Origin/CSRF;
      accept bearer only on the documented read/propose/apply routes and reject
      mixed cookie+bearer credentials.
- [x] Add official SDK 1.29.0 stdio MCP workspace with strict config/schemas,
      fixed-origin bounded API client, safe errors, static resources, complete
      read/propose tools, and opt-in apply tools including
      `activate_sync_policy`. No DB/provider/OAuth import or remote HTTP transport.
- [x] Add Google/fake provider free/busy and exact self-attendee decline ports,
      conditional revision, configured comment, quiet-update request,
      idempotent exact result and ambiguous-write verification.
- [x] Add strict-private Google `availability` role with CalendarList/free-busy
      only and exclude it from event sync. Require visible reauthorization for
      old source/both connections that lack free-busy. Reject any returned
      broader Calendar grant as `oauth_scope_overbroad`, requiring Google-side
      revoke/reconnect; reject an omitted returned set as
      `oauth_scope_unverified`; serialize first-connect/reauthorization by subject.
- [x] Add conflict preview/rule/action schema, strict bounded draft, time-only
      preview, stale-bound activation, durable reconcile/apply, fresh exact-
      interval free/busy, and exact invitation eligibility/revision recheck.
- [x] Fail closed for organizer, accepted, tentative, cancelled, missing/unknown
      self, all-day, started, changed and no-longer-conflicting events. A pending
      action already declined at exact initial GET is applied without PATCH,
      budgeted, and warned when its comment differs. Never auto-accept/undo on
      pause/removal.
- [x] Protect every selected private availability calendar from active bridges
      as either endpoint and reject inbound copies even from paused bridges.
      Conflict and bridge mutations use stable side-specific errors and shared
      tenant/calendar advisory locks over all endpoints. An outbound bridge may
      pause first, but its existing managed copies remain disclosed.
- [x] Persist canonical sync-policy and protected-availability provider-calendar
      identities. Treat Google calendar IDs as global across aliases, reject
      alias self-copy/duplicate selection, close alias no-copy races, and
      quarantine/audit historical self-copy work while preserving copies.
- [x] Add domain-separated private-availability HMACs, indexed 15-minute-fresh/
      5,000-row-bounded invitation candidates, one durable response-provider
      controller, a historical 20-per-24-hour budget counted from immutable
      verified-decline audit facts, and idempotent rule retire through API/MCP.
- [x] Treat a provider-verified RSVP decline with an unretained comment as
      applied-with-warning `decline_comment_not_retained`; consume budget and do
      not retry a confirmed decline merely to chase comment persistence. Treat
      Google write 5xx/response-read failure as ambiguous and exact-GET verify.
- [x] Make event-content `readable` distinct from
      `capabilities.freebusy_readable`; implement atomic source/both → no-event-
      read reauthorization that blocks dependencies, purges observations/cursors,
      retires subscriptions/jobs, restricts endpoints, audits counts, and closes
      the in-flight sync finalization race.
- [x] Enqueue conflict-rule reconciliation immediately after successful work
      response-calendar sync; retain the 15-minute scheduler as safety fallback.
- [x] Add Server Private replies and Settings/API-token/MCP surfaces with zero-
      copy and provider-delivery caveats. Prefer the `availability` role and
      warn truthfully when source/both has broader persisted bridge data.
- [x] Keep Google invitation responses disabled by default behind
      `PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE=false`; fake provider may
      exercise simulated response logic. Expose separate write/message state and
      refuse Google activation while the write gate is off.
- [x] Add single-process per-actor API windows (read 600/minute, apply
      120/minute, propose 30/10 minutes), safe 429/`Retry-After`, MCP error
      allowlisting, and a 10-live-conflict-preview/principal database preflight.
- [x] Set the MCP API deadline to 300 seconds for bounded provider fan-out and
      distinguish retryable read timeout from unknown-outcome POST/DELETE,
      requiring state inspection before mutation retry.
- [~] Focused MCP/API/engine/provider/OAuth/config/migration tests exist, and the
      opt-in PostgreSQL suite now covers 0001–0014, conflict preview/activate/
      apply, canonical alias rejection/no-copy checks, and an alias-aware bridge-
      versus-protected-calendar activation race. Run and record the post-edit
      consolidated gate, a seeded 0013→0014 quarantine upgrade, then add
      scheduler/worker fault/restore lifecycle; do not inherit earlier counts.
- [!] Inspect SQL, jobs, audit, logs, metrics, API/MCP and backup for forbidden
      personal event identity/content. Prove availability-only connections are
      never event-synced.
- [!] Run disposable Google organizer/work-attendee/personal/observer matrix for
      comment visibility, actual mail/calendar notifications with
      `sendUpdates=none`, recurring instances, concurrent RSVP/time changes,
      ambiguity, preconditions, quota/auth, pause/restore and cleanup.
- [ ] Add complete conflict-rule edit/retention/export, held-action repair,
      privacy-safe health/metrics/alerts and restore/token-rotation runbook drills.
- [ ] Add real-PostgreSQL role-downgrade coverage for every live/historical
      dependency, exact purge/audit counts, and in-flight sync races. Until a
      previewed historical projection/action purge exists, keep
      `availability_role_change_blocked` fail closed and recommend a distinct
      dedicated availability account.
- [ ] Run live Google old-grant revocation, availability-only reconnect, returned-
      scope inspection, and downgrade/purge proof. Unit scope rejection is not
      evidence that Google actually removed the broader grant.
- [ ] Add a previewed, audited bridge cleanup/retirement flow that can detach or
      remove older owned copies and projections after pausing. No-copy setup may
      proceed after pause today, but must disclose that existing copies remain.
- [x] Lease one scheduled job and one outbox effect per worker loop; renew the
      scheduled job every lease/3 plus immediately before terminal transition;
      leave state to the current owner and keep serving after lease loss.
- [ ] Move conflict activation free/busy and coordinator provider I/O outside
      open row/advisory-lock transactions; prove bounded lock duration, worker
      shutdown, retry, ambiguity recovery, and convergence when an uncancellable
      in-flight provider call outlives lease ownership.
- [ ] Add versioned/multi-key verification for private HMAC bases and an
      automated rotation workflow. Until then, expire previews and supersede/
      recompute pending/held actions under a writes-disabled maintenance window.
- [ ] Consider a narrower machine scope for conflict preview. Current `propose`
      can contact providers and infer private busy/work-invitation time overlaps,
      so it is not a low-sensitivity read-only capability.
- [ ] Replace process-local actor counters with a shared persistent limiter and
      make the 10-live-preview cap concurrency-hard. Test restart/replica/
      credential bypass, bounded key cardinality, read/apply windows, and add
      planning/public-specific abuse controls before Internet production.
- [ ] Exercise the stdio adapter against a real packaged Server from supported
      MCP hosts; add current online vulnerability evidence and track the accepted
      stdio-unreachable Hono moderate advisory until the SDK graph is fixed.
- [ ] If remote Streamable HTTP is desired, write a new auth/resource-server/
      deployment/security ADR first; do not proxy the stdio process.
- [ ] Keep every part Server-only. A Mac version needs separate native product,
      security, provider, lifecycle and release acceptance.

## S1P — Server Protected Hours and Smart Meetings alpha

- [x] Add PostgreSQL tables/types for planning rules, expiring previews,
      durable planned events, provenance generations, suggestions and audit.
- [x] Validate bounded availability-boundary and Smart Meeting rule documents,
      including timezone, days/windows, duration, attendee, priority, conflict
      policy, lock-window and horizon limits.
- [x] Reuse the deterministic Hours materializer for DST-aware fence intervals
      and Smart Meeting candidate windows.
- [x] Preview and activate private Busy fences before/after work and on closed
      days; generated effects have no attendees or reminders.
- [x] Preview Smart Meeting occurrences inside Meeting Hours, avoid selected
      Busy observations and past slots, prefer configured time/duration, return
      explicit unmet occurrences, and warn when required-attendee availability
      is unknown.
- [x] Require every selected availability calendar to have a `ready` cursor with
      a success no older than 30 minutes; include other active Smart Meeting
      planned events as Busy and exclude same-rule observed events by marker.
- [x] Persist owned planned events and use durable jobs plus provider-specific
      planning markers for create/update/delete, pause/resume and replan. Resume
      re-enqueues pending writes and intent-sequence checks suppress stale jobs.
- [x] Add Protect and Meet Server screens and report bridge/protection/meeting
      capabilities honestly as `alpha`.
- [x] Default Smart Meeting conflicts to Reclaim 2.0-style `suggest`; list
      expiring move/skip suggestions with current/proposed times and provide
      accept/dismiss actions. Accepted skips queue owned-event cancellation.
- [!] Add complete at-click rule/provider/availability/lock basis revalidation,
      stale suggestion rejection/recompute, notification consequence detail,
      and choose-another-time.
- [~] Keep explicit Reclaim 1.0-style `auto_move` and
      `keep_with_warning` policies technically represented, but do not call
      automatic movement safe or complete until notification/concurrency tests.
- [x] Enforce the configured 24-hour no-move window for existing occurrences.
- [ ] Enforce P1–P4 priority or remove it from effective controls and output.
- [ ] Replace per-rule copied hours with versioned reusable Working, Meeting,
      Personal, Custom, and one-off Hours, including multiple ranges and dated
      exceptions.
- [ ] Live-prove that the ready-cursor gate represents a complete availability
      horizon; implement authorized external-attendee free/busy/calendar mapping
      without reading titles when free/busy suffices. Remove current “mutual” UI
      copy whenever a required attendee is not represented.
- [x] Remove a planning rule through an explicit UI confirmation, expire its
      suggestions, and queue deletion of every marker-owned event. Pause remains
      distinct and leaves current provider events intact.
- [ ] Add planning rule edit/detach and a full removal impact preview; current
      removal uses a count-free confirmation.
- [ ] Add bounded planned-event drift verification, manual edit/delete recovery,
      timeout ambiguity recovery, marker mismatch action-needed flow, restore,
      and disconnect/reconnect convergence.
- [ ] Decide provider recurrence-master/exception semantics; current independent
      materialized events must remain labeled alpha rather than full recurrence
      parity.
- [x] Keep Google planning writes disabled by default behind
      `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`; fake-provider planning stays
      writable for credential-free tests.
- [!] Expose the Google planning-write gate through capabilities and Protect/Meet
      UI. When disabled, do not imply that activation created provider events;
      show pending local intent and operator guidance instead.
- [~] The real-PostgreSQL/compiled-browser/worker fake-provider flow now passes:
      15 fence blocks and five Smart Meetings converged while an elapsed-window
      occurrence stayed explicitly unmet. Still run live Google fence and Smart
      Meeting suites covering ordinary-viewer privacy, zero fence mail,
      invitations/updates, external attendees, RSVP, suggestions, explicit
      auto-move, pause/replan, DST, quota and failure recovery.
- [ ] Complete Protect/Meet keyboard, screen-reader, high-zoom, responsive,
      timezone, loading/offline/rate-limit/action-needed and destructive states.
- [ ] Decide when to implement these features independently on Mac under
      the native P1 planning acceptance; until then, keep them absent and never
      proxy to Server.

## S2 — Server Kubernetes release

- [~] Build API/scheduler/worker commands for one non-root multi-architecture
      image; commands/build metadata exist, but no image artifact is proven.
- [~] Package solo StatefulSet with API/scheduler/worker/Postgres containers and
      one RWO PVC; expose only API/web.
- [~] Package standard profile with external Postgres, same features.
- [~] Add startup/migration/ready/live/drain contracts and resource budgets.
- [~] Add NetworkPolicy, secret mounts, TLS/OAuth callback and private-cluster
      polling documentation.
- [~] Add redacted structured logs and protected metrics; dashboards/alerts remain.
- [~] Implement backup, restore, upgrade, rollback and reconciliation runbooks.
- [!] Prove restore/upgrade after queued/in-flight work creates no duplicates.
- [ ] Produce signed images, SBOM, provenance, checksums, chart/manifests, source
      tag and complete third-party notices.
- [ ] Complete 30-day Server dogfood and disaster-recovery drill.

## M0 — Mac native foundation

- [~] Create the native SwiftUI/AppKit package and modules:
      App/Core/Google/Store/Secrets/Sync/Design. Xcode app-bundle generation,
      sandbox entitlements and signed packaging remain M2 release work.
- [x] Pin Swift/Xcode/macOS support matrix and CI runners.
- [~] Audit and exactly pin the SQLCipher-managed GRDB 7.11.1 and SQLCipher.swift
      4.17.0 packages; linkage, encryption, migrations and notices are proven,
      while performance, signing/notarization and clean-VM evidence remain.
- [~] Create a random database key in non-synchronizing, device-bound Keychain;
      missing/wrong-key failure is proven, while rotation, interrupted rekey,
      reinstall, recovery escrow and coordinated reset remain.
- [~] Implement five versioned transactional migrations for accounts, bridge
      policy/hours, installation identity, observations/projections, cursors,
      staged pages and outbox. Native audit/health persistence remains.
- [x] Implement Google installed-app OAuth through system browser with state,
      PKCE, exact redirect, per-account Keychain token, revoke and redaction.
- [~] Prove two independently labeled Google identities with identical calendar
      names cannot be confused.
- [~] Implement direct Google full/incremental reads and cursor page transaction.
- [~] Implement HTTP 410 scoped full-resync without blind destination cleanup.
- [~] Implement actor-isolated polling with jitter, quota/backoff, reachability
      hints, cancellation and slower safety reconciliation.
- [~] Implement desired effects and managed identity/fingerprint replay on the
      encrypted production store; live-provider crash-window proof remains.
- [!] Inject crash after provider write/before local commit; prove no duplicate.
- [!] Test sleep/wake, offline/reconnect and Quit/relaunch catch-up exactly once.
- [ ] Set and enforce idle/running CPU, energy, memory and Google quota budgets.
- [ ] Inspect network/process/binary: no Planipus Server traffic, inbound listener,
      Server runtime, Postgres, Valkey, daemon, LaunchAgent, or privileged helper.

## M1 — Mac complete Google experience

- [x] Implement `PlanipusCore` pure policy evaluator against every shared fixture.
- [x] Build native onboarding explaining local-only operation and uptime limit.
- [~] Build explicit source/destination/both account roles, pre-consent
      least-privilege scopes, account-explicit bridge pairing and reconnect
      validation; calendar discovery beyond `primary` remains.
- [~] Build direction, hours, exception, selection and privacy editor.
- [~] Preview candidate count, changes, exclusions, exact disclosed fields and
      destructive cleanup before activation/material edit.
- [~] Build active policy health, last-success timestamp, retry, pause, detach,
      cleanup, disconnect and OAuth recovery.
- [x] Add MenuBarExtra states, Sync Now and unambiguous Quit.
- [~] Ensure closing the main window leaves sync running only when menu-bar app
      remains running; verify Quit fully stops it.
- [ ] Add optional local notifications with no titles/details/location/attendees.
- [ ] Add keyboard, VoiceOver, light/dark, contrast, reduced-motion and zoom tests.
- [ ] Add timezone/DST/clock-change, offline/stale and identical-name UI tests.
- [!] Run personal→work live Google end-to-end while app runs.
- [!] Demonstrate an event created during Quit stays unsynced until relaunch,
      then converges once and shows an honest last-sync time.
- [!] Verify privacy presets from ordinary third-viewer account.

## M2 — Mac recovery and distribution

- [ ] Specify encrypted backup container, schema version, KDF, checksum,
      portability and credential exclusion; security-review before implementation.
- [ ] Implement explicit user-selected export/import; never silently cloud-sync.
- [ ] Implement new-install/replacement flow with account reconnect and
      destination provenance scan.
- [!] Adopt only unambiguous managed copies; preview ambiguity; prove no duplicate
      or deletion storm with lost local state.
- [ ] Test corrupt database, missing Keychain key/token, revoked OAuth, partial
      restore, interrupted migration and unsupported-newer backup.
- [ ] Document uninstall and residual Keychain/database cleanup.
- [ ] Implement one explicit, coordinated reset workflow for the SQLCipher file,
      database key and OAuth items; never generate a replacement key over an
      existing unreadable database.
- [ ] Lock App Sandbox entitlements: outgoing network, app container, scoped
      Keychain and explicit user-selected import/export only.
- [ ] Developer ID sign, hardened-runtime validate, notarize and staple.
- [ ] Build DMG; publish checksum, SBOM/licenses, source tag and update policy.
- [ ] Clean-VM install/upgrade/uninstall and current/previous-two-macOS test.
- [ ] Complete 30-day local dogfood with sleep/offline/Quit/crash/revoke/DST gaps.

## E1 — independent release audit

- [!] Complete the requested read-only Claude Code Opus review. The local client
      is logged out and external-gateway transfer was blocked by workspace
      privacy policy; follow the safe continuation record under `docs/evidence`.
- [ ] Capture Swift and TypeScript conformance results from exact release commits.
- [ ] Capture separate two-account and third-viewer evidence for each edition.
- [ ] Install both editions with different accounts; prove no discovery/state/
      revoke/delete/version effect crosses the boundary.
- [ ] Audit all UI/help/site copy for honest Mac uptime and edition independence.
- [ ] Complete security review, license/notice review, SBOM and known limitations.

## Broad parity after the release-critical wedge

- [ ] Outlook parity, independently gated per edition.
- [ ] CalDAV parity, independently gated per edition/server matrix.
- [ ] Server public API/webhooks/CLI and complete native JSON/ICS export.
- [ ] Buffers plus individual/team/round-robin Scheduling Links on the shared
      Hours, priority, preview and ownership substrate.
- [ ] Tasks, habits and Focus goals with deterministic planning and explicit
      lock/defense semantics.
- [ ] Meeting Quality, teams, privacy-preserving analytics and assistants via
      new ADRs; none may become required for deterministic Calendar Sync.
