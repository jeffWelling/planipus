# ADR-003 — PostgreSQL-first Planipus Server foundation

Status: accepted for the foundation build

Date: 2026-07-21

Owners/reviewers: Planipus maintainers; dependency/security review ongoing

Requirements/risks: CAL-009–CAL-015, SEC-001–SEC-007, OPS-001–OPS-006

## Context

The first server must prove safe calendar projection, ambiguous-write recovery,
and Kubernetes operation. A second queue datastore does not improve these
properties while PostgreSQL already owns observations, cursors, projections,
and effects.

## Decision

The Server uses Node.js 24 LTS, strict TypeScript 6, Fastify 5, React 19/Vite 8,
PostgreSQL, Kysely with `pg`, built-in authenticated encryption, official
Google OAuth support, direct typed Calendar v3 HTTP, and a PostgreSQL durable
outbox/job queue using `FOR UPDATE SKIP LOCKED`. Exact versions and transitive
review live in `REUSE-MAP.md` and lockfiles.

API, scheduler, and worker are separate commands built from one application
image. PostgreSQL is the only required persistence service. Optional
`LISTEN/NOTIFY` reduces polling latency but is never the durable truth.

Valkey is not part of P0. It may be added only after measurements show a need
for reconstructible cache/lease/fanout work and a new ADR proves that failure or
loss cannot drop intent. This supersedes the mandatory-Valkey part of the
earlier solo-pod decision.

Google ingestion performs a master-oriented full sync and retains the compatible
incremental query fingerprint/token. Recurring occurrences are materialized in
the bounded policy horizon separately. HTTP 410 stages a replacement full-sync
generation; incomplete scans never infer deletion. Destination creates use a
deterministic client-assigned Google event ID plus private provenance so a lost
response can be read back without a duplicate create.

Google watch is an optional latency optimization requiring public HTTPS.
Polling plus periodic safety reconciliation is the supported private-cluster
mode and remains mandatory even when watches are enabled.

## Consequences

Solo Kubernetes has API/scheduler/worker and PostgreSQL containers in one
StatefulSet pod and one RWO volume. The external-database profile omits the
PostgreSQL sidecar. OIDC, CLI, MCP, planning, booking, and team breadth remain
outside the vertical slice.

## Validation/revisit trigger

The foundation gate requires fake-provider 401/410/412/429, pagination replay,
destination drift, and timeout-after-write tests plus a real PostgreSQL suite.
Add Valkey only if measured queue/fanout requirements cannot be met safely with
PostgreSQL.

## Supersedes / superseded by

Supersedes only the required-Valkey portion of the 2026-07-20 solo-pod decision.
