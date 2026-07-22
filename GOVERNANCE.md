# Governance

The project currently has one owner and no public governance body. The canonical
repository will remain fully open source; governance grows with contributors and
real adoption rather than inventing committees before code exists.

## Decision types

- Routine maintenance: maintainer review and tests.
- Product behavior/requirements: issue discussion plus requirement update.
- Architecture, storage, provider semantics, security boundary, public API, data
  migration, licensing, governance: ADR and maintainer approval.
- Security emergency: private fix/release process, then public advisory.
- Conduct/moderation: documented private review with conflict-of-interest recusal.

The decision log records outcome, context, options, consequences, and superseded
status. Silence is not consent for destructive/provider-visible changes.

## Provenance and upstream relationship

Planipus is a clean-room original project, not a Keeper downstream. Keeper and
other excluded copyleft donors are behavior research only. The binding
`docs/CLEAN-ROOM-POLICY.md` prohibits their source, tests, assets, schemas,
dependencies, history and runtime from entering the product. Compatible
components are recorded in `REUSE-MAP.md` with required notices; attribution
never implies a donor authored Planipus or endorsed it.

## Releases

Maintainers who can tag/release must require green release evidence, review
license/provenance, sign artifacts, publish source and notes, and avoid unilateral
release when a known critical calendar/security/migration issue exists. No person
may approve their own high-risk release change without a second reviewer once the
project has two maintainers.

## Path to shared maintainership

Invite maintainers based on sustained reviewed contributions, support/reliability,
security/privacy judgment, respectful collaboration, and ability to say “not yet.”
Document repository/package/registry/domain/secrets access, require MFA, least
privilege, offboarding, and two-person recovery.

## Commercial activity

Hosted operations, consulting, or support may be sold. The canonical distribution
does not withhold source features, require activation, cap seats, or require
telemetry. Marks/domains may have a separate policy before 1.0; forks retain
license rights but must not imply official endorsement.
