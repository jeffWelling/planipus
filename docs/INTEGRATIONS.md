# Integration contracts and delivery order

Integrations are adapters to typed ports. A provider never owns product policy,
and product code never depends on a provider's raw model. Each adapter ships only
after fixtures, retry/idempotency rules, permission documentation, disconnect,
and degraded-state UX are complete.

## Shared semantic adapter contract

The editions implement this contract independently. It is a behavior checklist
and conformance-fixture shape, not a shared binary, network service, credential,
or provider cursor.

Every calendar/task/project adapter implements as applicable:

- authorize/connect, scope inspection, refresh/rotate, revoke/disconnect;
- enumerate accounts/collections and select read/write roles;
- bounded initial sync and opaque incremental cursor;
- webhook/subscription create/renew/validate/delete or documented polling;
- canonical upsert/delete observations with recurrence/timezone fidelity;
- opaque provider free/busy queries that return intervals without event identity
  or content, when an availability-only product path requests them;
- idempotent create/update/delete with optimistic precondition;
- exact invitation read and self-attendee RSVP response with optimistic
  precondition, explicit notification controls, and fail-closed organizer/
  already-answered behavior when supported;
- provider error classification: auth, permission, quota, transient, conflict,
  validation, deleted, unsupported;
- health/lag/action-required state and privacy-safe metrics;
- field ownership/conflict mapping and provenance marker;
- export/cleanup behavior on disconnect.

Adapters receive scoped secrets through a secret handle and must not log them.
HTTP clients enforce HTTPS, timeout, response size, redirect, DNS/IP, and proxy
policy. User-configured CalDAV/webhook/model endpoints are SSRF-sensitive.

## Calendar providers

### CalDAV — M2

Adapt selected MIT FluidCalendar behavior and a maintained DAV/iCalendar library
behind the Planipus provider port. Verify RFC 4791 discovery, collection listing,
time-range queries, ETag/CTag/sync-token, recurrence exceptions, and write-back.
Required additions:

- recorded fixtures for Nextcloud, Radicale, Fastmail, iCloud, and common quirks;
- SSRF rebinding/redirect defenses and operator allowlist for private hosts;
- iTIP/iMIP boundary documentation; no claim of organizer invite parity until
  tested;
- explicit sync-token invalidation/full-resync behavior;
- per-calendar availability/write/privacy selection and mirror rules.

### Google Calendar — P0 in both editions

#### Server implementation

Implement an original Google provider behind Planipus policy ports, using
official documentation and Planipus-authored fixtures. It must support multiple
accounts, pagination, bounded ranges, CRUD, recurrence/timezone handling, retry
paths, and provenance without donor code/schema/test reuse. Required work:

- PKCE/state, offline refresh, encrypted token, and role-specific least scopes;
- identity scopes `openid email` plus CalendarList read; `availability` adds
  `calendar.freebusy` only and is never event-synced; source connections
  add read-only events plus free/busy; destination adds event-write; `both` adds
  event-write plus free/busy and is required to read/respond to work invitations;
- existing source/both connections need explicit reauthorization before the new
  free/busy grant is available; no silent scope expansion;
- master-oriented initial/incremental sync with a persisted query fingerprint;
  materialize recurrence occurrences inside the bounded policy horizon; HTTP
  410 stages a replacement full-sync generation without inferring deletion from
  an incomplete scan;
- optional Google watch creation/renewal for public HTTPS installations plus
  mandatory periodic safety sync; private clusters use labeled polling mode;
- extended properties/provenance where available;
- attendees/organizer/recurrence/all-day/conference-data mapping;
- documented Google verification constraints for public multi-user deployments.

#### Mac implementation

Implement a narrow native adapter using URLSession and Google's documented
installed-app OAuth/Calendar APIs. It owns its own Keychain tokens, full and
incremental cursors, normalized observations, projection effects, retries and
health. Required gates:

- system-browser OAuth through a Google iOS client registered to the macOS
  bundle ID, state, PKCE, exact reversed-client-ID redirect, offline refresh,
  role-specific least scopes, revoke/disconnect, and no confidential-client-
  secret assumption;
- one independently stored token per Google identity and unambiguous account +
  calendar labels;
- GRDB/SQLCipher cursor/observation/outbox transactions;
- bounded initial sync, incremental sync token, HTTP 410 scoped full-resync and
  non-destructive reconciliation;
- local polling with jitter/backoff and a slower safety reconciliation; no
  public webhook, local inbound listener, or tunnel requirement;
- direct create/update/delete with preconditions, private provenance and
  post-timeout read-before-retry;
- explicit no-work tests while Quit/asleep/known-offline and one-copy convergence
  after relaunch/wake/reconnect;
- no Planipus Server traffic, pairing, state, credentials, or fallback.

#### Cross-account Google mirroring — primary use case

Each Google OAuth connection is an independent account, not merely another
calendar inside one identity. A self-hoster can connect an employer Workspace
account and a personal Google account, then select calendars from either account
for availability, source, target, or ignore roles.

Mirror configuration is an explicit directed policy: source and destination
account/calendar; a selected working-hours profile or all-times mode; timed,
all-day, free, and RSVP filters; one of the four privacy presets defined in
`CALENDAR-SYNC.md`; provenance markers; loop prevention; and pause, preview,
activate, reconcile, detach, and delete-copy actions with audit records. Two
policies are required for reciprocal flow.

Employer-to-personal defaults should be busy/private with no title. Personal-
to-employer is opt-in and normally free/busy only. Planipus must show the data
boundary before OAuth completion and before the first write. Disposable tests
must use two accounts/calendars and cover recurrence, timezone, duplicates,
loops, source/target edits, remote deletion, revocation, expired cursors, and
the no-write preview path.

Never require a project operated by the canonical maintainers. Server operators
bring a web OAuth application. Mac distribution uses a separately registered
Google iOS OAuth client tied to the macOS bundle identifier under the documented
release/verification model;
credentials and redirects are not interchangeable between editions.

#### Server no-copy conflict response — alpha

The recommended strict-private personal account role is `availability`. Google
authorization then grants identity, CalendarList metadata read, and
`calendar.freebusy`. That free/busy scope does not authorize `Events.list`, and
Planipus role guards also prevent event ingestion or bridge-source use. Calendar
discovery is allowed; the event sync scheduler skips that role. Conflict
response groups selected calendar IDs by connection and uses `freeBusy.query`
for a bounded UTC range. Only returned busy start/end intervals cross the
provider port. Discovered endpoints deliberately expose `readable: false`
because that bit means event-content access, alongside
`capabilities.freebusy_readable: true`; API/MCP clients select on the latter.

The availability callback checks Google's returned grant. If prior consent
causes Google to retain any broader Calendar scope, Planipus fails
`oauth_scope_overbroad`; the user must revoke the old Planipus grant at Google
and reconnect availability-only. If the token response omits its scope set,
availability fails `oauth_scope_unverified`; Planipus does not substitute its
request as proof of the grant. The failed callback does not change the stored
role or claim that prior observations were purged. All callbacks, including two
simultaneous first-connect attempts, serialize organization + verified Google
subject before choosing/upserting the authoritative connection row.

Changing an existing source/both connection to availability-only is not a label
edit. OAuth reauthorization locks and validates the connection. It returns
`availability_role_change_blocked` while a live bridge, planning rule, work-
response rule, or historical projection/action still references event content.
If clear, the transaction purges observations/cursors, retires subscriptions and
queued sync work, restricts endpoints, and audits counts before changing the
role. In-flight sync commits re-lock/revalidate the role so purged content cannot
reappear. Pausing a dependency is insufficient. Supported planning/response
rules can be retired; a bridge or historical-reference blocker has no alpha
retirement/purge path, so keep the broader role or connect a separate dedicated
availability-only Google account.

Source/both calendars may also supply free/busy when a user separately needs a
bridge. Those broader roles can already persist normalized personal observations
for Calendar Sync; the conflict-response domain itself never consumes or stores
that content. Choose `availability` when the installation-wide requirement is
that no personal event content be mirrored locally; a dedicated calendar with no
bridge history is safest. Once selected by a non-deleted rule, the calendar
cannot be either endpoint of an active bridge. An existing outbound bridge may
be paused first; its managed copies remain and resume is blocked until the rule
is retired. Any inbound bridge blocks protection even when paused because its
surviving copies can feed back as private availability.

Google calendar IDs are global across delegated connections, so bridge and
conflict-response checks canonicalize the underlying calendar rather than trust
local endpoint IDs. Duplicate private aliases, response/private aliases, and
bridge source/destination aliases fail `same_provider_calendar`; provider-
identity advisory locks make the no-copy invariant hold across concurrent alias
activation/resume. Migration 0014 quarantines a pre-existing alias self-copy,
dead-letters its unfinished effects, finishes reconcile jobs, writes
`policy.quarantined_same_provider_calendar`, and leaves historical copies for
operator review.

The response calendar uses role `both` and ordinary work event sync to identify
future confirmed timed provider-original invitations for which the signed-in
identity is an attendee at `needsAction`. A successful response-calendar sync
immediately enqueues rule reconciliation, with the 15-minute scheduler as a
safety fallback. Immediately before apply, the adapter GETs the exact event,
rejects organizer/cancelled/missing-self and accepted or tentative answers,
checks `If-Match`, then PATCHes only a `needsAction` self attendee
with `attendeesOmitted=true`, `responseStatus=declined`, and configured comment.
For a pending Planipus action, an already-declined self attendee is terminal
recovery: no PATCH, applied with `changed=false`, and exact comment comparison.
An absent/different comment warns `decline_comment_not_retained`; either outcome
appends the immutable decline fact and consumes budget. This can conservatively
attribute a manual decline but cannot overwrite it or loosen the safety limit.
Google documents propagation of `responseStatus`,
not guaranteed delivery of the attendee comment to the organizer. Planipus
deliberately requests `sendUpdates=none` instead of broad guest updates with
`sendUpdates=all`.
The same static comment is used without event-data interpolation. Automatic
declines above 20 in a rolling 24-hour window for the durable response-provider
identity are held across current and historical rules. The applied count comes
from immutable `invitation_response.declined` audit facts, so provider reschedule
or reuse/supersede of an action row cannot erase it.

The mandatory post-write GET can prove self RSVP `declined` while Google omits
or changes the requested attendee comment. That result is applied with
`decline_comment_not_retained`, consumes budget, and is not repeatedly PATCHed.
It does not prove organizer comment visibility; message delivery remains
`unverified_google`.
Write-side Google 5xx and response-read failures are ambiguous, so the adapter
uses an exact GET verification before reporting success/retry/hold.

Google documentation and local HTTP fixtures are insufficient to claim that the
comment reaches the organizer or that no email/calendar notification is emitted.
`PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE` therefore defaults false. A
disposable organizer/attendee/personal account matrix is mandatory before
promotion and must cover recurrence instances, concurrent RSVP/time changes,
ambiguous timeouts, notification artifacts, quota, and reauthorization. Preview/
list and capabilities expose provider-write and message-delivery state;
activation is refused while Google writes are disabled, whereas fake mode is
explicitly simulated.

### Microsoft 365 / Outlook Graph — M2

New adapter using OAuth2 authorization code/PKCE and Microsoft Graph:

- multitenant/personal account choice is operator configuration;
- Calendar.ReadWrite and offline access only as required;
- per-calendar delta query, persisting next/delta links opaquely;
- change notification lifecycle and validation tokens;
- open extensions/category marker if safe, iCalUID/seriesMaster/occurrence mapping;
- online meeting creation via selected provider/permissions;
- throttling using Retry-After and provider request IDs.

Do not treat Exchange EWS as Microsoft 365 support.

### Exchange EWS — post-M2 compatibility candidate

Historical Cal.rs research shows on-prem Exchange 2013/2016/2019 is a possible
compatibility target, but its AGPL source is not an implementation donor under
the current clean-room policy. Any EWS support must be designed from Microsoft
documentation, a live test environment, and independently approved components.
Basic-auth deployment and EWS deprecation/security caveats must be explicit.
Autodiscovery is SSRF-sensitive. This is compatibility, not the primary
Microsoft path.

### ICS import/subscription/export — M1

- One-time import with dry-run, dedupe, timezone/recurrence diagnostics.
- Read-only subscription polling with ETag/Last-Modified and source attribution.
- Full export of managed calendar, tasks as VTODO where possible, and bookings.
- Never claim two-way sync for a published ICS feed.

## Task and project providers

Delivery order is driven by user evidence, not competitor checkbox parity:

1. Todoist and Google Tasks/Microsoft To Do (personal capture).
2. Linear and GitHub Issues (developer work).
3. Jira and Asana (team/project policy).
4. ClickUp, Notion databases, Trello, and generic webhook/API.

For every adapter, define a table before implementation:

| Canonical field | Remote field | Read/write owner | Conversion | Conflict behavior |
|---|---|---|---|---|
| title | provider-specific | configurable | plain text | surface conflict |
| completion | status/completed | remote or bidirectional | state map | idempotent command |
| deadline | due | configurable | timezone/date semantics | explicit resolution |
| duration | estimate | local by default | unit map | never overwrite silently |
| priority | priority/label | local/remote policy | provider map | explain lossy map |
| project/labels | project/tags | remote | ID mapping | retain unknown labels |
| schedule blocks | usually absent | local | no export unless supported | n/a |

Imported tasks remain linked. Completion propagation is a durable outbox command.
Deletion defaults to unlink/archive, not remote delete.

## Chat and collaboration

### Slack and Microsoft Teams — M4

- capture message to inbox/work item via explicit action/command;
- daily plan and at-risk notifications, user-configurable and quiet-hour aware;
- focus/meeting status only with opt-in and minimum disclosure;
- booking/plan approval interactive messages whose action tokens are signed,
  single-use, and permission checked;
- no channel history ingestion by default.

Workspace installation, bot tokens, signing secrets, event replay, rate limits,
and uninstall cleanup require their own threat model.

### Email — optional post-core integration

The P0 calendar bridge sends no invitations, reminders, or sync-notification
email. Projected provider events explicitly suppress reminders where supported.
Optional password recovery and operational email can be introduced only after
the dependency/security gate, with queued delivery, bounded templates, retry
classification, a test sink, and privacy-safe logs.

Inbound scheduling by email is later and must defend against spoofing, prompt
injection, thread ambiguity, and unauthorized attendee changes.

## Conferencing

- Jitsi deterministic local link pattern is supported with collision-safe random
  component and operator host.
- Generic signed webhook returns URL and metadata under timeout/allowlist.
- Google Meet, Microsoft Teams, and Zoom use provider-native OAuth/scopes and
  idempotency; failure cannot lose the booking.
- Video URL is secret-adjacent; public pages reveal it only after confirmation.

## Identity and secrets

### OIDC — M2/M3

Select a reviewed standards-based OIDC/passkey/session implementation. Add OIDC
authorization code/PKCE with a maintained standards library. Use standards docs
and live Authentik, Keycloak, Dex, and generic-provider tests for behavior; do
not copy Cal.rs source, tests, schemas, or configuration. Require discovery
pinning, issuer and audience checks, domain/registration policy, group mapping,
and account-link confirmation. OIDC group removal follows source-aware
membership rules.

### SCIM — post-1.0/enterprise

Provision users/groups with bearer token hashing, idempotency, soft deactivate,
and audit. SCIM cannot delete personal organizations or provider data implicitly.

### Secret backends — M2+

Environment/Kubernetes Secret supplies the master key initially. Later adapters:
SOPS/sealed secrets are deployment concerns; Vault/KMS envelope encryption is an
application option. Each encrypted record carries key version; rotation is an
online resumable job with dual-read/single-write transition.

## Assistant and model providers

Models are optional intent translators/recommenders:

- OpenAI-compatible HTTP endpoint, local Ollama, and selected direct APIs can be
  adapters after a data-processing review.
- Operator chooses provider, base URL, model, egress, retention assumption,
  redaction, budget, and allowed data classes.
- Local deterministic parser handles common capture commands without a model.
- Model returns typed JSON command validated against current schema/resources.
- No model receives calendar descriptions/attendee emails by default.
- No model can directly apply a plan or call a provider.
- Prompts and outputs have explicit retention and export/delete behavior.

## Automation/API ecosystem

- The implemented Server REST API is the authority for browser and machine
  operations. Dedicated tokens are hashed, expiring, and scoped
  `read|propose|apply`.
- The implemented MCP adapter uses the official TypeScript SDK 1.29.0 over local
  stdio and calls only that API over HTTPS/loopback. Read/proposal tools are the
  default; apply also needs an explicit process flag. Remote Streamable HTTP,
  outgoing webhooks, and CLI remain future surfaces.
- n8n/Home Assistant can use webhooks/API; build dedicated integrations only when
  authentication/discovery materially improves safety.
- Cal.diy/Cal.com coexistence adapter may import event types and observe bookings;
  it does not share database tables or dual-own availability.
- Nextcloud/Radicale are validated CalDAV servers, not bundled dependencies.

## Conformance fixture format

Each provider keeps sanitized fixtures with:

- request method/URL pattern/headers hash/body;
- response status/headers/body and provider version/date;
- expected canonical observations or effects;
- secret placeholders and documented sanitization;
- scenario ID referencing requirement and test.

Mandatory scenario classes: initial sync, pagination, no changes, create/update/
delete, recurrence series/exception, all-day, timezone/DST, attendee RSVP,
organizer change, cancellation, remote deletion, cursor invalidation, webhook
duplicate/out-of-order, 401 refresh, 403 revoked scope, 409/412 conflict, 429,
5xx, timeout, malformed/oversized payload.

Fixtures are reviewed for personal data before commit. Optional live suites run
only against disposable accounts and clean up resources with a unique prefix.

## Provider release checklist

- [ ] Scope/setup/disconnect docs and screenshots.
- [ ] Threat model and SSRF/redirect/secret review.
- [ ] Complete canonical field mapping and known-loss table.
- [ ] Fixture tests and optional live sandbox pass.
- [ ] Cursor/webhook renewal/full-resync behavior tested.
- [ ] Idempotent write/conflict/partial failure behavior tested.
- [ ] Metrics, health, action-required UI, and operator runbook.
- [ ] Export/delete/credential revocation tested.
- [ ] Provider name/logo usage follows trademark guidelines.
- [ ] Support claim is narrow and accurate; beta labels remain until real use.
