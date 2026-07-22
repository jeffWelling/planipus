# Risk register

Scale: likelihood (L) and impact (I) 1–5; exposure = L×I. Owner is a role until a
maintainer is assigned. Review at every milestone and after incidents/provider
changes. Closed risks remain in history with evidence.

| ID | Risk | L | I | Exposure | Owner | Mitigation / trigger |
|---|---|---:|---:|---:|---|---|
| R-001 | Clean-room boundary is breached by copied/uncertain-provenance donor material | 3 | 5 | 15 | architect/release | Binding policy, contributor attestations, excluded-donor search, SBOM/license scan, manual review and remove/rebuild incident process |
| R-002 | Chosen component stack has license, maintenance or security gaps | 3 | 4 | 12 | maintainer | Exact-version reuse ledger, compatibility review, CVE monitoring, removal plan, reproducible builds and bounded component spikes |
| R-003 | Provider, route, sync worker, and commercial-mode coupling become permanent architecture | 4 | 4 | 16 | architect | Policy/effect ports before feature work; remove billing gates; dependency-boundary checks |
| R-004 | Product/dependency license or attribution obligations are mishandled | 2 | 5 | 10 | release | License decision/legal review, SPDX/SBOM scan, notices/source-offer checklist and release gate |
| R-005 | Name conflicts/trademark or weak brand causes rework | 3 | 3 | 9 | product | Naming brief, exact product/repo/domain screen, legal review before public release |
| R-006 | Provider docs advertise capabilities source/tests do not support | 4 | 4 | 16 | integrations | Fixture/live conformance; narrow support matrix; docs generated from evidence |
| R-007 | Recurrence/timezone bug corrupts calendars | 3 | 5 | 15 | calendar | Canonical model, DST/RRULE properties, fixture corpus, preview, backup, canary |
| R-008 | Dropped/out-of-order webhooks leave stale availability | 4 | 4 | 16 | calendar | Idempotent inbox, cursor sync, safety polls, lag UI, stale booking guard |
| R-009 | Provider retry creates duplicate/destructive events | 3 | 5 | 15 | calendar | Idempotency marker, ETag precondition, outbox, reconciliation, partial state |
| R-010 | Original OAuth-token storage leaks through DB/log/export | 4 | 5 | 20 | security | Block deployment; versioned envelope encryption/Keychain design, rotation, redaction tests, least scopes, export exclusions |
| R-011 | User-configured endpoints enable SSRF | 4 | 5 | 20 | security | HTTPS/IP/DNS/redirect policy, private-host allowlist, egress NetworkPolicy, tests |
| R-012 | Public booking abused for spam/enumeration/DoS | 4 | 4 | 16 | booking | Layered rate limits, optional self-host captcha, safe errors, hold quotas, monitoring |
| R-013 | Concurrent holds/bookings double-book | 3 | 5 | 15 | booking | Transactional unique intervals/locks, signed offers, revalidation, race tests |
| R-014 | Preview differs from apply after concurrent changes | 4 | 5 | 20 | planning | Monotonic revision, preconditions, immutable plans, conflict/rebase, outbox |
| R-015 | Partial provider apply is presented as success | 3 | 5 | 15 | planning | Per-operation execution, partial UI, retry/compensation, audit and alerts |
| R-016 | Solver misses deadlines or produces unstable/untrusted plans | 4 | 4 | 16 | solver | Hard constraints, movement budget, explanations, golden corpus, no-op property |
| R-017 | Solver search exhausts CPU/memory on team cases | 3 | 4 | 12 | solver | Input/candidate/time/memory bounds, cancellation, partitioning, explicit timeout |
| R-018 | AI prompt injection causes action or privacy leak | 4 | 5 | 20 | assistant/security | Optional models, redaction, typed commands, capabilities, preview/approval, tests |
| R-019 | Model/provider becomes required despite self-host promise | 3 | 4 | 12 | product | Deterministic complete baseline, model-off CI/e2e, local adapter, no AI in solver |
| R-020 | Fate-shared PostgreSQL sidecar loses/corrupts state or invites unsafe scaling | 3 | 5 | 15 | storage | One StatefulSet replica/RWO PVC, loopback only, DB-aware backups, restore drills, scale gate |
| R-021 | Upgrade migration is irreversible without working backup | 3 | 5 | 15 | storage/release | Expand/contract, backup-before-upgrade, path tests, restore drills, schema guard |
| R-022 | Lost encryption key makes provider data unusable | 3 | 4 | 12 | operator/security | Key setup warning, backup/escrow docs, rotation/versioning, reconnect recovery |
| R-023 | Team analytics becomes employee surveillance | 3 | 5 | 15 | product/privacy | Aggregate facts, minimum cohorts, no rankings/content, clear policy and opt-outs |
| R-024 | Delegation/RBAC allows cross-tenant access | 3 | 5 | 15 | identity/security | Org-scoped repositories, deny-by-default policy, tenant property tests, audit |
| R-025 | Integration field ownership silently overwrites user work | 4 | 4 | 16 | integrations | Per-field mapping, ETag/version, visible conflicts, unlink instead of delete |
| R-026 | Notification/workflow sends external message without consent | 3 | 4 | 12 | workflows | Typed allowed actions, preview/approval policy, idempotency, audit, quiet hours |
| R-027 | Supply-chain dependency/image compromise | 3 | 5 | 15 | release/security | Locked deps, minimal image, SBOM, provenance/signatures, scans, update policy |
| R-028 | One maintainer/bus factor stalls large scope | 5 | 4 | 20 | governance | Adopt foundation, modular milestones, contributor docs, triage, avoid breadth-first |
| R-029 | “Feature complete” scope prevents a reliable first release | 5 | 4 | 20 | product | Milestone exit gates, P0/P1 requirements, accurate beta labels, user evidence |
| R-030 | Google/Microsoft app verification limits public adoption | 4 | 3 | 12 | integrations/docs | BYO OAuth docs, testing/publishing modes, CalDAV options, verification guidance |
| R-031 | Upstream provider API deprecation breaks support | 4 | 4 | 16 | integrations | Official change monitoring, contract/live suites, compatibility policy, health UI |
| R-032 | Backup contains encrypted secrets but destination is exposed | 3 | 5 | 15 | operations/security | Destination encryption, least access, no master key in backup, restore audit |
| R-033 | Logs/metrics have unbounded cardinality or personal content | 3 | 4 | 12 | observability/privacy | Structured allowlist, bounded labels, redaction tests, debug expiry |
| R-034 | Rebrand erases upstream attribution/community trust | 2 | 4 | 8 | governance | Prominent upstream history/UPSTREAM doc, truthful release notes, upstream patches |
| R-035 | Removing plan gates exposes unfinished smart meetings as production | 4 | 4 | 16 | product/meetings | Separate community entitlement from technical readiness; keep disabled until invitation/provider lifecycle tests pass |
| R-036 | Original Server scope expands into an unbounded rebuild | 4 | 5 | 20 | governance/release | Reuse ledger, narrow P0 Google scope, foundation gates, contract-first fixtures, strict no-feature-addition rule and component spike evidence |
| R-037 | Durable-job loss or a failed PostgreSQL lease silently drops required reconciliation work | 3 | 5 | 15 | jobs/storage | PostgreSQL intent/outbox and scheduled jobs; lease expiry/replay tests; visible degraded/dead-letter state |
| R-038 | Independent Swift and TypeScript engines drift in privacy/mutation behavior | 4 | 5 | 20 | product/privacy | Canonical JSON cases, shared reason/preset/disclosure versions, both runners required, third-viewer tests, security review for fixture disclosure changes |
| R-039 | Mac OAuth callback, Keychain item, or local database key is stolen | 3 | 5 | 15 | mac/security | System-browser installed-app flow, state/PKCE, exact redirect, non-sync Keychain, short access-token lifetime, SQLCipher, redaction/revoke/forensics tests |
| R-040 | Users assume Mac sync continues while Quit/asleep/offline and availability becomes stale | 5 | 5 | 25 | mac/product | Explicit onboarding/help/release copy, real last-success time, menu-bar/Quit semantics, sleep/offline tests, catch-up health and optional stale warning |
| R-041 | macOS signing/notarization/sandbox or SQLCipher packaging delays release | 3 | 4 | 12 | mac/release | Sandbox and encryption spike first, minimal entitlements, signed/notarized development artifacts at M0, clean-VM release gate |
| R-042 | Lost/replaced Mac state cannot identify old managed copies and duplicates/deletes them | 4 | 5 | 20 | mac/recovery | Encrypted explicit backup, reconnect + provenance scan, adopt only unambiguous copies, preview ambiguity, no-blind-cleanup replacement tests |
| R-043 | Both independent editions are configured for the same route and compete | 3 | 5 | 15 | architecture/docs | Warn that installations do not coordinate; installation-specific provenance; setup/recovery diagnostics; never market dual install as failover |
| R-044 | Google polling on Mac consumes quota/energy or leaves long stale windows | 4 | 4 | 16 | mac/integrations | Incremental tokens, jitter/backoff, configurable measured cadence, safety reconcile, energy/quota budgets, honest delayed timestamp |

## Highest-exposure actions before implementation

1. Resolve R-001 with the clean-room provenance gate.
2. Select compatible components/license and encrypt OAuth credentials
   (R-002/R-004/R-010/R-027/R-036).
3. Complete policy boundary and community/technical capability separation
   (R-003/R-006/R-035).
4. Establish observation/policy/projection/outbox transaction contract
   (R-009/R-014/R-015).
5. Establish SSRF and secret boundaries before exposing connection forms
   (R-010/R-011).
6. Prove solo PostgreSQL backup/job replay/restore (R-020/R-021/R-037).
7. Freeze P0/P1 release scope and issue taxonomy (R-028/R-029).
8. Freeze language-neutral conformance, preset, disclosure and reason-code
   versions before implementing both engines (R-038).
9. Prove Mac installed OAuth, encrypted local store, sleep/offline/Quit catch-up,
   and replacement adoption before native UI breadth (R-039–R-044).

## Risk acceptance template

```text
Risk ID:
Decision date:
Accepted by:
Scope and duration:
Evidence:
Why mitigation is not currently proportionate:
Compensating controls:
User/operator disclosure:
Trigger/expiry requiring review:
Linked issue/milestone:
```

Security, license, tenant isolation, calendar data integrity, booking uniqueness,
and backup/restore risks cannot be accepted merely to meet a date.

## Review triggers

- new provider or expanded OAuth scope;
- schema/storage/queue/solver replacement;
- public booking/assistant/external workflow launch;
- multi-replica or cross-organization feature;
- upstream merge, critical dependency update, license change;
- security report, data incident, restore failure, provider destructive-sync bug;
- milestone exit or stable release.
