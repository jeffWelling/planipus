# Third-party notices

This development notice is derived from `package-lock.json` as installed on
2026-07-21. It is not a substitute for the complete release SBOM, license-text
bundle, or legal review. Release artifacts must regenerate all three from the
exact lockfile and image digests.

## Direct runtime components

| Component | Version | License | Purpose |
|---|---:|---|---|
| `@fastify/cookie` | 11.1.2 | MIT | browser session cookies |
| `@fastify/csrf-protection` | 8.0.0 | MIT | browser mutation protection |
| `@fastify/swagger` | 9.8.1 | MIT | OpenAPI document support |
| Fastify | 5.10.0 | MIT | Server HTTP runtime |
| Google Auth Library for Node.js | 10.9.0 | Apache-2.0 | Google OAuth and token refresh |
| Kysely | 0.29.0 | MIT | typed PostgreSQL queries |
| Model Context Protocol TypeScript SDK | 1.29.0 | MIT | local stdio MCP server and protocol transport |
| `pg` | 8.16.3 | MIT | PostgreSQL protocol client |
| `prom-client` | 15.1.3 | Apache-2.0 | redacted operational metrics |
| `temporal-polyfill` | 1.0.1 | MIT | deterministic timezone/hour evaluation |
| `uuid` | 11.1.1 | MIT | stable identifiers |
| Zod | 4.1.12 | MIT | strict MCP tool-input schemas |
| React / React DOM | 19.2.7 | MIT | Server web interface |

The MCP SDK is the official MIT-licensed
[`modelcontextprotocol/typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
package. Planipus uses its stdio transport only. It does not ship the SDK's
optional HTTP/static-file serving path as an exposed Planipus MCP transport.

Planipus for Mac resolves these runtime packages through `macos/Package.resolved`:

| Component | Version / revision | License | Purpose |
|---|---|---|---|
| SQLCipher-managed `GRDB.swift` | 7.11.1 / `a285e4ca87ec6b3584c97b0ec25fc61fec02de60` | MIT | transactional Swift SQLite access and migrations with SQLCipher enabled |
| `SQLCipher.swift` | 4.17.0 / `205df55271aa1ba512a9bfe3fd1813bc9ac52a19` | BSD-3-Clause-style Community Edition license | official SQLCipher XCFramework and encrypted SQLite engine |
| SQLite within SQLCipher | version embedded by the exact SQLCipher artifact | public domain | embedded database engine |

The SQLCipher license requires retaining its copyright/conditions/disclaimer in
source distributions and reproducing them in documentation or other materials
with binary distributions. GRDB's MIT notice must accompany substantial copies.
The Mac app also uses Apple platform SDKs under the terms supplied with Xcode
and macOS. Release packaging must include the exact package license files, not
only this summary.

## Direct development and build components

The lockfile pins TypeScript, Vite, Vitest, Ajv, fast-check, React type
definitions, and the Vite React plugin. Their declared licenses are MIT or
Apache-2.0. Vite's installed build graph also contains MPL-2.0 Lightning CSS
binaries; they are build tooling and must be included in the build-environment
SBOM and license bundle even though they are not copied into the browser bundle
as a runtime library.

Every installed dependency entry that declares a license in the lockfile uses
one of these SPDX/license families:
`0BSD`, `Apache-2.0`, `BSD-3-Clause`, `ISC`, `MIT`, and `MPL-2.0`. This statement
describes package metadata, not a completed compatibility finding.

## Platform and deployment components

Planipus Server targets Node.js 24 and PostgreSQL 17. PostgreSQL is distributed
under the PostgreSQL License. The Helm defaults intentionally name invalid image
registries; operators must select reviewed images and pin digests. Valkey is not
part of the P0 runtime.

## Required release evidence

Before public distribution:

1. generate CycloneDX or SPDX SBOMs for source, npm graph, Mac bundle, Server
   image, PostgreSQL image, and Helm chart;
2. archive every required license and notice text;
3. run a current vulnerability and license-policy scan without silently sending
   private repository metadata to an unapproved service;
4. classify every reachable critical/high advisory and every accepted lower
   severity advisory; the current known remainder is a moderate
   `@hono/node-server` Windows serve-static advisory transitively installed by
   the MCP SDK, unreachable in Planipus's stdio-only MCP process and accepted
   temporarily pending an upstream SDK dependency update;
5. verify the downloaded SQLCipher XCFramework checksum recorded by SwiftPM and
   archive the matching source/license correspondence; and
6. record the exact Node, Swift/Xcode, image, and chart digests in release
   evidence.

The direct `uuid` package was upgraded to 11.1.1. The Hono disposition must be
reopened before any remote/Streamable HTTP MCP transport is added. A current
online audit still must be attached to release evidence; this notice does not
replace it.

## Excluded research sources

Historical market and behavior research contributes no source code, tests,
fixtures, schemas, assets, dependencies, lockfiles, runtime artifacts, or Git
history to Planipus and is not part of a shipped build.
