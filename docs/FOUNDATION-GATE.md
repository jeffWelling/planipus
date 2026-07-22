# Clean-room implementation foundation gate

No production code, provider credential, image, or public release proceeds past
the relevant gate without recorded evidence. A passing demo does not waive
provenance, privacy, duplicate-safety, or recovery controls.

`[x]` means every clause in that checklist item has current evidence. An
unchecked compound item may have substantial implementation behind it but stays
open until all of its clauses meet the stated acceptance boundary. `STATE.md`
is the authority for implemented-versus-unimplemented detail.

## A — clean-room provenance

- [ ] `CLEAN-ROOM-POLICY.md` is acknowledged by every contributor.
- [ ] Keeper and other excluded donor material is absent from application code,
      tests, fixtures, assets, schemas, migrations, lockfiles, images and CI.
- [ ] Historical research files are labeled reference-only and excluded from
      implementation prompts/work queues.
- [ ] Every implementation PR has provenance attestation and dependency ledger
      update where applicable.
- [ ] Automated license/SBOM scan plus manual high-risk-module review passes.
- [ ] Project license, notices, source-offer and contribution/DCO policy have
      legal-review evidence before distribution.

Pass: a new contributor can implement from Planipus requirements, official docs,
and approved dependencies without reading excluded source.

## B — shared behavior contract

- [x] `conformance/calendar-sync/v1` has schemas, reason codes, versioned
      privacy presets, disclosure manifests, and at least 50 named cases.
- [ ] Fixtures cover DST, recurrence/exceptions, all-day/free/RSVP, `#nosync`,
      privacy, duplicate/loop, detach, cleanup, cursor loss and effect replay.
- [x] Swift and TypeScript runners consume the exact canonical JSON and pass
      independently.
- [ ] A disclosure-changing fixture requires security review and version bump.
- [ ] No fixture derives from excluded donor tests or snapshots.

Pass: a policy decision is reproducible and explainable without a provider or
shared runtime.

## C — Server clean-room spike

- [x] Select/pin TypeScript runtime, HTTP/schema stack, database/migration layer,
      auth approach, PostgreSQL job approach and React primitives through the reuse
      ledger—not by copying another product's package graph.
- [x] Start one original service against disposable PostgreSQL with migrations,
      structured redacted logs, health and config validation.
- [x] Implement original account/calendar/policy/observation/projection/cursor/
      outbox/audit schema with documented invariants.
- [x] Use PostgreSQL transactionally for cursor observations and desired effects;
      queues cannot be the only durable truth.
- [ ] Implement direct Google web OAuth, encrypted token envelopes, key rotation,
      revocation and secret-redaction tests before any live credential.
- [ ] Implement fake-provider failure injection: page replay, cursor loss,
      ambiguous effect, retry, duplicate event and provider throttle.

Pass: an original Server process can run a fake Google policy safely without
Keeper code, schema, container, dependency lockfile, or runtime.

## D — Server P0 Google behavior

- [ ] Original policy-first domain supports hours/DST, selection, privacy,
      provenance, loop/duplicate prevention, preview/activation, pause, detach,
      cleanup and audit.
- [ ] Google payload fields/visibility/transparency/reminders are checked against
      disclosure manifests and ordinary-viewer expectations.
- [ ] Full/incremental cursors, invalid-token recovery, durable effects and
      post-timeout read-before-retry converge without duplicate writes.
- [ ] Disposable personal-source, employer-destination and ordinary-viewer live
      accounts pass create/update/move/recurrence/delete/revoke/reconnect tests.

Pass: CAL-009–CAL-015 Server behavior has live evidence and no source event is
mutated by a destination reconciliation.

## E — Server Kubernetes operation

- [ ] Build original non-root multi-architecture image from reviewed components.
- [ ] Solo profile runs one StatefulSet replica with API/scheduler/worker and
      PostgreSQL containers on one RWO PVC; only API/web HTTP is exposed.
- [ ] Standard external PostgreSQL profile has identical product behavior.
- [ ] Probes, resource budgets, graceful drain, metrics, redacted logs, network
      policy, backup, restore, upgrade and rollback are documented and tested.
- [ ] Restore/reconcile with queued/in-flight work produces no duplicate writes.
- [ ] SBOM, signatures, provenance, checksums and third-party notices accompany
      the release image/chart.

Pass: clean install→Google policy→backup→restore→reconcile repeats from
documented commands with no excluded donor artifact.

## F — autonomous Mac foundation

- [ ] Sandboxed Swift workspace has App/Core/Google/Store/Secrets/Sync modules.
- [ ] GRDB/SQLCipher build, migration, encryption, key lifecycle, backup,
      notarization, performance and license gates pass.
- [x] Direct installed-app Google OAuth uses system browser, exact redirect,
      state/PKCE and non-synchronizing Keychain credentials.
- [x] Local observations/cursors/projections/outbox are encrypted and durable;
      provider tokens and the database key are separate Keychain items.
- [ ] Release inspection proves tokens/database key never appear in rows, logs,
      exports or diagnostics.
- [x] Swift policy evaluator passes shared conformance fixtures.
- [ ] Incremental poll, HTTP 410 reset, effect replay and safety reconciliation
      pass against fake and disposable accounts.
- [ ] Quit/sleep/offline send no requests; wake/relaunch/reconnect catches up
      exactly once and shows actual last-success state.
- [ ] Lost/replaced-Mac recovery adopts only unambiguous copies and previews
      ambiguity without duplicate/delete storms.
- [ ] Runtime inspection proves no Server connection, daemon, helper, inbound
      listener, Bun, PostgreSQL or Valkey component.

Pass: a signed development build safely completes the P0 scenario locally while
running, and explicitly does not do so while it cannot run.

## Final gate

Server and Mac are released independently after their own gates pass. A
product-family release additionally requires both conformance reports, separate
third-viewer evidence, independence installation/revoke/delete proof, complete
SBOM/license/provenance evidence, and a 30-day dogfood period. Neither edition
substitutes for the other.
