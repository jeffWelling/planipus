# Decisions

## 2026-07-31 — One palette, sampled from the mascot

The product carried three palettes that shared no hues. Pip is burnt orange,
teal and gold outlined in deep teal-navy. The web edition was cream, sage,
dusty rose and olive ink. The Mac edition was lavender `#735FC7` and mint, and
its app mark was a lavender gradient. The two editions did not match each other,
let alone the mascot, so Pip read as a sticker applied after the fact.

The palette is now sampled from the artwork: paper `#FDF6E8`, gold `#F9B233`,
orange `#F26522`, teal `#1B9AAE`, deep teal `#0E7182`, ink `#123A47`. Cream was
kept because it is already his — his eye-whites and the card he holds — so only
the middle four values changed.

Two rules govern the two signal colours and they are not interchangeable.
Orange means a control you operate. Teal means information derived from opaque
provider data — free/busy, availability, anything sensed rather than read. The
web primary button was teal and is now orange, because a teal action would blur
the single distinction this product exists to make. The neutral is deliberately
not grey: Pip is outlined in deep teal-navy, so rules and body text inherit that
hue and the interface belongs to him on screens where he does not appear.

Type is Superclarendon for display, Seravek for body, and a monospaced face with
tabular figures for times, counts and reason codes. All ship with macOS, so no
webfont is fetched on either edition and nothing phones home — the same
constraint that governs every other network decision in the product.

The direction is *Riverbank*, whose signature is disclosure rendered as depth:
how far a band sits from the surface is its privacy tier, legible without a
legend. The rejected *Electrosense* direction is adopted for the bridge preview
screen alone, where showing position and duration with no titles does real
explanatory work. *Field notebook* was rejected despite being cheapest, because
it preserved the look that made the mascot feel bolted on.

Tokens are duplicated in `web/src/styles.css` and
`macos/Sources/PlanipusDesign/PlanipusDesign.swift`. The editions share no build
step, so a colour change means editing both. That cost is accepted; a shared
asset pipeline would be the first thread of a shared runtime, which HANDOFF
rule 3 forbids.

Pip has three jobs — Dock icon, empty states, and the idle/syncing/attention
status poses. He is not a chat avatar and never narrates. The menu-bar glyph
stays a monochrome silhouette rather than full-colour Pip, and remains reserved
as the ADR-006 control-plane indicator, which signals by changing shape rather
than tint.

## 2026-07-30 — Corrections to the planning round after independent security review

An independent reviewer re-derived the platform claims by probe and the repo
claims by reading code. Several assertions made during the planning round are
wrong and are corrected here. `PLAN-NEXT-2026-07-30.md` is immutable; this entry
governs where the two disagree.

**`PLAN-NEXT` §1 defect D3 is FALSE and must not be worked.** The claim was that
Protect and Meet accept an activation and write nothing while the experimental
planning gate is off. The gate is correctly wired end to end.
`server/src/commands/api.ts:14` omits `planning` from the dependency object
entirely when `planningProviderWritesEnabled` is false; all ten planning routes
guard on `dependencies.planning` and return `503 planning_unavailable`
(`app.ts:527,532,545,549,555,561,566,572,576,582`); `/api/v1/capabilities`
reports `availability_protection: "unavailable"` (`app.ts:512-513`); and
`App.tsx:211-212,749-750` removes Protect and Meetings from the navigation
entirely. The user is never shown the feature, cannot activate it, and is never
given a block count. The scenario is unreachable, and has been since the base
commit. The persona synthesis ranked this defect first and seven of nine personas
named it a deal-breaker; that ranking was built on a false premise. **TH-01 is
withdrawn from the current phase.** What survives is smaller and genuinely worth
doing: activation and reconciliation responses should still report provider
effects rather than local intent, and bridges and rules should still expose a
last-successful-provider-write timestamp.

**Defect D4's privacy framing was backwards.** `web/src/api.ts:433-442` hard-codes
**eight** selection fields, not six — the six enums plus `source_exclusion_marker`
and `manual_exclusions` — against a server validator that accepts 324
combinations. That asymmetry is real. But `all_day: 'skip'` is not a leak:
skipping writes no block, which is strictly *less* information flow, and an
absent block is the calendar's default state carrying no signal. The actual harm
runs the other way — an all-day source event (surgery, a court date, a full-day
clinic) receives no protection at all, so a colleague books over it while the
user believes they are covered. It is an availability-correctness defect.
`all_day: 'busy_only'` is the safer default and the fix is unchanged; the
reasoning in the plan is not.

**Defects D1, D2, D5 are confirmed**, with two corrections. There is no literal
"never copied" string in `web/src`; that phrasing originates in `PERSONAS.md`.
The shipped UI text is literally true about the destination write. The conflation
is structural rather than a mislabelled string: `evaluate.ts:221-230` emits an
honest `source_fields_read` that always includes `/content/summary`, and
`web/src/api.ts:88-97` does not carry that field in its type at all, so the one
honest signal is dropped before it reaches the screen. Separately, D1 is worse
than stated: `providers/google/calendar.ts:162-164` sets `singleEvents=true`, so
recurrence is expanded into discrete instances rather than copied as an RRULE,
which leaks *more* legibly — N blocks at exact instants, plus every exception and
reschedule.

**ADR-006's stated reason for hand-rolling BSD sockets is wrong, and the real
reason is more dangerous.** `NWEndpoint.unix(path:)` does exist
(`Network.swiftinterface:392`) and `NWConnection` to it works. The trap is that
`NWListener` has no endpoint-taking initializer and **silently ignores**
`parameters.requiredLocalEndpoint = .unix(path:)`: a probe reached `.ready` with
no socket inode created and a TCP port assigned. A developer taking the obvious
Network.framework route gets a TCP listener while believing they have a Unix
socket — in a sandboxed app that then requires `com.apple.security.network.server`
and is browser-reachable, which is precisely the outcome the ADR exists to
prevent. The secondary and decisive reason is that Network.framework hides the
file descriptor, so `LOCAL_PEERTOKEN` is unavailable and the peer-verification
design is impossible on it.

**The socket mode must be established before `bind()`, not after.** `bind()`
creates the inode as `0777 & ~umask`, measured as 0755 under a default umask, and
Darwin does enforce socket mode bits on `connect()`. The window between `bind()`
and `chmod()` is genuinely open. Call `umask(0177)` before `bind()` and place the
socket in a 0700 parent directory. `SURFACES.md`'s Server operator socket, as
originally specified with mode 0600 and no parent-directory requirement, was racy.

**`LOCAL_PEERTOKEN` must validate `optlen`, not just the return code.** On an
AF_INET socket the call does not fail: `SOL_LOCAL` is 0, which on an IP socket is
`IPPROTO_IP`, and `LOCAL_PEERTOKEN` (6) collides with `IP_RECVRETOPTS`. It
returns `rc=0, optlen=4` with the first word zeroed, and
`audit_token_to_euid()` on that reads as **root**. Any peer-verification helper
must assert `optlen == sizeof(audit_token_t)`. Citation corrections:
`audit_token_t` is defined in `mach/message.h:506-508`, not `bsm/audit.h`;
`audit_token_to_pidversion` is public SDK API at `bsm/libbsm.h:1576`, requiring
`-lbsm`. Related: an ad-hoc binary carrying `keychain-access-groups` does not
merely fail the Keychain call — AMFI SIGKILLs it at exec. And the Keychain *read*
path returns `-25300 errSecItemNotFound`, not `-34018`, so code special-casing
only `-34018` will misdiagnose a missing entitlement as "no credential stored"
and silently re-prompt for OAuth.

**`observation_hash` is unkeyed and must not be exposed.** It is a plain SHA-256
over the full normalized event (`policy/runtime.ts:20-22`), so it is a stable
per-event correlator and a confirmation oracle: the destination already discloses
exact start and end, so an adversary with a candidate title list confirms a guess
by recomputation. ADR-006's content-free projection proposed carrying it. It must
be HMAC'd under a key that never leaves the server, exactly as
`conflict-response/privacy-hash.ts:16-25` already does and as migration
`0011:19-20` already explains. Two threat models were being applied to the same
class of data, and the weaker one sat on the more sensitive input.

**The Mac already contains the B10 attack as a latent code path.**
`AppModel.persistConfigurationAndReschedule` regenerates `SyncPolicy` from
presentation state via `syncPolicy(for:)` (`AppModel.swift:646`, `:922-934`),
passing only ids, `enabled`, a hardcoded profile and `privacyPreset` — so
`manualExcludedSourceEventIDs` reverts to `[]` and `genericLabel` to its default
on every configuration save. It is latent only because no UI writes those fields
yet. **Any manual-exclusion UI ships broken unless this is fixed first.**
Relatedly, `persistConfigurationAndReschedule` calls `stopPolling()`/
`startPolling()` and the poll loop runs `runOnce` before its first sleep, so a
configuration change kicks a full fetch-reconcile-drain immediately. The gate
placed on a config-mutating call is bypassed at once, not eventually — which
strengthens rather than weakens the decision to enforce at the effect.

**On the Server, `generic_summary` is not constrained to "Busy".** The `"Busy"`
hard-override exists only in the Mac evaluator (`PolicyEvaluator.swift:63`).
`packages/calendar-sync/src/evaluate.ts:196-198` uses `generic_summary` verbatim
under `busy_only`, the API validator checks only non-empty
(`app.ts:1341-1342`), and MCP accepts 160 characters alongside
`preset: "busy_only"` (`mcp/src/schemas.ts:57`). An MCP client — including a model
under injection — can therefore create a `busy_only` policy whose
employer-calendar title is arbitrary text, including the real appointment title.
This is a live disclosure path and outranks most of the planned work.

**`POST /api/v1/sync` deliberately defeats job dedupe** for planning and
conflict-response by suffixing the dedupe key with `manual-sync:${Date.now()}`
(`app.ts:852,869`) while sync and policy reconcile use stable keys. Retrying a
timed-out `/sync` therefore enqueues duplicate conflict-response reconciliations —
the exact duplicate-cancellation hazard that motivated CLI exit code 11, present
today and reachable without a CLI. Exit 11 is a convention that only helps a
client that obeys it; **idempotency keys make retries safe regardless of client
discipline, and both should ship.**

**Further defects recorded for triage**, each verified: eighteen routes have no
rate limiting because `enforceActorRateLimit` is invoked only from
`requireActor`, and that set includes `POST /api/v1/sync`, which fans out to
Google; `trustProxy: false` (`app.ts:104`) behind the Helm ingress collapses every
client to the ingress pod IP, so five bad bootstrap attempts lock every user out
for fifteen minutes; `source_exclusion_marker` accepts the empty string in both
editions, silently disabling `#nosync` entirely, while the non-empty guard this
codebase already applies to `generic_summary` is absent;
`preview_conflict_response_rule` is annotated `destructiveHint: false` and
registered unconditionally outside the apply branch, yet returns real
`{start_at, end_at}` pairs for conflicted invitations and fans free/busy queries
across up to 32 calendars — so a "read-only" MCP deployment still pushes private
busy times into model context; and `source_observations` is never purged by the
cleanup sweep, with deletion tombstoning the row while preserving the content
block.

**Counts to correct before they are encoded in a test.** `SESSION_ONLY_WEB_OPS`
is **16**, not 15 (ten planning routes, plus sync, authorize, metrics and three
api-token routes). ADR-006's "twelve planning routes" is **ten**. The headline
surface figures are exact and confirmed: 46 route registrations plus a not-found
handler; 20 bearer-reachable; 18 owner-session-only; 6 unauthenticated API routes.

**Two mechanism descriptions were inverted and are corrected.**
`protectedMutation` (`app.ts:296-299`) does not use `mutationOriginAndCsrf`; it
composes `requireOrigin` and `app.csrfProtection` with a `requireSession`
preHandler. `mutationOriginAndCsrf` (`:279-286`) serves `protectedProposal` and
`protectedApply`, and its early return on a present `Authorization` header is
what correctly lets a non-ambient bearer credential skip Origin and CSRF. The
conclusion — no bearer token can reach a `protectedMutation` route — stands and is
covered by `api.test.ts:164-170`. Separately, App Sandbox requires only
`com.apple.security.app-sandbox` for a container Unix socket;
`network.client` is irrelevant to AF_UNIX and gates AF_INET only. And the YAML
argument should rest on the two unconditional premises — an unquoted `#nosync`
is a comment producing null in every parser, and a truncated YAML mapping is a
valid document missing its last keys where truncated JSON throws. Sexagesimal
`HH:MM` coercion and the Norway problem are YAML 1.1 behaviours, present in Psych,
`yaml.v2` and PyYAML's default loader but not in js-yaml 4 or `yaml.v3`. Stating
them unconditionally invites a reviewer to refute a premise and dismiss a correct
conclusion.

**Verified clean, so they are not re-litigated:** the OAuth flow (single-use state
under `FOR UPDATE`, envelope-encrypted PKCE verifier with transaction-bound AAD,
`id_token` verified against the required client id, `email_verified` required,
role taken from the pre-redirect intent, role downgrade purging event-read data
with an audit row); static asset serving; log redaction; content-free
`audit_facts.detail`; provider errors never interpolating response bodies; no API
route emitting event content; and `evaluate.ts:133-137` hard-rejecting
`copy_attendees`/`copy_organizer` for every preset and failing closed on a
mislabelled one — identified as the strongest control in the codebase.

## 2026-07-30 — Owner rulings on OAuth identity, distribution, retirement, retention, presence and multi-principal scope

Six product decisions taken after the persona and surface planning round. Each
resolves an open question in `PLAN-NEXT-2026-07-30.md` §8.

**Google OAuth client identity: ship both, and name which is in use.** BYO-client
remains the default and documented path; a verified Planipus client exists for
accounts inside a Workspace that enforces a Marketplace allowlist, where an
unrecognised client fails `admin_policy_enforced` before any feature matters. The
connection detail must always state which client authorised it, so a self-hoster
can demonstrate that no vendor is in the path. The named publisher entity for the
CASA assessment is **not** decided by this entry and must not be assumed from any
sibling project; Planipus is Apache-2.0 and its publisher identity is a separate
question with legal consequences.

**First image: publish an explicitly unreviewed pre-release.** A multi-arch image
plus a compose file ship before the SBOM, provenance, signing and advisory gates
close, labelled supply-chain-unreviewed in the tag, the README and a persistent
web-UI banner. The alternative leaves the adopters most able to generate live
evidence with nothing to install, which delays the S1 gates that no amount of
coding closes. The label is not decoration: it must be impossible to deploy this
image and believe it was reviewed.

**Bridge retirement forces an explicit choice with no default.** Retirement
presents detach-and-leave and delete-all with exact counts, neither preselected,
detach listed first, and the count in the button. A default is a decision made on
behalf of someone who is panicking, and the two outcomes are irreversible in
opposite directions. The confirmation must state that deletion removes events
from the calendar and cannot reach the admin audit log, a Vault export, backups
or device caches.

**The undo ships read-before-write.** Marker-verified enumeration of managed
copies, plus pause semantics that disclose surviving copies separately instead of
collapsing them into "0 new copies", ship in the current phase at zero risk. The
destructive half ships only after the live-Google gates have exercised marker
verification, because bulk destination deletion against unproven marker
verification, reached in a panic, is the worst combination in the product.

**Retention defaults to timing-only for redacted presets.** When every active
policy on a source endpoint is `busy_only` or `commitment`, only timing,
availability, lifecycle, origin, recurrence identity, an exclusion boolean and
the observation hash are persisted. A deployment-wide flag lets an operator
enforce it organisation-wide. The cost is accepted: Planipus can no longer show a
user what an event was, and upgrading such an endpoint to a detail preset
requires a full re-sync. This is what converts "the operator cannot read your
event titles" from a promise into a property.

**`presence:widened` is omitted from v1.** It is technically safe — deterministic,
verifier-stable, and enforceable as strictly-widening — but every user who asked
for coarsening wanted cadence concealment, which widening does not provide. A
tier whose principal effect is to be misunderstood by the people who select it
costs more than it returns. Presence ships as `mirrored`, `absorbed` and
`suppressed`.

**The surface registry lives at `registry/v1/`, not under `conformance/`.**
`conformance/` keeps meaning exactly one thing: the cross-edition behaviour
corpus that both the TypeScript and Swift evaluators execute against a canonical
SHA-256 vector. The surface registry is a build-time contract nothing executes as
fixtures, and it spans two editions where the behaviour corpus spans one
contract. `PARITY.lock` sits beside it. `SURFACES.md` is updated in place;
`PLAN-NEXT-2026-07-30.md` §8 item 9 remains as written, because plan files are
immutable and drift is recorded here.

**Multi-principal support is restricted, not general.** OIDC and real per-member
principals are permitted only in deployments where every policy is `busy_only`
and every connection is availability-only — the configurations in which
timing-only retention makes the operator's inability to read member content
structurally true. `private_details` and `shared_details` are refused in a
multi-principal deployment. The general role model is rejected because its
central promise is one this architecture cannot keep: reconciliation needs the
normalised event, so a worker must be able to decrypt it, and anyone who can
restore a backup can read it regardless of what the UI enforces. Multi-principal
work begins only after the undo and retention decisions above have landed, and
its threat model must name employer-demanded and partner-demanded access as
in-scope adversaries.

## 2026-07-30 — Symmetric per-edition triads, one operation registry, and a container-socket Mac control plane

Each edition owns a complete triad: Planipus Server has a Server API, CLI and
MCP; Planipus for Mac gets its own API, CLI and MCP, off by default with
authentication required. This revises HANDOFF rule 7's "must not embed a local
web service" and the entitlement rule's "no listener". The web-service
prohibition stands and is strengthened: the Mac carries no HTTP server, no
WebSocket and no TCP listener in any build. The entitlement rule survives intact,
because a Unix-domain socket inside the app's own sandbox container was measured
to need zero added entitlements — a sandboxed bundle signed with only
`app-sandbox` and `network.client` binds and listens successfully, while the
identical bundle receives `EPERM` on `127.0.0.1` until
`com.apple.security.network.server` is added. Only the prose sentence changes.

HANDOFF rule 3 is unchanged and is now enforced in the credential layer rather
than by convention. The editions never talk to each other: a `pln_api_`
credential presented to the Mac and a `plnmac_` credential presented to the
Server both fail with an audit row carrying `foreign_edition_credential`, and the
Mac client accepts no URL, hostname, socket path, port or profile from any
caller, which removes the SSRF shape and mechanically enforces the boundary.

`web/src/api.ts` is no longer the de-facto API contract.
`conformance/surface/v1/operations.json` declares every operation once; thin
surfaces (MCP tools, CLI parser, OpenAPI, docs tables) are generated from it and
thick surfaces (`server/src/api/app.ts` routes with their auth presets,
`web/src/api.ts` call sites) are checked against it by AST extractor — split by
blast radius so the release-critical directed-sync path is checked rather than
rewritten. Parity is a single integer CI asserts is zero, plus a ratchet:
`SESSION_ONLY_WEB_OPS` is 15 today and may never increase.

The agent-output format is minified JSON, not YAML. This is decided on parse
reliability with a repository-specific hazard: `source_exclusion_marker` defaults
to `#nosync`, which unquoted in YAML is a comment that silently nulls the field;
`LocalTimeString` is `HH:MM`, the sexagesimal shape YAML 1.1 mangles; and enums
include bare `free`, `busy` and `skip` alongside timezone strings that meet the
Norway problem. A truncated YAML stream yields a valid-but-wrong document where
truncated JSON throws. The token-cost claim was measured rather than assumed:
minified JSON 1,371 chars against block YAML 1,508 for a representative
`overview.get` payload, because these payloads are arrays of uniform records.
`--json` is deliberately not an alias for `--agent`; it remains an unstable human
debugging convenience so nobody scripts against a readability improvement.

`api_timeout_outcome_unknown` on a non-GET gets exit code 11, distinct from the
GET timeout's 10. A GET may be repeated verbatim; a POST or DELETE may already
have committed. Merging them would let a retry loop double-activate a bridge or
send a second round of cancellations to real attendees.

The Mac capability ceiling is existence-shaped rather than field-shaped, because
a field-shaped ceiling misses the eleven `SyncPolicy` selection knobs that decide
*which* events become copies while every disclosed field stays a perfectly opaque
`Busy` block. A revision that can admit an event the previous revision excluded
is disclosure-increasing, decided by a declared per-knob monotonicity lattice
plus empirical evaluation of both revisions over the observed window, and is
UI-only at every scope. Enforcement lives at the effect, not the API call:
provider writes are produced by the app's own coordinator, so a gate on the
request is bypassed by an attacker who mutates configuration and waits. The
coordinator refuses to project from an unratified revision digest.

The Mac local API returns no event title, description, location, attendee,
organiser or conference URL to any client at any scope in any build, and there is
no per-event enumeration endpoint. This is absence rather than a flag: the
exfiltration path is the MCP host's own shell and network tools, so once content
leaves the app it is in a model provider's retained context and no downstream
control exists. A boolean a persuasive agent can obtain in one exchange, with a
90-day blast radius, is not a control. It also dissolves the audit paradox — a
content-free log can honestly answer "did anything read my calendar?".

Rejected: loopback TCP, because browsers cannot open `AF_UNIX` sockets so the
whole DNS-rebinding class is deleted rather than mitigated, and because a closed
port RSTs immediately while an open one completes the handshake, making the
presence oracle a TCP-layer signal no HTTP-layer masking suppresses — and for
this product's users, a web page learning Planipus is installed is itself the
disclosure. Rejected: XPC with a global mach service name, which requires launchd
registration. Rejected: a CLI `login --local` presenting the bootstrap token to
obtain a browser session, which is impersonation that silently falsifies
`requireSession`'s guarantee. Withdrawn: the claim that TCC App Data consent is a
fourth authentication factor, because npm postinstalls and agent shell tools run
under exactly the terminals a user must grant that consent to, and an MDM PPPC
payload grants it with no prompt.

Also recorded: the Mac production Keychain path does not work today.
`KeychainSecretStore` sets `kSecUseDataProtectionKeychain: true`, which requires
an `application-identifier`/`keychain-access-groups` entitlement; there is no
`Info.plist`, `.entitlements` or `.app` outside `.build`, and a probe issuing
exactly the `SecItemAdd` that `save()` issues returns `-34018
errSecMissingEntitlement`. `SecretStoreTests` uses `InMemorySecretStore`, so the
suite never observes it. Packaging is therefore a prerequisite of the Mac triad
rather than a parallel track.

## 2026-07-22 — Provider-calendar identity, strict availability consent, and conservative decline recovery

Calendar-protection invariants use the underlying provider calendar rather than
only a local endpoint. Google calendar IDs are global across delegated
connections, so Planipus canonicalizes them as provider + `global` + remote ID;
other providers remain connection-scoped. Migration 0014 persists canonical
sync-policy source/destination identities and selected protected-availability
identities. Bridge and conflict-response paths lock/check those identities as
well as local endpoints. New alias self-copy/duplicate selections fail
`same_provider_calendar`.

The migration fail-closes pre-existing Google alias self-copy bridges: mark the
policy deleted with `same_provider_calendar`, dead-letter pending/leased/retry
effects, finish pending/leased/retry reconcile jobs with the same code, and emit
deterministic audit action `policy.quarantined_same_provider_calendar` with
`historical_copies_untouched: true`. It deliberately leaves destination copies
for explicit operator review; silent cleanup would add a distinct destructive
provider operation.

An availability OAuth callback must prove the returned Google grant is narrow.
If Google retains any broader Calendar scope from earlier consent, fail
`oauth_scope_overbroad`; require revocation of the prior Planipus grant at Google
and a fresh availability-only connection. If Google omits the returned scope set,
fail `oauth_scope_unverified`; availability never substitutes requested scopes
as proof. A failed callback neither changes the role nor proves local purge.
Every callback, including first-connect, serializes
organization + verified Google subject before choosing the authoritative
provider-connection row.

For an existing pending Planipus response action, an initial exact provider GET
that already shows the self attendee declined is terminal conservative recovery:
no PATCH, `applied`, `changed=false`, exact comment-retention comparison, normal
immutable decline audit, and 20/24-hour budget consumption. This may
overattribute a manual decline, but it cannot overwrite a user's answer or
bypass the blast-radius budget. Accepted/tentative remain held. Google write 5xx
and response-read ambiguity trigger exact GET verification before the outcome is
chosen.

## 2026-07-22 — Renew one scheduled-job lease while work is in flight

A worker loop leases at most one `scheduled_job` and at most one bridge outbox
effect.
Scheduled-job dispatch owns a heartbeat that conditionally renews every one-
third of the configured lease and performs a final renewal immediately before a
terminal success/failure transition. If renewal proves ownership was lost, the
stale worker records no transition and continues serving; the current owner is
authoritative. This replaces the earlier twenty-job scheduled batch, which could
allow later items to expire while the first provider call ran.

Heartbeat is ownership coordination, not provider-call cancellation. An already
in-flight network operation may finish after lease loss or shutdown starts.
Correctness still relies on conditional/idempotent provider writes, exact
ambiguity verification, and reconciliation. Provider I/O while domain rows or
advisory locks are held remains a scale/release concern.

## 2026-07-21 — No-copy conflict response is a separate Server aggregate

The new requirement is not another privacy preset for a bridge. A conflict-
response rule reads selected personal availability through provider free/busy
and may decline an eligible unanswered work invitation with a static comment.
The comment is never templated from event data. It creates no personal
placeholder/fence/copy, stores no personal event identity or content in this
aggregate, and never accepts/undoes an RSVP.

Eligibility is fail closed at reconcile and provider apply: future confirmed
timed provider-original work event; connected identity is self attendee and not
organizer; response is exactly `needs_action`; revision and rule still match;
and a fresh exact-interval free/busy overlap exists. Accepted, tentative,
cancelled, missing/unknown self, changed, started, all-day and no-longer-
conflicting events are not overwritten. Already-declined recovery is superseded
by the conservative pending-action decision above.
Work sync must be successful within 15 minutes; candidates are indexed/bounded
to 5,000, invitations may last at most seven days, and excess automatic declines
are held at 20 per rolling 24 hours across the same response-provider identity.
The applied count comes from immutable `invitation_response.declined` audit
facts, not mutable action rows, so reschedule/action reuse/retirement cannot
erase a prior response from the budget.
A successful response-calendar sync immediately enqueues rule reconciliation;
the scheduled 15-minute pass is a safety fallback.

A calendar selected by a non-deleted conflict rule as private availability
cannot be either endpoint of an **active** directed bridge. Conflict setup also
rejects active/paused inbound bridges because surviving copies can create self-
conflicts. Bridge preview/activation/resume reports `no_copy_rule_conflict` when
either endpoint is protected. These mutation paths acquire the same tenant-
scoped transaction advisory locks for selected availability calendars or both
bridge endpoints; sorted, de-duplicated keys prevent deadlocks and close races.

An existing bridge can be paused first. Its managed destination copies remain
deliberately and are not cleanup work owned by conflict-rule activation. They
must be disclosed, and the bridge cannot resume while the protection rule is
non-deleted, even if that rule is paused. Idempotent rule retirement supersedes
pending/held actions and permits later resume, but never cleans old copies or
reverses applied declines. Dedicated availability-only calendars without bridge
history are the safest default.

This is Server-only. The autonomous Mac edition gains nothing through the
Server and would need its own native decision/implementation/evidence.

## 2026-07-21 — Availability-only OAuth is the strict-private recommendation

Google connection intent adds `availability`, granting identity, CalendarList,
and `calendar.freebusy` only. The narrow Google scope does not authorize
`Events.list`; Planipus role guards also prevent event ingestion and bridge-
source use. This is the recommended personal-account setup when the operator
requires that no personal event content be persisted by the installation.
Endpoint `readable` means event-content permission and is therefore false for
this role; `capabilities.freebusy_readable` is the separate API/MCP capability.
Planipus deliberately does not use `calendar.events.freebusy`: Google accepts
that broader event-family scope for `Events.list`, so its name is not a safe
least-privilege boundary.

Existing `source` and `both` connections may also supply free/busy, because a
user may need the same account for a bridge. Those roles can independently
retain normalized source observations; the UI/docs must not overstate the
installation-wide privacy boundary. Old grants need explicit reauthorization;
Planipus never silently assumes expanded scope. The work response account is
`both` so it can read invitations and write the attendee response.

Removing event-read access from an existing source/both connection is an atomic
privacy transition during OAuth callback, not a metadata toggle. Live bridge,
planning, response-rule, or historical projection/action dependencies reject it
with `availability_role_change_blocked`. When clear, Planipus purges observations
and cursors, retires subscriptions/pending sync jobs, restricts endpoints, and
audits counts before changing role; concurrent sync commits lock and revalidate
the connection. The alpha has no force-purge for historical dependencies, so
operators must keep the broader role or connect a separate dedicated account.
The same applies to a bridge dependency because bridge retirement is not yet an
implemented product route; pausing does not remove its content relationship.

## 2026-07-21 — Private availability bases use keyed HMAC

Low-entropy busy intervals cannot be protected by an unkeyed digest against an
offline database/backup attacker. New preview snapshot and action basis values
are domain-separated HMAC-SHA-256 using a key derived separately from the active
installation master key. Personal intervals still never enter durable rows.

Migration compatibility accepts historical pre-release `sha256:` values, but
new writes are `hmac-sha256:`. Current verification has no multi-key support;
master-key rotation must disable writes, expire previews, and supersede/
recompute pending or held actions before resuming. Transparent rotation is a
TODO, not a present claim.

## 2026-07-21 — MCP is a stdio API adapter with two-key apply

The Planipus Server HTTP API remains the sole machine authority. A separate MCP
process uses the official MIT TypeScript SDK 1.29.0 and stdio transport, then
calls only the configured Server API over HTTPS (or loopback HTTP). It contains
no database/provider/OAuth route. Dedicated `pln_api_` tokens are expiring,
digest-only, one-time-displayed and scoped `read|propose|apply`.

Read/proposal tools and static resources are the default. Apply tools—including
`activate_sync_policy`—are registered only when
`PLANIPUS_MCP_ENABLE_APPLY=true`, and the API independently requires an `apply`
token. This double gate limits accidental model/tool mutation. Calendar and
provider text remains untrusted data and cannot grant capability.

Remote Streamable HTTP MCP is deferred. It would require a separate OAuth/
resource-server, origin/session, rate-limit, ingress and advisory review. The
stdio process must not be proxied and described as remote MCP. The accepted
transitive Hono moderate advisory is unreachable only under this stdio-only
decision and must be reopened before remote transport.

The stdio API deadline is 300 seconds because bounded conflict preview can need
roughly 160 seconds for 32 availability calendars in four concurrent 20-second
provider lanes. The client validates only 1–600 seconds. Aborting does not prove
server cancellation: GET timeout is `api_timeout`; POST/DELETE timeout is
`api_timeout_outcome_unknown`, requiring current-state inspection before retry.

## 2026-07-21 — Provider-contacting API proposals receive alpha rate guards

The API process limits each organization/actor-kind/session-or-token fixed
window: read 600/minute, apply 120/minute, and provider-contacting propose 30
per 10 minutes. It returns safe HTTP 429 `api_rate_limited` with `Retry-After`,
which the MCP adapter may expose. Conflict preview also counts durable live
unconsumed rows and refuses a principal at 10 with `preview_rate_limited`.

These controls reduce accidental/provider-inference blast radius in the current
single-process alpha. They are deliberately not represented as production abuse
control: request counters reset on restart and are not shared across replicas;
the preview count is a preflight, not a concurrency-hard quota; and planning/
public features need their own limits. A shared persistent limiter, concurrency/
bypass/cardinality matrix, and provider-quota evidence remain release work.

## 2026-07-21 — Live Google invitation response is release-gated

Google apply performs exact event GET and conditional self-attendee PATCH with
`attendeesOmitted=true`, configured comment, `If-Match`, and
`sendUpdates=none`. Google documents attendee `responseStatus` propagation, not
guaranteed organizer delivery of the comment. Planipus deliberately avoids
broad `sendUpdates=all` guest updates; provider documentation/fixtures still do
not prove that no mail/calendar notification occurs.

`PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE` is therefore a strict boolean
defaulting false. Preview remains available but activation fails while provider
writes are off; conflict-rule resume fails too. Preview/list/capabilities
separate provider-write state from message-delivery state; fake mode is
simulated and Google delivery remains
unverified even when writes are enabled. Setting true is experimental operator
consent, not feature promotion; disposable organizer, work-attendee, personal,
and observer evidence is required before release.

A post-write verification that confirms self RSVP `declined` but does not retain
the requested attendee comment is still a completed safe RSVP. The action/rule
reports `decline_comment_not_retained`, the immutable fact consumes budget, and
Planipus does not repeatedly PATCH an already-declined invitation. This warning
does not promote message delivery beyond `unverified_google`.

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
