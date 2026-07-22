# Open-source reuse map

This is a living engineering control, not a marketing list. Every product area
starts here before original implementation. Update the status, pinned revision,
license, security review, and integration decision in the same change that
introduces or replaces a dependency.

Status vocabulary:

- **adopt** — run or import the component with small configuration changes;
- **adapt** — modify a permitted component within its license terms and preserve attribution;
- **integrate** — connect through a standard or narrow API;
- **reference** — use independently summarized behavior or aggregate audit
  evidence; do not copy code, tests, fixtures, assets, schema, or expression;
- **defer** — candidate is plausible but not selected yet;
- **reject** — evaluated and unsuitable for the named role.

## Product foundation

| Capability | Candidate | License | Decision | Reused now | Missing/guardrail |
|---|---|---|---|---|---|
| Excluded donor: Keeper | Keeper `1c274dbe…` / v2.13.5+1 | AGPL-3.0-only | **reference only** | high-level behavior research only | No code/tests/assets/schema/history/dependencies/runtime/lockfiles or copied expression |
| Server application foundation | original Planipus TypeScript workspace | Apache-2.0 | **build/compose** | API, web, scheduler, worker, provider ports, original domain model | Build only from ledger-approved components and clean-room policy |
| Server data/jobs | PostgreSQL durable outbox/jobs; `pg` 8.16.3; Kysely 0.29.0 | PostgreSQL License; MIT | **integrate** | canonical store, worker leases, retry/dead-letter state | Valkey deferred by ADR-003; no job intent outside PostgreSQL |
| Mac application foundation | SwiftUI/AppKit + Swift Concurrency | Apple platform SDK | **adopt** | native lifecycle, UI, accessibility, actors, URLSession, AuthenticationServices, Keychain | Independent local edition; no Keeper runtime, web shell, or Server API |
| Mac database | SQLCipher-managed GRDB.swift 7.11.1 + SQLCipher.swift 4.17.0 | MIT + BSD-style; notices/review required | **selected and integrated; release gated** | SQLite access/migrations/transactions and encrypted-at-rest production store | Exact graph, encryption/migrations/wrong-key behavior are proven; complete rotation/recovery/performance/notarization/backup evidence |
| Cross-edition behavior | canonical JSON schema/cases | Planipus project license | **build once/test twice** | policy inputs, reasons, disclosure, expected provider-neutral effect | No shared runtime/storage/network API; both implementations must pass independently |
| Adaptive planner | Fluxure `724d45c…` / v1.0.86 | AGPL-3.0-only | **defer/reference** | high-level behavior concepts and aggregate audit/test results only | No source/test/fixture reuse; post-sync ADR only; never co-run as calendar authority |

## Donor projects

| Area | Donor | License | Decision | Candidate reuse | Constraints |
|---|---|---|---|---|---|
| Outlook/Graph provider | FluidCalendar pinned audited source | MIT | **adapt** after provider port | OAuth flow, calendar/task mapping, recurrence fixtures, setup UX | Encrypt credentials; use Graph delta/subscriptions; do not inherit Prisma coupling |
| CalDAV calendar/tasks | FluidCalendar pinned audited source | MIT | **adapt** | DAV discovery, calendar and VTODO mapping, timezone fixtures, error classification | Revalidate with standards and multiple servers; no plaintext credentials |
| Calendar UI interactions | FluidCalendar | MIT | **reference/adapt selectively** | multi-view interactions, drag semantics, event display | No wholesale fork; line-level attribution for copied MIT code |
| Booking lifecycle | Cal.rs v1.14.0 `13a584f…` | AGPL-3.0 | **reference only** | behavior questions only | No code/tests/assets/schema/runtime reuse under the clean-room policy |
| OIDC/CLI/self-host tests | Cal.rs v1.14.0 | AGPL-3.0 | **reference only** | behavior questions only | Use standards and Planipus-authored tests; no source reuse |
| Booking UI/components | Cal.com / Cal.diy | mixed/current review required | **reference/defer** | public booking interaction patterns, embed ergonomics | Do not import enterprise-licensed or removed community features |
| Task-server integration | Vikunja | AGPL-3.0 | **integrate later** | task source/sink through documented API/CalDAV where supported | External system remains task authority; explicit conflict policy |
| Calendar-server integration | Nextcloud, Radicale | AGPL/GPL | **integrate/test** | DAV conformance targets | Run in compatibility matrix, not in Planipus pod |
| Calendar-policy benchmark | Reclaim/CalendarBridge commercial behavior | proprietary | **reference** | source→destination policy, privacy, hours, RSVP/selection UX | Behavior only; do not copy code, text, branding, or UI |

## Standards and narrow libraries

No library is approved merely by appearing below. Pin an exact version and run
license, provenance, maintenance, and advisory review before introduction.

| Capability | Preferred reuse | Decision rule |
|---|---|---|
| Mac installed OAuth | Apple `ASWebAuthenticationSession`/AuthenticationServices plus Google native-app OAuth and PKCE | System browser, exact redirect/state/PKCE; distributed client secret is public; refresh token only in non-sync Keychain |
| Mac secret storage | Apple Keychain Services | No custom secret vault; separate token/database-key items; redaction, revoke, rotation, uninstall tests |
| Mac SQLite access | pinned GRDB.swift | Use migrations/transactions/observations; wrap behind PlanipusStore; no ORM types in Core |
| Mac database encryption | pinned SQLCipher build compatible with GRDB | Accept only after encryption-at-rest, key loss/rotation, export/restore, clean-VM signing/notarization and license gate |
| Mac Google HTTP | URLSession plus narrowly reviewed typed request/response layer or maintained official-compatible Swift library | Prefer small auditable surface; no scraping/EventKit; incremental token and serializer contract tests decide |
| iCalendar data | RFC 5545 plus a maintained TS parser such as `ical.js` | Use a library for syntax; keep Planipus normalization and lossless fixtures |
| CalDAV | RFC 4791/6638/7809 plus a maintained TS DAV client such as `tsdav` | Adopt only after Nextcloud, Radicale, Fastmail, and generic basic-auth/OAuth tests |
| Recurrence | maintained `rrule`/iCalendar implementation | Never invent RRULE parsing; preserve RECURRENCE-ID and exceptions |
| Google APIs | official Google documentation plus reviewed typed HTTP layer | Pin scopes/retry; original adapter and fixtures; no scraping or excluded donor code |
| Microsoft | official Microsoft Graph JavaScript client or direct typed HTTP generated from official schema | Delta and webhook semantics must be covered by contract fixtures |
| OIDC | maintained standards library such as `openid-client` | No home-grown protocol/crypto; support discovery, PKCE, nonce/state, group claims |
| Password hashing | current memory-hard library (Argon2id preferred) | Preserve migration path from adopted hashes; parameterize and test resource limits |
| Envelope encryption | maintained authenticated crypto already in stack or platform AEAD; optional KMS/Vault adapter | Keep ciphertext version/key ID/AAD; add rotation and rewrap; never invent primitives |
| Validation | reviewed schema stack such as TypeBox/Zod/ArkType, exact choice gated | One schema per public command; reject unknown security-sensitive fields |
| Database | PostgreSQL and reviewed migration/query layer | PostgreSQL is authoritative; original schema/migrations; no donor compatibility promise |
| Queues | PostgreSQL-backed worker with `FOR UPDATE SKIP LOCKED` | Never silently drop guaranteed jobs; outbox/job rows are durable source of truth |
| Mail | adopted optional mail adapter after dependency review | P0 copies send no reminders/invitations; mail is not required for sync |
| Metrics/traces | OpenTelemetry and/or `prom-client` | No required external collector and no telemetry egress by default |
| UI primitives/icons | reviewed accessible OSS packages | Preserve licenses; original Planipus design system/copy |
| Testing | Vitest plus browser/live provider harness and Testcontainers where useful | Planipus-authored deterministic time/provider/viewer suites; no donor tests |
| Kubernetes packaging | Helm/Kustomize with reviewed PostgreSQL image or operator contract | No dependency on a proprietary control plane or phone-home chart; optional cache needs an ADR |
| SBOM/signing | Syft/SPDX or CycloneDX plus Cosign | Produce in release pipeline; verify base-image provenance |

## Deferred solver escalation ladder

There is no solver in Calendar Sync P0. If a later ADR adds adaptive planning:

1. Re-evaluate the independently summarized Fluxure behavior and permissively
   licensed alternatives; do not adapt its AGPL code or property corpus.
2. Improve original Planipus candidate generation, incremental repair, and
   bounded local search if quality improves without losing deterministic latency.
3. Evaluate Timefold Community Edition (Apache-2.0) behind the solver port if
   multi-person or large dependency problems miss published budgets.
4. Run a separate solver process only when measurements justify its memory,
   image, upgrade, observability, and failure-mode cost.

The project must never label a generic optimizer “AI” or rely on a hosted model
to make calendar placements. Models may translate language into typed commands;
the deterministic plan path remains available without them.

## Authentication and infrastructure boundary

Planipus should integrate with an operator's existing open-source infrastructure
rather than absorbing it:

- OIDC providers: Authentik, Keycloak, Dex, Authelia-compatible discovery;
- mail: any SMTP server;
- database: bundled solo PostgreSQL sidecar or external PostgreSQL;
- Valkey: absent in P0; a future ADR may allow it only for reconstructible
  cache, lease, or fanout work, never durable intent;
- secrets: Kubernetes Secret initially, External Secrets/SOPS/Vault through
  ordinary mounted/env contracts;
- ingress/TLS/DNS: cluster responsibility;
- backup targets: volume snapshots and standard S3-compatible storage adapters;
- model endpoint: absent from P0; any later assistant is optional and cannot
  access credentials or bypass policy effects.

## Required dependency acceptance record

For every new runtime dependency or adapted donor component, record:

1. name, source URL, exact revision/version, and checksum/lockfile;
2. license/SPDX and compatibility with the chosen Planipus distribution license;
3. maintainers, recent release/commit activity, bus-factor observation;
4. current advisories and transitive dependency delta;
5. data and secrets it can access;
6. egress it can perform;
7. why the standard library/current stack is insufficient;
8. tests that bound its behavior and failure modes;
9. update/removal strategy; and
10. notice/attribution changes.

## Original-code budget

Original work should be concentrated in the product's differentiators and glue:

- language-neutral conformance corpus and independent Swift runner;
- Mac module orchestration, local durable sync lifecycle and truthful status;
- original per-directed-policy model;
- timezone-aware hours profiles and interval evaluation;
- versioned privacy presets, disclosure manifests, and provider serialization;
- RSVP/all-day/free/override/duplicate/loop/detach/cleanup semantics;
- credential envelope/rotation and dependency hardening;
- calm account→policy→preview→health UX;
- Kubernetes solo-profile lifecycle and restore UX; and
- live provider/viewer conformance tests.

Do not spend project time reimplementing OAuth/OIDC, RRULE parsing, DAV syntax,
SMTP, password hashing, encryption primitives, database engines, queues, icon
sets, or generic UI controls. Reuse does not mean copying excluded projects or
coupling the editions; see `CLEAN-ROOM-POLICY.md`.
