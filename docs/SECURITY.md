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

## Deferred assistant/model controls

- Any future model integration is optional; every otherwise shipped feature
  remains usable with models disabled.
- Minimize/redact data by class; operator/user policy chooses allowed categories,
  endpoint, model, retention, budget.
- Event/task/provider/model text is quoted data and cannot add tools/capabilities.
- Model returns typed command; server validates schema, authorization, references,
  constraints, cost, and current revision.
- Recommendations cite visible inputs. Mutation follows normal preview/apply/audit.
- Tool/MCP capabilities separate read/propose/apply; apply disabled by default.
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
| Cross-site mutation | secure cookie, SameSite, CSRF, origin, CSP, CORS deny |
| SSRF/rebinding | URL/IP/DNS/redirect validation, allowlist, egress policy, bounds |
| Forged/replayed webhook | signature/channel/timestamp, dedupe inbox, quick enqueue |
| Dropped/duplicate events | opaque cursor sync, safety poll, idempotent convergence |
| Calendar duplicate/destruction | policy revision, provenance, outbox/idempotency/ETag, reconcile, cleanup preview |
| Personal-detail disclosure | versioned field transform, private visibility, coworker-view live test, redacted storage/logs |
| Mirror recursion | policy graph rejection, provenance filtering, projection uniqueness |
| Planning invite spam/disclosure | explicit attendee preview, send-update UX, per-rule authorization, quotas/rate limits, live recipient tests |
| Planning self-conflict/drift | exclude owned events from busy input, deterministic provenance, bounded destination verification, visible held recovery |
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
- M3: public booking abuse/race external review.
- M5: assistant injection/capability/privacy review.
- M5/post-1.0: multi-tenant/scale/worker/analytics review.
- 1.0: formal threat model, penetration test, dependency/license/provenance,
  restore and incident exercises with no unresolved critical/high risk.

Vulnerability reporting policy is in repository root `SECURITY.md`. Do not include
calendar contents, credentials, backups, or live instance URLs in public issues.
