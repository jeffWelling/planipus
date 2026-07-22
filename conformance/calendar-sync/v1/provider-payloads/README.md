# Provider payload evidence

This directory is reserved for small, sanitized provider-boundary examples that
prove Planipus serialization and normalization without becoming a second
behavior contract. The canonical provider-neutral contract remains under
`../cases`, `../schemas`, and `../registries`.

Payload records must be Planipus-authored or captured from disposable test
accounts with all identifiers and content replaced. Never include OAuth codes,
tokens, cookies, client secrets, real email addresses, calendar IDs, event IDs,
URLs carrying credentials, or personal calendar content. Do not copy examples,
fixtures, schemas, or expression from Keeper or another excluded donor.

When live Google evidence is authorized, store paired records using names such
as `google-create-busy-only-v1.request.json` and
`google-create-busy-only-v1.response.json`. Each pair must include a sibling
Markdown record stating the source date, API version, sanitization performed,
requirement IDs, expected disclosure fields, and the exact test that consumes
it. Raw captures stay outside Git until sanitized and reviewed.

No provider payload snapshot is accepted yet. Current automated tests construct
synthetic Google responses in code and validate provider-neutral fixtures; live
two-account and third-viewer evidence remains a release gate.
