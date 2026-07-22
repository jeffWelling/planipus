# ADR-005: SQLCipher-managed GRDB for the Mac production store

- Status: Accepted for implementation spike; release gate remains open
- Date: 2026-07-21
- Owners: Planipus maintainers
- Scope: Planipus for Mac only

## Context

The Mac edition must keep observations, projections, cursors, policies, audit
facts and durable desired effects while remaining completely independent from
Planipus Server. Plain SQLite does not meet the encrypted-at-rest requirement.
Building a database mapper or encryption layer would waste effort, increase
cryptographic risk and contradict the project's compatible-OSS strategy.

Upstream GRDB is a mature Swift interface to SQLite, but its ordinary package
does not enable SQLCipher. Zetetic and the SQLCipher maintainers publish a
managed `sqlcipher/GRDB.swift` fork whose package enables SQLCipher and follows
upstream GRDB. The selected release is 7.11.1. Its package consumes the official
`sqlcipher/SQLCipher.swift` binary package; the selected dependency revision is
4.17.0. These versions were current in the official release channels when this
decision was recorded.

## Decision

Use the SQLCipher-managed GRDB Swift package at the exact 7.11.1 release behind
the `PlanipusStore` module. Resolve and lock its official SQLCipher.swift
dependency. Keep all GRDB/SQLCipher types out of `PlanipusCore`,
`PlanipusGoogle`, and UI modules.

The database encryption key is an independently generated random value stored
as a non-synchronizing Keychain item. OAuth tokens and the database key use
separate service/account namespaces. The key is never derived from an OAuth
token, device identifier, email address, passphrase default, or source code
constant. Production startup fails closed when the key is unavailable or the
database cannot be opened; it never silently creates an unencrypted replacement
or falls back to the in-memory repository.

Migrations are forward-only and transactional. A schema metadata record must
identify the Planipus schema version independently of the SQLCipher library
version. Every write that creates provider intent records the durable effect in
the same database transaction as its desired projection state.

## Required spike and acceptance evidence

The package selection does not by itself close the encrypted-store gate. Before
shipping the Mac edition, capture evidence for all of the following:

1. Package resolution is locked to reviewed versions and all package/source
   checksums are present in SwiftPM's resolution data.
2. A newly created database cannot be read using ordinary SQLite without its
   key, and the file header does not expose the SQLite magic header.
3. Schema creation and every migration run transactionally; interruption leaves
   either the old valid schema or the new valid schema.
4. Accounts, calendars, hours, policies, observations, projections, cursors,
   batches/outbox, audit and health survive process relaunch.
5. Missing/wrong Keychain keys fail with a safe recovery state and do not erase,
   overwrite, replace or quarantine data without explicit user action.
6. Crash-after-provider-write/before-local-commit recovery finds the managed
   copy and does not create a duplicate.
7. Key rotation uses SQLCipher rekey or an explicitly reviewed export/import
   transaction, is crash-tested, and never logs either key.
8. Backup/export design specifies whether it preserves the database key or
   re-encrypts under an export key; OAuth tokens are always excluded.
9. Release builds pass on a clean machine for the supported macOS matrix, with
   App Sandbox, hardened runtime, signing, notarization and license notices.
10. Startup, incremental transactions and representative full reconciliation
    remain within documented CPU, memory, energy and latency budgets.

## Consequences

- Planipus adopts maintained database and encryption foundations rather than
  reimplementing them.
- The Mac binary gains a native SQLCipher dependency and corresponding license,
  update, notarization and supply-chain responsibilities.
- The repository interface remains replaceable and testable; in-memory storage
  stays test/preview-only.
- A future upstream change may let Planipus return to standard GRDB with a
  separately linked SQLCipher package. That change requires a new dependency
  review, not Core changes.

## Rejected alternatives

- **Plain SQLite plus File Protection:** useful defense in depth, but does not
  satisfy the explicit encrypted-database contract or portable backup threat
  model.
- **Home-grown field encryption:** leaks relational metadata, complicates every
  query/migration and creates a custom cryptographic protocol.
- **Embedding PostgreSQL or calling Planipus Server:** violates the autonomous
  native-edition boundary and its local privacy/uptime model.
- **Shipping the in-memory repository:** loses durable intent and can create
  duplicates after relaunch.
- **Using an excluded AGPL calendar application or its storage code:** forbidden
  by the clean-room policy regardless of technical fit.

## Sources and review inputs

- SQLCipher-managed GRDB releases: <https://github.com/sqlcipher/GRDB.swift/releases>
- SQLCipher Swift package: <https://github.com/sqlcipher/SQLCipher.swift>
- SQLCipher Swift package releases: <https://github.com/sqlcipher/SQLCipher.swift/releases>
- Upstream GRDB releases: <https://github.com/groue/GRDB.swift/releases>
- Exact managed-package manifest: <https://raw.githubusercontent.com/sqlcipher/GRDB.swift/v7.11.1/Package.swift>

This is an engineering dependency decision, not legal advice. Public
distribution remains blocked on complete license/notice and security review.
