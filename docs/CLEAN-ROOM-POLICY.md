# Clean-room and open-source provenance policy

Status: **binding engineering policy**  
Decision date: 2026-07-20

## Purpose

Planipus will not incorporate Keeper.sh or any other AGPL/copyleft project whose
reuse would impose an unwanted derivative-work obligation on Planipus. Keeper
is retained only as historical market and behavior research. It is not a donor
repository.

This policy establishes a strict no-reuse process; it is not a legal conclusion
that prior historical research created a formal legal “clean room.” Because the
project previously recorded a source-level audit, implementation must be
authored from independent Planipus specifications, official documentation and
approved components, with provenance review before release. Obtain counsel for
any legal clean-room determination.

This policy applies to both Planipus for Mac and Planipus Server, every source
file, test, fixture, database schema, UI asset, build file, documentation
snippet, generated artifact, container image, and dependency.

## Absolute Keeper boundary

The following are forbidden from Keeper:

- source code, copied/ported/retyped implementation, and generated output;
- tests, fixtures, snapshots, sample data, schemas, migrations, API shapes, and
  database column/table designs copied from its source;
- UI copy, images, icons, CSS, translations, documentation text, and product
  assets;
- package lockfiles, build scripts, container files, CI workflows, dependency
  selections copied because Keeper used them;
- Git history, commits, patches, vendored modules, submodules, or runtime
  containers;
- imports or execution of Keeper as a service, sidecar, library, binary, or
  development tool.

Allowed use is limited to independently stated product ideas and behavior
questions, such as “a calendar bridge should preserve source→destination copy
identity” or “multi-account calendar discovery exists.” The implementation must
be designed from the Planipus contract, primary provider documentation, relevant
standards, and independently licensed components.

## Clean-room workflow

1. Write a Planipus behavior requirement in product language before coding.
2. Cite an authoritative source where one exists: Google Calendar/OAuth docs,
   RFCs, Apple docs, PostgreSQL/Valkey/BullMQ/other component documentation, or
   original Planipus design decisions.
3. Design an original data model, API, UI, test case, and algorithm. Do not use
   Keeper naming, structure, fixtures, or code as a template.
4. Record every third-party dependency in `REUSE-MAP.md` with exact version,
   SPDX license, source, security review, data access, egress, test coverage,
   upgrade/removal plan, and attribution requirement.
5. Require contributor provenance attestation in every implementation PR:
   “I did not copy or adapt Keeper material; all reused material is recorded in
   the reuse ledger.”
6. Run license/SBOM/provenance scans and manual review before release.

Historical Keeper audit files must be labeled research-only. They are not an
implementation reference or acceptance oracle. New contributors should not need
to read Keeper source to build Planipus.

## Permitted open-source strategy

We may integrate components under licenses compatible with the chosen Planipus
license, after the ledger gate. Preferred building blocks are:

| Area | Preferred approach | Boundary |
|---|---|---|
| Server language/runtime | Node.js 24, strict TypeScript 6, npm lockfile | No copied application framework or source |
| HTTP/API | Fastify 5.10.0 plus maintained Fastify cookie/CSRF/OpenAPI plugins | Original Planipus API/resource model |
| Server storage | PostgreSQL plus Kysely 0.29.0 and `pg` 8.16.3 | Original schema/migrations |
| Jobs/coordination | Original PostgreSQL outbox/jobs using row leases | PostgreSQL remains intent/projection authority; no P0 Valkey |
| Server web UI | React 19.2.7 and original CSS/components | Original visual system/copy/components |
| Server auth | Current single-owner bootstrap plus HttpOnly/CSRF browser sessions; standards-based OIDC is future | Original tenancy/authorization policy |
| Mac UI/runtime | SwiftUI/AppKit, Swift Concurrency, Keychain, AuthenticationServices | Apple platform APIs; original Planipus app |
| Mac storage | SQLCipher-managed GRDB 7.11.1 plus SQLCipher.swift 4.17.0 under ADR-005's gate | Original local schema/migrations |
| Provider behavior | Official Google APIs/OAuth docs and RFCs | Original adapter implementation and fixtures |
| Conformance | Planipus-authored JSON schemas/cases | No donor fixtures or test text |

“Permissive” is not a shortcut for review: validate the exact version and all
transitive licenses, source availability, patent terms, maintenance, advisories,
and distribution obligations before use. Do not select a dependency merely
because it was used by an excluded project.

## License decision gate

Planipus has selected Apache-2.0 with DCO sign-off for implementation. Exact
dependency compatibility, attribution, trademark policy, macOS distribution and
third-party notices still require dedicated legal review before public
distribution or external contribution intake. Do not state that Planipus
“becomes AGPL,” is a fork, or is compatible with any donor's database/API.

This is engineering process guidance, not legal advice. Obtain qualified legal
advice before public release or accepting external contributions.

## Evidence required before implementation release

- complete dependency ledger and SBOM for Mac and Server artifacts;
- automated license policy scan plus manually reviewed exceptions;
- source provenance attestation for every contributor/PR;
- no `keeper`, `ridafkih`, or excluded-donor package/source reference in shipped
  code, images, manifests, lockfiles, tests, or generated outputs;
- release notices and source-offer obligations validated for the chosen license;
- a clean-room review of high-risk modules: provider adapters, policy engine,
  schema/migrations, synchronization/retry, web UI, and installer/packaging;
- reproducible build from declared, reviewed dependencies only.

## Violation handling

If copied or uncertain-provenance material is found, stop release work. Isolate
the affected change, identify files/artifacts/derived tests, remove and replace
them with an independently designed implementation, update SBOM/attribution,
and record the incident in `DECISIONS.md` and release evidence. Do not “clean
up” suspicious code by superficial renaming.
