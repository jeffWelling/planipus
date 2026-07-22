# ADR-001 — Apache-2.0 license and DCO contribution model

Status: accepted for implementation; release legal review pending

Date: 2026-07-21

Owners/reviewers: project owner; qualified license review required before
public distribution or external contribution intake

Requirements/risks: OPS-006; clean-room Foundation Gate A

## Context

Planipus must be downloadable, self-hostable, fully open source, free of product
entitlement gates, and independently implemented from excluded copyleft
applications. The repository already contains the Apache License 2.0 text, but
the planning dossier previously stopped short of selecting an implementation
license.

## Decision drivers

- a widely understood OSI-approved permissive license;
- an express patent grant;
- compatibility with the intended permissive dependency set;
- low-friction community and self-hosted use;
- auditable contributor provenance without assigning copyright.

## Options

Apache-2.0, MPL-2.0, and AGPL-3.0 were considered. MPL-2.0 would add file-level
copyleft; AGPL-3.0 would add network copyleft and conflict with the owner's
stated reuse/distribution direction. Apache-2.0 best matches the current intent.

## Decision

Planipus implementation, conformance fixtures, packaging, and documentation are
Apache-2.0. Contributions require Developer Certificate of Origin 1.1 sign-off
and the excluded-donor attestation in `CONTRIBUTING.md`.

## Consequences

Every dependency and adapted compatible source still requires exact-version
license/provenance review, notices, and SBOM coverage. No part of this ADR is
legal advice. Public release and accepting external contributions remain gated
on qualified review of the full dependency graph, notices, trademarks, and
macOS distribution.

## Validation/revisit trigger

Revisit only through a new ADR and contributor-rights analysis. A dependency
that cannot be distributed under this model is replaced or isolated; it does
not silently change the project license.

## Supersedes / superseded by

Supersedes the unresolved implementation-license state in the initial dossier.
