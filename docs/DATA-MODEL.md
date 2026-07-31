# Data model

This document contains two unrelated physical models. The **Server model** is
an original PostgreSQL schema. The **Mac model** is a local GRDB/SQLCipher
schema. There is no replication, foreign key, session, import promise, or
storage compatibility between them. Physical names may differ only when
documented in the relevant edition's migration ADR and compatibility map.
New IDs are UUIDv7 or another sortable 128-bit ID where library/database support
is mature, and no migration rewrites identifiers merely for ordering. All
external IDs are never used as primary keys. All organization-owned tables carry
`organization_id`, `created_at`, `updated_at`, and optimistic `version` unless
explicitly immutable.

## Server migration rule

The Server schema is original and starts at Planipus v1. Before changing it:

1. record aggregate, invariants, forward migration, rollback boundary, and
   Planipus-authored representative fixtures;
2. preserve/version only Planipus serialized API/export contracts;
3. add ownership/policy fields with deterministic backfill rather than unscoped
   rows; and
4. verify a restored prior Planipus release upgrades without provider writes or
   duplicate destination copies.

PostgreSQL is authoritative for solo and standard profiles. P0 has no Valkey;
any future cache/queue may hold only reconstructible execution hints, and every
non-reconstructible intent must already have a PostgreSQL job/outbox row before
it can be acknowledged.

## Time representation

- Instants: UTC timestamp with microsecond precision.
- User/calendar timezone: IANA TZID, never a fixed offset.
- Local intent: local date + local time + TZID + DST resolution policy.
- All-day values: half-open local date range, not midnight timestamps.
- Durations: integer seconds internally; UI accepts minutes/hours.
- Recurrence: original RFC 5545 rule plus normalized query fields; exceptions keep
  recurrence identity.
- Windows/intervals: half-open `[start, end)` so adjacent blocks do not overlap.
- Week start and locale are user preferences; they do not alter stored instants.

Ambiguous fall-back local times require explicit earlier/later choice. Nonexistent
spring-forward times are rejected or shifted only under a named hours policy and
recorded in the policy preview/audit.

## Mac local model

The named aggregates below are the target logical model, not a claim that each
has a dedicated table in the current vertical slice. Every Mac row exists only
inside one application container. Local primary keys are UUIDs; remote provider
IDs are data, never primary keys. OAuth tokens and the database encryption key
are Keychain items, never columns.

The current SQLCipher schema is version 6. It physically stores `sync_cursors`,
`observations`, `change_batches`, `staged_observations`, `projections` (with
destination-edit `hold_code` and `detached` columns), `sync_notices` for
destination-edit records limited to the privacy-transformed copy
summary/timing, `outbox_effects`, `store_metadata`, and one versioned
`app_configuration` JSON
document for non-secret account/bridge/policy presentation state. Dedicated
calendar discovery, normalized hours/exception, audit, and health tables remain
target work. This mapping is intentional and must be migrated—not silently
reinterpreted—when those aggregates become physical tables.

### mac_installation_state

Fields: schema version, conformance/preset version, installation UUID, first-run
and migration state, created/updated time. There is no base URL, remote instance
ID, server protocol, principal, or device session.

### mac_provider_account

Fields: local ID, provider kind, stable remote subject where available, masked
email/display label, token Keychain reference, granted scopes, status,
authorization/last-success/error timestamps and safe error code. It does not
contain refresh/access tokens or raw OAuth responses.

### mac_calendar

Fields: local ID, account ID, remote calendar ID, stable display label,
provider timezone, role/capabilities, access level, selected/ignored state,
revision and observation time. Account identity is always displayed with an
ambiguous calendar name.

### mac_hours_profile and mac_hours_exception

Same language-neutral semantics as the common contract: IANA timezone, weekly
half-open local intervals, DST resolution, overlap/containment mode, local-date
exceptions and revision. Swift storage need not match Server column layout.

### mac_sync_policy

Fields: local ID, source/destination calendar IDs, selection/RSVP/all-day/free/
override settings, privacy preset ID/version and field switches, hours profile,
lifecycle, revision, created/activated/paused timestamps and last preview hash.
Reject source=destination and account/calendar ambiguity at the database and
domain layers where possible.

### mac_event_observation

Minimum normalized source facts needed within the configured horizon: provider
event/occurrence/revision identity, time/recurrence/type/availability/RSVP facts,
fields required by the active transform, managed-copy provenance, tombstone and
observed time. Retention purges observations outside all policy horizons after
projection/reconciliation safety permits it.

### mac_projection

Fields: policy ID/revision, source event and occurrence identity, destination
event ID/revision, managed provenance/generation, desired/applied fingerprints,
ownership (`attached|detached|ambiguous`), status and last verified time. Unique
constraints prevent two attached projections for one policy/source occurrence.

### mac_provider_cursor

Fields: account/calendar ID, provider cursor/sync token, pending page state where
needed, last full/incremental start/success, expiry/reset generation and safe
error. Advance only in the same transaction that commits all observations and
tombstones for the page sequence. HTTP 410 invalidates only the affected mirror
and triggers full read plus non-destructive reconciliation.

### mac_outbox_effect

Fields: effect UUID, policy/projection/generation, operation, canonical desired
fingerprint and encrypted/reconstructible bounded payload reference, state,
attempt count, next attempt, lease, provider request/result revision, ambiguous
flag, safe error and timestamps. Queueing and local desired state commit
transactionally. On ambiguous create/update/delete, read destination provenance
before retry.

### mac_audit_event and mac_health

Audit stores local actor (`user|sync|recovery`), config/effect/recovery reason,
privacy-safe IDs, policy revision, disclosure manifest, before/after hashes and
timestamp. Health stores account/policy state, last attempt/success, lag,
retry/action-needed classification. Logs and diagnostics do not replace this
structured local record and contain no event details.

### Mac backup boundary

An explicit encrypted export contains versioned local configuration and only the
state proven necessary for safe recovery. Provider refresh tokens are excluded
by default. Restore on a new Mac reconnects accounts and scans destination
provenance before effects. Ambiguous ownership remains inert until preview and
confirmation. The format is not a Planipus Server import/export format.

## Server identity and tenancy

### installation

Fields: immutable public `instance_id`, display name, canonical base URL,
deployment mode, API versions, initialization state, created time. Public API
metadata exposes only the safe subset defined in `API.md`; secrets,
provider/account counts, internal hosts, and detailed health are separate.

### organization

Fields: `id`, `slug`, `name`, `default_timezone`, `week_start`, `retention_policy`,
`feature_policy`, `revision`, `created_at`, `updated_at`.

An installation creates a personal organization for the first admin. A household
or team is not modeled as global shared state; every owned row belongs to exactly
one organization. Cross-organization calendars require two independent grants.

### principal

Fields: `id`, `kind(user|service)`, `email_normalized`, `display_name`, `locale`,
`timezone`, `status`, `last_login_at`. Authentication identities are separate:
`auth_identity(id, principal_id, provider, subject, verified_email, metadata)`.

### membership and role_binding

`membership(organization_id, principal_id, state, joined_at)` and
`role_binding(scope_type, scope_id, principal_id, role)` support owner, admin,
planner, member, booking-manager, auditor, and read-only. Team-admin is scoped to
a team. Do not encode authorization in a single user role column.

### team and team_member

Team fields: name, slug, visibility, default scheduling policy, OIDC group link.
Members include scheduling weight, routing priority, active range, capacity,
timezone, and role. OIDC synchronization never deletes a hand-picked membership
without an explicit source field and reconciliation rule.

### delegation

Fields: grantor, grantee, scope, allowed actions, calendar/item filters, starts,
expires, approval requirement, revoked_at. Delegation checks at command execution
and apply time; preview alone does not confer apply authority.

### api_token (implemented Server migration 0006)

Fields: `id`, organization, issuing principal, human label, SHA-256 token digest,
normalized JSON scopes (`read|propose|apply`), mandatory expiry, last-use,
revocation, and creation timestamps. Plaintext is returned once and never stored.
Apply implies propose/read; propose implies read. Authentication also requires an
active principal and organization membership. Creation/revocation are audited;
machine-authenticated domain actions use actor kind `api_token` where the service
records the initiating actor.

Token identifiers are not credentials. Backup/restore may preserve token rows,
but an operator who cannot account for every external plaintext copy revokes and
reissues after restore.

## Calendars and provider mirror

### provider_connection

Fields: `id`, organization, owner principal, provider kind, account label,
remote account ID, auth type, encrypted credential envelope, key version, scopes,
status, error code, connected/revoked times. Credential envelopes contain
algorithm, key ID/version, nonce, ciphertext, and authentication tag. Never return
them from general APIs or exports.

Server migration `0008_availability_connection_role.sql` extends the implemented
Google intent role to `availability|source|destination|both` without changing
historical rows.
`availability` is the strict-private free/busy role: it can discover calendars
and query availability but cannot list events and is excluded from event-sync
jobs. `source` and `both` may populate `source_observation` for bridge behavior;
selecting one of those calendars for conflict response does not erase that
independent persistence boundary.

For role `availability`, the callback validates the **returned** Google grant,
not merely Planipus's requested scopes. Any retained broader Calendar scope
fails `oauth_scope_overbroad`; the user must revoke the prior Google grant and
reconnect. An omitted returned scope set fails `oauth_scope_unverified` for
availability; Planipus does not substitute its request as proof. A failed
callback does not alter the existing connection role or
purge event state. The subject advisory lock is acquired even for first-connect
callbacks before the authoritative connection ID/row is chosen.

Removing event-read access from an existing source/both Google connection is a
transactional data migration. A subject-scoped advisory lock plus connection row
lock serializes first-connect/reauthorization, then the shared per-calendar
advisory locks serialize feature mutation. Live bridge/planning/response-rule dependencies or
historical projection/action references reject with
`availability_role_change_blocked`. Otherwise the transaction deletes that
connection's source observations/cursors, retires subscriptions and pending/
retry sync jobs, restricts endpoints, and audits counts before committing the
new role. Sync page/finalization writes lock and revalidate the connection to
prevent an in-flight read from repopulating purged content; discovery and cursor
initialization are guarded as well.

### calendar_endpoint

Fields: connection, remote ID/href, name, color, timezone, readable, writable,
primary, capabilities, disabled, sync state, last success/error. Privacy and
event selection do **not** live here; one calendar can use different rules for
different destination policies.

`readable` strictly means event-content readable. Opaque provider availability
is represented independently as `capabilities.freebusy_readable`. Thus an
availability-only endpoint persists `readable = false` and
`freebusy_readable = true`; API/MCP clients must not infer event-read authority
from the latter.

### source_observation

Canonical mirror of event/task resources:

- provider identity: connection, collection, remote ID/href, UID, recurrence ID;
- concurrency: ETag/change key, remote modified, local generation;
- normalized event: summary, description, location, start/end/date semantics,
  transparency, status, organizer, attendees, recurrence, exceptions;
- ownership/provenance: provider original or recognized Planipus managed copy;
- hashes of provider-relevant fields and last-applied desired state;
- raw payload only when needed for lossless round trip and encrypted/redacted by
  policy;
- tombstone and observed/deleted times.

Unique constraints prevent duplicate connection/collection/remote identity and
duplicate recurrence instance. Provider payloads are untrusted input.

### sync_cursor, subscription, inbox_event, outbox_effect

Cursor is opaque and advances only after all pages commit. Subscription records
provider channel, encrypted secret/token if any, resource, expiration, renew time,
and health. Inbox deduplicates webhook/poll observations. Outbox records desired
provider creates/updates/deletes with idempotency key, precondition version,
attempt state, and result identity.

### hours_profile and hours_exception

Profile fields: owner, name, timezone, weekly half-open local intervals, mode,
revision, created/updated. Exception fields add/remove intervals for a local date
and record reason/source. Materialized evaluation never stores fixed UTC offsets
as the recurring truth.

### sync_policy

Fields: owner, source/destination connections and calendars, enabled/paused/
review-required state, hours profile, hours match mode, privacy preset/version,
explicit field transform, all-day/free/RSVP/already-invited/override rules,
generic title/category, visibility, transparency, color, horizon, conflict and
destination-edit behavior, revision, health/lag/error, created/updated.

Migration 0014 persists length-prefixed `source_provider_identity` and
`destination_provider_identity`. Google identities use provider + global scope +
remote calendar ID so delegated aliases converge on one resource; other
providers use provider + local connection + remote ID. New preview/activation
rejects equal canonical identities as `same_provider_calendar`, persists both
identities, and uses them for alias-aware locking/no-copy checks.

During upgrade, a pre-existing Google alias self-copy policy is quarantined
rather than activated: status becomes `deleted` with
`same_provider_calendar`, its pending/leased/retry outbox effects become `dead`,
and matching pending/leased/retry reconcile jobs become `succeeded` with that
safe code. Deterministic audit action
`policy.quarantined_same_provider_calendar` records
`historical_copies_untouched:true`. Historical destination copies remain for
explicit operator review.
The database check rejects equal canonical identities for every non-deleted
policy while preserving those quarantined historical rows.

One policy is directed. Reciprocal behavior uses two records. A policy never
grants account access; the actor must hold read access to source and write access
to destination. Unique/validation constraints reject self-maps and duplicate
active identical policies.

### projection

Durable relationship between source observation/occurrence, policy revision,
and destination copy. Fields: source identity/recurrence ID, policy ID,
destination calendar/event ID/UID, desired/source/destination hashes, last
desired state, provider precondition, generation, status, error, last attempt/
success, last destination-verification time, detached/tombstone timestamps,
`source_basis_hash`, and a nullable `recovery_operation` authorized only for a
held projection after current-source shadow evaluation.
Unique constraints prevent duplicate source-policy-occurrence projections.

`last_verified_at` is the durable oldest-first cursor for the bounded
destination-verification pass. It is not evidence that the copy is still
current: a successful create/update sets it, each later verification attempt
advances it, and a delete clears it. Verification reads only the mapped event;
it never turns a destination calendar into a second source feed.

`intent_sequence` is monotonic per projection and participates in every outbox
idempotency key. It distinguishes legitimate repeated transitions such as
A→B→A→B even when generation, policy revision, operation and desired payload
repeat. A successful or confirmed-missing delete advances `generation`; the
new generation is written into provider provenance before a new custom event ID
is used.

`source_basis_hash` binds the normalized source observation hash and its
relational tombstone flag. The same value is stored on each outbox effect. The
worker locks the source observation and projection and requires all three basis
values to match immediately before provider access. A null or changed basis
supersedes the old intent and schedules current-source reconciliation; it never
authorizes a stale write. `recovery_operation` is cleared whenever normal
execution/repair starts or succeeds.

Planipus copies are recognized using both projection mappings and provider
private markers. Copies are never re-ingested recursively. Redacted projections
must not retain forbidden source details merely for convenience.

### sync_notice (Server migration 0006)

User-facing record of a direct edit or deletion of a managed destination copy,
created by destination verification according to the policy's
destination-edit behavior. Fields: organization, policy, projection, kind
(`copy_edit_reverted`, `copy_delete_restored`, `copy_edit_held`,
`copy_delete_held`), status (`unread`, `acknowledged`, `resolved`), the chosen
resolution for held kinds (`restore` or `keep_and_detach`), and a detail
document limited to the privacy-transformed summary/timing the destination copy
already discloses. Notices never contain raw source event fields. Held kinds
carry an open decision while their projection remains an attached
destination-edit hold; resolution either replays the validated recovery
evidence as a marker-verified ambiguous intent or detaches the copy.

The authoritative policy semantics are in `CALENDAR-SYNC.md`.

## Implemented alpha planning model (Server migration 0004)

Migration `0004_planning_rules.sql` adds an original Planipus planning slice for
Availability Boundary and Smart Meeting rules. These records are Server-only;
they are not replicated to, shared with, or import-compatible with the Mac
edition. They are deliberately separate from `sync_policy`, `projection`, and
`outbox_effect`: a calendar bridge mirrors an authoritative source event, while
a planning rule owns independently generated destination events.

All planning JSON documents are validated by the application before insertion,
but PostgreSQL does not currently enforce their internal schemas. Event titles,
descriptions, locations, attendee email addresses, calendar identifiers, and
busy-result metadata in these documents are **restricted plaintext application
data** inside PostgreSQL. Database, backup, export, support, and operator access
must be treated accordingly; credential envelope encryption does not encrypt
these fields.

### planning_preview

`planning_previews` is a short-lived, single-consumption activation artifact:

- organization, requesting principal, and `rule_kind`;
- validated canonical draft document and its hash;
- an input snapshot hash derived from target/availability calendar rows and
  relevant normalized observations;
- deterministic result document containing proposed occurrences, warnings, and
  unmet reasons;
- expiry, consumption, and creation timestamps.

The current service sets a ten-minute expiry. Activation locks the row, checks
organization/principal ownership and expiry, recomputes the current snapshot and
result, and consumes the preview in the same transaction that creates durable
rule state. Preview rows are deleted no earlier than seven days after expiry by
the scheduler; the document can therefore remain in backups longer. There is no
user-facing preview deletion API.

Current snapshot limitations are material: calendar query ordering is not
canonicalized and the preview evaluation instant is not part of the hash. A
preview can therefore be rejected despite unchanged inputs or cross a local-date
boundary without a stale conflict. Smart Meeting preparation does fail closed
unless every selected availability calendar is active, readable, and has a
ready successful sync within 30 minutes. Required attendees without a mapped
calendar remain warning-only and are not represented as proven availability.

### planning_rule

`planning_rules` stores:

- organization, owner principal, `availability_boundary|smart_meeting` kind,
  bounded name, and target calendar;
- lifecycle `active|paused|deleting|deleted`, positive revision, validated rule document
  and hash;
- last planned, successful apply, safe error code, and timestamps.

Activation creates revision 1. The current API can list, pause, resume, request a
replan, and remove a rule, but cannot edit or fetch one rule. Removal changes the
status to `deleting`, increments revision, expires pending suggestions, and
creates remote delete intent for future/current events that may exist. The last
successful cleanup changes the rule to `deleted`; a rule with nothing to clean
transitions immediately. Active rule content remains revision 1 because there
is no edit protocol. A paused rule retains its events and planning rows; it
suppresses normal reconcile/apply execution, while resume re-enqueues both
reconciliation and any pending event intents. The lifecycle command currently
accepts a `deleting` rule, so it can incorrectly interrupt cleanup by setting
the status back to paused/active.

The target calendar composite foreign key proves that the calendar belongs to
the rule organization. The `owner_principal_id` foreign key proves only that the
principal exists; migration 0004 does not prove membership in the same
organization. Application activation uses the authenticated principal, but this
database invariant must be strengthened before multi-user tenancy is enabled.

### planned_event

`planned_events` is durable desired state plus provider-effect state for one
rule occurrence. It stores rule revision, stable occurrence key, destination
calendar, generation, monotonic intent sequence, provider event ID/ETag,
canonical desired document/hash, send-update policy, safe error/reason, and
timestamps. The unique `(rule_id, occurrence_key)` constraint prevents duplicate
local ownership for a rule occurrence; rule tenancy is independently enforced by
the composite organization/rule foreign key.

Lifecycle states are:

```text
pending_create -> converged
converged -> pending_update -> converged
converged -> pending_delete -> deleted
pending_* -> held | unmet
unmet -> pending_create when a later plan becomes feasible
converged -> held | suggestion -> pending_update|pending_delete
pending_delete -> skipped when an accepted skip is applied
any managed/in-flight state -> pending_delete -> deleted on rule removal
```

The coordinator derives a deterministic Google event ID from planned-event ID
and generation and sends provider writes with ETag/idempotency preconditions.
When a mapped event is confirmed missing, generation advances before recreation.
Provider ownership markers bind kind, rule, planned event, occurrence,
generation, and intent sequence. This is a planning-specific intent protocol;
it does not use the calendar-bridge `outbox_effect` table.

An unchanged pending create/update is re-enqueued during reconciliation and
resume. An active rule's unchanged `target_unavailable` hold transitions back to
pending on later reconciliation; ownership and policy holds have no corresponding
recovery command. A failed target/ownership/precondition check while a rule is
`deleting` preserves `pending_delete` but completes the job, and deleting rules
are not periodically reconciled, so cleanup can remain stuck. `skipped` is
terminal under ordinary reconciliation.

There is no bounded remote verifier for unchanged planning events, so an
external destination edit/delete is not detected merely by periodic planning
reconciliation. Rolling Smart Meeting reconciliation advances the effective
cadence start, but its stale-occurrence delete path does not check whether an
attached event has already ended; provider history and attendee notification can
therefore be affected. These are known correctness gaps, not intended lifecycle
semantics.

### planning_suggestion

`planning_suggestions` records proposed `move|shorten|skip` state for an existing
planned event, tied to a basis hash and reason. Status is
`pending|accepted|dismissed|expired`; the scheduler expires pending suggestions
after fourteen days. The current `suggest` conflict policy creates or reuses a
pending suggestion when a converged event's desired state changes.

The API lists pending, unexpired suggestions for active rules and can accept or
dismiss them. Acceptance rechecks the basis hash, current no-move window, recent
calendar availability, and the occurrence's current proposed result before it
replaces desired state, increments intent, queues provider apply/delete, marks
the selected suggestion accepted, and expires sibling pending suggestions. Rule
list responses additionally expose a pending count. The coordinator currently
creates only `move` and `skip`; the `shorten` value is reserved by the schema.

The database foreign keys ensure organization consistency but do not prove that
the referenced planned event belongs to the referenced rule; that same-rule
invariant is currently application-dependent. The unique basis index applies
across all statuses, so a dismissed/expired basis cannot later be re-proposed
without a changed hash.

### Planning retention and restore boundary

Planning rules, planned events (including deleted/skipped rows), and suggestions
have no implemented purge policy. Expired previews are eventually deleted, but
database backups may retain all planning content for the operator's configured
backup lifetime. A restore must inspect these four tables with provider writes
paused, then reconcile deterministic ownership before enabling the worker.
Restoring two instances against the same target calendar is unsafe. Organization
deletion/export is not implemented. Rule removal does enqueue planning-specific
remote cleanup and leaves past provider events, but has no impact preview,
detach option, per-event result surface, stuck-cleanup recovery, or local-row
purge.

## Implemented no-copy conflict-response model (Server migrations 0007–0014)

These aggregates are separate from calendar-bridge projections and planning
events. They never own or create a personal-calendar event. Personal provider
availability enters through free/busy as time intervals and is reduced to
domain-separated keyed snapshot/basis HMACs; no personal event ID or content
belongs in this model.

### conflict_response_preview

`conflict_response_previews` stores organization/principal, validated canonical
draft JSON and ordinary configuration hash, provider-derived keyed input HMAC, privacy-safe result,
fixed reference instant, ten-minute expiry, consumption time, and creation time.
The result contains only invitation/conflict/held counts, time-only examples,
and fixed warnings. Activation locks the preview, verifies owner/expiry/one-use,
reparses and rehashes the draft, recomputes the snapshot, rejects a mismatch or
already-started conflict, and consumes it in the rule-creation transaction.

### conflict_response_rule and availability calendars

`conflict_response_rules` stores organization/owner, name, response calendar,
durable `response_provider_identity`, `active|paused|deleted`, positive revision,
canonical rule JSON/hash, evaluation/success times, safe error, and timestamps.
The rule JSON contains name, work response calendar endpoint, selected
availability endpoint IDs, static decline comment, and 1–90-day horizon.

Migration 0009 adds a partial unique index on organization + local response
calendar for `status <> 'deleted'`. Migration 0012 adds the stronger partial
unique index on organization + underlying `response_provider_identity`. Google
calendar IDs are global for this purpose, so two delegated connections that
point at the same Google calendar cannot become separate controllers or reset a
safety budget. Non-Google/fake identities include the connection identity.
Service activation locks `response-provider:<identity>`, checks the same
invariant, and maps concurrent uniqueness loss to `response_rule_conflict`.

`conflict_response_availability_calendars` is a tenant-consistent join from the
rule to selected local calendar endpoint IDs and the canonical underlying
`provider_calendar_identity`. The latter is calendar identity, not event
identity; it stores no provider event ID.
Validation requires a distinct readable/writable `both` response calendar and
one through 32 free/busy-readable availability endpoints. The persisted/API
`readable` bit strictly means event-content access; an availability-only endpoint
therefore has `readable = false` and
`capabilities.freebusy_readable = true`. A strict-private endpoint is owned by
an `availability` connection; source/both remain valid when another feature
already needs broader access.

The database cannot encode a conventional cross-table exclusion constraint
between rules and bridges. Application preview, activation, reconcile/apply and
policy preview/activation/resume therefore enforce that a calendar selected by
a non-deleted conflict rule as private availability cannot participate in an
active bridge as source or destination. Conflict setup rejects an active
outbound bridge with `copy_policy_conflict`. It rejects any active **or paused**
inbound bridge with `availability_copy_feedback`, because already-created
inbound copies can contaminate private free/busy and create self-conflicts.
Bridge setup/resume uses `no_copy_rule_conflict` for either endpoint.

To make the activation check atomic across the two tables and delegated aliases,
conflict activation locks every selected local availability endpoint and
canonical provider-calendar identity; bridge activation and resume lock both
local endpoints and their persisted canonical source/destination identities
through the same tenant-scoped PostgreSQL transaction advisory key. Keys are
sorted and de-duplicated before acquisition. Each path then checks the opposite
table by canonical identity and inserts/changes status while the lock remains
held, so concurrent alias requests cannot both commit an active configuration.

Pausing an active **outbound** bridge permits later conflict-rule activation. Pausing does
not remove that bridge's projections, effects, or already-created managed
destination copies, so the preview hashes and warns when paused outbound copies
remain. A non-deleted conflict rule then prevents bridge resume, including while
the conflict rule is paused. `DELETE /api/v1/conflict-response/rules/:id`
idempotently marks it deleted and supersedes pending/held actions, after which a
bridge may resume. Applied RSVP history and older bridge copies are never
silently reversed or cleaned. Restore/invariant checks must still inspect the
condition because advisory locks serialize writes but do not repair imported or
manually corrupted data.

### invitation_response_action

`invitation_response_actions` is durable work-side RSVP intent. Fields include
organization/rule/revision, response calendar, exact **work** observation/event/
recurrence identity, work observation hash and keyed conflict-basis HMAC, expected work
revision, desired static comment, `pending|applied|superseded|held`, resulting
work revision, attempt/success times, safe error, and timestamps. One action per
rule/work observation prevents duplicate response intents.

The work identity is necessary to conditionally target an invitation; it must
not be confused with personal availability identity. Missing revision, changed
work observation, rule change/pause, disappeared conflict, non-`needs_action`
provider state, disabled live-write gate, provider precondition, capability loss,
or the 20-declines-per-rolling-24-hours budget for the underlying response-
provider identity holds/supersedes rather than authorizing a blind write.
Historical rules sharing that identity count, so retirement/recreation and a
delegated Google alias do not reset the budget. An applied action
is historical truth; pause/delete never converts it into an acceptance.
If post-write verification proves the RSVP declined but the attendee comment was
not retained, the action remains `applied` with safe error
`decline_comment_not_retained`; the rule repeats that warning. A confirmed RSVP
is not retried merely to chase comment persistence.

The same terminal representation is used for conservative recovery when the
initial exact provider GET for an existing pending action already finds self
RSVP `declined`: no PATCH is sent, `changed=false`, exact comment equality
determines `comment_retained`, and the action is `applied`. This may attribute a
manual decline to the pending Planipus action, but preserves the safer facts:
the attendee is declined, Planipus does not overwrite the response, and the
result consumes rather than bypasses the 20/24-hour budget. Accepted/tentative
remain held. Ambiguous Google write 5xx/response-read failures use exact GET
verification before selecting this outcome.

Each verified decline appends an immutable audit fact with action
`invitation_response.declined`, target type/action ID, ordinary work-side hashes,
and privacy-safe detail including whether the provider changed and retained the
comment. The 24-hour budget counts these audit facts—joined through action/rule
to `response_provider_identity`—rather than mutable action status/success time.
Rescheduling can reuse/supersede an action row without erasing an earlier decline
from the budget. `created_at` is explicitly PostgreSQL `clock_timestamp()` at
verified provider completion, not transaction-start `now()`.

Migration 0010 adds a partial expression index for confirmed, provider-original,
timed, unanswered work-attendee observations; the query is horizon-bounded and
fails over 5,000 candidates. Migration 0011 widens the two private hash columns
to accept `hmac-sha256:`. New snapshot/action bases use a key derived in a
separate domain from the installation master key, resisting offline enumeration
of low-entropy busy times from a database or backup alone. Legacy `sha256:` is
accepted only for pre-release migration compatibility.

Migration 0012 stores the length-prefixed provider identity, backfills existing
rules, and adds the underlying-provider partial unique index. The migration 0009
local-endpoint index remains defense in depth. The identity also joins immutable
historical decline audit facts through their action/rule for the rolling safety
budget.

Migration 0013 adds a partial audit index on
`(organization_id, created_at, target_id)` for decline/action facts so the
rolling immutable-budget lookup is bounded to the relevant fact class.

Migration 0014 stores canonical identities on sync policy source/destination and
each protected availability selection. It uniquely prevents one rule from
selecting two aliases of one availability calendar, indexes tenant/provider
identity lookups, and makes no-copy checks and advisory locks alias-aware.

### Conflict-response retention and restore boundary

Expired previews require a bounded purge policy. Rules/actions remain audit and
idempotency state until an explicit retention/export design is implemented.
Database backups contain the configured static comment and work-side invitation
identifiers/revisions, but must not contain personal event identity/content from
this feature. After restore, keep Google invitation writes disabled, rotate any
unaccounted API token, reconcile active rules, and verify current work RSVP and
fresh free/busy before re-enabling provider writes.

## Deferred full work and planning model

Everything below this heading is post-alpha research retained for possible later
modules. It is not part of P0 migrations or migration 0004. In particular,
`project`, `work_item`, immutable `plan`/`plan_operation`, full constraint and
explanation models, booking, and smart-meeting series are not implemented by the
alpha planning tables above.

### project

Fields: owner/team, name, description, state, priority, target date, default work
policy, capacity budget, external link, import source. Projects may nest only if
the dependency/rollup semantics remain acyclic.

### work_item

Root record for task, habit occurrence, focus goal occurrence, buffer, travel,
meeting preparation, or imported task:

- title/notes and privacy classification;
- owner, assignees, project, labels, context, energy requirement;
- state: inbox, ready, scheduled, active, blocked, completed, cancelled, archived;
- priority P1–P4 plus optional policy boost and explanation;
- estimate min/likely/max seconds and actual seconds;
- earliest start, due/deadline, local preferred windows, allowed weekdays;
- splittable, minimum/maximum chunk, maximum chunks/day, minimum gap;
- availability impact, defense level, lock/pin state;
- import identity and field-ownership mapping;
- completion/cancellation metadata.

Task dependencies use `work_dependency(predecessor, successor, type, lag)` with a
cycle-preventing command validation. Subtasks are relations, not title prefixes.

### recurrence_template and occurrence

Templates cover habits, recurring tasks, focus goals, breaks, and routine buffers.
Fields include RFC recurrence, target frequency, completion semantics, rollover,
skip/holiday policy, preferred windows, duration distribution, and active range.
Occurrences are materialized only for a bounded horizon and keep template version.
A later template edit does not silently rewrite completed history.

### work_session

Actual execution fact: work item, planned placement, start, end, source
(timer/manual/provider), interruption, outcome, note privacy. Planned versus actual
analytics are derived from sessions, not from mutable task fields.

## Scheduling

### policy_set and constraint

Policy sets are versioned and scoped to organization, team, principal, project,
item, or booking type. Precedence is explicit: safety/system hard constraints;
organization; team; delegation; user; project; item. Lower scopes may narrow a
hard rule but cannot weaken a higher hard rule without an allowed override.

Constraints store typed kind, hardness, parameters JSON validated by versioned
schema, source, scope, active range, and explanation label. Examples: working
hours, protected personal time, meeting-free day, max meeting hours, lunch,
energy curve, minimum focus block, travel mode, attendee fairness.

### placement

Represents current desired/observed allocation: work item/meeting, start/end,
TZID/local intent, state, locked until, defense level, target calendar, managed
provider resource, plan operation origin, completion. Historical movements are
immutable placement facts, not overwritten timestamps.

### plan

Immutable preview header:

- organization, requester, solver version/config hash/seed;
- horizon and base revision;
- input snapshot hash and policy versions;
- state: draft, ready, applying, applied, partial, rejected, expired, superseded;
- quality metrics before/after, unmet items, created/expires/applied times;
- approval policy and approving principal.

### plan_operation

Ordered operation: create/move/resize/delete/defend/release placement, update
provider event, or create booking. Fields include target identity, before/after
canonical value, precondition version, dependencies, risk class, user-visible
summary, apply state, provider effect, error, compensation operation. Operations
are immutable; status is tracked in a separate execution record if strict event
sourcing is chosen.

### explanation

Per plan, operation, candidate, or unscheduled item: human message key, structured
factors, hard exclusions, score contributions, alternatives considered, policy
citations, and redacted debug detail. Public API treats explanation schema as
versioned. Never emit hidden attendee details to a user without permission.

### revision

An organization revision increments on any planning-relevant change: fixed event,
item, placement, policy, booking hold, calendar availability, or relevant team
membership. Cosmetic changes do not. Apply requires exact base revision unless a
safe rebase recomputes and returns a new plan for approval.

## Meetings and booking

### meeting_template

Extends upstream event type with owner/team, visibility, scheduling mode
(personal, collective, round robin, pooled ownership), duration options, buffers,
notice, date limits, booking limits, questions, confirmation, workflow, video,
calendar selection, priority, displacement budget, and smart-recurring policy.

### booking_hold

Short-lived unique reservation: template, candidate start/end, resources/members,
guest session, expires, status. Creation transaction checks overlapping holds,
confirmed bookings, provider mirror, and hard constraints. An idempotency key
prevents double form submits.

### booking

Fields: template, assigned hosts/resources, guest/attendees, encrypted/redacted
answers, timezone, start/end, state, provider event, video link, confirmation,
cancel/reschedule token hashes, workflow state, source/referrer/UTM subject to
privacy policy. Tokens are random, shown once, and stored hashed.

### smart_meeting_series

Organizer intent for recurring meetings: attendees, cadence, duration, horizon,
allowed windows, priority, move notice, no-move window, fairness weights, organizer
fallback, cancellation/skip policy. Occurrences retain invitations and provider
series identity; optimization must not explode a series accidentally.

## Workflows, integrations, assistant

### workflow_definition / workflow_run / workflow_step

Definitions are versioned triggers and allowed actions. Runs pin definition
version, actor, event, state, and idempotency key. Steps record input/output hashes,
redacted result, attempts, next time, and compensation. External messages are
preview/approval-gated according to policy.

### external_mapping

Maps provider objects to domain objects with field ownership per field, last
import/export version, and conflict. No adapter is allowed to overwrite a locally
owned field simply because a remote timestamp is newer.

### assistant_thread / assistant_command

Threads store minimum necessary redacted context and retention. Commands store the
original user text under policy, model/provider metadata, typed command, validation
result, proposed plan, approval, and execution. A model response has no database
or provider capability; only validated commands reach application services.

### api_client / token / webhook_endpoint

Client secrets and API tokens are stored hashed; display prefix and last-used
metadata support rotation. Webhook endpoints use encrypted signing secret,
subscribed event types, failure/backoff state, and disable threshold.

## Audit and analytics

### audit_event

Append-only: event ID, timestamp, organization, actor/effective actor, action,
target, command/correlation/request IDs, before/after hashes or redacted diff,
policy decision, source IP class, result. Optional hash chaining and external sink
make tampering evident. Secret values and private event content are excluded.

### analytic_fact

Immutable categorized fact such as planned seconds, actual session, meeting
seconds, focus fragmentation, task deadline outcome, or booking outcome. Team
views require minimum group size and suppress individual productivity rankings.

## Deletion, retention, and export

- Soft deletion exists only where undo/sync requires it and always has purge time.
- Provider disconnect revokes credentials, removes subscriptions, and lets the
  user choose managed-event cleanup; it does not silently delete their calendars.
- Account/org deletion is a durable workflow with export option, credential
  destruction, provider cleanup attempts, legal retention exceptions, and final
  tombstone.
- Default export includes JSON/ICS/CSV, mappings, plans, policies, and audit; it
  excludes provider credentials, session secrets, token hashes, and other users'
  private details.
- Backups contain encrypted secrets and must be encrypted outside the application
  as well; restore requires the application key or documented key escrow.

## Migration invariants

1. Every migration is transactional where PostgreSQL permits; nontransactional
   operations have an explicit resumable state and rollback boundary.
2. Destructive changes use expand/backfill/verify/contract across releases.
3. Startup refuses a database newer than the binary.
4. Backup-before-upgrade is enforced for schema changes after beta.
5. Migrations are idempotence-tested from every supported release.
6. Provider tokens are never decrypted during ordinary schema migration unless a
   key-rotation migration explicitly requires it and is restart-safe.
7. API-token migrations never persist plaintext or make an expired/revoked token
   active; restore does not manufacture a recoverable credential.
8. Conflict-response migrations and backfills never materialize personal event
   identity/content. Availability-only connections remain outside event sync.
