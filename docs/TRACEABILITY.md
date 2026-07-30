# Requirement traceability

This matrix prevents “documented somewhere” from becoming “implemented.” Status
values: specified, implemented, verified, deferred. Everything is currently
**specified** unless marked otherwise after executable evidence. Source of truth
for wording/priority is `REQUIREMENTS.md`.

| ID | Design owner docs | Roadmap | Primary verification |
|---|---|---|---|
| SCH-001 | SOLVER, DATA-MODEL, TESTING | post-sync (alpha slice exists) | interval/property corpus: no hard overlap |
| SCH-002 | SOLVER, TESTING | post-sync (alpha slice exists) | deterministic canonical golden/property |
| SCH-003 | DATA-MODEL, API, UX-SPEC | post-sync | domain/API CRUD + validation tables |
| SCH-004 | ARCHITECTURE, API, UX-SPEC, TESTING | post-sync (alpha slice exists) | plan golden/API/browser trust scenario |
| SCH-005 | ARCHITECTURE, API, SOLVER, TESTING | post-sync (alpha slice exists) | stale revision, idempotency, partial fault injection |
| SCH-006 | DATA-MODEL, SOLVER | post-sync | generated chunk sum/gap/dependency properties |
| SCH-007 | DATA-MODEL, SOLVER, INTEGRATIONS, TESTING | post-sync (alpha independent occurrences) | RFC recurrence fixture/property corpus |
| SCH-008 | DATA-MODEL, SOLVER, UX-SPEC | post-sync | defense transition policy/state tests |
| SCH-009 | SOLVER, SECURITY | post-sync | multi-person fairness bound properties |
| SCH-010 | SOLVER, OPERATIONS | post-sync | 500-user/50k/12-week reference benchmark |
| WRK-001 | DATA-MODEL, API, UX-SPEC | post-sync | lifecycle state machine/API/audit tests |
| WRK-002 | DATA-MODEL, UX-SPEC | post-sync | project/dependency/view acceptance suite |
| WRK-003 | DATA-MODEL, SOLVER, UX-SPEC | post-sync | recurrence/materialization/scheduling tests |
| WRK-004 | DATA-MODEL, SOLVER, UX-SPEC | post-sync | proactive/reactive goal scenarios |
| WRK-005 | DATA-MODEL, UX-SPEC, INTEGRATIONS | post-sync | timer/session/interruption/adapter hooks |
| WRK-006 | UX-SPEC | post-sync | keyboard/browser ritual flows |
| WRK-007 | DATA-MODEL, UX-SPEC, SECURITY | post-sync | capacity rollup/privacy/API/browser |
| MTG-001 | DATA-MODEL, SOLVER, UX-SPEC, TESTING | post-sync (alpha slice exists) | smart-series recurrence/constraint scenarios |
| MTG-002 | SOLVER, INTEGRATIONS, TESTING | post-sync (alpha slice exists) | RSVP/conflict/series provider fixtures |
| MTG-003 | DATA-MODEL, API, UX-SPEC | post-sync | public lifecycle/e2e/accessibility |
| MTG-004 | DATA-MODEL, SOLVER | post-sync | routing/fairness/atomic concurrency tests |
| MTG-005 | SOLVER, API, UX-SPEC | post-sync | booking displacement preview policy tests |
| MTG-006 | DATA-MODEL, API, INTEGRATIONS | post-sync | workflow idempotency/replay/fault tests |
| MTG-007 | DATA-MODEL, SECURITY, UX-SPEC | post-sync | privacy-safe rule fixtures/browser |
| NCR-001 | CONFLICT-RESPONSE-AND-MCP, API, UX-SPEC | S1C | strict draft/calendar capability API and browser tests |
| NCR-002 | CONFLICT-RESPONSE-AND-MCP, INTEGRATIONS, SECURITY | S1C | OAuth scope golden + no-event-sync/database inspection + live consent |
| NCR-003 | CONFLICT-RESPONSE-AND-MCP, API, DATA-MODEL | S1C | preview no-write/expiry/one-use/stale/privacy tests |
| NCR-004 | CONFLICT-RESPONSE-AND-MCP, TESTING | S1C | eligibility decision table plus concurrent provider exact-read cases |
| NCR-005 | CONFLICT-RESPONSE-AND-MCP, ARCHITECTURE, TEST-STRATEGY | S1C | real-PostgreSQL coordinator fault/idempotency/concurrency suite |
| NCR-006 | CONFLICT-RESPONSE-AND-MCP, SECURITY, DATA-MODEL | S1C | SQL/job/audit/log/metric/API/MCP/backup forbidden-data inspection |
| NCR-007 | CONFLICT-RESPONSE-AND-MCP, API, UX-SPEC, OPERATIONS | S1C | actor/tenant/pause/resume/reconcile/restore lifecycle suite |
| NCR-008 | CONFLICT-RESPONSE-AND-MCP, INTEGRATIONS, TESTING | S1C release gate | disposable Google comment/mail/recurrence/concurrency evidence |
| CAL-001 | INTEGRATIONS, OPERATIONS | M5 | named provider fixture + disposable live suite |
| CAL-002 | DATA-MODEL, INTEGRATIONS | M1/M5 | recurrence/attendee/timezone round-trip fixtures |
| CAL-003 | ARCHITECTURE, INTEGRATIONS | M1/M5 | dropped/out-of-order/cursor fault injection |
| CAL-004 | DATA-MODEL, INTEGRATIONS | M1 | privacy transform/recursion/convergence tests |
| CAL-005 | INTEGRATIONS | post-sync adapters | per-adapter mapping/conflict contract |
| CAL-006 | DATA-MODEL, INTEGRATIONS, OPERATIONS | M5 | import dry run/round-trip/export/restore |
| CAL-007 | API, SECURITY, CONFLICT-RESPONSE-AND-MCP | S1C/M5 | token lifecycle/scope/tenant matrix + OpenAPI diff + UI command mapping |
| CAL-008 | API, SECURITY, CONFLICT-RESPONSE-AND-MCP | S1C/M5 | MCP API-only boundary/tool-resource map/default-no-apply/injection tests |
| CAL-009 | CALENDAR-SYNC, DATA-MODEL, INTEGRATIONS, API, UX-SPEC | M1 | two-account policy preview/activation and automatic source-change convergence |
| CAL-010 | CALENDAR-SYNC, DATA-MODEL, INTEGRATIONS | M1 | hours interval property/golden suite plus DST and live Google cases |
| CAL-011 | CALENDAR-SYNC, INTEGRATIONS, SECURITY, UX-SPEC | M1 | provider payload goldens and third-viewer disclosure suite |
| CAL-012 | CALENDAR-SYNC, INTEGRATIONS, DATA-MODEL | M1 | all-day/free/RSVP/override/invite decision tables and live fixtures |
| CAL-013 | CALENDAR-SYNC, ARCHITECTURE, DATA-MODEL, OPERATIONS | M1 | fault/retry/loop/reconnect/restore convergence suite |
| CAL-014 | CALENDAR-SYNC, DATA-MODEL, API, UX-SPEC | M1 | one-source/multi-policy independent behavior and migration tests |
| CAL-015 | CALENDAR-SYNC, INTEGRATIONS, TEST-STRATEGY | M1 | three-identity disposable Google end-to-end gate |
| AI-001 | ARCHITECTURE, SOLVER, INTEGRATIONS | post-sync | full model-off CI/e2e and egress observation |
| AI-002 | API, INTEGRATIONS, UX-SPEC | post-sync | typed parser ambiguity/preview browser |
| AI-003 | INTEGRATIONS, SECURITY, OPERATIONS | post-sync | provider config/redaction/disable suites |
| AI-004 | DATA-MODEL, SECURITY | post-sync | audit category/redaction/budget tests |
| AI-005 | API, SECURITY, UX-SPEC | post-sync | citation/authorization/injection scenarios |
| SEC-001 | OPERATIONS, SECURITY | M2 | restricted pod admission/runtime inspection |
| SEC-002 | API, SECURITY | M0 | auth mandatory/session/recovery tests |
| SEC-003 | DATA-MODEL, API, SECURITY | M5 | role/delegation/tenant policy matrix |
| SEC-004 | DATA-MODEL, SECURITY, OPERATIONS | G0/M2 | encryption/rotation/log/export tests |
| SEC-005 | DATA-MODEL, API, SECURITY | M1/M5 | append/hash/export/retention/tamper tests |
| SEC-006 | DATA-MODEL, API, SECURITY | M5/1.0 | timed export/deletion/provider cleanup drill |
| SEC-007 | API, INTEGRATIONS, SECURITY | all/1.0 | negative security suites and penetration test |
| SEC-008 | DATA-MODEL, SECURITY, INTEGRATIONS | post-1.0 | conformance/security/edition audit |
| SEC-009 | SECURITY, CONFLICT-RESPONSE-AND-MCP, REUSE-MAP | S1C | machine-secret/threat/privacy/provider/supply-chain release matrix |
| MAC-001 | MACOS-AND-KUBERNETES, UX-SPEC | M0/M1 | native critical-flow UI tests and WebView/runtime inspection |
| MAC-002 | MACOS-AND-KUBERNETES, SECURITY, INTEGRATIONS | M0/M1 | installed-app OAuth state/PKCE/Keychain and secret-leak suite |
| MAC-003 | MACOS-AND-KUBERNETES, ARCHITECTURE, DATA-MODEL | M0 | binary/process/network inspection plus local-store/outbox tests |
| MAC-004 | MACOS-AND-KUBERNETES, ARCHITECTURE, TEST-STRATEGY | M0/M1/M2 | quit/sleep/offline/wake/relaunch/410 exact-once E2E |
| MAC-005 | MACOS-AND-KUBERNETES, TEST-STRATEGY | M0/M1 | polling/cursor/transaction/ambiguous-write/reconcile integration tests |
| MAC-006 | MACOS-AND-KUBERNETES, SECURITY | M0/M2 | codesign entitlement inspection, sandbox and encrypted import/export tests |
| MAC-007 | MACOS-AND-KUBERNETES, UX-SPEC | M1 | menu-bar/Quit/status/timestamp/notification privacy UI tests |
| MAC-008 | MACOS-AND-KUBERNETES, UX-SPEC, TEST-STRATEGY | M1/M2 | VoiceOver/keyboard/appearance/timezone/offline matrix |
| MAC-009 | MACOS-AND-KUBERNETES, TEST-STRATEGY | M2 | sign/notarize/staple/DMG/clean-VM release evidence |
| MAC-010 | MACOS-AND-KUBERNETES, SECURITY, DATA-MODEL | E0/M2 | independence network/state/revoke/version suite |
| MAC-011 | MACOS-AND-KUBERNETES, DATA-MODEL, TEST-STRATEGY | M2 | new-install/backup/reconnect/adopt/ambiguity/no-duplicate recovery suite |
| MAC-012 | MACOS-AND-KUBERNETES, CALENDAR-SYNC, TEST-STRATEGY | E0/all | identical canonical fixtures pass in Swift and TypeScript |
| OPS-001 | ARCHITECTURE, OPERATIONS | M2 | clean one-pod startup/no-egress/restore |
| OPS-002 | ARCHITECTURE, OPERATIONS | post-1.0 | failover/lease/rolling/duplicate-write chaos |
| OPS-003 | ARCHITECTURE, OPERATIONS | M2 | probe/metric/log redaction tests |
| OPS-004 | OPERATIONS, TEST-STRATEGY | M2/1.0 | reproducibility/SBOM/provenance/signature |
| OPS-005 | OPERATIONS | M2/M5 | render/admission/install/upgrade/restore |
| OPS-006 | ADOPT-OR-BUILD, REUSE-MAP, OPERATIONS | G0/1.0 | license/source/capability-gate/egress audit |
| OPS-007 | OPERATIONS, CONFLICT-RESPONSE-AND-MCP, TESTING | S1C/S2 | token/MCP/reauth/conflict/restore/incident runbook drills |

## Alpha planning evidence map (2026-07-21)

This map records partial implementation evidence without changing any
requirement to verified. Migration 0004, `server/src/planning`, the planning API
routes, scheduler/worker dispatch, and provider planning methods form one narrow
Server alpha slice. `TESTING.md` identifies the executable cases and missing
gates.

| Requirement | Present artifact/evidence | Why the requirement is not verified |
|---|---|---|
| SCH-001 | Pure engine excludes pooled timed/all-day busy intervals and already selected occurrences; same-rule marker observations are excluded; example tests cover one mutual opening and one fully busy window; coordinator holds changed future events inside the no-move window | No 10,000-schedule property corpus or complete immutable/selected-busy model; priority is ignored, already-started events are not locked, and unselected-calendar desired events can be pooled |
| SCH-002 | Repeated identical Smart Meeting input is equal in one unit test; engine ordering/tie-breaks are deterministic for supplied arrays | No canonical byte-level plan/explanation format, engine/config/tzdb version, broad property corpus, or proof that database snapshot ordering is stable |
| SCH-004 | Preview returns occurrences, scheduled/unmet counts, warnings, and a short hours summary before external writes | No operation diff, move/delete details, alternatives/rejected candidates, soft violations, capacity shortfall, score, or per-change explanation graph |
| SCH-005 | Preview activation compares the input snapshot then recomputes the result; planned/provider state carries generation and intent sequence, jobs are durable, and provider methods use deterministic IDs/ETags | No full stale-revision protocol or real-PostgreSQL coordinator fault suite; stored result is not compared, snapshot omits evaluation instant, unordered calendar rows can false-conflict, provider I/O holds DB locks, and deleting/ownership holds lack convergence proof |
| SCH-007 | Smart Meeting cadence materializes bounded independent occurrence keys and rolls the effective start by complete cycles | This is not RFC 5545 recurrence, a provider series, custom cadence/override support, or completed-history-safe behavior; current stale cleanup can delete ended occurrences |
| MTG-001 | Parser accepts bounded required/optional attendees, cadence, preferred time, min/max duration, meeting window, P1–P4 value, timezone, selected calendars, lock value and conflict policy; coordinator enforces a future-event no-move window | Priority is not effective; suggest semantics after lock expiry, per-attendee availability, smart series, RSVP behavior, and UI proof for unsupported controls are absent |
| MTG-002 | Engine selects closest feasible pooled opening, tries maximum-to-minimum configured duration, reports unmet instead of leaving meeting hours, and warns on unknown required-attendee availability; suggestions can be listed/accepted/dismissed with at-click basis/availability revalidation | No rejected-candidate explanation beyond a count; “mutual” is not proven per attendee; no RSVP/series/provider lifecycle fixtures; only fixture-level provider evidence |
| SEC-002/SEC-007 | Planning routes use the existing session, exact-origin, and CSRF boundary; parser bounds known fields | No planning-specific rate limit, strict unknown-field rejection, malformed-ID negative suite, invite-abuse control, or live privacy/recipient evidence |
| SEC-003 | Planning rows and queries carry organization scope | Current rule listing/lifecycle management is not owner/delegate scoped; owner membership is not a database invariant; only the single-owner profile is supportable |
| OPS-001 | API, scheduler, and worker serve planning through PostgreSQL jobs in the existing one-pod process model | No planning backup/restore/upgrade drill, load/lock measurement, or alpha Kubernetes acceptance evidence |
| OPS-003 | General process/API health and aggregate job telemetry exist | Planning rule/event/suggestion lag, held/pending state, verification, and notification metrics are absent |

Provider serializer and fake-adapter tests prove that Availability Boundary and
calendar bridge events omit attendees/reminders while Smart Meeting serialization
can include attendees with separate ownership markers. They do not prove live
Google invitation, cancellation, privacy, RSVP, retry, or third-viewer behavior.

The clean-room boundary is invariant across this evidence: Keeper and other
AGPL-licensed implementation material are prohibited as source, schema, fixture,
test oracle, dependency, translation target, or donor code. Behavioral research
does not count as implementation evidence.

## API/MCP/no-copy evidence map (2026-07-21)

This is partial implementation evidence, not verification. Exact commands and
open gates live in
`evidence/2026-07-21-mcp-api-conflict-response.md` and `TESTING.md`.

| Requirement | Present artifact/evidence | Why the requirement is not verified |
|---|---|---|
| CAL-007 | Migration 0006, token service, owner-only settings/API routes, bearer actor boundary; provider-contact sensitivity docs; process-local read/apply/propose windows, 10-live-preview preflight, safe 429 and focused propose-limit API test | No complete OpenAPI schemas/compatibility, real-PostgreSQL token/preview lifetime/concurrency, shared persistent multi-replica limiter, restart/cardinality/bypass/read/apply matrix, planning/public-specific abuse controls, narrower-preview-scope decision, support policy, or restore/rotation drill |
| CAL-008 | Official SDK stdio package, strict config/client/schemas, static resources, provider-contacting preview open-world metadata, read/propose default and opt-in apply/retire tools; 300-second bounded-fan-out deadline; read versus unknown-mutation timeout tests; source boundary/tests | No real slow API/provider E2E, outer-host abort/state-read retry proof, packaged MCP-host matrix, long-running secret rotation, model injection assessment, or remote transport (intentionally absent) |
| NCR-001/NCR-003 | Strict parser, free/busy engine, preview/service/routes/UI, migrations 0007–0014, provider-identity uniqueness, canonical bridge/protected-availability identities, self-copy quarantine SQL/audit, retirement, pure/API tests, and an opt-in PostgreSQL fake-provider lifecycle plus delegated-alias rejection/no-copy activation-lock race | PostgreSQL result is not yet attached to the consolidated gate; no seeded 0013→0014 quarantine execution, complete both-winner/inbound/multi-destination/resume/retire alias race matrix, paused-bridge surviving-copy UX proof, expiry/fault lifecycle, or complete browser/accessibility evidence |
| NCR-002/NCR-006 | Availability role/scopes and distinct freebusy/event-read capability, overbroad/missing returned-grant rejection, subject-serialized first-connect helper, provider free/busy port, atomic role-downgrade purge/guard implementation, no personal identity/content fields, domain-separated HMAC/unit assertions | No PostgreSQL first-connect/dependency/purge/in-flight-sync race evidence, live Google grant revoke/reconnect/downgrade proof, post-run SQL/job/audit/log/metric/backup inspection, offline-enumeration/rotation proof, or long-term retention proof |
| NCR-004/NCR-005 | Bounded eligibility engine; response-sync-triggered reconciliation; immutable decline-audit provider-identity budget with PostgreSQL action-mutation/retire-recreate/20-hold assertions; exact provider recheck; initial already-declined no-PATCH and ambiguous network/5xx/malformed-response verification fixtures; persisted dropped-comment applied warning; answered/organizer/cancelled fixtures | No actual scheduler/worker/PostgreSQL trigger, concurrent budget/alias/fault lifecycle, coordinator-level initial-recovery audit/budget idempotency, completion-timestamp assertion, live provider concurrency, quota, recurrence, or crash-after-commit proof |
| NCR-007 | Service/API/MCP pause/resume/reconcile/retire and rule/action status/audit design; browser controls and dropped-comment safe warning contract | No complete authorization/delegation, edit, retention/export, historical-copy/action purge, warning UI evidence, operational health, restore, or runbook drill |
| NCR-008 | Strict config flag defaults false; preview/list/capabilities separate provider-write and message-delivery state; activation refuses a disabled gate; Google fixtures assert conditional self attendee/comment/`sendUpdates=none` and a verified decline with unretained comment | Capability/warning UI integration and organizer-visible comment or mail/calendar notification behavior lack release evidence; Google delivery remains unverified even when writes are enabled |
| SEC-009/OPS-007 | Hashed/scoped token design, MCP apply double gate, official SDK provenance/notice, domain-separated private HMAC and controlled-rotation runbook, scheduled-job lease/3 heartbeat plus final-renewal/lease-loss unit tests, docs/evidence ledger | Consolidated gates, competing-worker/uncancellable-provider-call and HMAC rotation/fault proof, and online audit are not yet attached; provider I/O under locks remains a release concern and the Hono moderate advisory is accepted only for unreachable stdio path pending upstream |

## Updating status

Do not add a mutable status column here that drifts. Implementation issues and
release evidence reference requirement IDs. A release trace report is generated
from issue/test metadata and links back to this matrix. If generation is not yet
available, append a dated evidence file under `docs/evidence/releases/` rather
than changing “specified” to “verified” in prose.

## Requirement change process

1. Propose changed wording/priority with product, security, operation, migration,
   and compatibility impact.
2. Update `REQUIREMENTS.md` and this owner/verification mapping together.
3. Add an ADR when semantics or scope materially change.
4. Update roadmap/backlog/risk/API/data/UX as affected.
5. Existing release claims remain tied to the old requirement version.
