# No-copy conflict response, API tokens, and MCP

Status: Server alpha implemented in this worktree; live Google invitation
response is release-gated. This document is the authoritative feature contract
for the new Server-only surface. It does not extend Planipus for Mac.

## Problem and promise

A user may want personal commitments to protect their work time without placing
even a redacted `Busy` copy on an employer calendar. A **conflict-response rule**
therefore has a deliberately narrower effect than a calendar bridge:

1. Planipus asks the provider only whether selected personal calendars are busy
   in a time range.
2. Planipus finds future work invitations that are still awaiting the connected
   work identity's response.
3. When those two intervals overlap, Planipus rechecks both facts and may decline
   the work invitation with a static, user-configured response comment.
4. Planipus never creates a personal-event copy on the work calendar, stores a
   personal event identifier, or stores personal event content for this feature.

This feature is not a general meeting assistant. It never accepts an invitation,
changes an existing acceptance or tentative answer, declines an event organized
by the connected identity, moves a meeting, or creates an out-of-office event.

## Edition boundary

The HTTP API, API tokens, MCP adapter, and conflict-response rules exist only in
**Planipus Server**. The autonomous native Mac edition has its own credentials,
database, sync runtime, and lifecycle. It neither calls this API nor receives
this feature through a Server installation. Adding it to Mac would require a
separate product decision, native implementation, provider proof, tests, and
release evidence.

The practical consequence is explicit:

- a Server installation can continue responding while its Kubernetes workload
  and provider connectivity are healthy;
- a Mac installation continues only while that independent app can run; and
- installing both products does not pair, synchronize, or transfer these rules.

## Architecture and authority

```text
MCP host
  └─ local Planipus MCP process (stdio only)
       └─ HTTPS, or HTTP to loopback only
            └─ Planipus Server HTTP API
                 ├─ authorization and validation
                 ├─ preview/activation services
                 ├─ PostgreSQL rules, actions, jobs, and audit
                 └─ Google or deterministic fake provider adapter
```

The Server HTTP API is the sole policy and mutation authority. The MCP process
contains no database client, provider credential code, OAuth implementation,
calendar adapter, policy repository, or bypass. It validates tool arguments,
sends bearer-authenticated API requests, bounds response size/time, and maps
safe API errors into MCP results. Calendar titles, descriptions, comments, and
provider responses are untrusted data; they never grant tool or token scope.

The first supported MCP transport is local **stdio**. The process may run on an
operator workstation and call the cluster API over HTTPS, or run beside a local
Server and use loopback HTTP. A remotely exposed Streamable HTTP MCP endpoint is
not implemented: it would add a separate OAuth/resource-server, origin, session,
rate-limit, and deployment boundary. Do not put the stdio process behind an
ingress and call it remote MCP.

## API token contract

API tokens are dedicated machine credentials, not browser sessions and not
Google tokens. Only an authenticated active installation owner may issue or
revoke them through the browser session/Origin/CSRF-protected settings surface.

- Plaintext format: `pln_api_<random value>`.
- The plaintext is returned once at creation. It cannot be recovered later.
- PostgreSQL stores a SHA-256 digest, label, normalized scopes, owner,
  organization, creation/expiry/last-use/revocation timestamps, and no plaintext.
- Expiry is required, defaults to 30 days, and may be 1 through 365 days.
- Revocation is immediate for later API authentication.
- A token is bound to one active principal and organization membership.
- Browser cookies plus an `Authorization` header are rejected as ambiguous
  credentials. A bearer request does not use browser CSRF authentication.
- Tokens belong in secret storage or a private MCP-host environment, never a
  command argument, URL, repository, screenshot, issue, or log.

Scopes are intentionally small:

| Scope | Allows | Normalization |
|---|---|---|
| `read` | privacy-safe reads and MCP resources | no implied scope |
| `propose` | reads plus previews; conflict preview contacts calendar providers and returns sensitive overlap counts/time-only examples, but performs no RSVP/rule activation | implies `read` |
| `apply` | reads, previews, activation, pause/resume, and reconciliation | implies `propose` and `read` |

Use `read` alone when an MCP host does not need previews. The common `read` +
`propose` token is materially more sensitive: conflict preview sends free/busy
queries to connected providers and can infer private-busy/work-invitation
overlap counts and example times. “No write” does not mean “no provider contact”
or “low sensitivity.” A future narrower conflict-preview scope is open
hardening work.

Apply requires both an API token containing `apply` **and**
`PLANIPUS_MCP_ENABLE_APPLY=true` on that MCP
process. The process flag defaults to false and removes apply tools entirely;
it is a second capability boundary, not a substitute for server authorization.

The current API process also applies fixed-window, in-memory limits per
organization + actor kind + session/token: `read` 600/minute, `apply`
120/minute, and provider-contacting `propose` 30/10 minutes. Exceeding a window
returns HTTP 429 `api_rate_limited` with `Retry-After`; the MCP client allowlists
that safe code. Independently, conflict preview refuses a new preview when that
principal already has 10 unconsumed, unexpired previews, returning HTTP 429
`preview_rate_limited` (`Retry-After: 60`). This persisted preflight reduces
provider/inference abuse but is not yet a concurrency-hard database quota.

The request counters reset on API-process restart and are not shared across
replicas. They are alpha blast-radius controls, not distributed/persistent abuse
protection or planning/public-endpoint rate limiting. Production/multi-replica
promotion requires a shared limiter, concurrency proof, bypass/cardinality
tests, and explicit planning-specific controls.

## HTTP API

All responses use `Cache-Control: no-store`; API errors contain a safe code and
request identifier, not provider bodies or secrets. Machine requests send
`Authorization: Bearer <token>`. Production requests use HTTPS.

### Token administration (browser-session only)

| Method and path | Input/result |
|---|---|
| `GET /api/v1/api-tokens` | metadata only; never plaintext tokens |
| `POST /api/v1/api-tokens` | `{label, scopes, expires_in_days}`; returns the plaintext `token` once |
| `DELETE /api/v1/api-tokens/:id` | revokes the owner's token |

`GET /api/v1/auth/context` accepts a browser session or bearer `read` scope and
returns actor kind, principal, organization, and effective scopes.

### Bearer-readable API

These existing Server routes accept bearer `read` scope as well as a browser
session:

- `GET /api/v1/connections`
- `GET /api/v1/calendars`
- `GET /api/v1/overview`
- `GET /api/v1/capabilities`
- `GET /api/v1/policies`
- `GET /api/v1/health/detail`
- `GET /api/v1/conflict-response/rules`

OAuth start/callback, session, metrics, planning-alpha administration, manual
whole-installation sync, and token administration remain browser-only unless a
later reviewed contract says otherwise.

### Preview (`propose`)

`POST /api/v1/conflict-response/preview`

```json
{
  "name": "Protect work from personal conflicts",
  "response_calendar_id": "work-calendar-endpoint",
  "availability_calendar_ids": ["personal-calendar-endpoint"],
  "decline_message": "I have a private conflict at that time. Please choose another time.",
  "horizon_days": 60
}
```

The name is 1–160 visible characters, one through 32 unique availability
calendars are required, the response calendar cannot be in that set, the comment
is 1–500 visible characters, and the horizon is 1–90 days. Unknown fields are
rejected. The response calendar must be readable and writable through an active
`both` connection. Availability calendars must expose opaque free/busy through
active `availability`, `source`, or `both` connections. In API and MCP calendar
documents, `readable` means permission to read **event content**; it is therefore
intentionally `false` for an availability-only endpoint. Callers must use
`capabilities.freebusy_readable` to identify a free/busy-only endpoint rather
than treating `readable: false` as unavailable. `availability` is the recommended
strict-private role: it grants CalendarList plus provider free/busy only and the
event sync coordinator never mirrors its event records. A dedicated
availability-only calendar that has never participated in a bridge is safest.

Distinctness is checked on the underlying provider calendar, not only the local
endpoint ID. Google calendar IDs are global across delegated connections:
response/availability aliases or duplicate availability aliases fail
`same_provider_calendar`. Non-Google identities remain connection-scoped unless
that provider later supplies an equally strong global-identity contract.

A calendar selected as private availability may not have an **active** outbound
copy bridge, regardless of destination. Conflict-rule preview/activation/apply
reject that with `copy_policy_conflict`. It also may not be the destination of
an active **or paused** bridge: surviving inbound copies can contaminate private
free/busy and create self-conflicts, so setup rejects them with
`availability_copy_feedback`. Bridge preview/activation/resume rejects a
protected calendar in either direction with `no_copy_rule_conflict`.

Conflict activation locks every selected local availability endpoint and its
canonical provider-calendar identity. Bridge activation/resume locks both local
endpoints and both persisted canonical source/destination identities using the
same tenant-scoped, transaction-scoped PostgreSQL advisory key before rechecking
the cross-table invariant. Keys are sorted and de-duplicated. This prevents a
concurrent mutation, delegated Google alias, or later bridge to a third calendar
from defeating the boundary. A bridge whose source and destination aliases are
the same underlying provider calendar fails `same_provider_calendar` rather
than creating a copy loop.

An existing outbound bridge can be paused before enabling no-copy protection.
Its already-created managed destination copies deliberately remain; activation
does not delete, detach, or redact them. While any non-deleted conflict rule
protects the source—even when that rule is paused—the bridge cannot resume. The
current alpha has no supported cleanup flow for those older copies, so preview
and operations must disclose them rather than claiming the whole
installation contains zero copies. `DELETE
/api/v1/conflict-response/rules/:id` idempotently retires the protection rule and
supersedes pending/held actions, after which the bridge may resume. Retirement
does not accept/undo an applied decline or clean older bridge copies.

Only one non-deleted conflict-response rule may control an underlying work
provider calendar. The durable `response_provider_identity` closes the local-
endpoint loophole: Google delegated connections that refer to the same remote
calendar are one controller and one safety-budget identity. The message is one
static 1–500-character string per rule; there is no template interpolation and
no personal event field can enter it automatically.

The response includes:

- an opaque, one-use `preview_token` with a ten-minute expiry;
- counts of eligible invitations, conflicts, and conflicts held for missing
  revision protection;
- at most three time-only examples; and
- explicit no-copy and eligibility warnings;
- `provider_writes_enabled`; and
- `message_delivery`, exactly `simulated` for fake mode or
  `unverified_google` for Google mode.

When writes are off, warnings include `invitation_writes_disabled`. Google
previews always include `decline_message_delivery_unverified`, even when the
experimental RSVP write gate is on.
`paused_bridge_existing_copies_remain` discloses a paused outbound bridge;
`availability_role_may_retain_event_content` discloses source/both account use;
and `automatic_decline_budget_will_hold_excess` appears when the preview exceeds
the remaining allowance in the 20-per-response-provider rolling-24-hour safety
budget. Immutable `invitation_response.declined` audit facts—not mutable action
status—supply the count. Declines from retired/recreated rules, delegated aliases,
rescheduled invitations, and reused action rows therefore remain in the same
allowance.

No invitation title or personal event identity/content is returned. Preview
does not create a rule and does not change an RSVP. Rule-list rows repeat the
two capability fields. `GET /api/v1/capabilities` exposes the installation-wide
`conflict_auto_decline_provider_writes` boolean and
`conflict_decline_message_delivery` state.

`POST /api/v1/policies/preview` is the corresponding calendar-bridge proposal
route and also requires `propose` for bearer callers.

### Apply (`apply`)

| Method and path | Effect |
|---|---|
| `POST /api/v1/conflict-response/rules` | consume `{preview_token}` and activate a rule after stale-input recheck |
| `POST /api/v1/conflict-response/rules/:id/pause` | stop new reconciliation/apply work; never undo prior declines |
| `POST /api/v1/conflict-response/rules/:id/resume` | activate and enqueue reconciliation |
| `POST /api/v1/conflict-response/rules/:id/reconcile` | enqueue an idempotent re-evaluation |
| `DELETE /api/v1/conflict-response/rules/:id` | idempotently retire; supersede pending/held actions; never undo applied declines |
| `POST /api/v1/policies` | consume a sync-policy preview and activate a bridge |
| `POST /api/v1/policies/:id/pause` | pause a bridge |
| `POST /api/v1/policies/:id/resume` | resume a bridge |
| `POST /api/v1/policies/:id/reconcile` | request bridge reconciliation |

Activation and conflict-rule resume are fail closed on provider capability. In
fake mode writes are simulated and both are available. In Google mode
`PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE=false` makes
`provider_writes_enabled=false`; activation/resume returns HTTP 409
`invitation_writes_disabled` instead of creating/reactivating a rule. Enabling
the Google RSVP gate changes write capability only—`message_delivery` remains
`unverified_google` until live evidence exists.

The browser can use the same feature routes with its session, exact Origin, and
CSRF token. Preview activation fails stale if its stored rule/input snapshot no
longer matches the fresh provider-derived snapshot.

## MCP contract

Package: `@planipus/mcp`, based on the official Model Context Protocol TypeScript
SDK 1.29.0. It is a separate process launched with:

```text
PLANIPUS_API_URL=https://planipus.example.test
PLANIPUS_API_TOKEN=<one-time token from Settings>
PLANIPUS_MCP_ENABLE_APPLY=false
```

`PLANIPUS_API_URL` must be an origin with no credentials, path, query, or
fragment. It must use HTTPS except for `localhost`, `127.0.0.1`, or `[::1]`.
The launched MCP process uses a 300-second API deadline and caps responses at one
MiB. The lower-level client accepts validated deadlines only from 1 through 600
seconds; the stdio environment does not currently expose that as a setting. The
300-second default covers the API's bounded worst-case private-availability
query (up to 32 calendar groups, four provider calls in parallel, 20 seconds per
call; roughly 160 seconds). HTTP redirects are rejected. Startup/configuration
failures go to stderr so stdout remains a valid MCP stdio stream.

A timeout is not proof that the authoritative API canceled its work. Timed-out
GETs return `api_timeout` and may be repeated. Timed-out POST/DELETE calls return
`api_timeout_outcome_unknown`; the caller must list/read current state before
deciding whether any mutation should be retried. This distinction also applies
when the deadline expires while reading the response body.

Read tools (token needs `read`):

- `list_connections`
- `list_calendars`
- `get_sync_health`
- `list_policies`
- `get_policy`
- `list_conflict_response_rules`

Proposal tools (token needs `propose`; available by default):

- `preview_sync_policy`
- `preview_conflict_response_rule`

MCP metadata marks `preview_conflict_response_rule` as
`openWorldHint: true`, `readOnlyHint: false`, and `destructiveHint: false`. It
does not mutate Planipus or RSVP state, but it calls external provider free/busy
and creates a durable expiring preview, so a host must not treat it as a closed-
world local read. Bridge preview retains closed-world proposal metadata because
it evaluates the synchronized local observation model.

Apply tools (token needs `apply` and process apply flag must be true):

- `activate_sync_policy`
- `pause_policy`
- `resume_policy`
- `reconcile_policy`
- `activate_conflict_response_rule`
- `pause_conflict_response_rule`
- `resume_conflict_response_rule`
- `reconcile_conflict_response_rule`
- `retire_conflict_response_rule`

Static JSON resources (token needs `read`):

- `planipus://capabilities`
- `planipus://overview`
- `planipus://connections`
- `planipus://calendars`
- `planipus://policies`
- `planipus://conflict-response-rules`

Tool schemas are strict and bounded. Results preserve safe error code, HTTP
status, request ID, and numeric `Retry-After` when available; arbitrary server
error messages and provider content are not reflected into the model context.

## Conflict eligibility and fail-closed table

An invitation is eligible only when every row below is true at evaluation and
again immediately before the provider write:

| Condition | Required result | Otherwise |
|---|---|---|
| origin | provider-original | ignore/supersede |
| lifecycle | confirmed | cancelled/deleted ignored |
| timing | valid timed interval, starts in future, inside horizon | all-day, invalid, started, or too-far invitation ignored |
| relationship | connected identity is attendee, not organizer | ignore/hold |
| RSVP | self attendee is exactly `needs_action` when creating/revalidating a new candidate | accepted/tentative fail closed; declined creates no new action, while an existing pending action uses the conservative recovery below |
| work revision | non-empty and unchanged | hold; do not blind-write |
| personal availability | fresh provider free/busy overlaps the exact work interval | supersede; do not decline |
| rule | active and same revision/basis | no-op |
| provider write gate | fake provider, or explicit live-Google opt-in | hold |
| safety budget | fewer than 20 applied/reserved automatic declines for the underlying response-provider calendar in the rolling 24-hour window | hold as `automatic_decline_budget_exceeded` |

Eligible invitations may last at most seven days and both start and end inside
the horizon. The work response calendar must have a ready successful sync no
older than 15 minutes. A successful work response-calendar sync immediately
enqueues conflict-rule reconciliation; the 15-minute scheduler remains a safety
fallback. The indexed candidate query selects only future confirmed provider-
original timed attendee/`needs_action` observations and fails closed above 5,000
rows. The 20-per-response-provider budget is a blast-radius guard, not a complete
API abuse/rate limit. It is evaluated across historical rules with the same
provider identity, so retirement/recreation or a delegated Google alias does not
reset it.

The coordinator first identifies candidates from the work-calendar observation
mirror. For each candidate it computes an action basis from the rule revision,
work observation hash/timing, and opaque busy intervals. Before apply it locks
the action and rule, reloads the work observation, repeats eligibility/revision
checks, performs a fresh free/busy query for the exact invitation interval, and
asks the provider adapter to GET and conditionally update the exact invitation.
Provider adapters must reject organizer events, missing self-attendee identity,
cancelled events, non-`needs_action` RSVP state, and revision mismatch.

For a durable pending Planipus action, an initial exact provider GET that already
shows the self attendee as `declined` is terminal conservative crash recovery.
Planipus records `applied` with `changed=false` and sends no PATCH. Exact comment
equality sets `comment_retained=true`; an absent/different comment surfaces
`decline_comment_not_retained`. Both cases append the normal immutable decline
fact and consume the provider-identity budget. This may conservatively
attribute/count a manual decline, but it cannot overwrite the user's response
or relax the 20/24-hour limit. Accepted and tentative remain held/fail closed.

Google write-side 5xx responses and failures while reading the write response
are ambiguous rather than proof of failure. They trigger an exact GET and use
the same conservative recovery rule; without a verified declined state the
action remains retryable/held rather than guessing.

After Planipus attempts the conditional write, a verification read may prove the
self attendee is declined while Google did not retain the requested attendee
comment. The RSVP is still the safe desired state: the action is `applied`, the
decline consumes the rolling budget, and both action/rule surface
`decline_comment_not_retained`. It is not retried or overwritten merely to chase
comment retention. An accepted or tentative answer observed before the Planipus
write still fails closed.

Pause is prospective. Planipus does not auto-accept or undo declines if a
personal conflict later disappears, a rule is paused, or a rule is removed.

## Google provider behavior and release gate

Personal availability uses Google Calendar `freeBusy.query`, grouped by the
owning provider connection. Planipus receives only time intervals from this
boundary. An `availability`, `source`, or `both` Google connection requests
`https://www.googleapis.com/auth/calendar.freebusy`; existing connections do
not gain that grant automatically and must be reauthorized before use. The
`calendar.freebusy` grant authorizes Google's Freebusy resource, not
`Events.list`. Planipus also enforces the connection-role boundary so event sync
never ingests event content from an `availability` connection.

Google may return accumulated grants from earlier consent even when Planipus
requests the narrower availability set. An availability callback rejects
`oauth_scope_overbroad` if **any** broader Calendar scope remains. The callback
must also receive a reported scope set: an omitted set fails
`oauth_scope_unverified`, rather than treating Planipus's requested scopes as
evidence of Google's grant. The user must revoke the previous Planipus grant at
Google and reconnect availability-only;
the failed callback neither changes the existing Planipus role nor proves that
stored event content was purged. This manual revoke/reconnect behavior and the
resulting live Google grant remain release-evidence gaps.

Reauthorizing a previously event-readable `source`/`both` connection as
availability-only is a transactional privacy downgrade, not a label change. It
returns `availability_role_change_blocked` while live bridge/planning/work-
response rules or historical projection/invitation-action references still need
that connection's observations. Pause is insufficient. Planning/response rules
have retirement paths, but this alpha has no bridge-retirement or historical-
reference purge path; those blockers require keeping the broader role or using
a distinct dedicated availability account. OAuth callbacks for one organization/
Google subject serialize on a transaction advisory lock before selecting the
provider connection `FOR UPDATE`, closing both first-connect and
reauthorization races.
The downgrade then acquires the same sorted per-calendar advisory locks as
feature activation before dependency recheck. If clear, Planipus purges
observations and cursors, retires subscriptions and pending/retry sync jobs,
marks endpoints non-readable/non-writable, records audited counts, and commits
the narrower role. Calendar discovery, cursor initialization, page persistence,
and finalization lock/revalidate the connection so stale in-flight event content
cannot reappear.
Never force the transition by editing PostgreSQL.

For a new private-personal setup, choose `availability`. That role does not grant
event-list read access and cannot be used as a Calendar Sync bridge source. A
calendar on a `source` or `both` connection can also supply free/busy, but its
event content may already be present in the general source-observation mirror for
an independently configured bridge. The conflict-response aggregate still never
reads or stores those personal event records; the stronger installation-wide
"no personal event content persisted" claim requires availability-only accounts.

The work response account must use role `both`: it needs event read access to
find and revalidate invitations and event write access to RSVP. Google apply
performs an exact event GET and a conditional PATCH of only the signed-in self
attendee, with `attendeesOmitted: true`, `responseStatus: declined`, the static
comment, `If-Match`, and `sendUpdates=none`.

Google documents attendee `responseStatus` propagation, but does not guarantee
that the accompanying attendee comment will be delivered to or shown to the
organizer in every account/client combination. Planipus deliberately requests
`sendUpdates=none` instead of `sendUpdates=all` so it does not initiate broad
guest-update mail; that request still cannot prove that Google emits no mail or
calendar notification as a consequence of the RSVP. Consequently:

- fake-provider preview/reconcile/apply may be exercised locally;
- live Google response writes default off with
  `PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE=false`;
- setting it true is experimental operator consent, not release evidence; and
- public release remains blocked on a disposable-account live matrix proving
  comment visibility and notification behavior.

Even with writes enabled, Google may verify the RSVP as declined without
retaining the attendee comment. Planipus records that as an applied decline with
warning `decline_comment_not_retained`; the 20/24-hour budget still counts its
immutable decline audit fact. `message_delivery` remains `unverified_google`.

Do not claim organizer-only comment delivery, zero mail, or production safety
until that matrix is archived for the release commit.

## Durable model and privacy boundary

Server migrations `0006_api_tokens.sql`,
`0007_conflict_response_rules.sql`, and
`0008_availability_connection_role.sql` through
`0014_canonical_calendar_protection.sql` add:

- `api_tokens`: hashed machine credential metadata and lifecycle;
- `conflict_response_previews`: immutable draft, draft/input hashes, privacy-safe
  result, reference time, expiry, and one-time consumption;
- `conflict_response_rules`: owner, work response endpoint, durable underlying
  provider-calendar identity, canonical rule, revision/status/health;
- `conflict_response_availability_calendars`: selected calendar endpoint IDs,
  not provider event IDs;
- `invitation_response_actions`: work-side observation/event/revision identity,
  rule/basis hashes, desired static comment, state, result revision, and health;
- the provider connection `availability` role without rewriting historical
  connection roles;
- local-endpoint and underlying-provider one-live-controller uniqueness;
- a bounded future-unanswered-invitation candidate index;
- domain-separated HMAC support for private snapshot/action basis values;
- a durable provider-calendar identity/one-live-controller index that survives
  delegated Google aliases and rule retirement/recreation;
- a partial immutable-decline-audit index supporting the rolling provider-
  identity budget; and
- canonical source/destination identities on sync policies plus canonical
  identities on protected availability selections, alias-aware lookup indexes,
  and a database check against a live alias self-copy bridge.

Migration 0014 backfills those length-prefixed identities. Google uses the
global scope because one Google calendar ID names the same provider resource
across delegated connections; other providers remain connection-scoped. A
pre-existing Google alias self-copy bridge is fail-closed quarantined: its policy
becomes `deleted` with `same_provider_calendar`, pending/leased/retry outbox
effects become `dead`, and pending/leased/retry reconcile jobs become
`succeeded` with the same safe code. It emits deterministic audit action
`policy.quarantined_same_provider_calendar` with
`historical_copies_untouched:true`. Historical destination copies are not
deleted and require explicit operator review. The database distinctness check
permits equality only on these deleted historical rows.

Availability-event IDs, titles, descriptions, locations, attendees, organizer,
conference data, and event bodies are forbidden from these records, jobs, audit
details, logs, metrics, and API responses. Busy interval times are used in
memory and reduced to keyed `hmac-sha256:` snapshot/basis values before
persistence. The key is derived in a separate domain from the installation
master key, so a stolen database/backup alone cannot cheaply enumerate likely
busy times. Legacy `sha256:` values are accepted only for pre-release migration
compatibility; new values use HMAC. Work-side invitation identity is retained
because a safe conditional RSVP must target the exact work event.

Action states are `pending`, `applied`, `held`, and `superseded`. A missing
revision, changed invitation, unavailable scope, disabled write gate, rule
error, or provider safety rejection holds or supersedes the action; it does not
fall back to an unconditional write.

Every verified provider-side decline appends an immutable
`invitation_response.declined` audit fact. The rolling safety budget counts these
facts by the joined rule's `response_provider_identity` and audit creation time,
not the mutable action status or `last_success_at`. Reconciliation may reuse an
action row after a reschedule, and retirement may supersede it, without erasing
the earlier budget event. A verified decline whose comment was not retained is
still such an event; the action/rule safe warning is
`decline_comment_not_retained`. The fact explicitly uses PostgreSQL
`clock_timestamp()` at verified provider completion; transaction-start `now()`
would age a slow in-transaction provider response too early.

## Operations

- Migrations must complete before API, scheduler, worker, or MCP use.
- API, scheduler, and worker are still separate Server process roles sharing
  PostgreSQL. MCP is an optional separate stdio process and is not a Kubernetes
  service or ingress.
- Each worker loop leases at most one scheduled job and one bridge effect.
  Scheduled jobs renew every lease/3 and immediately before terminal transition; lease loss
  leaves the current owner authoritative and does not stop the worker. This does
  not cancel an in-flight provider call, so conditional/idempotent writes, exact
  ambiguity verification, reconciliation, and provider-I/O-under-lock evidence
  remain required.
- Back up rules/actions/token metadata with PostgreSQL, but never back up a
  plaintext API token because Planipus does not retain it.
- After restore, revoke machine tokens whose external copies cannot be accounted
  for; issue replacements and reconcile active rules. Reconciliation must not
  undo prior declines.
- Monitor safe counts for held actions, rule errors, provider auth failures, job
  dead letters, and token expiry. Never label metrics with token, email,
  calendar title, event ID, comment, or personal interval.
- Rotate tokens by issuing a new least-privilege token, updating the MCP host's
  secret, proving `auth/context`, then revoking the old token.
- Private-basis HMAC rotation is a maintenance boundary, not transparent key
  rollover. Disable provider writes and workers, expire outstanding previews,
  supersede and recompute pending/held actions under the new master key, prove
  old jobs cannot apply, then resume. There is no multi-key verification path.
- If comment/mail behavior is uncertain, disable the Google invitation-decline
  flag immediately. Pausing rules additionally stops new rule work but is not a
  recall of provider responses already sent.
- Activation currently recomputes provider free/busy while its database
  transaction holds the preview row and protected-calendar advisory locks. Apply
  also performs provider reads/writes while action/rule rows are locked. Measure
  provider latency, transaction duration, lock contention, lease expiry, and
  shutdown behavior; move provider I/O behind a committed intent boundary
  before scale or production claims.

## Verification and release checklist

The feature is not release-complete until evidence for the exact release commit
shows:

1. migrations apply on a fresh and upgraded PostgreSQL database;
2. token issue/one-time-display/hash/expiry/revocation, scope hierarchy,
   membership disablement, tenant isolation, cookie+bearer rejection, and audit;
3. MCP config URL/token validation, bounded responses, redirect/error redaction,
   static resources, every tool-to-route mapping, and absence of apply tools by
   default;
4. eligibility cases for organizer, accepted, tentative, declined, cancelled,
   all-day, started, free, changed-revision, and no-longer-conflicting events;
5. no personal event identity/content in SQL, jobs, audit, logs, metrics, API,
   or MCP results;
6. preview expiry/one-use/stale-input behavior, protected-calendar advisory-lock
   races against outbound and inbound bridge endpoints, provider-identity alias
   uniqueness, historical-budget continuity, retirement/resume behavior, and
   apply idempotency under duplicate jobs, crash-after-write, timeout, and
   concurrent RSVP changes;
7. fake-provider end-to-end API → job → provider response coverage;
8. disposable live Google source/both reauthorization and free/busy results;
9. disposable live Google exact-self-attendee decline/comment visibility,
   notification/mail behavior, `If-Match` conflict, ambiguous-write recovery,
   recurring-instance behavior, and organizer/RSVP fail-closed cases;
10. HMAC offline-enumeration and controlled-rotation tests proving old jobs
    cannot apply after rotation; and
11. full workspace, provenance, documentation, vulnerability, image, restore,
    and cluster gates.

The dated evidence record is
[`evidence/2026-07-21-mcp-api-conflict-response.md`](evidence/2026-07-21-mcp-api-conflict-response.md).
It distinguishes checks actually run from planned release gates.

## Primary implementation references

- [Model Context Protocol transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Google Calendar freeBusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Google Calendar Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Google Calendar events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)
- [Google Calendar OAuth scopes](https://developers.google.com/workspace/calendar/api/auth)

These references define protocol/provider capabilities. They do not replace the
live behavior evidence required above, especially organizer comment visibility
and notification/mail observation.
