# Calendar Sync conformance contract v1

This directory is the language-neutral behavior contract shared by the
autonomous Planipus for Mac and Planipus Server editions. It contains original
Planipus fixtures derived from the Planipus product specification. No excluded
donor source, tests, fixtures, schemas, or snapshots may be used here.

## Rules

- JSON is UTF-8 and strings are interpreted in Unicode NFC form.
- Schemas use JSON Schema draft 2020-12 and reject unknown fields where a
  closed object is declared.
- Instants are RFC 3339 UTC strings; dates, local times, and IANA timezones are
  separate values.
- Fixture bundles contain a complete `defaults.input`. Per-case `input_patch`
  uses RFC 7396 JSON Merge Patch. Arrays replace rather than merge.
- Each case has a globally unique stable ID and an entry in `manifest.json`.
- Runners fail for missing, duplicate, unlisted, or unexpected case IDs.
- Reason codes and privacy presets must exist in their versioned registries.
- Desired-copy fingerprints are `sha256:` plus lowercase SHA-256 over the
  RFC-8785-style canonical JSON emitted by `@planipus/calendar-sync`.
- A disclosure-changing fixture requires privacy/security review and a preset
  or contract version change.

`expected` is an explicit conformance assertion. Selection, operation, and
primary reason are always exact. Optional `reason_codes_include`,
`warnings_include`, desired-copy assertions, interval assertions, and forbidden
sentinels add exact checks relevant to the case without coupling the two
editions to persistence or provider-specific identifiers.

Provider payload fixtures are separate from provider-neutral policy cases. A
Google adapter must compile a `DesiredCopy` to Google fields and request
controls without changing the policy decision.
