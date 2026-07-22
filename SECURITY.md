# Security policy

No public security contact exists yet because the project has not been published.
Until a repository and private reporting channel are established, do not publish
suspected vulnerabilities, exploit details, credentials, or affected calendar
data. The project owner must configure a private security advisory/contact before
the first public release and replace this paragraph.

## Supported versions

There are no supported releases. The current repository is a planning package and
incomplete reference prototype. After beta, maintain a table of supported minor
release lines and end dates; generally only the latest stable and current beta
receive security fixes unless an LTS policy is announced.

## Include in a private report

- affected version/commit and deployment profile;
- vulnerability class and impact;
- minimal reproduction using synthetic data;
- required permissions/provider conditions;
- whether calendar/provider writes occurred;
- logs/screenshots with all secrets and personal data removed;
- suggested mitigation if known;
- disclosure coordination preference.

Never send real OAuth tokens, cookies, master keys, backups, database files, event
descriptions, attendee lists, or model prompts. The maintainer may provide a
secure transfer mechanism for necessary synthetic artifacts.

## Response targets after publication

- acknowledge within 3 business days;
- initial severity/triage within 7 days;
- mitigation timeline based on exploitability/data risk;
- coordinate advisory/CVE and credit if desired;
- publish clear affected versions, upgrade/mitigation, calendar reconciliation,
  credential rotation, and incident guidance.

No target is a warranty. Calendar corruption, cross-tenant disclosure, credential
exposure, authentication bypass, booking double-write, and remote code execution
are emergency priority.

## Security design

See `docs/SECURITY.md`, `docs/RISK-REGISTER.md`, `docs/OPERATIONS.md`, and
`docs/TEST-STRATEGY.md`. Core commitments include non-root restricted containers,
encrypted provider secrets, least privilege, SSRF controls, revision-bound plans,
idempotent provider effects, explicit partial failure, and model-off operation.
