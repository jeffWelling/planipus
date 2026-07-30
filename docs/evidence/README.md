# Evidence records

Evidence proves a decision/release on an exact commit and environment. It is not
general documentation.

Expected paths:

- `foundation-gate.md` — pinned foundation build/test/runtime/extension gate;
- `2026-07-20-keeper-audit.md` — historical source/build/type/test/security
  research; excluded from implementation under the clean-room policy;
- `2026-07-20-foundation-audit.md` — superseded historical Fluxure audit retained
  so the decision change remains inspectable;
- `2026-07-21-build-verification.md` — first credential-free implementation,
  real-PostgreSQL/browser/worker evidence, defects found, and open boundary;
- `2026-07-21-planning-browser-verification.md` — Protect and Smart Meeting
  compiled-UI/PostgreSQL/worker walkthrough, defects found/fixed, and the exact
  fake-versus-live evidence boundary;
- `2026-07-21-claude-opus-review.md` — review request, authentication/privacy
  blocker, exact continuation procedure, and (once authorized) independent
  read-only review plus prioritized follow-up;
- `2026-07-21-mcp-api-conflict-response.md` — Server API-token, stdio MCP, and
  no-copy invitation-response implementation handoff, verification ledger,
  audit disposition, privacy inspection, and open live-Google release gate;
- `releases/<version>.md` — tests, migrations, image digest, SBOM, scans,
  benchmarks, provider conformance, backup/restore, known issues;
- `providers/<provider>-<date>.md` — sanitized fixture/live conformance;
- `security/<review>-<date>.md` — threat review/penetration remediation summary;
- `accessibility/<review>-<date>.md` — tools, flows, assistive technology, issues.

Every release/decision record includes a source commit, date/timezone,
environment/tool versions, commands or CI links, result, exceptions, artifact
checksums/paths, reviewer, and requirement/risk IDs. A pre-commit development
record must instead identify the uncommitted snapshot honestly and cannot
certify a release. Never include secrets, credentials, personal calendar data,
private report details, or provider payloads that have not been sanitized.
