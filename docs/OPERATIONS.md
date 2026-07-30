# Operations, container, and Kubernetes specification

This is exclusively the autonomous Planipus Server operations contract. The
native Mac edition is not its client, has no release/runtime coupling, and is
covered separately in `MACOS-AND-KUBERNETES.md`.

The default installation is one **Planipus pod** and one persistent volume. It
must remain understandable to a competent self-hoster without requiring a
proprietary control plane. Ingress, TLS, DNS, OAuth applications, SMTP, OIDC,
secrets, and backup destination are operator contracts.

## Supported profiles

### Solo pod

One StatefulSet pod, one replica, one ReadWriteOnce PVC with separate subpaths:

| Container | Purpose | State |
|---|---|---|
| `api` | original Planipus API and web bootstrap | no canonical filesystem state; bounded tmp only |
| `scheduler` | discovery, source safety sync, bounded bridge destination verification, bridge/planning reconciliation, and retention scheduling | durable intent/cursors/jobs in PostgreSQL |
| `worker` | bridge/planning reconciliation and provider effects | durable intent/results/leases in PostgreSQL |
| `postgres` | PostgreSQL authoritative application store | PVC, database-aware backup |

All service traffic stays on pod loopback except API/web HTTP. The three
application containers use one immutable image with different commands. The pod is
fate-shared and single-node by design; this is acceptable for a personal or
household installation. Node/PVC maintenance causes downtime. It is not called
HA and must not be scaled above one.

The chart may permit an operator to omit the database sidecar and provide an
external URL. That turns the install into the standard profile; it must not
silently create mixed ownership.

### Standard cluster

- current chart: the same one-replica StatefulSet application processes without
  the PostgreSQL sidecar/PVC; a future scaling ADR may split them into Deployments;
- external PostgreSQL 16+;
- optional worker Deployment after ownership/job scale tests;
- object storage or operator backup system for durable backups;
- external secret/KMS integration through ordinary env/mount contracts.

Multiple app replicas are supported only after sync-policy ownership, future
provider watch renewal, migrations, rate limiting, and idempotent effects pass a dedicated
scale gate. Any future cache/coordination service is reconstructible and never
replaces PostgreSQL outbox/job state.

## Application image contract

`project.toml` and `Procfile` select Cloud Native Buildpacks as the current image
foundation. A reviewed CNB builder consumes the frozen npm lockfile, runs the
ordered workspace build, and publishes `api`, `scheduler`, `worker`, `migrate`
and `web` process types. Conceptual operator command:

```text
pack build REGISTRY/planipus:VERSION \
  --builder REVIEWED_BUILDER@sha256:IMMUTABLE_DIGEST \
  --publish
```

Do not copy those placeholders literally. The exact builder/run-image digests,
architectures, build-network policy and registry are operator/release inputs;
this worktree intentionally does not select or pull a local builder. The built
artifact must satisfy all of the following before publication:

- selected TypeScript runtime and package manager pinned by digest/version;
- frozen lockfile at build; no dependency download at runtime;
- React web plus API, scheduler, worker, and shared packages in one image;
- non-root fixed UID/GID documented for policy and mounted tmp;
- read-only root filesystem and bounded writable `/tmp` only;
- no compiler, git, debugging suite, npm, or arbitrary package install in the
  runtime image unless a documented health/runtime need exists;
- one API/web HTTP port; PostgreSQL is never exposed by the Service;
- JSON/structured stdout/stderr logs;
- CA roots and timezone database required for providers/time semantics;
- OCI labels: source, product revision, version, license,
  created time, docs;
- amd64 and arm64 release images, immutable digests, SBOM, provenance, signature,
  checksums, source tag;
- startup validates configuration, encryption key, database connectivity,
  schema compatibility, migration lock, public URL/proxy/cookie constraints;
- graceful SIGTERM stops acceptance, drains in-flight apply/provider effects,
  closes workers/WebSockets, and exits inside the termination budget.

The current selected-component production audit must be green before publication.
Historical Keeper advisories are not a dependency baseline because its graph is
excluded. The first Planipus image is blocked until its own dependency graph is
reviewed, remediated, rebuilt, retested, and rescanned.

## Solo StatefulSet resources

Required chart/manifests:

- optional Namespace example;
- ServiceAccount with no API permissions and token automount disabled;
- StatefulSet, one replica, ordered startup, and safe rollout semantics
  documented for database sidecars;
- ClusterIP Service selecting only the Planipus HTTP port;
- volumeClaimTemplate and optional separate backup PVC/VolumeSnapshot examples;
- ConfigMap for nonsecret settings; Secret references/external-secret examples;
- default-deny NetworkPolicy plus explicit ingress and egress;
- PodDisruptionBudget `minAvailable: 0` so one replica does not block node drain
  while pretending to be available;
- optional Ingress example with TLS secret reference;
- backup CronJob or application job plus a separate restore procedure;
- ServiceMonitor/PodMonitor only when the CRD is installed.

App container security context:

```yaml
runAsNonRoot: true
runAsUser: 10001
runAsGroup: 10001
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
seccompProfile:
  type: RuntimeDefault
```

Pod-level:

```yaml
automountServiceAccountToken: false
securityContext:
  fsGroup: <documented group compatible with selected images/storage class>
  fsGroupChangePolicy: OnRootMismatch
```

The PostgreSQL image may use a different non-root UID. Prefer an image whose
documented security context works with `fsGroup`/CSI permissions. Never add a
privileged/root init container merely to recursively chmod a volume. Never use
host network/PID/IPC, Docker socket, broad hostPath, or extra Linux capabilities.

## Sidecar contracts

### PostgreSQL

- image pinned by digest and supported architecture;
- loopback-only listen; no Service port;
- SCRAM password supplied by Secret, never a default chart value;
- database/user/schema owned explicitly; app is not a database superuser;
- checksums where supported, sane `max_connections` for personal load, statement
  timeout, log redaction, and bounded WAL;
- readiness via `pg_isready` plus app migration readiness;
- `pg_dump`/restore and optional physical snapshot procedures tested;
- major upgrades use dump/restore or documented `pg_upgrade`, never image-tag
  surprise.

### Deferred cache/coordination service

P0 has none. A later ADR may select one only for measured, reconstructible
cache/lease/fanout behavior. It cannot own provider intent, projections,
cursors, effects, sessions, or audit data, and its complete loss must not prevent
PostgreSQL job replay.

## Probes and status

- `/api/health/live`: process/event loop only; no provider/database call.
- `/api/health/startup`: configuration, database reachability, migration/recovery,
  encryption-key validation; generous but bounded.
- `/api/health/ready`: schema compatible, Postgres usable, local ownership/jobs
  ready for the enabled profile. Provider outage is degraded, not app-unready.
- `/api/health/detail`: authenticated/admin-only component state with redacted
  error classes, last success, lag, and remediation.

Probe output reveals no secrets, provider endpoint credentials, emails, event
titles, database DSN, queue payload, or user counts. Liveness must never cause a
restart loop during a recoverable provider outage.

## Alpha planning runtime

Migration `0004_planning_rules.sql` adds Availability Boundary and Smart Meeting
runtime state. The same `api`, `scheduler`, and `worker` processes serve it; no
separate planner service, cache, controller, or Kubernetes resource exists.
Migration `0005_scheduled_job_history_lookup.sql` adds the non-partial lookup
index used by historically deduplicated scheduler windows; it does not replace
the active-only unique index required by repeatable source sync.

Fake-provider mode exposes planning for deterministic local use. Google mode
keeps the planning API and writes disabled unless
`PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`; the default is false. Turning the
flag off does not transition or repair already-pending planning rows, so an
operator must inspect/drain them before changing this setting. An attempted
apply while disabled fails non-retryably as `planning_writes_disabled` and the
job becomes dead rather than implying success.

- API preview computes synchronously and stores a ten-minute preview. Activation
  consumes a still-current preview and atomically creates a rule, planned-event
  rows, audit record, and PostgreSQL scheduled jobs. Staleness is bound to
  planning-semantic capabilities/readiness/Busy intervals; discovery timestamps,
  title-only observation edits, and pending-to-converged bookkeeping do not
  invalidate a preview.
- The scheduler's default tick is fifteen seconds. Each active rule receives at
  most one reconciliation job, including completed history, per fifteen-minute
  deduplication window. Discovery and destination verification use the same
  historical-window rule. A transaction-scoped advisory lock serializes the
  same key across scheduler replicas and migration 0005 indexes the retained
  history lookup. Lock-producing organization/resource collections are ordered
  by stable IDs before acquisition so replicas cannot deadlock by traversing the
  same set differently. Constant-key source sync deliberately retains
  active-only deduplication so it can run again after completion.
  It also expires pending planning suggestions after fourteen days and deletes
  previews only after they have been expired for seven days.
- The worker polls by default every second and leases at most **one** scheduled
  job plus **one** bridge outbox effect per loop. Scheduled jobs default to a
  sixty-second lease. While dispatch is running, a heartbeat conditionally renews the job at
  one-third of the configured lease interval (with a one-second minimum
  interval), then performs one final conditional renewal before recording success
  or failure. If ownership was lost, that worker records no terminal transition,
  logs the safe fact, continues running, and leaves the current owner to finish.
  Outbox effects remain separately idempotent/ambiguity-aware. Active-job
  deduplication and `SKIP LOCKED` claiming live in PostgreSQL. Failures use
  jittered exponential retry, up to ten attempts and a one-hour cap, before the
  job becomes dead.
- Planning desired intent lives in `planned_events` plus `scheduled_jobs`; it
  does not use `outbox_effect`. Queue payloads contain rule/planned-event IDs and
  expected intent sequence, not meeting bodies; a superseded job is a local
  no-op before provider access.
- Google planning requests have a twenty-second request timeout. The current
  apply path performs its provider read/write while holding a PostgreSQL
  transaction and planned-event row lock. Operator statement, worker lease,
  termination, and connection-pool budgets must account for this known alpha
  risk; it is not yet validated for concurrent or high-latency operation.

Lease heartbeat does not cancel an already in-flight provider call when
ownership is lost or shutdown begins. Correctness still depends on provider-
level idempotency/conditional writes, ambiguity verification, and later
reconciliation. Provider I/O under database row/advisory locks remains a scale
and release concern even though scheduled-job ownership is renewed safely.

Operationally, periodic rule reconciliation is only desired-state recomputation.
It does not remotely verify an unchanged managed planning event. A provider-side
edit/delete can remain invisible. Resume and reconciliation re-enqueue unchanged
pending intents, and active target-unavailable holds return to pending after
recovery. Ownership/policy holds do not. Rule removal is asynchronous
`deleting -> deleted`; a target/ownership/precondition hold preserves
`pending_delete` but currently has no scheduler recovery because only active
rules are reconciled. The current overview, authenticated health detail, and
metrics do not surface planning-rule lag, pending/held/unmet planned events,
pending suggestion details, deleting cleanup, or oldest planning verification.
Operators must not interpret general process health or a successful
`/api/v1/sync` response as proof that these remote events converge.

The current scheduler purges neither deleted planning rules/events nor resolved
or expired suggestions. Retention sizing and deletion/export procedures must
include that unbounded history until a forward migration and explicit policy are
implemented.

## API tokens, MCP, and no-copy conflict response

Migrations `0006_api_tokens.sql` through
`0014_canonical_calendar_protection.sql` must run before this feature is used. The
ordinary API, scheduler, and worker processes
serve it; there is no additional in-cluster controller. Scheduler/worker handle
`reconcile_conflict_response_rule` and `apply_invitation_response` as durable
PostgreSQL jobs. Queue payloads contain rule/action IDs and opaque basis hash,
not personal event content.

The MCP adapter is optional and **stdio-only**. Normally the operator configures
their MCP host to launch it on a workstation and call the cluster's public HTTPS
API. For local development it may call loopback HTTP. It is not a fourth Service,
Ingress, sidecar, or remotely exposed MCP endpoint. Do not wrap stdio in a TCP/
HTTP proxy; remote Streamable HTTP needs a separate security/operations ADR.

Provision MCP credentials from the owner-only Settings surface. `propose` is
provider-contacting/read-sensitive: conflict preview queries private free/busy
and reveals overlap counts/time-only examples. It is non-writing, not harmless.

1. issue `read` alone unless previews are required; otherwise issue a short-lived
   token with `read` and `propose`;

2. copy the one-time plaintext directly into the MCP host's secret environment;
3. configure `PLANIPUS_API_URL`, `PLANIPUS_API_TOKEN`, and
   `PLANIPUS_MCP_ENABLE_APPLY=false`;
4. prove `GET /api/v1/auth/context` and read/proposal tools;
5. only if automated mutation is intentionally needed, issue a separate token
   containing `apply` and set that one process flag true; and
6. rotate by installing/proving the replacement before revoking the old token.

Never place the token in command arguments, chart values committed to Git,
ConfigMap, logs, screenshots, support bundles, or a shared shell history.
Plaintext cannot be recovered from PostgreSQL.

The API's current actor limits are process-local fixed windows: read 600/minute,
apply 120/minute, and propose 30/10 minutes per organization + actor kind +
session/token. A 429 `api_rate_limited` includes `Retry-After`; MCP surfaces the
safe code. Conflict preview additionally refuses a principal with 10 live
unconsumed previews as `preview_rate_limited`. Process restart/replica fan-out
resets or partitions the request counters, and concurrent preview creation is not
yet guarded by a database-hard quota. Alert on 429 counts without credential/
identity labels. Do not scale API replicas or make Internet-production claims
until shared persistent limits and planning/public-specific controls are proven.

The MCP process uses a fixed 300-second API deadline (the internal client accepts
1–600 seconds) so a bounded 32-calendar conflict preview can finish its roughly
160-second worst-case provider schedule. Do not shorten it with an outer host
timeout without preserving outcome handling. `api_timeout` on GET is safely
repeatable. `api_timeout_outcome_unknown` on POST/DELETE means the API may have
committed after the MCP client stopped waiting: list rules/policies/current state,
correlate the request ID/audit where available, then decide whether to retry.
Never blindly repeat an unknown-outcome mutation.

For strict-private personal availability, reconnect with Google role
`availability`; it requests CalendarList metadata plus `calendar.freebusy`. The
free/busy grant does not authorize `Events.list`, and Planipus role guards skip
event sync and bridge-source use. Existing source/both grants must be
reauthorized for free/busy and may already have source observations for bridge
use. Calendar/API/MCP `readable` means event-content access, so an availability-
only endpoint is `readable: false` with
`capabilities.freebusy_readable: true`. The work response account uses `both` so
Planipus can read and conditionally RSVP. Prefer a dedicated availability-only
calendar that has never participated in a bridge. Selecting it protects it from
every active bridge in either direction.

Google may retain broader Calendar scopes from an old source/both consent. If
the callback returns `oauth_scope_overbroad`, Planipus has refused the downgrade:
revoke the prior Planipus grant in the Google account, then begin a fresh
availability-only connection. `oauth_scope_unverified` means Google omitted the
returned scope set; availability also fails closed and uses the same revoke/
reconnect recovery instead of trusting the requested scopes. Do not report
privacy success or delete local data
on the failed callback. Verify the returned scope set and subsequent audited
purge after reconnect; Planipus does not currently provide its own remote-grant
revocation button. OAuth callbacks serialize by organization + verified Google
subject even on first connect, but live revoke/reconnect behavior remains an
acceptance gate.

Reauthorizing an existing source/both account to remove event-read access may
return `availability_role_change_blocked`. Pausing is insufficient. Retire
supported planning/response rules, then retry OAuth. A bridge dependency or
historical projection/invitation-action reference cannot be cleared through a
supported alpha bridge-retirement/purge route: keep the broader role or connect
a separate dedicated Google account as availability-only. Never force the
transition with SQL. On a clear
transition, Planipus atomically purges observations/cursors, retires subscriptions
and queued sync jobs, restricts endpoints, and audits counts; inspect that audit
fact after the callback. In-flight sync commits revalidate the locked connection
and cannot repopulate purged event content.

Pause every active outbound bridge from a selected availability calendar before
enabling the no-copy rule. Existing managed destination copies remain; rule
activation does not delete, detach, or redact them, and the current alpha has no
supported cleanup flow for them. Inventory those copies and disclose their
continued privacy exposure. Do not mutate policy state directly in PostgreSQL.
While the protection rule remains non-deleted, bridge resume is rejected even
if the rule itself is paused. An active or paused bridge whose **destination**
is the availability calendar blocks protection entirely: pause cannot remove
the inbound copies that may create false personal conflicts. Retiring the
protection rule through DELETE supersedes pending/held actions and permits bridge
resume; it does not undo applied declines or clean older bridge copies.

Conflict activation and bridge activation/resume serialize every protected
local calendar/both bridge endpoints **and** their canonical provider-calendar
identities with tenant-scoped transaction advisory locks before checking the
opposite table. Google calendar IDs are global across delegated connections, so
an alias cannot bypass protection or form a source-to-itself copy policy.
This closes concurrent activation races, but it is not a restore repair: inspect
both tables for imported/manual violations before reenabling workers. Conflict
activation currently performs free/busy while the preview/advisory locks remain
held, and response apply performs provider I/O while action/rule rows are
locked. Alert on long transaction/lock/lease age and keep concurrency bounded;
production hardening must move provider I/O behind a committed intent boundary.

Migration 0014 fail-closes a pre-existing Google alias self-copy policy. It
marks the policy `deleted` with `same_provider_calendar`, changes pending/leased/
retry outbox work to `dead`, finishes pending/leased/retry reconcile jobs with
the same safe code, and records audit action
`policy.quarantined_same_provider_calendar` with
`historical_copies_untouched: true`. It intentionally does not delete existing
destination copies. Inventory and review those copies after upgrade; do not
silently report cleanup or re-enable the quarantined bridge through SQL.

Private snapshot/action bases use a domain-separated HMAC derived from the
active installation master key. There is no multi-key HMAC verification yet, so
do not claim transparent master-key rotation. The current safe maintenance
boundary is: disable invitation writes and workers, prevent activation until all
ten-minute previews expire, supersede/recompute every pending/held action under
the new key, verify no old-basis job can apply, then resume. A supported,
automated rotation workflow and fault evidence remain TODO; do not improvise
direct SQL against production.

Fake-provider responses are suitable for deterministic local testing. Google
writes remain off unless
`PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE=true`; default false is required
in normal/release profiles until disposable live tests prove organizer comment
visibility and actual mail/calendar notification behavior. Turning the flag off
holds later provider applies; it does not recall or auto-accept prior declines.
Pause affected rules too, inspect held/dead jobs, and keep the flag off during
restore or credential investigation.

The capabilities endpoint exposes `conflict_auto_decline_provider_writes` and
`conflict_decline_message_delivery`; preview/list repeat them as
`provider_writes_enabled` and `message_delivery`. With the Google gate off,
preview is available but activation and conflict-rule resume are rejected with
`invitation_writes_disabled`, so there should be no newly activated rule whose
first actions merely wait on the gate. Fake mode is `simulated`. A Google
installation
remains `unverified_google` even when RSVP writes are enabled; do not treat the
write boolean as evidence of comment delivery.

Operational health must distinguish active/paused rules, last evaluation/
success, safe error, pending/held/applied counts, 20-per-provider-identity
rolling-24-hour budget holds across immutable `invitation_response.declined`
audit facts for historical rules/delegated aliases/reschedules,
provider-auth/scope failures, and dead jobs. Successful work response-calendar
sync immediately enqueues rule reconciliation; monitor the 15-minute scheduler
as a safety fallback and alert when freshness reaches the fail-closed boundary.
Metrics/logs may use bounded state/error counts but no token,
email, calendar title, comment, work event ID, personal interval, or provider
body. Current health/UI coverage must be verified before production claims.

`decline_comment_not_retained` means the exact provider read confirmed the self
RSVP as declined but did not echo the configured attendee comment. It is an
applied-with-warning response, consumes the 20/24-hour budget, and must not be
retried merely to chase the comment. Keep message delivery labeled unverified;
include the warning in privacy-safe rule health and live-provider evidence.
This can arise before a PATCH when a pending action's initial GET already sees a
decline; Planipus sends no write, records `changed=false`, and conservatively
attributes/budgets the result. It can also arise after ambiguous or successful
write verification. Google write 5xx/response-read failures require exact GET
verification; never blindly replay the PATCH.

## Configuration inventory

Every variable has type, default, required profile, secret classification,
reload behavior, and validation. Preserve standard ecosystem names when useful;
use a Planipus prefix for project-specific policy.

### Core/public

- listen host/port;
- canonical public base/API/webhook URLs;
- CORS allowed origin(s), trusted proxy hops, cookie domain/secure/same-site;
- registration/invitation policy, locale/timezone defaults;
- `SELF_HOSTED=true` migration to an unconditional community-capability model.

### Persistence/jobs

- `DATABASE_URL`, TLS mode/CA, pool/connect/idle/statement timeouts;
- PostgreSQL job polling interval, lease duration, retry/backoff, and concurrency;
- migration mode/lock timeout; retention and cleanup schedules;
- backup target, encryption, retention, verification schedule.

### Security/identity

- JWT/session secrets and rotation identifiers;
- versioned encryption key(s)/provider;
- OIDC discovery/client/claims/groups and local-login policy;
- OAuth client credentials/callback base for Google/Graph;
- password policy/rate limits/session lifetime.
- API token maximum lifetime/rotation procedure; plaintext is never configured
  as a Server environment variable.

### Integrations

- SMTP/from/TLS;
- provider allowlists and sync/watch intervals;
- CalDAV private-network opt-in;
- conferencing/webhook endpoints/secrets;
- optional task/project/chat sources;
- optional model endpoint/key/model/budget/redaction policy.

### Runtime/observability

- structured log level/format and sensitive-debug expiry;
- metrics listener/auth and tracing exporter;
- worker/solver budgets and scheduling defaults;
- `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING` (strict boolean, default false),
  changed only with pending-state and live-notification review;
- `PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE` (strict boolean, default
  false), changed only for a controlled live response test until the release
  matrix passes;
- telemetry/update checks: off/no egress by default.

Production rejects weak/default secrets, malformed encryption key, wildcard CORS
with credentials, unsafe proxy trust, invalid HTTP public URL unless explicitly
allowed, incompatible schema, and unavailable required state. `config validate`
reports secret presence/validity/source only, never values.

## Network

Inbound: ingress/reverse proxy to Planipus HTTP only. TLS terminates at ingress
or app; secure cookies and OAuth callbacks require correct external scheme and
bounded trusted-proxy configuration.

Outbound categories:

- cluster DNS and time infrastructure;
- configured Google/Microsoft/OIDC endpoints;
- explicitly configured CalDAV/ICS/task hosts; private addresses require policy;
- SMTP and conferencing/webhooks;
- backup/object storage and configured observability;
- optional model endpoint.

PostgreSQL sidecar traffic is loopback. With integrations/exporters and
update checks disabled, the pod must operate without external requests. Fonts,
icons, assets, localization, and documentation used by the UI are bundled.

## Storage and capacity

Publish measured values after the gate. Initial test envelope, not a promise:

- request at least 5 GiB for a personal solo PVC, 20 GiB for a household/small
  team with history; make size configurable;
- alert/surface 70/85/95% capacity thresholds;
- bound provider raw payload, audit, analytics, dead-letter, session, OAuth-state,
  and schedule-change retention;
- PostgreSQL autovacuum/checkpoint/WAL behavior tested under reschedule bursts;
- PostgreSQL job/outbox retention and dead-letter growth included in estimates;
- planning previews, full rule/desired JSON documents, planned-event history and
  suggestions included in restricted-data and capacity estimates;
- export/temp quotas and cleanup; no attachment mirroring by default;
- UI/admin status shows logical DB size, queue/dead-letter counts, last verified
  backup and restore drill—not host paths.

## Backup artifact

Use `pg_dump` custom format or another documented consistent PostgreSQL method.
Jobs and provider effects are already part of that consistent database state.
A blind copy of live database files is not supported.

Manifest:

- Planipus version, source revision, schema/migration version;
- creation/completion time and installation/organization scope;
- PostgreSQL dump checksum/size and optional object checksums;
- queue-drain/reconstruction status;
- planning rule/planned-event/suggestion counts and active-job reconstruction
  status;
- API-token active/expired/revoked metadata counts (never plaintext) and
  conflict-response rule/action state counts;
- encryption ciphertext/key version requirements (never the master key);
- chart/config schema version and compatibility floor;
- backup tool/version and verification outcome.

Encrypt transport and destination in addition to field-level secret encryption.
Example retention: 7 daily, 4 weekly, 6 monthly. Verification restores into an
empty PostgreSQL instance, runs schema/invariant checks, starts Planipus with
provider writes paused, and records the result. A backup is not “verified” merely
because the upload succeeded.

## Restore

1. Pause provider writes/jobs and stop the app; snapshot current target volume.
2. Verify image supports the backup schema and required encryption key versions.
3. Create empty PostgreSQL state; never restore over a live unknown schema.
4. Verify manifest/checksums and restore PostgreSQL.
5. Restore/reconstruct queue state according to manifest.
6. Start one app pod with provider effects paused; run migrations/invariants.
7. Inspect identities, settings, provider connections, calendars, hours profiles,
   sync policies, observations, projections, outbox/dead-letter, planning
   previews/rules/events/suggestions, API-token metadata, conflict-response
   previews/rules/actions, and retention. Keep both Google write flags false.
   Revoke/reissue every API token whose external plaintext copy is not accounted
   for; update and prove MCP hosts before revoking a known old token.
8. Re-enable providers one at a time; run bounded incremental/full bridge and
   planning reconciliation, inspect planning ownership/generation markers, and
   detect duplicate managed identities. Do not run two restored instances
   against the same planning target calendars. Reconcile conflict rules with
   live invitation writes still disabled, inspect fresh free/busy/held actions,
   then enable experimental Google RSVP only under its live-proof runbook.
9. Record restore evidence and retain pre-restore snapshot until acceptance.

Full-instance restore and organization-level export/import are distinct. Do not
run two restored instances against the same writable provider calendars without
an explicit ownership transfer procedure.

## Upgrade and rollback

- read release notes and supported version path;
- require a recent verified backup and sufficient free disk;
- stage image/chart by digest and render/dry-run manifests;
- preflight configuration, database version, key versions, and schema;
- stop/drain one-pod workload; run migrations once under lock;
- when crossing migration 0004, verify the four planning tables and scheduled-job
  indexes before enabling planning rules; migration 0004 has no supported
  destructive downgrade;
- when crossing migrations 0006–0014, verify token hashes/scopes/expiry,
  conflict rule/action tenant and local/provider one-live-controller constraints,
  candidate and immutable-decline-budget indexes, HMAC-compatible columns,
  canonical bridge/protected-availability identity backfills, and alias self-copy
  quarantine/audit/effect/job outcomes. Keep invitation writes disabled, require
  reauthorization for old source/both free/busy grants, and exercise
  `oauth_scope_overbroad` revoke/reconnect before claiming a privacy downgrade;
- start and check login, account connection, policy preview/activation, and sync;
- monitor HTTP, jobs, policy/projection/outbox, DB, and provider metrics;
- rollback binary only when migration declares backward compatibility;
  otherwise restore the backup at the documented boundary.

Never automatically jump PostgreSQL major versions or use floating image tags.
Planipus refuses an unsupported downgrade rather than guessing.

## Observability

Structured log fields: time, level, service/component, request/correlation/job/
policy/projection/organization/provider opaque IDs, error class, duration, attempt.
Redact event text, attendee identity, calendar labels, prompt text, cookies,
tokens, auth codes, encrypted blobs, credential URLs, and provider bodies.

Metrics:

- HTTP/WebSocket totals, latency, status, rate-limit events;
- PostgreSQL pool/transaction/locks/WAL/size and migration;
- PostgreSQL job queued/leased/age/attempt/dead-letter state;
- policy evaluation duration/input/filter reason and projection lifecycle;
- preview/activate/reconcile stale/conflict/partial/compensation;
- sync lag/pages/items/errors/cursor reset/watch expiry;
- provider writes/retries/precondition/quota;
- API-token authentication/scope failure, expiry/revocation and MCP-safe request
  outcomes without token/label dimensions;
- conflict-rule evaluation and pending/held/applied/superseded action counts by
  bounded safe code, never work event or personal interval labels;
- privacy-transform and working-hours filter outcomes by bounded reason code;
- webhook/provider outcome;
- backup age/duration/verify and restore-drill result.

The list above is the release target, not current planning telemetry. The current
runtime exposes general HTTP/process and aggregate scheduled-job information but
does not implement the planning-specific rule/event/suggestion/verification
metrics or health fields needed for operational acceptance. Add bounded metrics
for rule reconcile duration/outcome, active/paused rules, planned-event states,
oldest pending/held age, suggestion age, preview stale/expiry, provider
notification mode, and dead planning jobs before treating planning as operable
without direct database inspection.

Labels are bounded; never label by email, title, remote URL, raw error, task ID,
or booking answer. Export is disabled until configured by the operator.

## Alerts and runbooks

Ship runbooks for:

- startup/migration/database/job-runner readiness failure;
- PVC pressure and PostgreSQL WAL/lock/corruption;
- stale/failed/unverified backup and failed restore drill;
- key missing/wrong/rotation stuck;
- provider auth revoked, sync lag, cursor reset storm, watch expiry;
- provider quota/outage and outbox backlog;
- stale/partial projection apply and compensation;
- planning preview stale/incomplete availability and unexpected invitation risk;
- planned-event `pending_*`, `held`, or `unmet` backlog, pause/resume recovery,
  destination ownership mismatch, and missing externally deleted event;
- rule stuck in `deleting`, deletion lifecycle command race, or accidental
  deletion of already-ended Smart Meeting history;
- dead planning reconcile/apply job and slow provider call holding database locks;
- pending suggestion aging/expiry, stale rejection/recompute, and accept/dismiss
  apply failure;
- API token expiring/compromised, MCP cannot authenticate, insufficient scope,
  apply unexpectedly enabled, and zero-downtime token rotation;
- conflict-response missing free/busy grant/reauthorization, held action,
  concurrent RSVP rejection, disabled live-write gate, ambiguous provider write,
  and unexpected comment/mail behavior;
- duplicate/missing mirror, loop detection, and orphan cleanup failure;
- webhook/provider failure;
- high latency/memory/restarts and job dead letters.

Each includes symptoms, impact, safe read-only diagnostics, mitigation, recovery,
and escalation. Direct database row deletion is never first-line remediation.

## Disaster and compromise

- Lost PVC/database: restore last verified artifact, reconnect/reconcile providers,
  report recovery point and possible duplicate/missing managed effects.
- Lost encryption key: encrypted provider credentials are intentionally
  unrecoverable unless operator escrowed the key; retain nonsecret data and
  reconnect providers.
- Token/session compromise: revoke upstream grant/session, rotate affected key,
  inspect audit/outbox, reconcile, and follow incident notification policy.
- API-token/MCP compromise: revoke the exact token, stop the MCP process, inspect
  API-token/domain audit and provider actions, replace with least privilege, and
  keep Google invitation writes disabled until impact is understood.
- Job-runner loss: leases expire and another worker reclaims PostgreSQL jobs;
  replay must preserve idempotency and ambiguous-write verification.
- Malicious installation admin: the host owner can access process memory/storage;
  hash-chained/exportable audit improves detection, not protection from root.

## Release channels

- `edge`: branch builds, explicitly unsupported migrations.
- `beta`: tagged prerelease with provider labels and backup/restore evidence.
- `stable`: full checklist, signed artifacts, upgrade/rollback path, verified
  restore and compatibility matrix.

Never publish only `latest`. Provide semantic version tags, immutable digests,
source/SBOM/signature/provenance, and chart versions pinned to image digest.
