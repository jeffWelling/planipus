# Security and privacy architecture

Calendar data reveals location, relationships, routines, health, religion,
employment, travel, and organization structure. Treat event content and even
busy intervals as sensitive regardless of a provider's “public” label.

This document specifies required controls. The repository now has a
credential-free, pre-release implementation with component and local-integration
evidence recorded in `STATE.md` and
`evidence/2026-07-21-build-verification.md`; that evidence is not a release
security certification. Controls remain mandatory and are accepted for release
only after their applicable regression and operational gates pass.

Planipus is a clean-room implementation. Historical Keeper findings are not a
security baseline or a donor roadmap: Keeper material is excluded. Every selected
Planipus dependency receives its own current license, provenance, vulnerability,
secret-handling and update review before it can reach a release.

## Trust boundaries

- The editions are separate trust domains. A Mac installation and a Kubernetes
  installation never exchange sessions, credentials, policies, or state.
- A Mac owner controls the device/login, application, Keychain access, local
  database/backups, and egress and can inspect process memory. The app cannot
  protect against a malicious device owner or compromised login session.
- A Server owner controls cluster, image selection, master key, DB/backups,
  egress, and can inspect process memory. The service cannot protect users from
  a malicious infrastructure owner.
- Organization admins control policy/membership but do not automatically read
  private event details, credentials, assistant prompts, or personal sessions.
- Users/delegates have scoped commands. Delegation is explicit, expiring,
  revocable, and audited.
- Calendar providers are external processors with independent
  security/retention. The operator chooses and supplies credentials.
- Event descriptions, ICS, provider responses, and webhook bodies are untrusted
  data, not instructions.

## Data classification

1. **Secret:** provider refresh/access tokens, client secrets, master/data keys,
   cookies, API/webhook tokens, and encryption keys. Never log/return/export.
2. **Restricted:** event details, attendees, organizer, conference/location,
   calendar labels, and audit diffs. Least privilege; encrypted backups.
3. **Sensitive metadata:** busy intervals, category, team capacity, provider
   identity, sync health. Disclosure can still reveal behavior.
4. **Public:** deliberately published booking profile/event type and project docs.

Classification flows through adapter mapping, logs, metrics, exports, analytics,
assistant redaction, and UI. “Busy only” is sensitive metadata, not anonymous.

## Server identity and session controls

- Local passwords use current Argon2id parameters with per-password salt and
  upgrade-on-login; recovery tokens random, single-use, hashed, short-lived.
- OIDC uses authorization code + PKCE, state, nonce, exact issuer/audience/
  redirect, discovery/JWKS cache and rotation, account-link confirmation.
- Browser session IDs random and server-side; cookies Secure, HttpOnly, SameSite,
  scoped path/domain, bounded lifetime and idle timeout; rotate on auth/privilege.
- Logout/revoke/password/reset/role removal invalidates relevant sessions.
- MFA relies on OIDC initially; local TOTP/recovery codes require separate ADR.
- API tokens are scoped, expiring where possible, random, stored hashed, prefix-
  identifiable, shown once, rotatable, last-used audited.
- Public cancel/reschedule/invite/action tokens are random, hashed, scoped,
  single-use or bounded-use, expiring, and rate limited.

### Implemented API-token and MCP controls

Planipus machine credentials are separate from sessions and provider grants.
Only an active organization owner using a browser session with exact Origin and
CSRF may issue/list/revoke them. The API returns `pln_api_…` plaintext once,
stores only SHA-256 digest and lifecycle metadata, requires expiry (1–365 days),
and rejects expired, revoked, inactive-principal, or non-member tokens.

Scopes are `read`, `propose`, and `apply`; lower scopes are implied when a
higher one is issued. Browser cookie plus bearer is rejected as ambiguous.
Bearer requests never receive OAuth callback, session, token-administration,
metrics, planning-alpha, or whole-installation sync authority merely because
they have `apply`.

`propose` is non-mutating but not low sensitivity. Conflict preview contacts
calendar providers, queries private free/busy, and returns overlap counts plus
time-only work-invitation examples. Issue `read` alone unless that inference is
needed; protect `read+propose` like calendar-derived data access. A narrower
future conflict-preview scope is a valid hardening item.

The MCP adapter is a separate stdio process that calls only the authoritative
HTTP API. It accepts an origin-only HTTPS URL (loopback HTTP is the sole
exception), rejects redirects, bounds request time/response size, validates
strict tool schemas, and maps only allowlisted error codes. It has no direct
database, OAuth, credential-decryption, or provider access. Apply tools are not
registered unless `PLANIPUS_MCP_ENABLE_APPLY=true`, and the API still requires
an `apply` token. Remote Streamable HTTP transport is absent; adding it requires
a new authentication/resource-server and deployment threat review.

Current API blast-radius limits are per organization + actor kind + credential/
session in one process: read 600/minute, apply 120/minute, and provider-
contacting propose 30/10 minutes. Limit responses are safe 429
`api_rate_limited` plus `Retry-After`, including through MCP. Conflict preview
also refuses a principal once 10 live unconsumed previews exist. The former
resets at restart/is not shared across replicas; the latter is a database count
preflight rather than a concurrency-hard quota. Neither substitutes for
distributed persistent limits, planning/public abuse controls, cardinality/
bypass tests, or provider quota handling.

The stdio adapter's API deadline is 300 seconds because a valid conflict preview
can require roughly 160 seconds at the bounded 32-calendar/four-lane/20-second-
provider-call maximum. Client abort does not prove server cancellation. Read
timeouts are `api_timeout`; POST/DELETE timeouts are the stronger
`api_timeout_outcome_unknown`, requiring a current-state read before retry. This
prevents a model/host from treating an unknown activation/retirement result as a
safe no-op and issuing duplicate or contradictory mutations.

`preview_conflict_response_rule` advertises MCP `openWorldHint=true` and
`readOnlyHint=false` (while remaining non-destructive). That is deliberate host-
visible disclosure that proposal contacts external providers and stores a
preview; it must not inherit closed-world/local-read approval merely because no
RSVP is written.

## Native Mac boundary

- The Mac is a complete local installation, not a Server client. It has no
  Planipus login, server profile, native-auth/device credential, or server API.
- Google installed-app OAuth uses the system browser, exact registered redirect,
  high-entropy state, and PKCE. A client secret shipped in the binary is not
  considered confidential.
- Google refresh tokens are separate non-synchronizing Keychain items per local
  provider identity. Short access tokens remain in memory where practical.
- A random SQLCipher database key is a separate non-synchronizing Keychain item.
  Database rows never contain OAuth credentials or the database key.
- The local encrypted database necessarily contains event observations,
  projection mappings, policy configuration, preview inputs/results, cursor and
  audit facts. Retain the minimum fields/horizon needed and purge predictably;
  do not mislabel it a redacted UI cache.
- App Sandbox allows outgoing network, scoped Keychain, app-container storage,
  and explicit user-selected encrypted import/export. P0 has no EventKit,
  Contacts, incoming-network, Apple Events, APNs, or privileged helper.
- No daemon or LaunchAgent continues after Quit. Sleep/offline likewise stops
  synchronization; truthful status and catch-up semantics are security UX.
- Default portable export excludes provider refresh tokens. New-device recovery
  reconnects accounts and proves destination-copy ownership before writes or
  cleanup. Ambiguous provenance requires preview.
- Logs, metrics, crash reports, notifications, menus, diagnostics, and support
  bundles contain no token, event detail, attendee, location, conference data,
  PKCE verifier, or database key.
- The Mac communicates directly with provider HTTPS endpoints. A network test
  proves it never sends data to a Planipus Server or project-operated service.

## Authorization and tenancy

- Deny by default. Every command/query receives authenticated principal,
  organization, effective actor/delegation, and capability.
- Repository methods require organization scope and cannot return global rows to
  ordinary services. Composite unique/foreign keys include tenant where useful.
- Role binding is scoped (organization/team/resource), not a global admin boolean.
- Apply re-authorizes at execution; a preview made before role revocation cannot
  grant continued authority.
- Team meeting search/analytics reveal availability/aggregation only, never event
  titles or hidden policy reasons.
- Cross-tenant/ID enumeration property/API tests are release blockers.

## Server secret storage and rotation

- Master key comes from Kubernetes Secret/file descriptor or configured KMS; not
  database, command line, log, image, ConfigMap, or backup.
- Provider/OIDC/SMTP/webhook/model secrets use AEAD envelope encryption
  (AES-256-GCM or reviewed equivalent) with random nonce, authenticated context
  binding record/tenant/type, and key version.
- Data key material is zeroized where practical. Decryption happens only in the
  narrow adapter action and plaintext is never placed in generic domain structs.
- Rotation uses dual-read/single-write then resumable re-encryption, with audit,
  progress, failure recovery, and old-key retirement after verified backup.
- API/session/booking tokens that need comparison are hashed, not reversibly
  encrypted.
- Exports omit all secrets. Backups contain encrypted envelopes but never master
  key and require destination encryption/access controls.

## Mac secret lifecycle

- Keychain account/service labels use stable local UUIDs, never an event title
  or unnecessary email address, and are not iCloud-synchronizable.
- Choose and test the narrowest Keychain accessibility class that supports use
  after login while the app is running; document locked-Keychain behavior.
- Disconnect revokes the provider grant where supported, deletes the Keychain
  token, and previews managed-copy cleanup separately.
- Database-key rotation is transactional/recoverable. Losing the only key puts
  the store into explicit recovery; the app never replaces it and overwrites
  provider state silently.
- Uninstall behavior and residual Keychain cleanup are documented and tested.
- Encrypted backup format, KDF, versioning, integrity, rollback, and portable-
  credential exclusions require an ADR and independent review.

## Web application controls

- Unsafe browser methods require CSRF token and exact allowed origin; no wildcard
  credentialed CORS.
- Security headers: strict CSP targeting no unsafe inline/eval, HSTS at TLS
  deployment, frame-ancestors none except explicit embed pages, nosniff,
  Referrer-Policy, Permissions-Policy.
- Template autoescaping by default; sanitize intentionally allowed Markdown/HTML;
  provider content never becomes raw template/script/style/URL.
- Input schemas must reject unknown command fields, bound body/string/list/
  horizon/recurrence depth and normalize carefully without changing identity
  semantics. The alpha planning parser currently bounds known values but ignores
  unknown object properties; strict schema rejection is an open release gate.
- Redirect/callback destinations are server allowlisted or signed relative paths.
- File import/export validates type/size/nesting, prevents zip bombs/path
  traversal/formula injection, uses isolated temp quota, and cleans up.
- Error responses use stable safe classes/request ID; no stack, SQL, provider body,
  token, filesystem path, or private conflict detail.

## SSRF and outbound safety

User/operator-configurable CalDAV, EWS autodiscovery, OIDC, webhook, conferencing,
SMTP, object store, and model endpoints are sensitive.

- HTTPS by default; explicit development/private-host exceptions are operator
  config, never supplied by ordinary users.
- Parse URL strictly; reject credentials, fragments, invalid ports/schemes;
  normalize international names.
- Resolve every connection and redirect; block loopback, link-local, multicast,
  unspecified, metadata, and private ranges unless exact operator allowlist.
- Pin/compare resolved destination enough to resist DNS rebinding; validate TLS
  hostname; cap redirects.
- Timeouts, connection/body/decompression limits, content-type/parser limits.
- NetworkPolicy/egress proxy is defense in depth, not replacement for app checks.
- Never return fetched raw response to an untrusted client.

## OAuth/provider/webhook controls

- BYO provider apps and least documented scopes; show scopes before connect.
- OAuth state/PKCE stored server-side, short-lived, single-use, and scoped to
  the initiating principal/organization. Browser-session binding remains an
  explicit hardening item rather than a current claim;
  exact redirect URIs; token response size/error redaction.
- Refresh rotations are transactional so new token is not lost; revoke/disconnect
  is audited and cleans subscriptions.
- Incoming webhooks validate provider channel/signature/timestamp when available,
  use replay/deduplication, and only enqueue observations.
- Outgoing webhooks use HMAC timestamp/body, event ID, HTTPS, backoff, disable and
  replay; signing secret encrypted.
- Provider writes use idempotency/provenance and optimistic remote version. Partial
  effects remain visible; no retry after ambiguous outcome without reconciliation.

## Calendar projection integrity

- The source provider event remains authoritative; Planipus never edits or
  deletes it through a bridge command.
- Policy transformation is deterministic, versioned, and server-side. Suppressed
  source fields are absent from desired-state and projection records unless
  strictly needed for a separately justified reconciliation hash.
- Policy activation/update commits the policy revision, disclosure summary,
  audit, and durable reconciliation intent atomically before provider effects.
- Provider effects are idempotent and carry opaque provenance. Reconciliation
  compares source observation, policy revision, desired hash, destination
  observation, and provider version before create/update/delete.
- Loops are rejected structurally and at ingestion through provenance. Two
  directed policies cannot ingest their own or each other's managed copies.
- A destination copy edited/deleted externally enters a visible conflict or is
  restored according to explicit policy; it is never silently adopted as source.
- Privacy presets set both field transforms and Google visibility. `private` is
  described as ordinary-viewer protection, not protection from calendar editors
  or Workspace administrators.
- P0 never serializes attendees/organizer and explicitly disables reminders, so
  projection creation cannot send invitations or reminder email.
- Hours, recurrence, all-day, RSVP, free/busy, and timezone mapping are tested
  across DST and partial overlaps before any live write claim.
- Dropped or duplicated notifications converge through deduplicated observations,
  cursor sync, safety polls, and reconciliation; ambiguous writes are read back
  before retry.

## Alpha planning integrity and privacy

The Server alpha planner owns destination events directly; it does not mirror a
source event and does not use bridge projections/outbox effects. Its two rule
kinds have different disclosure and notification properties:

- Availability Boundary creates private/default generic protection blocks with
  no attendees, disabled default reminders, and `sendUpdates=none`.
- Smart Meeting stores title, optional description/location, and attendee email
  addresses in the rule/desired documents; it creates independent events with
  those attendees and uses Google's `sendUpdates=all` on create, update, and
  delete whenever the attendee list is non-empty. Automatic replanning can
  therefore notify people repeatedly. There is no provider recurrence series,
  RSVP-aware movement policy, conference creation, invitation quota, or
  planning-specific rate limiter.

The planning JSON documents and preview results are restricted plaintext in
PostgreSQL. They flow into encrypted-at-destination backups, but are not protected
by the provider-credential envelope. Logs and metrics must record only opaque
IDs and bounded reason/error codes. Rule list currently returns the full stored
draft, including attendee addresses and optional meeting content, to any
authenticated member of the organization. Lifecycle commands likewise do not
enforce rule ownership beyond organization scope; this includes rule removal and
suggestion acceptance/dismissal. Removal has no cleanup preview/detach choice and
can send attendee cancellations. That is acceptable only for the current
single-owner profile; it blocks multi-user enablement.

The planning API is enabled in deterministic fake-provider mode. In Google mode
it is fail-closed behind `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`, which
defaults false. This capability flag limits accidental exposure; it is not a
substitute for the live recipient/privacy and abuse gates below.

Preview activation locks and consumes a short-lived preview, rechecks its input
snapshot hash, and recomputes the result. It does not compare the stored and
recomputed result. This is useful stale-write protection, but not yet a full
authorization or availability guarantee:

- every explicitly selected calendar must be active/readable with a ready sync
  no more than 30 minutes old, but unknown required-attendee availability does
  not prevent scheduling or invitation; an attendee calendar reference is not
  required to be among the selected calendars;
- calendar snapshot row ordering is not canonicalized and the evaluation
  instant is absent from the hash;
- caller-supplied rule IDs accept general bounded text at the HTTP boundary;
  malformed non-UUID values can reach UUID database queries and become a 500;
- `lock_before_minutes` is enforced only for a changed desired state whose
  existing future start is inside the window. It does not protect an
  already-started event; after expiry a held `suggest` rule can currently fall
  through to automatic update. Priority remains unenforced;
- current-rule observations are excluded by normalized private marker, but
  desired events from unrelated, unselected Smart Meeting calendars can be
  pooled as busy;
- there is no bounded destination verifier for unchanged planned events, nor a
  public held recovery/reattach command;
- suggestion accept/dismiss revalidates basis, lock, recent availability and
  result, but the schema does not prove the suggestion rule and planned event are
  the same rule;
- rolling reconciliation can currently queue deletion of already-ended Smart
  Meeting occurrences, which can remove history and send attendee updates;
- provider requests execute while a database transaction and row locks remain
  open, with a provider timeout of up to twenty seconds. Contention and lease
  behavior require fault/scale testing.

Provider writes use deterministic IDs, private ownership/intent markers,
generations, ETags, and read-after-ambiguous-create logic. Ownership mismatch and
remote precondition failure hold the event instead of overwriting an unrelated
event. Resume and reconciliation re-enqueue unchanged pending rows; active
target-unavailable holds are retried. Ownership/policy holds remain stranded.
During asynchronous rule removal, target/ownership/precondition failure can
leave `pending_delete` without a scheduled recovery. A periodic rule replan is
not evidence that the remote event was verified.

Before alpha planning is enabled for an Internet-reachable or multi-user
installation, require strict request schemas, per-rule authorization, invite and
replan abuse controls, fail-closed policy choices, held/pending recovery,
destination verification, planning-specific health/metrics, and disposable live
Google tests that observe organizer, required attendee, and uninvolved third
viewer behavior. Current fixture/unit evidence is not a live privacy or
notification certification.

## No-copy conflict-response integrity and privacy

The Server conflict-response feature is a distinct authority from bridges and
planning events. Its strict-private personal connection role is `availability`,
which grants Google CalendarList and `calendar.freebusy`. That scope authorizes
the Freebusy resource, not `Events.list`; the sync coordinator's role guards
also prevent event ingestion and bridge-source use. Endpoint `readable` strictly
means event-content access, so this role stores `readable=false` and the separate
`capabilities.freebusy_readable=true`; API/MCP clients must not conflate them. A user may
also select a source/both calendar, but that account may already have personal
event observations for an independent bridge. The narrower invariant is always
true: conflict response itself reads private calendars only through provider
free/busy and stores no personal event ID/content/copy. A dedicated
availability-only calendar with no bridge history is the safest default.

An availability OAuth callback evaluates Google's returned grant. If Google
retains any broader Calendar scope from earlier source/both consent, Planipus
fails `oauth_scope_overbroad` instead of claiming least privilege. The callback
must receive a reported grant: a missing Google scope set fails
`oauth_scope_unverified`, rather than accepting requested scopes as proof. The
user must revoke the prior Planipus grant at Google and reconnect availability-
only. The failed callback does not change the current role or purge stored
observations;
live revoke/reconnect/downgrade proof remains open. A subject-scoped advisory
lock is taken before choosing the authoritative connection row even on first
connect, preventing concurrent callbacks from escaping this decision boundary.

Narrowing a source/both Google connection to a role without event reads is an
explicit destructive privacy transaction. It locks the connection/endpoints and
serializes one organization/Google subject plus the shared sorted calendar
advisory keys. This closes first-connect, reauthorization, and feature-activation
races. It fails `availability_role_change_blocked` while a live bridge, planning rule,
response rule, or historical projection/action retains a dependency. When clear,
it purges observations/cursors, retires subscriptions and pending/retry sync work,
restricts endpoint access, and audits counts before committing the new role.
Discovery, cursor initialization, page persistence, and finalization lock and
revalidate the connection so an in-flight read cannot repopulate content after
purge. Pausing a dependency is not enough.
Supported planning/response rules can be retired; a bridge or historical-
reference blocker has no alpha retirement/purge path. The safe recovery is to
keep the broader role or use a distinct dedicated availability account, never a
force-purge.

A calendar selected by a non-deleted conflict rule as private availability may
not be either endpoint of an **active** bridge. Conflict setup also rejects any
active/paused inbound bridge because surviving copies can create self-conflicts.
Bridge creation/resume rejects a protected source or destination. Conflict locks
selected local availability endpoints and canonical provider-calendar
identities; bridge mutation locks both local endpoints and persisted canonical
source/destination identities before the cross-table check. Google calendar IDs
are global across delegated connections, so a second account alias cannot bypass
the invariant or create a same-calendar self-copy bridge. Non-Google identity is
connection-scoped. Migration 0014 quarantines a historical alias self-copy as
deleted/dead work with `same_provider_calendar`, leaves its existing destination
copies untouched, and emits `policy.quarantined_same_provider_calendar` audit;
the operator must review those copies explicitly.
An outbound bridge may be paused, but its managed copies remain/disclosed and
resume stays blocked while the rule is non-deleted. Idempotent retirement
supersedes pending/held actions and permits resume; it never deletes old copies
or reverses an applied RSVP.

Conflict activation currently calls provider free/busy while the preview row
and protected-calendar advisory locks remain held in an open transaction. Apply
also performs provider reads/writes while action and rule rows are locked. A
slow provider can therefore lengthen transactions, increase contention, and
interact badly with job leases or shutdown. This requires fault/scale evidence
and an eventual committed-intent/provider-I/O split before production claims.
The scheduled-job heartbeat renews ownership every lease/3 and immediately
before terminal transition, and a stale owner makes no transition. It cannot
cancel a provider call already in flight; idempotency, exact ambiguity reads, and
reconciliation remain security/correctness controls after lease loss.

Busy intervals are sensitive metadata. They are used in memory for overlap and
reduced to domain-separated keyed HMACs before persistence. The HMAC key is
derived separately from the active installation master key, preventing an
attacker with only a database/backup from cheaply enumerating likely busy times.
There is no multi-key verification; rotation must expire previews and
supersede/recompute pending/held actions before writes resume. Rule tables retain
only selected calendar endpoint IDs and static user-configured comment. Action
rows retain exact **work-side** invitation observation/event/revision identity
because a conditional RSVP must target it. Jobs, audit, logs, metrics, HTTP, and
MCP must contain no personal event ID/title/description/location/attendee/
organizer/conference/provider body or interval label.

Apply is fail closed and repeats authorization/state checks: active same rule
revision, future confirmed timed provider-original invitation, connected
identity as self attendee and not organizer, exact `needs_action`, unchanged
revision/hash, and fresh exact-interval free/busy overlap. The provider GET and
conditional PATCH repeat the RSVP/organizer/cancelled/revision checks. Accepted,
tentative, cancelled, missing/unknown-self, organizer, changed, started, or no-
longer-conflicting states are never overwritten. For a durable pending Planipus
action, an initial exact provider GET that already finds self RSVP `declined` is
terminal conservative crash recovery: no PATCH, `applied`, `changed=false`,
exact comment comparison, immutable audit fact, and budget consumption. A
comment mismatch warns `decline_comment_not_retained`. This may conservatively
overattribute a manual decline, but cannot overwrite the user response or relax
the budget. Pause/delete never auto-accepts or reverses an RSVP.
The indexed work query requires a successful sync within 15 minutes, bounds the
candidate set at 5,000, and ignores invitations over seven days. A successful
response-calendar sync immediately enqueues rule reconciliation; the 15-minute
scheduler is a fallback, not the primary freshness signal. One live
controller per durable response-provider identity and a 20-automatic-declines/
rolling-24-hours budget across its historical rules reduce blast radius. This is
counted from immutable `invitation_response.declined` audit facts rather than
mutable action status, so reschedule/reuse/supersede cannot erase a prior decline.
It is not a substitute for API abuse controls or operator-token protection.

Google PATCH is limited to the self attendee with `attendeesOmitted=true`,
configured static comment, `If-Match`, and `sendUpdates=none`. Google documents
propagation of attendee `responseStatus`, not guaranteed organizer delivery of
the comment. Planipus deliberately avoids `sendUpdates=all` and its broad guest
updates; `sendUpdates=none` is still not a zero-mail guarantee. Live writes
default off through
`PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE=false`; comment visibility,
mail/calendar notifications, recurring occurrences, and concurrency remain a
disposable-account release gate.

When the exact post-write read proves self RSVP `declined` but the requested
comment is absent/different, Planipus treats the safe RSVP outcome as applied,
appends the immutable decline fact, consumes budget, and surfaces
`decline_comment_not_retained` on action/rule health. It must not repeatedly
write a confirmed decline to chase comment retention. Accepted or tentative
responses observed before Planipus attempts its write remain fail closed. Google
write-side 5xx and response-read failures are ambiguous and require an exact GET
verification before selecting an applied/retry/held outcome.

Preview/list and `/api/v1/capabilities` expose separate provider-write and
message-delivery states. Google activation fails
`invitation_writes_disabled` while the write gate is off; conflict-rule resume
fails the same way. Fake mode is labeled
simulated; enabling Google RSVP writes must never imply that comment delivery is
verified. Treat these fields as safety state, not cosmetic UI hints.

## Deferred assistant/model controls

- Any future model integration is optional; every otherwise shipped feature
  remains usable with models disabled.
- Minimize/redact data by class; operator/user policy chooses allowed categories,
  endpoint, model, retention, budget.
- Event/task/provider/model text is quoted data and cannot add tools/capabilities.
- Model returns typed command; server validates schema, authorization, references,
  constraints, cost, and current revision.
- Recommendations cite visible inputs. Mutation follows normal preview/apply/audit.
- Model-facing use of the implemented MCP boundary retains separate
  read/propose/apply; apply remains disabled by default.
- Calls record provider/model/purpose/categories/latency/usage/result, not raw
  prompt or secret by default.

## Deferred public-booking abuse controls

- Layered limits per IP prefix, organization, template, guest token, and endpoint;
  bounded slot horizons/results and hold counts.
- Optional self-hosted privacy-preserving proof-of-work/CAPTCHA; no mandatory
  third-party tracker.
- Generic availability/errors prevent account/template/calendar enumeration.
- Slot tokens bind template/time/routing set/revision/expiry and are signed;
  server revalidates.
- Booking forms bound/sanitize fields; email/ICS header injection prevented;
  outbound message quotas and abuse monitoring.
- Cancel/reschedule endpoints do not reveal booking data before token validation.

## Runtime and supply chain

- Non-root fixed UID/GID, read-only root, drop all capabilities, no privilege
  escalation, runtime-default seccomp, no service-account token, resource limits.
- Solo pod is one StatefulSet replica with a PostgreSQL sidecar on one
  RWO PVC; database/queue ports are loopback-only; no privileged chmod init.
- The official MCP SDK 1.29.0 and Zod 4.1.12 are exact MIT-licensed pins and the
  shipped-source provenance scan includes `mcp/`. The current moderate
  `@hono/node-server` Windows static-serving advisory is unreachable because
  Planipus MCP is stdio-only; this is a time-bounded acceptance pending upstream
  SDK remediation and must be reopened before remote HTTP transport. `uuid` is
  upgraded to 11.1.1. A fresh online audit remains a release requirement.
- Locked dependencies, minimal runtime, no compiler/package manager/runtime asset
  download; bundled fonts/assets.
- CI untrusted PRs receive no provider/release secrets. Releases have source tag,
  SBOM, provenance, signatures, checksums, image digest, vulnerability disposition.
- Dependency/license/security updates are reviewed and tested; excluded donor
  material and unreviewed component updates never enter stable releases.

## Logging, metrics, audit, analytics

- Structured allowlisted fields; no request/response bodies, headers, URLs with
  credentials, event/task titles, attendees, form answers, prompts, tokens.
- Metrics labels bounded and contain no users/URLs/titles/raw errors.
- Debug mode is explicit, time-limited, admin-audited, still redacts secrets, and
  warns about restricted content.
- Audit is append-only, actor/effective actor/correlation/policy/result, with
  redacted diff/hash. Hash chaining/external sink makes tampering evident but
  cannot defeat a malicious host owner.
- Team analytics aggregate with minimum cohort and no individual score/ranking.

## Privacy lifecycle

- Read-only provider onboarding until calendar selection and first write preview.
- Purpose/retention settings for raw provider payloads, analytics, assistant,
  audit, jobs, backups.
- User/org export is versioned and excludes others' hidden data/secrets.
- Deletion is a durable audited workflow covering credentials, subscriptions,
  mirrors, managed events choice, assistant/analytics, exports, and backup expiry.
- Disconnect clearly distinguishes revoke, stop sync, delete local mirror, and
  remove managed remote events; destructive cleanup is never default.
- No required telemetry, ads, data sale, or training on user calendar data.

## Threat-control table

| Threat | Primary controls |
|---|---|
| Provider token theft | envelope encryption, least scopes, rotation/revoke, no read/export/log |
| API-token theft/escalation | one-time plaintext, hash, expiry/revoke, least scope, MCP apply double gate, no cookie+bearer ambiguity |
| Cross-site mutation | secure cookie, SameSite, CSRF, origin, CSP, CORS deny |
| SSRF/rebinding | URL/IP/DNS/redirect validation, allowlist, egress policy, bounds |
| Forged/replayed webhook | signature/channel/timestamp, dedupe inbox, quick enqueue |
| Dropped/duplicate events | opaque cursor sync, safety poll, idempotent convergence |
| Calendar duplicate/destruction | policy revision, provenance, outbox/idempotency/ETag, reconcile, cleanup preview |
| Personal-detail disclosure | versioned field transform, private visibility, coworker-view live test, redacted storage/logs |
| Mirror recursion | policy graph rejection, provenance filtering, projection uniqueness |
| Planning invite spam/disclosure | explicit attendee preview, send-update UX, per-rule authorization, quotas/rate limits, live recipient tests |
| Planning self-conflict/drift | exclude owned events from busy input, deterministic provenance, bounded destination verification, visible held recovery |
| Private-calendar disclosure in conflict response | availability-only OAuth, free/busy port, no event sync/content/IDs, in-memory intervals reduced to hashes, privacy inspection |
| Wrong invitation auto-declined | needs-action/attendee/organizer/time/revision checks at reconcile and exact provider apply, fresh free/busy, conditional patch, held/superseded fallback |
| Unauthorized rule control | owner/delegate checks at query, lifecycle command, activation and apply; cross-tenant/owner tests |
| Booking race/abuse | signed offers, atomic holds, revalidation, quotas/rate/captcha |
| Cross-tenant/delegate leak | scoped repo/policy, apply reauth, tenant property tests, audit |
| Prompt/tool injection | data isolation, typed command, capabilities, preview, redaction |
| Compromised pod | restricted runtime, secrets external, egress, minimal image, rotate |
| Curious manager | aggregate/min cohort, privacy labels, no ranking/content, audit |
| Secret/log/export leak | allowlist/redaction tests, hashed tokens, export schema, debug expiry |
| Malicious upstream/dependency | pinned history/lock, review, CI, SBOM/provenance/signatures |

## Security gates

- Foundation: `FOUNDATION-GATE.md` provenance, clean build/tests, advisory and
  timezone remediation, community-capability, runtime, restore, extension seams.
- Every provider: integration release checklist and live/fixture evidence.
- M0/M1: policy/projection/provider-write and tenant/auth threat review, including
  the three-identity Google privacy suite.
- Alpha planning: strict schemas, owner authorization, invitation-abuse limits,
  destination verification/recovery, provider-write fault tests, and a disposable
  live Google attendee/privacy suite before general enablement.
- API/MCP/conflict response: token lifecycle/scope/tenant tests, MCP API-only and
  default-no-apply proof, privacy persistence inspection, exact RSVP concurrency
  suite, and disposable Google comment/mail evidence before live flag promotion.
- M3: public booking abuse/race external review.
- M5: assistant injection/capability/privacy review.
- M5/post-1.0: multi-tenant/scale/worker/analytics review.
- 1.0: formal threat model, penetration test, dependency/license/provenance,
  restore and incident exercises with no unresolved critical/high risk.

Vulnerability reporting policy is in repository root `SECURITY.md`. Do not include
calendar contents, credentials, backups, or live instance URLs in public issues.
