# Build verification — 2026-07-21

Evidence status: local, credential-free, uncommitted worktree. This is
development evidence, not release certification.

## Scope

This record covers the first working Planipus implementation:

- the provider-neutral Calendar Sync v1 contract and TypeScript engine;
- Planipus Server API/web/scheduler/worker against a real local PostgreSQL;
- the native Planipus for Mac package and canonical Swift evaluator;
- Helm solo/standard rendering; and
- clean-room documentation/provenance gates.

It deliberately does not claim live Google correctness, ordinary-viewer privacy,
production image safety, cluster recovery, Mac distribution, legal approval or
dogfood duration.

## Toolchain observed

- Node.js 24.9.0; npm package engine is locked to Node 24/npm 11.
- Apple Swift 6.3.3; package contract is Swift tools 6.1 and macOS 14+.
- Local PostgreSQL 17.7 on loopback port 55432 in a disposable data directory.
- Helm 3 from the local development environment.

Exact release versions and image digests remain a release-record responsibility.

## Shared and Node verification

Command:

```text
npm run verify
```

Result after Server/web integration:

- provenance gate passed;
- documentation gate passed;
- shared TypeScript type-check/build passed;
- 95 shared tests passed across two files;
- Server type-check/build passed; the production artifact verifier found 75
  source-only emitted paths and no test/Vitest output;
- 59 Server tests passed across 12 files; the isolated PostgreSQL test is a
  thirteenth opt-in file;
- web type-check and production Vite build passed;
- output was one HTML document, one CSS asset and one JavaScript asset with
  source map.

The shared suite discovers the canonical manifest and executes 91 v1 behavior
cases; the remaining four tests cover corpus integrity/canonicalization.

## Native Swift verification

Commands:

```text
swift test --package-path macos
swift build -c release --package-path macos
```

The final integrated pass produced 58 passing Swift tests and a successful
release build. Its manifest-driven test proved:

- the manifest and bundled case sets close exactly;
- all 91 declared assertions execute in native Swift;
- hours including exception and DST gap/fold behavior match v1;
- selection, validation, privacy/disclosure and reconciliation vocabulary match
  the canonical registries; and
- Swift and TypeScript produce the same published canonical SHA-256 vector.

The native persistence/lifecycle suite additionally proved SQLCipher headers do
not expose SQLite/plaintext sentinels; state survives reopen; missing and wrong
keys fail without overwriting bytes; five migrations are idempotent; cursor,
staged-page and outbox commits are atomic; abandoned crash batches do not
advance cursors; same-named calendars stay separated by account; and a durable
ownership quarantine cannot starve an independent policy or re-enter automatic
retry. OAuth credential metadata can be inspected without exposing tokens.

The consolidated `scripts/gate.sh` passed Node type-check/build/tests, the web
production build, all 58 Swift tests, the Swift release build, documentation,
provenance, and both Helm profile lint/render checks. SwiftPM required normal
macOS build-sandbox/cache access; the first restricted-host attempt stopped at
manifest compilation before testing, then the approved native run completed.

## Real PostgreSQL integration

The test used a newly initialized, loopback-only PostgreSQL cluster and isolated
temporary schemas/databases. No production service or user data was touched.

1. The built migration command applied `server/migrations/0001_initial.sql`,
   `0002_destination_verification.sql`, and `0003_recovery_basis.sql`.
2. Schema inspection found 19 application/migration tables.
3. Two synthetic fake-provider connections were inserted:
   `Personal / p•••@gmail.com` as source and
   `Employer / j•••@company.example` as destination, with separate calendar
   endpoint UUIDs and no real credentials.
4. The built API served readiness and the compiled React app on
   `127.0.0.1:18080`. Port 8080 was already owned by an unrelated user process
   and was intentionally left untouched.
5. Browser bootstrap created an HttpOnly SameSite session and CSRF cookie.
6. Policy preview and activation persisted a dedicated hours profile, directed
   policy, preview consumption, audit fact and durable reconciliation job.
7. Sync Now produced one `sync_calendar` and one `reconcile_policy` job.
8. The real worker leased and completed those jobs; database inspection showed
   succeeded state and one attempt. Resuming the policy produced and completed
   the expected additional reconcile job.
9. The overview reported the latest successful reconciliation and zero pending
   effects.

### Defects found only by the real database

The first preview returned PostgreSQL `22001`: canonical hashes are written as
`sha256:` plus 64 hexadecimal characters (71 characters), while original schema
columns used `char(64)`. The initial migration now uses checked `varchar(71)`
for canonical hashes/idempotency values while retaining 64-character columns
for bare session/OAuth token hashes. The migration test asserts this distinction.

The first activation then returned PostgreSQL `22P02`: node-postgres encodes a
top-level JavaScript array as a PostgreSQL array literal, which a `jsonb` column
rejects. Top-level weekly-interval, exception and OAuth-scope arrays are now
serialized explicitly as JSON text; object-shaped documents continue through
the normal JSON path.

A final static review found a third correctness defect: a newly introduced
query fingerprint created a new cursor at generation 1. Observations left by an
older fingerprint at generation 1 or higher could therefore escape the
completed full scan's `sync_generation < current_generation` tombstoning rule.
Cursor creation now chooses one greater than the maximum cursor or observation
generation for that calendar. The real-PostgreSQL integration test seeds a live
generation-1 observation, runs an empty replacement full scan, and proves the
cursor and tombstone both advance to generation 2.

The same static pass found that Server ambiguity recovery read only destination
ID/revision and would update any event found at a deterministic managed ID. The
provider lookup contract now returns private Planipus policy/projection/
generation markers. Create/update/delete recovery holds the projection inert on
any absent or mismatched marker, and Google write/read results fail closed when
the provider omits a revision. Provider tests cover exact ownership matching,
marker parsing, and rejection inputs; live collision evidence remains pending.

Later safety review found and fixed additional issues in the same real-database
test:

- preview now requires a complete/current source cursor, rejects a >5,000-row
  truncation, and activation revalidates connection roles/capabilities;
- pause and provider execution share a policy-row lock, so pause either wins
  before the write or waits for the bounded in-flight request and its outcome;
- source A→B→A→B transitions use a monotonic projection intent sequence, so a
  historical idempotency key cannot suppress a legitimate later intent;
- a 15-minute, 100-item oldest-first verifier restores owned edits, rotates
  generation/provenance/custom ID after deletion, and holds foreign ownership;
- edit→delete and ambiguous-create disappearance races also rotate rather than
  reuse a Google custom event ID;
- explicit held-effect recovery rechecks ownership, holds again while a foreign
  event remains, then safely rotates/recreates only after it is removed;
- periodic reconciliation preserves terminal failure/ownership state and
  refreshes a held recovery payload without authorizing a write;
- every effect binds the source observation hash plus its separate tombstone
  flag, and the worker rechecks that basis under source/projection locks before
  provider access; stale and pre-migration effects are superseded locally; and
- overview health now attributes held/failed/ambiguous projections and dead
  effects to the affected bridge, keeping the explicit recovery action reachable.

`server/tests/postgres.integration.test.ts` now creates a cryptographically
random, strictly validated temporary schema; migrates it; seeds fake accounts,
calendars and one observation; previews and activates inline hours; asserts
71-character hashes and JSON-array round trips; verifies the durable job;
exercises calendar-wide generation/tombstone behavior; and drops only that
schema in `finally`. It also proves pause serialization, destination drift and
deletion repair, marker collision holds, explicit recovery, and A→B→A→B outbox
uniqueness. The final extension proves a terminal stale effect cannot mask
failure, a later source edit is the only payload eventually written, and a
tombstone that leaves normalized event bytes unchanged still prevents a queued
create. It passed against the disposable loopback database:

```text
PLANIPUS_TEST_DATABASE_URL=postgresql://LOCAL_ROLE@127.0.0.1:55432/planipus \
  npm run test --workspace @planipus/server -- postgres.integration.test.ts

Test Files  1 passed (1)
Tests       1 passed (1)
```

The schema was reset only in the disposable database, the corrected initial
migration was reapplied, and the full browser/worker flow then passed. The
temporary PostgreSQL process was stopped cleanly afterward; its disposable data
directory remains under `/private/tmp` for OS cleanup and is not part of the
repository.

The documented `npm run seed:fake` command was also run twice against a separate
empty disposable database. Both runs succeeded, and inspection remained exactly
two fake connections, two calendars, one source observation and one ready cursor
(`2|2|1|1`), proving the local demo seed is idempotent. It refuses production or
Google provider mode.

## Browser verification

The compiled app was tested against the same built API process in the in-app
browser, with DOM/accessibility snapshots and full-page visual inspection.

Passed flow:

1. bootstrap login with disabled-until-valid password control;
2. empty first-account state;
3. overview with two labeled/masked accounts;
4. personal calendar → employer calendar direction;
5. overlap-hours default, 09:00–17:00 weekdays, America/Vancouver;
6. privacy choices for no details, generic type, private details and selected
   shared details;
7. exact zero-change preview against an empty fake source;
8. activation and visible active bridge;
9. Sync Now durable job creation;
10. pause and resume with status/activity updates; and
11. worker completion reflected as a successful-sync timestamp.

No browser console warning/error remained after the passing flow. Visual review
found a calm desktop layout with clear hierarchy, masked identities, direction,
hours/privacy chips and safe activity text. One awkward pre-sync phrase was
changed to “Waiting for the first successful sync.”

This is synthetic browser evidence. It predates the final per-bridge recovery
control and privacy-label UI edits; those later edits passed type-check,
production build, and component tests, but the browser flow was not rerun.
Google consent screens, event details, provider failures and third-viewer ACL
disclosure were not exercised.

## Helm and delivery verification

The delivery pass completed:

- solo and standard `helm lint`;
- solo and standard `helm template`;
- inspection that standard mode renders no PostgreSQL container, database
  volume or PVC;
- workflow YAML and values-schema parsing;
- JavaScript and shell syntax checks; and
- npm workspace-tree validation.

The solo chart now preserves the official PostgreSQL entrypoint, listens only on
pod loopback, and initializes a separate `NOSUPERUSER` application owner from an
admin-only Secret that application containers do not receive. Rendering rejects
equal admin/application role names and rejects one Secret name reused for both
application and administrator passwords; the passwords must also differ. The
bounded migration-attempt chart setting is wired into every process instead of
being inert. PostgreSQL init-script
password changes remain an explicit existing-PVC `ALTER ROLE` procedure.

No image was built, pushed, scanned or deployed. No server-side Kubernetes
dry-run or admission check was run. Default registries remain invalid by design.

## Dependency observations

- `npm install` reported one moderate advisory. No complete advisory
  classification/SBOM was performed.
- The maintained SQLCipher fork of GRDB resolved at 7.11.1, revision
  `a285e4ca87ec6b3584c97b0ec25fc61fec02de60`.
- Its official SQLCipher.swift dependency resolved at 4.17.0, revision
  `205df55271aa1ba512a9bfe3fd1813bc9ac52a19`, including the official binary
  XCFramework artifact.
- `macos/Package.resolved`, `THIRD_PARTY_NOTICES.md`, `REUSE-MAP.md` and ADR-005
  record the selection. License/notarization/SBOM evidence is not yet complete.

## Remaining acceptance boundary

Before any release claim, complete the blockers in `STATE.md`: real Google
two-account/third-viewer matrices independently in both editions, encrypted Mac
store recovery/key lifecycle, provider quota/revoke/cursor cases, Server image
and cluster backup/restore/upgrade, accessibility/energy/security checks,
SBOM/advisory/notices/signing/provenance/legal review and dogfood periods.
