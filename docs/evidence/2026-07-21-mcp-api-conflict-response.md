# MCP, API-token, and no-copy conflict-response evidence

Date: 2026-07-21  
Contract follow-up: 2026-07-22  
Worktree branch: `codex/mcp-auto-decline`  
Evidence status: implementation handoff; not release approval

## Scope reviewed

This record covers the new Planipus Server API-token authentication, stdio MCP
adapter, provider free/busy port, no-copy conflict-response domain, Google
invitation response adapter, browser configuration surfaces, migrations
0006–0014, protected-calendar concurrency control, and their documentation/
provenance changes. It does not cover or modify Planipus for Mac.

## Product assertions represented in the worktree

- The Server HTTP API remains authoritative; MCP calls it and has no direct
  database or provider route.
- MCP is stdio-only. Remote Streamable HTTP transport is not implemented.
- Dedicated expiring API tokens are scoped `read`, `propose`, and `apply`, are
  stored only as hashes, and expose plaintext once at issue time.
- One API process applies actor/session-token windows of read 600/minute, apply
  120/minute, and propose 30/10 minutes. Conflict preview also refuses a
  principal already holding 10 live previews. Safe 429/`Retry-After` reaches MCP;
  shared persistent multi-replica/planning abuse control remains open.
- MCP registers read and proposal tools by default. Apply tools exist only when
  `PLANIPUS_MCP_ENABLE_APPLY=true`, and the HTTP API independently requires an
  `apply` token.
- The stdio process uses a 300-second API deadline to cover bounded 32-calendar/
  four-lane provider fan-out. GET timeout is `api_timeout`; POST/DELETE timeout is
  `api_timeout_outcome_unknown` and requires listing current state before retry.
- `propose` is non-writing but provider-contacting/read-sensitive: conflict
  preview queries private free/busy and returns bounded overlap counts/time-only
  examples. `read` alone is the least-sensitive machine default when previews
  are unnecessary.
- MCP marks conflict preview open-world/non-read-only/non-destructive so hosts can
  distinguish its provider contact and durable preview from a local read.
- Conflict response makes no personal calendar copy. It uses provider free/busy
  and writes only a work-side attendee RSVP when all safety checks pass.
- The recommended personal connection is role `availability`, which cannot list
  events and is not ingested by source sync. Its endpoint reports event-content
  `readable:false` and `capabilities.freebusy_readable:true`. `source`/`both`
  calendars remain selectable for users who also need bridges, but those roles
  may independently populate the general source-observation mirror.
- Removing event-read access through OAuth is transactional: it blocks live or
  historical event-content dependencies, or purges observations/cursors,
  retires subscriptions/sync jobs, restricts endpoints, and audits counts while
  concurrent sync finalization revalidates the locked connection.
- Every Google callback serializes first-connect/reauthorization by organization
  + subject before selecting the connection row. Availability rejects any
  retained broader Calendar scope as `oauth_scope_overbroad` and a missing
  returned scope set as `oauth_scope_unverified`; Google-side revoke/reconnect
  and the live downgrade remain unproven.
- A private availability calendar may have no active outbound bridge and no
  active/paused inbound bridge. A paused outbound bridge may leave older managed
  copies; resume remains blocked while the protection rule is non-deleted.
  Conflict activation and bridge activation/resume share tenant/calendar locks
  across all selected/both endpoint IDs. Idempotent rule retirement supersedes
  pending/held actions and permits bridge resume without cleaning old copies or
  reversing applied declines.
- Canonical provider-calendar identities make Google delegated aliases global
  for bridge source/destination and protected availability. Alias self-copy and
  no-copy bypass are rejected/locked across accounts. Migration 0014
  quarantines historical alias self-copy policy/work with deterministic audit
  and deliberately leaves historical copies for operator review.
- A durable provider identity prevents multiple live controllers through local
  or delegated Google aliases. The 20-per-24-hours decline budget follows that
  identity across immutable `invitation_response.declined` audit facts, so
  retirement/recreation, reschedule, or mutable action reuse does not reset it.
- Eligible invitations are no longer than seven days, fully inside the horizon,
  sourced from a ready sync no older than 15 minutes, and fail closed above
  5,000 candidates. Successful work sync immediately enqueues reconciliation;
  the 15-minute scheduler remains a safety fallback.
- Each worker loop leases at most one scheduled job and one effect. Scheduled
  jobs renew every lease/3 plus immediately before terminal transition; lease loss causes no
  stale-owner transition and does not terminate the worker. In-flight provider
  calls remain uncancellable and rely on idempotency/ambiguity reconciliation.
- Private snapshot/action bases use domain-separated HMAC. There is no multi-key
  verification; rotation is a writes/workers-disabled expire/supersede/recompute
  maintenance boundary.
- Live Google invitation response remains disabled by default through
  `PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE=false`. Preview remains
  available, activation is refused, and message delivery remains
  `unverified_google` even if the RSVP write gate is enabled. Fake mode is
  `simulated`.
- A post-write verification that confirms self RSVP declined while the attendee
  comment was not retained is applied, consumes immutable audit budget, and
  surfaces `decline_comment_not_retained` on action/rule without retrying.
- For a pending action, an initial exact GET already showing self declined is
  likewise applied with `changed=false` and no PATCH; exact comment comparison
  determines the warning. It consumes immutable budget and may conservatively
  attribute a manual decline without overwriting it. Google write 5xx/response-
  read failures are ambiguous and exact-GET verified.

## Implementation inventory

Expected files and boundaries:

- `mcp/`: official SDK-based stdio process, strict config and tool schemas,
  API-only client, resources, mapping/security tests;
- `server/migrations/0006_api_tokens.sql`: token lifecycle and audit actor;
- `server/migrations/0007_conflict_response_rules.sql`: previews, rules,
  selected availability endpoints, and work-side invitation response actions;
- `server/migrations/0008_availability_connection_role.sql`: strict-private
  provider connection role without historical-row rewriting;
- `server/migrations/0009_conflict_response_uniqueness.sql`: one non-deleted
  rule per organization/local work response endpoint;
- `server/migrations/0010_conflict_invitation_candidates.sql`: bounded partial
  index for future unanswered work invitations;
- `server/migrations/0011_private_availability_hmac.sql`: HMAC-length snapshot/
  basis columns with pre-release SHA-256 compatibility;
- `server/migrations/0012_conflict_response_provider_identity.sql`: durable
  provider-calendar identity, delegated-alias uniqueness and historical budget
  continuity;
- `server/migrations/0013_decline_budget_audit_index.sql`: partial immutable-
  decline-fact index for the rolling provider-calendar safety budget;
- `server/migrations/0014_canonical_calendar_protection.sql`: canonical sync-
  policy source/destination and protected-availability identities, Google-global
  alias self-copy/no-copy enforcement, and fail-closed historical self-copy
  policy/effect/job quarantine with deterministic audit and untouched copies;
- `server/src/auth/api-token.ts`: issue, authenticate, list, revoke, scopes;
- `server/src/conflict-response/`: validation, free/busy input preparation,
  eligibility, preview/activation, reconciliation and apply;
- `server/src/providers/google/oauth.ts`: explicit dependency guard and atomic
  purge/restriction for role changes that remove event reads;
- `server/src/calendar-protection-lock.ts`: sorted tenant/calendar PostgreSQL
  transaction advisory locks shared by conflict activation and bridge activation/
  resume for both bridge endpoints;
- `server/src/providers/`: provider-neutral free/busy/RSVP ports and fake/Google
  implementations;
- `web/src/ConflictResponseScreen.tsx` and `web/src/SettingsScreen.tsx`: calm
  rule setup and one-time token management; and
- `scripts/provenance-gate.mjs`: `mcp` included in scanned shipped roots.

## Verification ledger

Never convert a planned row to “verified” without recording the exact command,
result, and commit/worktree state.

| Check | Status on this record | Evidence / next action |
|---|---|---|
| MCP dependency install/lock | verified in worktree | official SDK 1.29.0 and Zod 4.1.12 pinned exactly in `mcp/package.json`/lockfile |
| `uuid` advisory remediation | verified in lockfile | installed `uuid` is 11.1.1 |
| current npm audit | partially classified; not rerun successfully here | remaining reported moderate `@hono/node-server` Windows serve-static advisory is unreachable in this stdio-only MCP process and accepted temporarily pending the upstream SDK; network audit endpoint was unavailable when documentation was prepared |
| docs link/claim gate | verified on the uncommitted worktree | `npm run docs` passed after the final contract sweep: 52 Markdown files, 80 requirements |
| excluded-donor provenance gate | verified on the uncommitted worktree | `node scripts/provenance-gate.mjs` passed with `mcp` in shipped roots |
| MCP typecheck/test | verified after final timeout/annotation edits on the uncommitted worktree | `npm run typecheck --workspace @planipus/mcp` passed; `npm test --workspace @planipus/mcp`: 4 files / 31 tests passed |
| MCP build artifact | verified in the final consolidated gate | artifact verifier passed with 11 emitted paths and no test/Vitest output |
| Server test | verified after missing-scope/OAuth, 0014, recovery, lease, token-owner-role, and safe-message edits on the uncommitted worktree | final consolidated `npm test --workspace @planipus/server`: 15 files passed, 1 skipped; 156 tests passed, 1 skipped; 4.59 s (start 01:01:21) |
| Server typecheck/build | verified in the final consolidated gate | typecheck passed; emitted artifact verifier passed with 113 paths and no test/Vitest output |
| web typecheck/build/browser | verified on the final uncommitted worktree | typecheck and Vite production build passed; the web workspace has no automated test script. In-app browser walkthrough proved availability-only OAuth wording/focus/Escape, API/MCP token controls, time-only preview, zero-copy disclosure, preview → activate → worker apply, and one simulated decline. |
| provider write/message capability contract | implementation present; focused proof pending | preview/list/capabilities expose separate state; test fake simulated, Google disabled activation/resume, and enabled-but-unverified Google delivery through API and browser |
| availability capability/role downgrade | overbroad and missing-returned-scope rejection unit tests present; integration proof pending | verify `readable:false` + `freebusy_readable:true`, every live/historical dependency block, clear purge/audit counts, subject/connection/calendar lock order, same-subject first-connect/reauthorization/activation/discovery/cursor/page/finalization races on PostgreSQL, and live Google old-grant revoke/narrow reconnect |
| canonical calendar protection | migration/service and fresh PostgreSQL alias rejection/no-copy race paths present | execute a seeded 0013→0014 upgrade proving policy/effect/job quarantine, deterministic audit, historical-copy preservation, database check, and complete both-winner/resume/inbound alias race matrix |
| API/preview alpha limits | focused propose-limit API test present; wider proof pending | prove read/apply/session/token/tenant windows, MCP 429 + `Retry-After`, restart/replica/cardinality/bypass behavior, concurrent 10-preview cap, and shared persistent/planning-specific replacement |
| MCP timeout outcome | config/client tests present | prove real bounded slow preview under 300 seconds and host behavior that reads state before retrying an unknown-outcome mutation |
| scheduled-job lease ownership | focused heartbeat/final-renewal/lease-loss unit and PostgreSQL competing-owner/recovery tests passed | an in-flight call is still not cancelled; provider idempotency/reconciliation and provider-I/O-under-lock remain release risks |
| response trigger/bounds/budget | implementation present; lifecycle proof pending | prove immediate post-sync reconciliation plus scheduler fallback, 15-minute/5,000/7-day fail-closed bounds, alias uniqueness, and historical 20-per-provider budget under concurrency |
| immutable decline/comment warning | PostgreSQL action-mutation/retire-recreate/20-hold budget and persisted dropped-comment action-warning path present; provider fixtures cover initial already-declined no-PATCH and ambiguous network/5xx/malformed-response verification | prove coordinator-level initial-recovery audit/budget/warning idempotency, rule/UI warning, `clock_timestamp()` completion semantics, concurrent reservations, no retry through worker faults, and live Google behavior |
| retirement transition | API/MCP/service implementation present; integration proof pending | prove idempotent DELETE supersedes pending/held, preserves applied, permits bridge resume, and never cleans legacy copies |
| private HMAC/rotation | HMAC implementation present; operational proof pending | prove database-only offline enumeration resistance and writes-disabled key rotation where old jobs cannot apply; no multi-key support is claimed |
| PostgreSQL fresh migration/integration | verified on the final uncommitted worktree | `env PLANIPUS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/planipus_test npm test --workspace @planipus/server -- --run tests/postgres.integration.test.ts`: 1 file / 1 test passed in 11.82 s (start 01:02:57); applies fresh 0001→0014 and exercises direct fake-provider conflict lifecycle, lease ownership/recovery, token owner-role invalidation, and delegated-alias protection race |
| PostgreSQL upgraded migration | seeded upgrade execution pending on this record | add explicit 0013→0014 historical self-copy policy/effect/job quarantine, deterministic audit, untouched-copy, and database-check evidence |
| fake-provider end to end | verified manually through the final compiled web/API/scheduler/worker processes | paused the pre-existing demo Bridge, previewed one unanswered work invitation against one private busy interval, observed zero new copies and one eligible conflict, activated the rule, and observed one simulated decline/zero pending/zero held with a successful timestamp; existing Bridge copy remained explicitly disclosed |
| consolidated repository gate | verified on the final uncommitted worktree | `./scripts/gate.sh` exited 0 after provenance/docs, all TypeScript typechecks/tests/build artifacts, 58 Swift tests, Swift release build, Helm solo/standard lint/render, and the shared-admin-Secret rejection check |
| live Google free/busy | release gate open | reauthorize disposable availability and both accounts; verify minimal scope and interval mapping |
| live Google comment visibility | release gate open | observe best-effort configured comment across supported clients/accounts; Google documents `responseStatus`, not guaranteed organizer comment delivery |
| live Google mail/notification behavior | release gate open | prove observed behavior with `sendUpdates=none`; do not infer from API flag |
| concurrent RSVP fail-closed matrix | release gate open | accepted/tentative/declined/cancelled/organizer/revision-change immediately before PATCH |
| backup/restore/token rotation | release gate open | restore database, replace MCP token, reconcile without duplicate provider response |
| Kubernetes/image evidence | release gate open | build/pin image, render/install chart, probes/jobs/restart/NetworkPolicy evidence |

## Vulnerability disposition

The MCP SDK added a transitive `@hono/node-server` dependency associated with a
moderate Windows static-file serving advisory. Planipus MCP exposes only the SDK
stdio transport; it does not import or start Hono's HTTP/static-file server, and
the supported Server runtime targets Linux containers or a local Node process.
The vulnerable serving path is therefore unreachable in the shipped MCP mode.
This is a time-bounded acceptance, not a declaration that the dependency is
safe in every use: track the upstream MCP SDK, upgrade when a compatible fixed
graph is available, and reassess before adding Streamable HTTP.

The direct `uuid` dependency is locked at 11.1.1. No forced audit fix was used.

## Privacy inspection checklist

Before release, inspect SQL rows, serialized jobs, audit details, structured
logs, metrics, HTTP payloads, and MCP results after realistic conflicts. Confirm
that the conflict-response path contains no personal event ID, title,
description, location, organizer, attendee, conference, recurrence identity, or
provider body. Calendar endpoint IDs and opaque hashes are allowed. Work-side
event/observation/revision identity is allowed only where necessary to target
and conditionally update the invitation.

For the strongest privacy proof, connect the personal account with role
`availability`; confirm it grants CalendarList metadata plus
`calendar.freebusy`, does not authorize `Events.list`, reports
`readable:false`/`freebusy_readable:true`, and confirm role guards/the sync
coordinator create no source observations or bridge-source capability for that
connection. If the
same account is intentionally role `source` or `both`, document that bridge
sync may retain personal observations independently of this feature.

For a source/both calendar with an existing bridge, pause every active outbound
bridge before protection. Record the already-created managed copies that remain
and verify the UI does not call the installation zero-copy. Prove bridge resume
fails while the protection rule remains non-deleted, including when that rule is
paused.
Also prove an active or paused **inbound** bridge rejects protection with
`availability_copy_feedback`. Retire the protection rule through DELETE and
prove pending/held actions become superseded, applied declines remain historical,
and bridge resume becomes available without silently cleaning the older copies.

For source/both → availability-only reauthorization, prove every live feature
and historical projection/action dependency returns
`availability_role_change_blocked`. On a clear account, record exact audit purge
counts and prove a concurrent sync page/finalization cannot restore event content.
If historical references exist, verify UI/operations recommend a separate
dedicated availability-only account instead of direct SQL. Apply the same
recovery to a bridge dependency because the alpha has no bridge-retirement route;
pausing it is not sufficient.

Also prove the consent boundary itself. A returned availability grant containing
any broader Calendar scope must fail `oauth_scope_overbroad` without role/data
mutation; an omitted returned set must fail `oauth_scope_unverified` rather than
fall back to requested scopes. Revoke the old Planipus grant at Google,
reconnect, record only the narrow returned scope names, then prove the guarded
purge. Race two first-connect
callbacks for the same organization/subject. Until this is observed live, the
unit validator and subject-lock code are not downgrade evidence.

## Live Google release matrix

Use disposable work organizer, work attendee, personal availability, and
ordinary observer accounts. At minimum cover:

1. future one-off timed invitation, self `needsAction`, overlapping personal
   busy interval;
2. no overlap, adjacent intervals, all-day personal busy, multi-calendar overlap;
3. attendee accepts, tentatively accepts, or declines between reconcile and
   apply; accepted/tentative hold, while an already-declined pending action sends
   no PATCH and is conservatively applied/budgeted;
4. organizer cancels or changes time/revision between reconcile and apply;
5. connected identity is organizer or no self attendee exists;
6. recurring master versus materialized occurrence and exception;
7. duplicate job, timeout after provider commit, write-side 5xx, malformed/
   failed response read, exact verification GET, 412, 404/410, 429, and revoked
   authorization;
8. `responseStatus` plus configured comment as observed (or absent) by organizer
   and attendee in web/mobile clients—absence is a documented provider limit,
   not something Planipus may conceal;
9. initial or post-write verified `declined` with absent/different attendee
   comment becomes applied `decline_comment_not_retained`, consumes budget, is
   not retried, and does not mark message delivery verified;
10. every mail and calendar-notification artifact with `sendUpdates=none`; and
11. pause/resume/retire/restore: no auto-accept or reversal of an applied decline;
    retirement permits bridge resume without legacy-copy cleanup; and
12. delegated aliases and rule retirement/recreation do not bypass the one-live-
    controller invariant or reset the 20-per-provider rolling budget; and
13. delegated aliases cannot self-copy or bypass protected availability; an
    upgrade-quarantined historical copy remains visible for operator review.

Keep `PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE=false` in normal and release
profiles until this matrix is archived. Setting it true for the matrix is an
explicit experiment, not feature promotion.

## Handoff checklist

- Read `docs/CONFLICT-RESPONSE-AND-MCP.md` before editing the feature.
- Confirm implementation names and HTTP status/error mappings against the API
  source; update docs if code changed.
- Verify provider exact-read checks reject every non-`needsAction` self response.
- Confirm OAuth role `availability` receives CalendarList + free/busy only,
  `source` adds read-only events, `destination` adds writable events, and `both`
  supports work invitation read/write plus free/busy.
- Confirm old source/both connections receive a visible reauthorization action
  before a conflict rule can use a missing free/busy grant.
- Confirm event-content `readable` and opaque `freebusy_readable` remain distinct
  in HTTP, MCP, and UI. Exercise and document
  `availability_role_change_blocked` recovery without direct SQL.
- Run the consolidated gate, then record exact pass/fail counts here and in
  `STATE.md`; do not inherit older counts.
- Run a current online audit and update the time-bounded Hono disposition.
- Do not expose a remote MCP transport without a new security/operations ADR.
- Do not claim this feature exists in Planipus for Mac.
