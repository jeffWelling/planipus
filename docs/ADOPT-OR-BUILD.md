# Adopt, compose, or build

Status: **clean-room original implementation selected**  
Decision date: 2026-07-20

## Decision

Planipus will not adopt, fork, port, embed, copy, or derive implementation from
Keeper.sh. Keeper's AGPL license makes that reuse incompatible with the owner's
chosen project boundary. It may inform high-level product questions only; it is
not a code, test, asset, schema, dependency, or runtime donor.

Planipus instead uses a compositional open-source strategy:

| Edition | Build ourselves | Integrate after review | Explicitly exclude |
|---|---|---|---|
| Planipus for Mac | Swift policy/sync/recovery engine, native UX, local schema | SwiftUI/AppKit, Keychain, AuthenticationServices, URLSession, GRDB, gated SQLCipher, official Google APIs | Keeper, web service runtime, daemon/helper, Server API |
| Planipus Server | TypeScript policy/sync/recovery engine, web UX, server schema/API | PostgreSQL jobs/outbox, HTTP/API/schema stack, React accessible primitives, OIDC/OAuth libraries, official Google APIs | Keeper code/history/assets/fixtures/schema/dependencies/runtime |
| Shared | Calendar Sync contract, reason registry, JSON conformance cases | JSON-schema/test tooling | shared live state, API, binary runtime, donor fixtures |

The binding rules are in `CLEAN-ROOM-POLICY.md`. Apache-2.0 is selected for the
implementation; complete dependency/legal review remains a public-release
blocker. Do not claim Planipus is an AGPL fork or compatible with Keeper data.

## What the Keeper research still tells us

The historical audit establishes only that Calendar Sync is a meaningful,
multi-part product: multiple accounts, provider cursors, source→destination
identity, recurrence/timezones, reconciled create/update/delete effects, policy
privacy transforms, jobs, health, and self-host operations. These are feature
observations, not a blueprint to copy.

Planipus requirements and designs must be traceable instead to:

- user intent and `CALENDAR-SYNC.md`;
- Reclaim/competitor behavior research, without copying expression;
- Google OAuth/Calendar documentation and relevant RFCs;
- original Planipus design/acceptance decisions;
- independently reviewed compatible components.

## Why this is still an OSS-first plan

The expensive, solved layers remain reused:

- native UI, accessibility, OAuth browser mediation, Keychain, sandboxing, and
  notarization from macOS;
- PostgreSQL database engine and proven backup/restore tooling;
- PostgreSQL durable jobs first; a cache/coordination layer only where measured;
- mature HTTP, OpenAPI/schema validation, OIDC, password hashing, metrics,
  tracing, JSON, iCalendar, recurrence, and queue libraries after audit;
- Google’s documented provider API rather than scraping or EventKit;
- exactly pinned SQLCipher-managed GRDB and SQLCipher.swift for local Swift
  persistence/encryption; the production store is integrated while its
  rotation/recovery/distribution acceptance gate remains open.

The custom code is constrained to product-specific semantics and glue: directed
policy evaluation, DST-aware hours, privacy projection/disclosure, provenance,
durable effects, recovery, and the calm user experience.

## Selected Server technical baseline

The foundation spike selected and implemented:

- strict TypeScript on Node.js 24;
- Fastify for HTTP with explicit request-boundary validation; a centralized
  schema stack and complete generated OpenAPI are still backlog work;
- PostgreSQL as durable truth with Kysely and `pg` behind original repositories;
- PostgreSQL outbox/jobs with lease expiry, replay, and dead-letter visibility;
- any future cache/coordination service only after an ADR proves measured need,
  reconstructability, exact-version licensing, and failure behavior;
- React and accessible MIT/Apache UI primitives with original Planipus design;
- an owner bootstrap token, HttpOnly session cookie and CSRF/origin protection;
  OIDC/passkeys remain future, separately threat-modeled work.

The Server first proves one Google→Google policy with PostgreSQL-backed durable
intent/outbox. Queue, webhooks, additional providers, scaling, and web breadth
follow evidence rather than copied architecture.

## Mac technical baseline to validate

The Mac edition directly uses dependency-free `ASWebAuthenticationSession`
Google installed-app OAuth with PKCE, a non-synchronizing Keychain token store,
and an integrated GRDB/SQLCipher production database. Its key
lifecycle/distribution gate remains open. It polls/incrementally syncs only
while the application runs; it has no
server profile, remote Planipus dependency, background helper, or embedded web
service. Swift policy behavior must pass the same Planipus-authored fixtures as
the Server implementation.

## Component selection gate

Before introducing any runtime dependency or donor component:

1. record exact source/revision/checksum, SPDX license, maintainer/activity, and
   transitive-license result in `REUSE-MAP.md`;
2. document data/secret access, network egress, attack surface, and removal plan;
3. validate build, update, failure, license-notice and security behavior in CI;
4. add provider/domain tests that bound the component's role;
5. obtain a provenance attestation that no excluded-project material was copied.

Reject an otherwise convenient component when its license, source availability,
security record, maintenance, or distribution obligation conflicts with the
product license decision.

## Historical comparison

| Candidate | Use in Planipus |
|---|---|
| Keeper.sh | Behavior/market research only; excluded from implementation |
| Reclaim/OneCal/CalendarBridge/SyncBusy | Behavioral benchmark only; proprietary products are never runtime dependencies |
| GRDB/SQLCipher | Mac production persistence, integrated; lifecycle/release gated |
| PostgreSQL | Server persistence and durable-job foundation |
| FluidCalendar/Cal.rs/Fluxure | Research only until an independent license/provenance review approves a narrowly scoped, compatible component; no current code reuse |
| Standards/official provider SDK/docs | Preferred protocol reference and integration boundary |

## Success criteria

The plan is accepted when both editions independently implement the P0 Google
scenario, pass Planipus-authored conformance and third-viewer privacy tests, and
produce SBOM/license/provenance evidence showing no excluded donor material.
