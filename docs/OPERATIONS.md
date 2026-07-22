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

Fake-provider mode exposes planning for deterministic local use. Google mode
keeps the planning API and writes disabled unless
`PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`; the default is false. Turning the
flag off does not transition or repair already-pending planning rows, so an
operator must inspect/drain them before changing this setting. An attempted
apply while disabled fails non-retryably as `planning_writes_disabled` and the
job becomes dead rather than implying success.

- API preview computes synchronously and stores a ten-minute preview. Activation
  consumes a still-current preview and atomically creates a rule, planned-event
  rows, audit record, and PostgreSQL scheduled jobs.
- The scheduler's default tick is fifteen seconds. Each active rule receives at
  most one active reconciliation job per fifteen-minute deduplication window.
  It also expires pending planning suggestions after fourteen days and deletes
  previews only after they have been expired for seven days.
- The worker polls by default every second, leases up to twenty scheduled jobs
  for sixty seconds, and dispatches planning reconcile/apply jobs before normal
  bridge/effect handling. Active-job deduplication and `SKIP LOCKED` claiming live
  in PostgreSQL. Failures use jittered exponential retry, up to ten attempts and
  a one-hour cap, before the job becomes dead.
- Planning desired intent lives in `planned_events` plus `scheduled_jobs`; it
  does not use `outbox_effect`. Queue payloads contain rule/planned-event IDs and
  expected intent sequence, not meeting bodies; a superseded job is a local
  no-op before provider access.
- Google planning requests have a twenty-second request timeout. The current
  apply path performs its provider read/write while holding a PostgreSQL
  transaction and planned-event row lock. Operator statement, worker lease,
  termination, and connection-pool budgets must account for this known alpha
  risk; it is not yet validated for concurrent or high-latency operation.

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
   previews/rules/events/suggestions, and retention.
8. Re-enable providers one at a time; run bounded incremental/full bridge and
   planning reconciliation, inspect planning ownership/generation markers, and
   detect duplicate managed identities. Do not run two restored instances
   against the same planning target calendars.
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
