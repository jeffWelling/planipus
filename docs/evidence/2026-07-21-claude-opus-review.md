# Claude Opus review

Date: 2026-07-21 (America/Vancouver)  
Evidence status: **first attempt blocked (below); review completed 2026-07-21 and
recorded under `## Claude Opus review` at the end of this file**  
Requested reviewer: Claude Code Opus, read-only  
Source state: local, uncommitted Planipus worktree

The provenance record of the blocked first attempt is preserved unchanged in the
next three sections, per the continuation instructions it contains.

## Why no review text is present

The owner explicitly requested a detailed Claude Code Opus review saved in the
project. The implementation was brought to a green credential-free gate before
attempting that review, but the available local Claude Code 2.1.215 client
reported `loggedIn: false` with authentication method `none`. Its print-mode
review command exited with `Not logged in · Please run /login`; it did not read
or transmit the worktree.

The configured agent gateway listed `claude-opus-4-6-thinking`, but the attempt
to send the private worktree to that external model service was rejected by the
workspace privacy policy. The policy requires the owner to approve that
external transfer after being informed of the risk. No workaround, alternate
gateway, copied archive, or weaker external reviewer was used.

Do not describe this record as an independent review, and do not mark the Opus
review backlog item complete.

## Safe continuation in a new session

Preferred path: authenticate the locally installed Claude Code client in an
owner-controlled terminal, then verify `claude auth status` reports a logged-in
account. If the owner instead wants the configured gateway, obtain explicit
approval after explaining that the complete private Planipus source and
documentation will be transmitted to an external model service.

Run the review from the repository root with read-only tools only. Exclude
`node_modules`, `.build`, generated `dist` assets, frozen
`spikes/go-reference`, and historical `PLAN-ALPHA.md` as implementation inputs.
Do not grant edit, shell, network-browsing, secret, or calendar access. Ask the
reviewer to inspect active source, tests, migrations, chart/CI/delivery files,
manifests/lockfiles, security/operations documents, ADRs, evidence,
requirements, TODO, and handoff.

The review prompt must preserve these facts:

- P0 is Reclaim-style directed cross-account Calendar Sync: a qualifying
  personal source event produces and maintains a privacy-filtered work copy;
  the source is authoritative.
- Planipus for Mac and Planipus Server are autonomous editions. They share only
  Planipus-authored behavior fixtures, not accounts, credentials, state, API,
  runtime, storage, or continuity.
- The Mac stops while quit, asleep, offline, powered off, or replaced.
- Keeper is AGPL and excluded from code, tests, fixtures, schema, assets,
  dependencies, runtime, and history. Recorded behavior ideas are the only
  permitted input.
- The current claimed baseline is 91 canonical cases, 95 shared tests, 59
  regular Server tests plus one opt-in PostgreSQL integration test, and 58 Mac
  tests with SQLCipher schema v5. The reviewer must treat those as claims from
  local evidence, not tests it ran.

Ask for a detailed Markdown report with:

1. executive verdict;
2. P0/P1/P2/P3 findings with exact file, symbol, line, confirmed defect versus
   risk/evidence gap, concrete failure, impact, smallest safe remediation, and
   required regression test;
3. architecture, correctness, recurrence/DST, disclosure/privacy,
   multi-account OAuth roles/scopes, session/CSRF/credential protection,
   source-authoritative reconciliation, cursors/generations, ambiguous writes,
   failure isolation, SQLCipher lifecycle, Mac lifecycle, PostgreSQL
   concurrency, Helm/recovery, OSS/license/provenance, tests, deployability, and
   documentation-truth coverage;
4. positive findings and a requirement/evidence gap matrix;
5. ordered next implementation plan and release recommendation; and
6. explicit conclusions on Keeper-derived material and edition independence.

Save the returned text verbatim in this file below a new `## Claude Opus review`
heading, preserving this provenance section. Then add a dated maintainer
response under every P0/P1 finding: fixed with test/evidence, accepted risk with
owner/date, or release-blocking follow-up. Rerun the full gate after any code or
fixture change.

## Maintainer pre-review audit and remediation

This is local maintainer work, not Claude output. A parallel static audit before
the external review found and fixed these concrete issues:

- Mac source accounts had received event-write scope. Account role is now chosen
  before consent; source-only uses `calendar.events.readonly`, destination/both
  uses `calendar.events`, and unused calendar-list scope was removed.
- Mac onboarding had hard-coded the first two accounts and one bridge. Account
  addition is now separate from account-explicit bridge creation, supports
  source/destination/both roles, and prevents an identical account endpoint.
- Restored Mac policies could appear ready without a usable Keychain credential.
  Non-secret granted scopes are persisted, actual Keychain credential metadata
  is revalidated without exposing tokens, and only valid affected policies are
  scheduled; reconnect guidance is shown otherwise.
- Mac offline state existed only as an unused method. A retained
  `NWPathMonitor` now composes with sleep/wake state before driving the
  coordinator lifecycle.
- One ownership-mismatched Mac outbox effect could repeatedly starve unrelated
  bridges. SQLCipher schema v5 adds a terminal quarantine; due queries exclude
  quarantines, draining continues through independent effects, and action-needed
  survives relaunch. Native tests cover both non-starvation and persistence.
- Both conformance runners previously trusted only manifest-listed bundle paths.
  They now enumerate `cases/**/*.json` and compare the on-disk bundle set with
  manifest paths, while the Node/AJV gate remains the schema validator.
- Documentation that still described the SQLCipher store as unimplemented was
  reconciled with the working encrypted store and its honest open lifecycle
  blockers. Current-versus-target physical data-model wording was corrected.
- A later recovery audit found that periodic reconciliation could mask terminal
  effects or erase held recovery evidence. Migration 0003 now binds projections
  and effects to source hash plus tombstone state, shadow-refreshes held payloads
  without authorizing a write, and makes the worker supersede any stale basis
  before provider access. The PostgreSQL regression covers a later source edit
  and a tombstone whose normalized event bytes did not change.
- Per-bridge health now exposes held/failed/ambiguous projections and dead
  effects so the safe recovery control is reachable. The solo chart also rejects
  reusing one Secret name for application and PostgreSQL administrator passwords.

Latest local verification before this record:

- shared TypeScript: 95/95 tests;
- Mac: 58/58 tests;
- current Server baseline: 59/59 regular tests with the real-PostgreSQL test
  opt-in locally and configured in hosted CI;
- the opt-in disposable-PostgreSQL regression passed after exercising preview,
  activation, pause/write serialization, drift/deletion repair, ownership hold,
  explicit recovery, generation rotation, and A→B→A→B outbox uniqueness;
  and
- the final consolidated gate passed the native release build, web and Server
  production builds, all 58 Swift tests, provenance/documentation checks, and
  Helm solo/standard lint/render after the final implementation edits.

## Review focus still requiring independent scrutiny

The highest-value static questions for Opus remain:

- whether the newly added calendar-wide query-fingerprint generation fix covers
  every concurrency and interrupted-scan window beyond its PostgreSQL regression;
- whether every Server privacy preset emits only its disclosure manifest under
  all Google serialization paths;
- whether job/effect leases and migration startup are safe across termination
  windows even under the declared singleton topology;
- whether Mac re-role/reconnect and a future source-endpoint edit can strand old
  projections;
- whether SQLCipher migration 005 preserves every constraint/index and whether
  quarantine needs an explicit user-resolution protocol;
- whether bootstrap/session/CSRF/origin behavior has any proxy or multi-host
  bypass;
- whether Helm probes, secret injection, NetworkPolicy and solo PostgreSQL
  lifecycle match the current process behavior; and
- whether any active documentation still makes a release claim unsupported by
  live Google, third-viewer privacy, backup/restore, image, signing, advisory,
  accessibility, energy, or dogfood evidence.

---

## Claude Opus review

Reviewer: Claude Opus 4.8, running as Claude Code locally on the owner's Mac,
read-only, no external gateway.  
Date: 2026-07-21 (America/Vancouver)  
Commit reviewed: none — the worktree has **zero commits**; this review describes
the working tree as of 2026-07-21 19:27.

### Review conditions (differences from the plan in the provenance section)

The blocked path in this file assumed transmitting the worktree to an external
model gateway. That is not what happened. The review ran inside Claude Code on
the owner's machine with filesystem access only; nothing was uploaded. Work was
split across the main session (documentation, product strategy, cross-document
consistency) and three read-only subagents scoped to Server TypeScript, the Mac
Swift package, and the shared contract + web + Helm + gates.

Claims that were **executed, not read**: `swift build` and `swift test
--package-path macos` (58 pass, 10.1s); `npm run test --workspace
@planipus/calendar-sync` (95 pass); `tsc --noEmit` on `server` (clean); direct
probes of the built `@planipus/calendar-sync` engine to confirm ENG-1, ENG-2 and
ENG-3 below; `git check-ignore -v` on `.env`, `dist/`, `node_modules/`,
`macos/.build`. Server behaviour was read, not executed — the PostgreSQL
integration suite was not run, so all Server findings are static analysis of code
paths, with the failure scenario stated so each can be reproduced.

Exclusions honoured: `node_modules`, `.build`, generated `dist`,
`spikes/go-reference`, `PLAN-ALPHA.md`.

---

### 1. Executive verdict

**Do not connect a real employer calendar yet.** Two defects can put a second
live copy of the same meeting on the destination calendar and one can quietly
delete a month of copies; a third makes both editions capable of copying event
descriptions the user did not ask to disclose. None of them are architectural —
the architecture is right — but all three are in the exact places where this
product's promise is either kept or broken.

The engineering quality here is genuinely high and unusually disciplined for a
pre-first-commit project. The source-authoritative model, the durable outbox, the
deterministic destination IDs plus private ownership markers, the
`source_basis_hash` fence that stops a stale intent from resurrecting a deleted
event, the versioned envelope crypto, the CSRF/origin/session handling, the
fake-provider capability fence, the 91-case provider-neutral corpus with real DST
gap/fold coverage — these are the right ideas, correctly identified in advance
and mostly correctly built. The documentation is better than most funded
products'.

The gap is not competence. It is that **the project has optimized for the
appearance of release-readiness ahead of the evidence that would justify it**,
and the ceremony built to guarantee correctness (gates, registries, provenance
scanners, traceability matrices) is not where correctness is actually escaping.
Three concrete symptoms:

- The single highest-value test — "after this sequence, exactly one managed copy
  exists on the destination" — **is asserted nowhere in either edition.** That is
  the entire product thesis, and the fake providers cannot even express its
  violation, because a duplicate created under a rotated generation lands at a
  different key in the fake's map.
- The conformance corpus's policy-evaluation schema declares `policy`, `source`,
  `projection`, `horizon` as bare `{"type": "object"}` with no
  `additionalProperties: false`, contradicting the corpus README's own claim that
  schemas reject unknown fields. A case can patch `"lifecyle": "deleted"`, change
  nothing, and pass while appearing to test deletion. 66 of 91 cases depend on
  that schema.
- `provenance-gate.mjs` greps for two hardcoded vendor names, obfuscated as
  `["kee","per"].join("")` so it does not trip on itself — and skips `.md` files,
  which is where a donor name would actually appear. It is 81 lines of assurance
  theatre guarding a risk (a solo owner accidentally pasting AGPL code) that no
  grep can detect anyway.

Verdict by edition: **Server** is close — the defects are specific and fixable in
days, and it is the edition that suits the owner's actual situation (a 24/7
cluster). **Mac** is an excellent engine behind a high-fidelity mock: sync status
never reaches the UI, there is no way to delete a bridge or disconnect an
account, and there is no app bundle, Info.plist or entitlements file, so the
documented `swift run PlanipusApp` path cannot work at all — `kSecUseDataProtectionKeychain`
on an unsigned SwiftPM executable returns `errSecMissingEntitlement`.

Recommendation: fix P0s, then get **one** edition to live evidence against
disposable Google accounts. Do not advance both.

---

### 2. Findings

Severity: **P0** release-blocking or user-data-damaging · **P1** must fix before
live accounts · **P2** fix before public release · **P3** cleanup.

#### P0-1 · One unconfirmed 404 permanently duplicates a destination copy
`server/src/sync/effects.ts:294-314, 369-372` → `scheduleReplacementAfterMissing`
(`:433-558`); `server/src/sync/verification.ts:108-115`, `:515-534`

Every "the copy is gone" conclusion is drawn from exactly one `getEvent`
returning `null`, and `getEvent` maps *any* HTTP 404 to `null`
(`providers/google/calendar.ts:137-139`). The response is to increment
`generation`, **null out `destination_event_id`**, and create at a different
deterministic ID.

Failure: a create crosses the network, Google creates `p<uuid>1`, the response
times out (`calendar.ts:219` → `ambiguous_network_error`). Retry reads
`p<uuid>1`; Google's read replica has not materialised it yet, or returns a
transient 404 under load → rotate → `createEvent(p<uuid>2)` succeeds. **Two
copies of the same meeting on the work calendar.** Because
`destination_event_id` was reassigned, `p<uuid>1` is referenced by no projection;
verification only reads `projection.destination_event_id` (`verification.ts:141-181`)
and nothing in the codebase ever enumerates orphaned managed events. The
duplicate is permanent and invisible to the UI.

Fix: (a) require corroboration before rotating — a delayed second read, or an
`events.list` filtered on `extendedProperties.private.planipus_projection`, which
is precisely what those markers are for and is currently **never queried**;
(b) keep retired IDs in `projections.retired_event_ids` and have the verifier
sweep them, so a wrong rotation self-heals; (c) treat a 404 on an event whose
`destination_etag` is known — proof it existed — as more suspicious than a 404 on
a never-confirmed create.

Regression test: fake provider gains `failNextGet("not_found")`; assert exactly
one event carrying markers for projection P exists after create-timeout →
spurious-404 → recovery.

#### P0-2 · Aged-out events are deleted from the destination and reported as a policy exclusion
`packages/calendar-sync/src/evaluate.ts:278` + `:64-80`;
`server/src/sync/reconciliation.ts:130-171, 241-247`; `coordinator.ts:214-234, 308-335`

`excluded(input, "outside_horizon")` routes through `excluded()`, which for
`ownership: "attached"` emits `operation: "delete"`. Confirmed by direct probe:

```
PAST-HORIZON+ATTACHED: excluded delete delete_policy_exclusion
                       ["outside_horizon","delete_policy_exclusion"]
```

The horizon is recomputed from `now` on every pass (default `past_days: 30`), and
the candidate loop iterates **all** stored observations with no horizon filter.
Separately, the forced 24-hour full resync recomputes its window from
`Date.now()` and tombstones every observation not returned by that scan, so an
event at −29 days is inside today's window and outside tomorrow's; it is
tombstoned, evaluated as `source_deleted`, and the copy is deleted.

Failure: a coworker opens last month's calendar to reconstruct availability and
the blocks are gone. The activity feed says "policy exclusion" — the user changed
nothing. Audit records it as a normal `copy.deleted`.

Fix: decide the intent explicitly. Either filter candidates by horizon so
out-of-horizon rows are never evaluated, or return `operation: "none"` with a
distinct `outside_horizon_retained` code; and restrict tombstoning to events that
were inside the scanned window. Add a conformance case either way. This is a
contract decision, not a bug fix — `CALENDAR-SYNC.md` does not currently say what
should happen to a copy whose source ages out of the horizon.

#### P0-3 · Privacy presets are wrong in both editions, in opposite directions
`web/src/api.ts:195-208` (Server) · `macos/Sources/PlanipusApp/AppModel.swift:764`
(Mac) · `packages/calendar-sync/src/evaluate.ts:87-91`

Server's web wizard sets `copy_summary`, `copy_description` **and
`copy_location`** all to `true` for both `private_details` and `shared_details`,
with no per-field control anywhere in the UI. `UX-SPEC.md:132-141` mandates a
field-by-field disclosure table and an explicit acknowledgement for
`shared_details`; neither exists. The preview screen shows only
`sample.summary = "Source event title"` — the description is never surfaced.

Failure: the user picks "Details private" expecting a title, and the full
description ("Oncologist follow-up, bring scans, Dr. X") plus location land on a
calendar their employer administers. `private_details` sets provider visibility
to private, which the product correctly documents as *not* end-to-end secrecy.

Mac has the inverse bug: `syncPolicy(for:)` leaves `privacyFields` at the
all-false default, and the canonical transform gates every field on
`details && copySummary/...`, so "Shared details" produces `"Personal
commitment"` with nothing else — identical to "Generic label" except
`visibility` flips to `default`, a pure privacy regression with no benefit. The
preview text at `RootView.swift:385` already only handles two of the four cases.

Also in this class: `#nosync` scans `summary`, `description` and `response_note`
but **not `location`** (`evaluate.ts:87-91`) — and under `shared_details` that
location is copied to the destination, marker and all.

Fix: ship the UX-SPEC field table with every switch defaulting off; derive Mac's
`privacyFields` from the preset or remove the two detail presets from its UI
until wired; add `location` to the `#nosync` scan. Regression test: a
disclosure-manifest assertion per preset, run in both engines, asserting the
forbidden-field sentinels the corpus already defines.

#### P0-4 · The Mac app never tells the user it has stopped working
`macos/Sources/PlanipusSync/SyncCoordinator.swift:113`;
`macos/Sources/PlanipusApp/AppModel.swift:180, 741`

`SyncCoordinator.status()` is never called from `PlanipusApp`. `Bridge.lastRun`
is set only in preview mode. `AppModel.lifecycle` is derived purely from
`NWPathMonitor` plus sleep notifications.

Failure: a refresh token is revoked → the coordinator sets `.actionNeeded
"Reconnect a Google account"` → the menu bar still reads "Ready on this Mac", the
bridge card still reads "Bridge on", "Last checked: Not yet". A quarantined
ownership mismatch is permanently invisible. **The user believes their work
calendar is protected while it stopped updating weeks ago** — precisely risk
R-040, the highest-exposure entry in the register (25), whose mitigation column
lists only copy and UI intentions.

Fix: publish `SyncStatus` from the coordinator (an `AsyncStream` or `@MainActor`
observer), map into `AppModel`, persist `lastRun` per bridge on each `.current`.

#### P0-5 · The Mac app has no bundle, Info.plist, entitlements or signing; the documented run path cannot work
`macos/Package.swift:56`; `macos/README.md:748`;
`macos/Sources/PlanipusSecrets/KeychainSecretStore.swift:56`;
`macos/Sources/PlanipusApp/AppModel.swift:818`

`Package.swift` declares a bare `.executableTarget`; the README says `swift run
PlanipusApp`. But `KeychainSecretStore` sets `kSecUseDataProtectionKeychain:
true`, which on macOS requires a signed binary with a keychain-access-group
entitlement — an unsigned SwiftPM executable gets `errSecMissingEntitlement
(-34018)` from `SecItemAdd`. `AppModel.configuredValue` reads
`Bundle.main.object(forInfoDictionaryKey:)` from a bundle that does not exist.
`ASWebAuthenticationSession` with a reversed-client-ID callback needs
`CFBundleURLTypes`. `MenuBarExtra` without `LSUIElement` gives a Dock icon, not a
menu-bar app.

Failure: first launch → `DatabaseKeyVault.resolve` → `secretStore.save` throws →
"Planipus could not open its encrypted database". Nothing works, ever, in the
configuration the README documents. This also means `KeychainSecretStore` has
never been executed — `SecretStoreTests` covers the in-memory double and a
constants struct.

Fix: add an Xcode app target with Info.plist (`LSUIElement`, `CFBundleURLTypes`,
`PlanipusGoogleClientID`), an entitlements file, and Developer ID signing. This
is a prerequisite for *any* Mac security claim in the README being true, not an
M2 packaging task.

---

#### P1 findings

| ID | Where | Defect |
|---|---|---|
| P1-1 | `migrations/0001_initial.sql:124-126`; `policy/service.ts:373-389` | The unique index meant to stop duplicate routes includes `policy_hash`, which hashes the draft *including its name*. Rename the bridge by one character and you get two active policies over the same calendar pair, each with its own projections and deterministic IDs — **two copies of every event**. `activate` does not check for an existing active policy at all. |
| P1-2 | `server/src/commands/worker.ts:26` | `runBatch` is outside the try/catch. A `statement_timeout` in `lease()`, or any `executeTakeFirstOrThrow` in `succeed`/`fail`/`supersede` finding zero rows after a lease was reaped, escapes to `main()` → `runtime.close()` → **process exits**. `reportFatal` only sets `exitCode`; on a bare Procfile deploy sync silently stops. |
| P1-3 | `server/src/sync/effects.ts:120-124, 137-424` | All provider I/O happens inside an open transaction holding `FOR UPDATE` locks on policy, effect, projection and observation rows — up to 40s of network on the ambiguous-update path, against `statement_timeout: 30_000` and `pool.max: 10`. Another worker's lease reaper blocks on those locks, is killed by the timeout, and trips P1-2. |
| P1-4 | `server/src/commands/worker.ts:26`; `effects.ts:43-49, 56-68` | 20 effects leased with a 60s lease and executed serially, each capable of 40s. Effects 3..20 are *certain* to have expired leases, get flipped to `retry` with `ambiguous: true` **with no provider call made**, and then take the ambiguous read path — which is the P0-1 rotation path. |
| P1-5 | `providers/google/calendar.ts:331-337`; `macos/.../PolicyEvaluator.swift:196` | All-day events are always normalized as UTC. Google never returns `start.timeZone` on an all-day event, so the fallback always wins. For a `America/Vancouver` user a one-day event is evaluated as `00:00Z–00:00Z` instead of `07:00Z–07:00Z`: `contained_in_profile` misclassifies by up to 14 hours, and horizon-edge events flip in and out between passes, producing create/delete churn. `calendar_endpoints.timezone` is fetched, stored, and read by nothing but the overview DTO. |
| P1-6 | `packages/calendar-sync/src/hours.ts:142-151, 206-208` | `deduplicateAndSort` never *merges* abutting intervals, and containment is tested against a single interval. Confirmed: with 09:00–12:00 + 12:00–17:00 windows, an 11:00–13:00 event returns `included=false, not_contained_in_hours`. Anyone who models lunch by splitting the day rather than leaving a gap loses every event crossing the seam — and with an attached projection that is a **delete**. The corpus's near-miss case uses a real gap, so this passes as designed. |
| P1-7 | `packages/calendar-sync/src/evaluate.ts:76` | Six distinct delete causes collapse to `delete_policy_exclusion`. Confirmed for already-invited, declined, and outside-hours. The corpus asserts that code only for `manual_exclusion`, so the Swift engine has **no contractual obligation on five destructive paths** and the editions may legitimately diverge. Also blocks UX-SPEC's "Removed after source was declined". |
| P1-8 | `conformance/.../schemas/policy-evaluation.schema.json:8-15`; `case-bundle.schema.json:29-38` | `policy`, `source`, `projection`, `horizon`, `destination_capabilities` are bare `{"type":"object"}`; `expected` is an open object. With RFC-7396 merge semantics a typo'd patch key adds junk, changes nothing, and the case passes while appearing to test something else. A misspelled assertion key is silently dropped and the case degrades to the three required assertions. Contradicts the corpus README's own claim. **Highest-leverage single fix in the corpus.** |
| P1-9 | `conformance/`; `packages/calendar-sync/test/conformance.test.ts:142` | Canonical JSON and fingerprints are declared part of the cross-engine contract but have **zero conformance vectors**. The only fingerprint assertion re-runs the same function on the same input — tautological. The one real vector lives in TS-only `canonical.test.ts`, which Swift never sees. `canonical.ts:32` sorts by UTF-16 code-unit order, which diverges from Swift `String` ordering for astral-plane keys (unreachable today, unspecified). |
| P1-10 | `macos/.../SyncCoordinator.swift:252-276`; `GoogleCalendarProvider.swift:36-45` | The Mac sync window freezes at first run. `timeMin`/`timeMax` are sent only on the cursorless full sync; Google binds `nextSyncToken` to the originating query and forbids resending the window with it. The cursor is cleared only on 410. The effective forward horizon shrinks by a day per day, and observations before the frozen `timeMin` are never re-tombstoned. Silent, gradual data loss. |
| P1-11 | `macos/.../SyncCoordinator.swift:295-301, 403, 478-491, 165` | One Google GET per mirrored event per 60-second poll. 300 events → ~430k reads/day, forever, on battery → `403 rateLimitExceeded` → mapped to `.forbidden` (`GoogleCalendarProvider.swift:178`) → "Reconnect a Google account" for a perfectly valid account. `Retry-After` on 429 is discarded. |
| P1-12 | `macos/.../SyncCoordinator.swift:585-640` | Head-of-line blocking: every non-quarantine error path throws out of the drain loop. One event that consistently 409s becomes the oldest due effect, is retried first every pass, and starves every other bridge — the exact starvation the quarantine path was added to prevent, left unfixed for all other errors. |
| P1-13 | `macos/.../GoogleCalendarProvider.swift:338-344` vs `server/src/providers/google/serializer.ts:42-49` | The two editions write **incompatible ownership markers** (`planipus_managed:"1"` vs `planipus_version:"1"`, and different `planipus_projection` semantics; Server also emits `planipus_generation`). A user moving Mac→Server, or running both at a work calendar, gets each edition treating the other's copies as foreign: Mac quarantines and stops, duplicates accumulate. Server additionally throws `unsupported_google_conference_copy` where Mac writes the conference — a disclosure difference. |
| P1-14 | `macos/.../PolicyEvaluator.swift:66, 38-39, 111-140` | The Mac adapter fabricates `now` from the event's own start and defaults the horizon to `event.start−1d … event.end+1d`, making the horizon check a tautology; Server passes real `now` and 30/365. It also always sends `generation: 1`, never `desired_fingerprint`, never `observed_copy`, so the evaluator can only ever return `create` or `none`, and the coordinator substitutes its own `SHA256(JSONEncoder(...))` for the contract's canonical fingerprint. **The conformance suite cannot catch this, because the adapter — not the evaluator — is wrong.** Two "conformant" editions with different change-detection semantics. |
| P1-15 | `server/src/api/app.ts:810-812`; `sync/query.ts:3-4` | Policy horizon accepts up to 3650 days; ingestion is hard-coded to 30/365. A `future_days: 1000` policy never sees events past 365 days, preview reports "0 create", and the user gets no signal. The horizon is also not part of `calendarSyncQueryFingerprint`, so two policies with different horizons share one cursor and one window. |
| P1-16 | `deploy/helm/planipus/templates/networkpolicy.yaml:26-42`; `.github/workflows/ci.yml:95-96` | `values-standard.yaml` renders green in CI and cannot reach an external database: egress allows DNS + TCP/443 to `0.0.0.0/0` with all RFC1918 in `except`, so TCP/5432 is denied. The pod CrashLoops through 60 migration attempts with nothing pointing at NetworkPolicy. **Homelab-specific:** this `ipBlock`-with-`except` pattern is the one that behaves differently under Cilium, where `ipBlock` CIDRs never match in-cluster endpoints — an in-cluster CloudNativePG would be blocked whatever the `except` list says. Use `namespaceSelector`/`podSelector` for the DB peer. |

#### P2 findings (condensed)

- `getEvent` ignores `status` (`calendar.ts:130-142`): Google returns 200 +
  `status:"cancelled"` for deleted recurring instances and 404 for deleted single
  events, so the same user action takes two different recovery mechanisms, only
  one of which is duplicate-safe.
- Deferred effects parked for 24h have no wake-up path for
  `policy_revision_changed` (`effects.ts:560-584`; `policy/service.ts:446-455`).
- Reconcile rescans every observation ever stored, one transaction each, forever;
  tombstoned observations and projections are never pruned
  (`reconciliation.ts:132-174`; `scheduler.ts:87-107`).
- Master-key mismatch produces a dead queue, not a reconnect prompt
  (`oauth.ts:292-296`); `rewrapEnvelope` exists but is called only by a test —
  key rotation is unimplemented despite being schema and API surface.
- Re-authorization silently repurposes a live connection (`oauth.ts:214-229`):
  reconnecting a policy *source* as "destination" flips its calendars to
  `readable:false`, breaks every policy using it, and grants write scope, with no
  confirmation and no audit fact. `audit_facts` records nothing for connection
  create/rotate at all.
- Mac: no disconnect/revoke/delete path anywhere in the UI. `revoke` is fully
  implemented and never called; a bridge cannot be deleted, so mirrored copies
  can never be cleaned up and refresh tokens survive app deletion.
- Mac: `presentationAnchor` force-unwraps a nilled property (crash on a lost
  race); a lost `finish` race wedges sign-in for the process lifetime
  (`SystemWebAuthenticationSession.swift:96, 108, 88`).
- Mac: every repository call blocks a cooperative-pool thread — an actor wrapping
  GRDB's *synchronous* `read`/`write` with `busyMode: .timeout(5)`
  (`ProductionStoreGate.swift:88, 133, 163, 210, 440`).
- Mac: `cipher_memory_security` is set *after* keying, so the derived key page is
  already allocated (`ProductionStoreGate.swift:59-61`).
- Mac: status can stick at "syncing" forever; poll-interval changes are ignored;
  retry backoff uses a stale attempt count.
- Web: modal has no focus trap, no initial focus, no Escape, no focus
  restoration; wizard radio groups have no `name`, so arrow keys don't cycle and
  screen readers don't announce "2 of 4" — directly blocking the stated
  keyboard/VoiceOver requirement.
- Web: the preview screen displays **client-fabricated** `summary`, `visibility`
  and `transparency` (`api.ts:307-312`) — `transparency` is the literal `"busy"`
  regardless of what the engine decided. The preview is the product's safety
  gate and three of its four fields are guesses.
- Helm: `values.schema.json` omits `service`, `ingress`, `networkPolicy`,
  `resources`, `nodeSelector`, `tolerations`, `affinity`, with no
  `additionalProperties:false` at any level — so `--set ingres.enabled=true`
  silently no-ops, and the failure most worth guarding (shipping with no
  NetworkPolicy) is unguarded.
- Helm: solo-profile app password rotation is a silent footgun — the same secret
  must appear twice, nothing validates agreement, and the init script only runs
  on first `initdb`.
- Bootstrap rate limiter is an unpruned per-process `Map` (slow leak, and 5N
  attempts across N replicas); 500s log only `safe_error_code`, leaving nothing
  to debug with; `safe_error_code` surfaces raw SQLSTATEs (`"23505"`) as bridge
  status; `/api/openapi.json` is unauthenticated while every other informational
  endpoint requires a session.

#### P3 · cleanup

Duplicate conformance case (`reconciliation/core.json:18` and `:28` are
byte-identical); `rsvp_unanswered_free` and `update_source_change` asserted
nowhere, the latter near-unreachable; double percent-encoding of event IDs
(`GoogleCalendarProvider.swift:171`); unparseable times collapse to
`.distantPast` → silently omitted; `PodDisruptionBudget` with `minAvailable: 0`
is a no-op that appears in the inventory as governance; Postgres sidecar lacks
`readOnlyRootFilesystem`; `.npmrc:3` explicitly writes `ignore-scripts=false` (the
default) in a repo whose gates are otherwise supply-chain-themed; session expiry
renders "Overview is unavailable" instead of the login screen; error copy renders
raw codes (`Csrf invalid`) against UX-SPEC's calm-language rule.

---

### 3. Positive findings

Stated explicitly so they are not re-litigated in a later pass.

**Verified correct, Server:** AES-256-GCM with a fresh 96-bit random nonce per
encryption; AAD binding record id + purpose; key-id and tag-length checks on
decrypt; constant-time bootstrap comparison; PKCE S256 with a 512-bit verifier;
hashed one-time OAuth state consumed under `FOR UPDATE`; ID-token audience +
`email_verified` checks; strict-SameSite HttpOnly cookies; Origin + CSRF double
gate on every mutation; `redirect: "error"` and a constant API base (no SSRF);
fully parameterised Kysely queries; query strings stripped from request logs;
`sendUpdates=none` on every write so no attendee is ever emailed; no attendees or
reminders in the serialized copy; session-gated metrics with bounded label
cardinality; `pg_advisory_lock` correctly serialising migrations across the three
containers.

**Load-bearing and worth defending:** the outbox; deterministic destination IDs;
private ownership markers; and especially the `source_basis_hash` +
tombstone-state fence (`basis.ts`, `effects.ts:231-262`), which genuinely
prevents a stale queued intent from resurrecting a deleted source event. That
mechanism is the best idea in the codebase.

**Mac:** the canonical evaluator, outbox, cursor/batch transactions and
installed-app OAuth are well built — better than most first cuts. `swift test`
is green and the 58 tests are good tests.

**Helm:** `runAsNonRoot`, `runAsUser: 10001`, `drop: ["ALL"]`, pod-level
`seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false` on both
pod and ServiceAccount, digest pinning support, no Secret template in the chart,
`replicas: 1` hardcoded rather than templated, `OrderedReady` + `RollingUpdate`
so two schedulers never overlap. CI's Helm shared-secret rejection test
(`ci.yml:71-79`) is a real negative test — rare and good.

**Corpus:** provider-neutrality holds; no Google field names, IDs or payload
shapes appear in any case file. DST gap *and* fold with both resolution policies,
quarter-hour zones, overnight windows, NFC-equivalent `#nosync`, forbidden-value
sentinels for privacy leakage, and marker-vs-ownership separation are all
genuinely thoughtful.

**Repo hygiene:** `.gitignore` correctly covers `.env`, `node_modules/`,
`dist/`, `macos/.build`, and pre-emptively `*.key`, `*.pem`,
`client_secret*.json`, `values*.local.yaml`, `*.sqlite*` — verified with `git
check-ignore -v`. `.env` holds real secrets (43-char master key, 48-char
bootstrap token, DB URL with embedded password — shapes checked, values never
printed) and is correctly ignored. Licensing is in good shape.

### 4. Evidence gap matrix

| Claim in STATE/HANDOFF | Actual evidence | Gap |
|---|---|---|
| "91 canonical cases pass in both engines" | True, executed | The cases under-specify: open schemas (P1-8), no canonical vectors (P1-9), five destructive paths uncontracted (P1-7). Mac's *adapter* diverges where the corpus cannot see (P1-14). |
| "no duplicate destination writes" | Design intent + one 1,113-line integration `it()` | **No test anywhere asserts "exactly one managed copy exists".** Fake providers key events by `(calendar, eventId)`, so a rotation duplicate at a different ID is invisible to every assertion. |
| "crash/ambiguity recovery converges" | Proven at two layers that never meet | Mac: all 16 coordinator tests use `InMemoryPlanipusRepository`; nothing runs the coordinator against a real SQLCipher store with `applying` effects. Server: the lease reaper — which *sets* `ambiguous` and feeds P0-1 — has zero coverage. |
| "58 Swift tests, release build" | True, executed | Zero tests for `PlanipusApp`; `KeychainSecretStore` never executed; `FixedSyncClock` is constant, so backoff, `next_attempt_at` ordering and poll cadence are untested. |
| "59 Server tests" | True (`tsc` clean) | Almost entirely pure functions. Locally the PostgreSQL suite silently skips, so a developer sees green having exercised no reconciliation, coordinator, verifier or effect execution. No concurrency test exists — the `SKIP LOCKED` ordering guard is asserted only by comment. |
| "CI runs the PostgreSQL regression" | `ci.yml:22` sets the URL | No hosted run has occurred. |
| "solo/standard Helm profiles" | `helm lint`/`template` pass | Standard profile cannot reach a database as shipped (P1-16). No cluster deployment, no image built. |
| "provenance gate" | Runs | Greps two hardcoded words and skips `.md`. No licensing property verified. |
| Foundation gate A–F | Gate B and C partly `[x]` | A, D, E, F substantially unchecked. Gate A item 1 ("acknowledged by every contributor") is unsatisfiable and meaningless with one owner. |

---

### 5. Add / remove / change — the owner's question

#### Add

1. **Shadow mode against a real Google account.** A `PLANIPUS_WRITE_MODE=shadow`
   that reads the real personal calendar, computes desired effects, writes
   nothing, and emits a diff report. This is the cheapest possible path out of
   the "no live evidence" logjam: it exercises OAuth consent, real recurrence
   payloads, real all-day timezone behaviour (P1-5), quota and 410 handling —
   with zero risk to the employer calendar. Today the only route to live evidence
   is the full two-account write matrix, which is a big scary step, which is why
   it hasn't been taken. **Highest-value single addition.**
2. **A staleness watchdog with teeth.** R-040 is the register's highest exposure
   (25) and its mitigation column is entirely copy and UI intentions — and P0-4
   shows the UI half isn't wired. Make it mechanical: if the last successful
   source poll exceeds N minutes, the bridge goes degraded, the menu bar/health
   page says so, and the Helm chart ships a Prometheus alert rule. Consider an
   optional "availability data may be stale since X" marker on the destination.
3. **Previewed cleanup / detach / delete as a completed P0 feature.** It is `[~]`
   everywhere in TODO and missing entirely from Mac. Two reasons it should be
   finished before live accounts: `RESEARCH.md` identifies CalendarBridge's
   failure to clean up as the gap to exploit, and — more importantly — it is the
   escape hatch. If any of P0-1/P0-2 fires against a real employer calendar, "one
   button to undo everything Planipus wrote" is what turns an incident into an
   inconvenience.
4. **`planipus doctor`.** `NAMING.md` already imagines it. One command checking
   config, DB reachability, credential presence and scopes, clock/timezone,
   cursor age, held/quarantined projections, orphaned managed events (which would
   have surfaced P0-1). For a self-hoster this is worth more than the metrics
   endpoint.
5. **`planipus backup` / documented restore as a command, not a runbook**, plus
   the restore-reconciliation test that is already a listed release blocker.
6. **A scripted third-viewer privacy harness.** Currently a manual `[!]` gate
   repeated in four places, which is why it hasn't happened. Capture a third
   account's free/busy and event-list API responses as golden files per preset.
   Turns a scary manual matrix into a repeatable test — and it is the only thing
   that can actually validate P0-3.
7. **"Explain this copy."** Reason codes exist, and "auditable reason codes" is a
   stated differentiator, but there is no surface for them. Per copy: why it
   exists, which policy revision, what fields were disclosed, when last verified.
   This is the differentiator made visible, and it costs almost nothing because
   the data is already stored.

#### Remove

1. **`spikes/go-reference/`.** `DECISIONS.md` says to archive it once clean-room
   baselines exist. They exist. It is excluded from every gate and will confuse
   the next reader.
2. **`scripts/provenance-gate.mjs` and its CI step.** Highest
   ceremony-to-value ratio in the repo (see §1). Replace with a one-line `grep
   -ri` in `gate.sh` if the reflex is wanted.
3. **~1,000 lines of post-P0 specification masquerading as active spec.**
   `SOLVER.md` (273 lines for a subsystem that is an explicit non-goal through
   1.0), `PRODUCT.md`'s "optional post-sync journeys" and information
   architecture, `RESEARCH.md`'s broad-planner matrix, the SCH/WRK/MTG/AI rows in
   `REQUIREMENTS.md` and `TRACEABILITY.md`, and the booking/solver/AI/team-
   analytics risks (R-012, R-013, R-016, R-017, R-018, R-023, R-026). Move to
   `docs/future/` with one index line. They currently inflate the review surface
   and dilute P0 for no benefit.
4. **`docs/API.md` (328 lines).** `HANDOFF.md` states outright that the real
   contract is `web/src/api.ts`, "not the future endpoints still catalogued in
   API.md". A specification document known to be wrong is worse than none.
   Generate it from the Fastify schemas or trim to what exists.
5. **Server dead machinery.** `provider_subscriptions`, `inbox_notifications`,
   `memberships` — referenced by zero lines of `server/src`. Policy `revision` is
   written as `1` and never incremented (no edit endpoint exists), yet threads
   through effects, projections, job dedupe keys, three disposition branches and
   the verifier guard. `status='deleted'` is set by nothing, making
   `supersede_deleted` unreachable. `ownership:'detached'` is assigned by
   nothing. `rewrapEnvelope`/`key_version` is API surface with no implementation.
   `ProviderRouter` + `AccessTokenBroker` + `GoogleServiceFactories` are five
   indirection layers over two providers, one of which is a test double.
   `policy_previews` is a two-phase commit protocol — table, hash, cursor
   fingerprint, expiry, `FOR UPDATE` revalidation — to create one row in a
   single-user app. Roughly 500 lines of schema and branches.
6. **Mac over-abstraction.** `ProductionStoreGate` (an enum with `isAvailable =
   true` and a two-line pass-through); `GatedGoogleOAuthAuthorizer` (dead);
   `PlanipusDesign` (a whole module for a palette and a lozenge, consumed by one
   target); `KeychainPolicy` plus a test asserting three constants equal
   themselves; `CalendarProviderKind` (one case, costing a column in four tables
   and a component in every composite key); `URLSessionHTTPTransport` as an
   `actor` (URLSession is thread-safe; the actor serialises request initiation
   for nothing); `ChangeBatchHandle` re-validation (an extra SELECT per stage to
   detect an error the type system prevents). And **`PlanipusTestSupport` is
   exported as a public library** while the README says never to link it into a
   release runtime.
7. **`InMemoryPlanipusRepository` (211 lines).** Its only consumer is
   `SyncCoordinatorTests`, and its existence is precisely *why* the coordinator
   has never run against the real encrypted store. It duplicates commit/tombstone
   /dedupe logic with a different observation-key scheme. Point the coordinator
   tests at a temp-file encrypted store and delete it.
8. **Governance apparatus sized for a foundation project.** `GOVERNANCE.md`'s
   maintainer-invitation and two-person-recovery policy, the DCO + excluded-donor
   attestation in `CONTRIBUTING.md`, the PR template, and the ADR ceremony — for
   a repo with zero commits, one owner, no public repository and no contributors.
   Keep `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md` (real obligations) and the
   ADR *log* (genuinely useful). Defer the rest until a public repo exists.
9. **`Procfile` lines 4-5** (`migrate:` never invoked; `web:` byte-identical to
   `api:`), the no-op `PodDisruptionBudget`, and the duplicate conformance case.

#### Change

1. **Commit the repository today.** ~1,100 files of unversioned work with no
   recovery point, on one Mac, and the `.gitignore` protecting the master key has
   itself never been committed. This is by a wide margin the largest live risk in
   the project and it appears nowhere in a 44-entry risk register that has room
   for trademark collision and prompt injection. Before the first `git add -A`:
   `git status --porcelain | grep -E '\.env$|dist/|\.build/'` must be empty.
2. **Sequence the editions; stop racing them.** R-038 (engine drift, exposure 20)
   exists *only* because there are two engines, and this review found it live in
   three places (P1-7 uncontracted deletes, P1-13 incompatible markers, P1-14 a
   diverging adapter the corpus structurally cannot catch). R-043 already knows
   dual installation is dangerous. Meanwhile the Mac edition's defining
   limitation — it cannot sync while quit, asleep or offline — makes it strictly
   worse than Server for the stated scenario **for an owner who already runs a
   24/7 Kubernetes cluster**. Recommendation: take Server to live-verified P0,
   freeze Mac at its current foundation, and revisit Mac later as the
   "no server needed" distribution. This halves the surface of the riskiest code
   in the product.
3. **Redefine done as "it works on my calendars", not "it survives a public
   release".** `REQUIREMENTS.md` marks notarization (MAC-009), full VoiceOver and
   zoom matrices (MAC-008), SBOM and reproducible images as **P0**. The
   foundation gate requires a 30-day dogfood and legal review before the final
   gate. That ordering guarantees the owner never uses their own software. Invert
   it: disposable accounts → own real accounts → hardening → distribution. If a
   public OSS release is *not* actually the goal, roughly 40% of the remaining
   backlog can be deleted outright.
4. **Fix the milestone vocabulary drift.** `TRACEABILITY.md` uses `M1/M2/M5/G0`
   from the superseded plan while `ROADMAP.md` uses `E0/S0/S1/S2/M0/M1/M2/E1`.
   `M5` and `G0` do not exist; `M1` means "Server Google policy" in the CAL rows
   and "Mac complete Google experience" in the MAC rows. The matrix that exists
   to prevent "documented somewhere" from becoming "implemented" is itself
   ambiguous, and `docs-gate` does not catch it (its traceability check passes on
   a row containing only the ID). Similarly, `MACOS-AND-KUBERNETES.md` prescribes
   a repository layout (`applications/macos/`, `services/`) that does not match
   the actual tree, and describes a Google **iOS** client with a
   reversed-client-ID callback while the code uses installed-app OAuth via
   `ASWebAuthenticationSession`.
5. **Align the image build with the owner's existing homelab path.**
   `OPERATIONS.md` specifies Cloud Native Buildpacks and a conceptual `pack
   build`. The owner's standing infrastructure rules require building in-cluster
   via homelab CI, with all pulls through the zot pull-through cache and no
   privileged/root pods. Nothing in the repo references zot, kaniko, buildah or
   the homelab registry. Either adopt the existing path or record an ADR
   explaining why this project departs from it — the current gap means the "build
   the image" release blocker has no actual runway.
6. **Make the fake providers able to fail.** `FakeCalendarProvider.getEvent` is a
   `Map` lookup: perfectly consistent, never eventually-consistent, never returns
   `status:"cancelled"`, never 404s spuriously. It structurally cannot express
   the failure mode P0-1 depends on. A `failNextGet("not_found")` switch turns
   P0-1 into a one-line regression test.

---

### 6. Ordered plan and release recommendation

1. **Commit the worktree.** Verify the `.env`/`dist`/`.build` exclusions first.
2. **P0-1** — corroborate before rotating; retain retired IDs; add fault
   injection to both fake providers; assert "exactly one managed copy" as a
   standing property test in both editions.
3. **P1-2 + P1-3 + P1-4** — worker survives errors; provider I/O out of the
   transaction; lease sized to the work. These three interact and currently form
   a crash loop under load that also feeds P0-1.
4. **P0-2** — decide the horizon-expiry contract, write it into
   `CALENDAR-SYNC.md`, enforce it, add cases.
5. **P0-3 + P1-6 + P1-7 + `#nosync` location** — the privacy and hours-semantics
   cluster. Ship the UX-SPEC field table.
6. **P1-8 + P1-9** — close the schemas, add canonicalization vectors. Worth more
   than twenty additional cases.
7. **P1-1, P1-5, P1-15** — duplicate routes, all-day timezone, horizon coherence.
8. **Shadow mode**, then live disposable-account evidence for Server only.
9. Deletion pass (§Remove 1–9), which is mostly mechanical and makes everything
   after it cheaper.
10. Mac: decide freeze-or-continue. If continue, P0-4 and P0-5 come before
    anything else, because until they land the Mac edition cannot be run at all
    and cannot tell the truth when it fails.

**Release recommendation: not releasable, and not yet safe against a real
employer calendar.** It is, after items 1–7, safe against disposable accounts —
which is the next milestone that actually matters. The public-release gates
(SBOM, notarization, signing, legal review, 30-day dogfood) should be deferred
until after the owner has used this on their own calendars for a month, not
before.

### 7. Explicit conclusions

**Keeper-derived material:** none found. No Keeper code, test, fixture, schema,
migration, dependency, asset or history trace was observed in any reviewed file.
The dependency set is ordinary and independently chosen (Fastify, Kysely, `pg`,
React/Vite, GRDB, SQLCipher). The architecture is recognisably an independent
solution to the same problem, not a reimplementation of a specific one — the
`source_basis_hash` fence and the generation-rotation design in particular are
original and are not patterns lifted from anywhere obvious. The clean-room
boundary appears intact; the *gate* that claims to verify it does not verify it
(see §1), but the property it asserts holds on inspection.

**Edition independence:** holds structurally. No Server URL, pairing path, shared
session, shared storage format or cross-edition API exists in the Mac target; no
Mac-specific coupling exists in Server. The two share only JSON fixtures. The
qualification is behavioural rather than architectural: the editions write
**incompatible ownership markers** (P1-13) and diverge on at least five
destructive reason codes (P1-7) and on change-detection semantics (P1-14). They
are independent, as designed — but they are not yet *equivalent*, and the
conformance corpus in its current form cannot detect the difference. That is the
strongest argument for sequencing them rather than building both at once.
