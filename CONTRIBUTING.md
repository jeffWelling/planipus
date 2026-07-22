# Contributing

The project is moving through its clean-room foundation gates. Build product
behavior only from the Planipus contract, primary platform/provider
documentation, and dependencies approved in the reuse ledger. Do not build new
product behavior on the archived Go spike.

## Before opening work

1. Read `docs/HANDOFF.md`, `docs/DECISIONS.md`, `docs/REQUIREMENTS.md`, and the
   relevant design document.
2. Confirm the issue names requirement IDs, risk IDs, and milestone.
3. For provider/security/schema/public API/solver changes, propose an ADR first.
4. Discuss large work before implementation; small docs/tests/fixes can proceed.

## Change expectations

- Follow `docs/CLEAN-ROOM-POLICY.md`: no Keeper/AGPL donor code, tests, fixtures,
  assets, schema, dependency graph, runtime, or copied expression. Record every
  permitted dependency or adapted compatible component in `REUSE-MAP.md`.
- No proprietary feature gate, required telemetry, phone-home activation, or
  model requirement.
- Domain behavior is deterministic/testable; provider/model/network calls stay in
  adapters.
- Every mutation follows command, authorization, revision/preview where relevant,
  audit, and idempotent effect paths.
- Add tests proportionate to calendar/data/privacy risk and update docs.
- Never commit production data, calendars, email addresses, tokens, OAuth secrets,
  provider payloads, model prompts, backups, or generated keys.
- New dependencies require the acceptance record in `docs/REUSE-MAP.md`: exact
  version/source, license, maintenance, vulnerability, data/egress access, tests,
  update/removal, notices, binary-size, and operational review.

## Commit/PR shape

Prefer small behavior-neutral refactors followed by features. Explain:

- outcome and user/operator effect;
- requirement/risk/ADR references;
- data/schema/API/provider/security/accessibility impact;
- verification commands/evidence;
- upgrade/rollback and known limitations;
- provenance attestation and dependency/license changes.

Do not mix licensing/provenance work, schema rewrite, and product feature in one
change. Generated files identify their generator and are reproducible.

Every implementation contribution must include these attestations in its pull
request description:

> I certify that I authored this contribution or have the right to submit it
> under Apache-2.0, and I agree to the Developer Certificate of Origin 1.1.

> I did not copy or adapt excluded-donor material. Every third-party component
> or adapted compatible source introduced by this change is recorded in
> `docs/REUSE-MAP.md` with its exact version, license, source, and review.

Commits must use `Signed-off-by:` to record agreement with the
[Developer Certificate of Origin 1.1](https://developercertificate.org/).

## Local verification

The active commands will be finalized after the foundation gate. At minimum the
project must run formatting, lint with warnings denied, full tests, docs/link/schema
checks, secret/license scan, and the relevant integration/browser/container
suite. Do not state verification passed before executing on the same commit.

## Provider fixtures

Use disposable accounts and sanitized recordings following
`docs/INTEGRATIONS.md`. Replace tokens, IDs, names, emails, descriptions, URLs,
calendar contents, and hidden metadata. Review the final diff manually; automated
redaction is not proof of privacy.

## Security reports

Do not open public issues for suspected vulnerabilities or calendar data
corruption with exploit details. Follow `SECURITY.md`.

## Conduct

Be direct, kind, and evidence-driven. Calendar software touches private life and
work; dismissing privacy/accessibility/data-loss reports is unacceptable. Harassment,
discrimination, doxxing, and publication of private data are not tolerated.
