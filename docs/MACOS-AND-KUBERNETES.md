# Planipus editions: native Mac and Kubernetes server

Status: **authoritative platform decision**  
Updated: 2026-07-20

## The correction

Planipus has two autonomous editions. They are members of the same product
family, not a client and server:

1. **Planipus for Mac** is a native application whose OAuth credentials,
   configuration, database, sync engine, and scheduler all live on that Mac.
2. **Planipus Server** is an original clean-room web service whose credentials,
   configuration, database, sync engine, and scheduler live in Kubernetes.

Neither edition knows about, pairs with, authenticates to, controls, backs up,
or takes over for the other. Installing both creates two unrelated Planipus
installations. A policy or Google account connected in one is not present in
the other.

The operational consequence is deliberate and must never be hidden:

> Planipus for Mac cannot synchronize while the application is quit, the Mac is
> asleep or powered off, the network is unavailable, or the Mac has been
> replaced. It catches up after it is running and online again. Planipus Server
> continues only because its own independent Kubernetes workload is running.

“Different branches of the product” means **editions**, not long-lived Git
branches. A monorepo keeps the behavioral contract and test vectors aligned;
the two runtime implementations and their data remain separate.

## Non-negotiable topology

| Property | Planipus for Mac | Planipus Server |
|---|---|---|
| User surface | Native SwiftUI/AppKit app and menu bar | Responsive web UI and API |
| Runtime | In-process on one Mac | Original Server services in Kubernetes |
| Provider connection | Direct from the Mac to Google | Direct from the cluster to Google |
| OAuth application type | Google iOS client registered to the macOS bundle ID and reversed-client-ID callback | Google web application |
| Provider tokens | Non-synchronizing macOS Keychain | Envelope-encrypted server storage |
| Canonical data | Local encrypted SQLite | PostgreSQL |
| Work scheduling | In-process while app runs | Cron/worker processes while pod runs |
| Offline behavior | Paused; catches up later | Depends only on cluster/provider reachability |
| User identity | Local Mac user; no Planipus server account | Server-local account/OIDC/passkey policy |
| Pairing between editions | None | None |
| Shared database/API/session | None | None |
| Backup/restore | Explicit encrypted Mac export/restore | Database/PVC backup and restore |

Forbidden architecture:

- Mac as a thin client for Planipus Server;
- a “server profile” or server URL in the Mac app;
- Planipus device credentials, native-auth exchange, or Mac↔server SSE;
- copying configuration or credentials automatically between editions
  (deliberate, human-driven migration via a credential-free export file is
  planned separately in `MIGRATION.md` and stays within this rule);
- claiming Kubernetes keeps a Mac-created installation running;
- bundling any Server service, PostgreSQL, or Valkey inside the Mac app;
- a LaunchAgent or privileged helper that continues syncing after the user quits;
- implying that closing the main window quits the app when its menu-bar process
  remains active.

## What the editions share

They share product behavior, not runtime code or live state:

- the Calendar Sync contract and requirement identifiers;
- privacy preset names, versions, disclosure manifests, and reason codes;
- language-neutral JSON conformance fixtures;
- provider payload fixtures with secrets and personal data removed;
- user-facing vocabulary and calm visual principles;
- project governance, security policy, license obligations, and release evidence
  shape.

Both implementations must independently pass the same applicable behavioral
cases. Passing in TypeScript does not prove the Swift edition and vice versa.
No shared network API, database format, or binary module is a compatibility
goal.

## Repository layout

Keep one repository and one default development branch. The original clean-room
implementation converges toward:

```text
applications/
  macos/                         # independent native edition
    Planipus.xcodeproj
    Sources/
      PlanipusApp/
      PlanipusCore/
      PlanipusGoogle/
      PlanipusStore/
      PlanipusSecrets/
      PlanipusSync/
      PlanipusDesign/
    Tests/
  web/                           # original Server web surface
packages/                        # original Server packages
services/                        # original API/cron/worker services
deploy/                          # Planipus Server images and Kubernetes assets
conformance/
  calendar-sync/v1/
    schemas/
    cases/
    provider-payloads/
docs/
```

Do not force the original TypeScript server packages into a platform-neutral
library. Do not expose Swift types as the shared specification. The shared
artifact is canonical JSON plus prose and schemas, so each edition has an
independent parser/evaluator and can reveal semantic drift.

## Planipus for Mac

### Product boundary

The application is native SwiftUI, with AppKit only where macOS behavior cannot
be expressed cleanly. It is not Electron, Catalyst, a WebView shell, or a local
web server. The complete primary flow is native:

1. connect two or more Google identities;
2. label each identity clearly and choose calendars;
3. create a directed source→destination policy;
4. select an hours profile and privacy preset;
5. preview exact candidate events and disclosed fields;
6. activate, pause, inspect health, retry, detach, clean up, and disconnect;
7. see honest last-sync and paused/offline/stopped semantics.

The first supported provider combination is Google personal↔Google Workspace.
Outlook and CalDAV are separate post-P0 gates for the Mac edition even when the
server edition already supports them.

### Internal modules

#### `PlanipusApp`

SwiftUI application lifecycle, scenes, navigation, menu-bar surface,
accessibility, onboarding, previews, status, and destructive confirmations.
Closing the main window may leave the menu-bar app running. Choosing **Quit
Planipus** stops all synchronization.

#### `PlanipusCore`

Pure Swift domain types and deterministic policy evaluation. It owns:

- directed policy, hours profile, exception date, privacy preset, and override;
- interval overlap and IANA-timezone/DST evaluation;
- selection, RSVP, all-day, free, duplicate, and loop decisions;
- disclosure manifests and provider-independent desired projections;
- reason codes and conformance fixture decoding.

It performs no network, database, Keychain, clock, or UI work. Inject those
ports so tests use deterministic time and identifiers.

#### `PlanipusGoogle`

Direct installed-app OAuth and Google Calendar API adapter. The packaged app
uses a Google iOS OAuth client registered to its macOS bundle identifier and
reversed-client-ID callback scheme; it does not open a loopback listener:

- system-browser authorization with PKCE and state validation;
- separate refresh credentials for each Google identity;
- calendar discovery and stable identity labeling;
- full and incremental event listing;
- provider create/update/delete and private extended properties;
- retry, quota, invalid-grant, sync-token expiry, and partial-failure mapping.

No client secret is treated as secret in a distributed native binary. Use only
the minimum Calendar scopes that support the selected behavior. Never use
browser scraping or macOS EventKit as the Google provider integration.

#### `PlanipusStore`

Local persistence now uses the exactly pinned SQLCipher-managed GRDB and
SQLCipher.swift packages. The random 32-byte database key lives in a
non-synchronizing, device-bound Keychain item and is configured before schema
access; it is never derived from an application constant. Existing files with a
missing/wrong key fail without replacement.

Five migrations and transactions currently cover non-secret account/bridge
configuration, installation identity, observations, projections, provider
cursors, staged batches, durable outbox work, and terminal ownership quarantine.
OAuth tokens are never database columns. Dedicated calendar discovery,
normalized exception, audit, and health storage remain target model work.

The encrypted-store integration gate has passed, but lifecycle acceptance has
not: key rotation/interrupted rekey, export/import, replacement-Mac recovery,
coordinated reset, performance, packaging, signing/notarization and backup proof
remain release blockers. Plain SQLite is never an implicit fallback.

#### `PlanipusSecrets`

Small secrets in Keychain Services:

- one refresh-token record per provider identity;
- the local database encryption key;
- metadata sufficient to locate and rotate, but never log, a credential.

Items use the data-protection Keychain and application access group only, set
`kSecAttrSynchronizable=false`, and use
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` so an awake logged-in Mac may
continue while its screen is locked. Logout/disconnect and uninstall documentation must state
what remains in Keychain and how to remove it.

#### `PlanipusSync`

An actor-isolated in-process coordinator. It owns account work serialization,
poll scheduling, incremental cursors, durable outbox/retry, reconciliation,
health, cancellation, and wake/reconnect catch-up. Provider effects are
idempotent by managed identity and desired projection fingerprint, not by an
assumption that a request ran only once.

There is no daemon, LaunchAgent, privileged helper, embedded server, inbound
listener, or promise of execution after application termination.

### OAuth flow

For each Google identity:

1. generate high-entropy state, PKCE verifier, and challenge in memory;
2. open Google's authorization endpoint in the system browser using the native
   authentication session;
3. accept only the exact registered reversed-client-ID redirect and matching state;
4. exchange the authorization code directly with Google using PKCE;
5. persist the refresh token in the non-synchronizing Keychain item;
6. hold short-lived access tokens in memory where practical;
7. discover calendars and ask the user to label personal/work identities;
8. never transmit the credential to Planipus Server or a Planipus-operated
   service.

Authorization is per local installation. Replacing the Mac requires reconnecting
accounts unless the user restores an explicit encrypted Planipus backup that is
documented to include portable credential material. A default backup should not
export provider refresh tokens; this makes reconnection explicit and safer.

### Local data model

Minimum entities mirror the behavior contract without claiming server schema
compatibility:

- `provider_account`: stable local UUID, provider subject/email display data,
  status, token Keychain reference, last authorization error;
- `calendar`: provider calendar ID, account UUID, role/capabilities/timezone;
- `hours_profile` and `hours_exception`;
- `sync_policy`: source/destination, selection, privacy preset version, lifecycle
  and revision;
- `event_observation`: normalized source facts and provider revision;
- `projection`: source occurrence→destination event identity, policy revision,
  desired/applied fingerprints, ownership/detach state;
- `provider_cursor`: page/sync token and last successful full/incremental scan;
- `outbox_effect`: durable desired provider action, attempts, next attempt,
  terminal classification;
- `audit_event`: privacy-safe local explanation and disclosure manifest;
- `installation_state`: local schema/conformance version and first-run state.

All tables are scoped to the local installation. No server ID, server profile,
device session, or remote principal appears in this model.

### Synchronization lifecycle

#### While running and online

- Perform an initial full sync for a newly connected calendar.
- Store the returned Google sync token only after the page sequence commits.
- Poll incrementally on a configurable cadence; initial default target is 60
  seconds with jitter and provider-quota backoff.
- Re-evaluate affected policies, persist desired effects, then drain the outbox.
- Run a slower safety reconciliation to detect missing or manually changed
  managed copies.
- **Sync Now** requests immediate work but still respects provider throttling.

Google push notifications require a stable public HTTPS receiver and therefore
are not the Mac default. Do not open a local webhook or depend on a tunnel.

#### Sleep

macOS suspends execution. Planipus performs no synchronization. On wake:

1. wait for clock/network stabilization;
2. cancel stale in-flight assumptions;
3. refresh authorization if needed;
4. run incremental catch-up from each committed cursor;
5. perform reconciliation when the elapsed gap or token state requires it;
6. update **Last successful sync** only after provider effects converge.

#### Offline

The app displays **Offline — changes will sync when connected** and the actual
last-success timestamp. It persists pending desired work, applies bounded
exponential backoff with jitter, and retries on network restoration. It never
shows “up to date” based only on a local evaluation.

#### Quit or crash

All processing stops. Durable transactions ensure an effect is either absent
or represented in the outbox; startup safely retries ambiguous work using
managed identity/fingerprints. A crash between a provider write and local commit
must not create a second copy on restart.

#### Relaunch

Open and migrate the encrypted store, validate Keychain references, mark any
abandoned work recoverable, then perform incremental catch-up. Google can expire
an incremental sync token; on HTTP 410, clear only the affected cached
observations/cursor, perform a full sync, and reconcile without blindly deleting
destination copies.

#### Mac replacement or local-state loss

There is no invisible continuation. The user sees that this is a new
installation, reconnects accounts, and imports a compatible encrypted backup if
available. Before creating copies, recovery scans destination provenance and
offers to adopt safely identifiable managed copies. Ambiguous copies require a
preview; the app never assumes an event is safe to delete. Replacement and
restore tests must prove no duplicate storm.

### Honest status language

The Mac UI distinguishes:

- **Up to date** — last poll and effects succeeded while this app was running;
- **Syncing** — work is active;
- **Delayed** — retryable provider/quota problem;
- **Offline** — network unavailable;
- **Action needed** — revoked OAuth, ambiguous recovery, or terminal error;
- **Paused** — policy intentionally disabled;
- **Stopped** — explanatory state shown in help/onboarding for app quit/sleep;
  the application cannot render live status while terminated.

Every status includes a concrete last-success timestamp. Documentation and
onboarding explicitly say that quitting, sleeping, powering off, or losing the
Mac stops synchronization.

### Sandbox and distribution

- Enable App Sandbox from the first target.
- Request outgoing network access and only the narrow entitlements proven
  necessary. The app needs no incoming network, Calendar/EventKit, Contacts,
  broad user-file, automation, or location entitlement for P0.
- Store the database inside the application container. User-selected encrypted
  import/export uses the standard open/save panel grant.
- Developer ID sign, use the hardened runtime, notarize, and staple public
  artifacts. Publish a DMG, checksum, source tag, SBOM/license manifest, and
  clean-VM install/upgrade/uninstall evidence.
- A Mac App Store release is optional and gated separately. The architecture
  must remain sandbox-compatible without allowing store policy to weaken
  direct-distribution security or features.

Initial deployment target is macOS 14, to be confirmed by a dependency and
hardware support spike. Test the current macOS release and previous two major
releases on Apple Silicon; document Intel support explicitly rather than imply
it.

## Planipus Server

Planipus Server is the original clean-room web service selected in
`ADOPT-OR-BUILD.md`. It has its own provider adapters, policy engine,
database, workers, UI, authentication, encryption, backup, and operational
contracts. The native app is not its control plane.

### Solo Kubernetes profile

One StatefulSet replica and one RWO PVC may run multiple containers in one pod:

| Container | Responsibility | Persistent path |
|---|---|---|
| `api` | web UI/API and server authentication | none |
| `scheduler` | provider polling, safety refresh and reconciliation triggers | none |
| `worker` | provider effects and durable jobs | none |
| `postgres` | canonical server data | `/var/lib/postgresql/data` |

This is operational co-location, not one application process. Readiness must
reflect migrations, database, job, and worker health. Only API/web HTTP is
exposed. PostgreSQL stays pod-local. All containers run non-root with
resource requests/limits, seccomp, dropped capabilities, and read-only root
filesystems where supported.

The standard profile uses external PostgreSQL. Feature behavior is
identical. Additional replicas are unsupported until leader election, job
ownership, provider quota, and duplicate-effect tests pass.

### Server OAuth and security

Server Google OAuth uses its own web-application client and stable HTTPS
callbacks. Provider tokens are envelope-encrypted with versioned key IDs; unit
tests cover authenticated encryption and in-memory rewrapping under a new key.
An operational rotation procedure and backup/restore proof remain release
gates. This OAuth client, redirect, token set, database, and principal model are
unrelated to those on a Mac installation.

Server backup/restore, ingress/TLS, OIDC, passkeys, API/webhooks, monitoring,
upgrade, and disaster recovery are specified in the existing operations,
security, API, and foundation-gate documents.

## Shared conformance suite

Create `conformance/calendar-sync/v1` before implementing divergent policy
logic. Each case is language-neutral canonical JSON:

```json
{
  "case": "work-hours-private-busy-dst-overlap",
  "now": "2026-11-01T08:30:00Z",
  "policy": {},
  "source": {},
  "existingProjection": null,
  "expectedDecision": "copy",
  "expectedReasonCodes": ["hours.overlap", "selection.included"],
  "expectedDisclosure": ["time.start", "time.end", "availability.busy"],
  "expectedProviderShape": {}
}
```

The fixture corpus covers:

- DST gaps/folds, cross-midnight hours, exceptions, and timezone changes;
- recurring masters/exceptions, moved instances, cancellations, and split
  series;
- Busy, generic, selected, and full privacy modes with owner/third-viewer
  expectations;
- all-day/free/OOO/focus, RSVP, `#nosync`, already-invited, and duplicate rules;
- loops across three calendars and managed-copy exclusion;
- destination edits, detach, reconnect, cursor loss, and cleanup;
- crash ambiguity and idempotent provider replay.

The Swift and TypeScript suites each consume the same input and assert their own
provider serializer. A fixture change that alters disclosure is a security-
reviewed behavior change and increments the preset/schema version.

## Delivery plan

### E0 — freeze the edition contract

- Remove all Mac↔server pairing/API assumptions.
- Check in conformance schema, reason-code registry, and first Google fixtures.
- Mark every requirement as common, Mac-only, or Server-only.
- Record separate threat models, release artifacts, and support statements.

Exit: a reviewer can explain both editions without drawing a connecting arrow.

### M0 — native foundation spike

- Create the sandboxed Swift workspace and module boundaries.
- Prove installed-app Google OAuth with two test identities and PKCE.
- Gate GRDB/SQLCipher packaging, database-key Keychain storage, migrations, and
  encrypted export/restore.
- Prove incremental sync, HTTP 410 recovery, polling, and wake/relaunch catch-up.
- Measure idle CPU, memory, energy, and provider quota use.

Exit: no UI polish; a signed development build safely catches up without
duplicate effects after offline, sleep, crash, and relaunch scenarios.

### M1 — Mac Google policy flow

- Implement Core policy evaluator against conformance fixtures.
- Build native onboarding, identity/calendar chooser, hours/privacy editor,
  preview/apply, health, pause, cleanup, and disconnect.
- Add MenuBarExtra status and privacy-safe optional notifications.
- Run live two-account and ordinary third-viewer disclosure tests.

Exit: the defining Google scenario works while the app runs and visibly pauses
when the machine/app cannot run.

### M2 — Mac recovery and release

- Complete crash/idempotency, backup/restore, replacement/adoption, token revoke,
  uninstall, accessibility, localization foundation, and energy tests.
- Sign, harden, notarize, staple, package, and test clean install/upgrade.
- Dogfood for 30 days including repeated sleep/offline/quit gaps.

Exit: a public Mac artifact meets the independent Mac acceptance matrix.

### S0–S2 — Server foundation and release

Execute the clean-room Server foundation, Google policy semantics, and Kubernetes
release milestones in `FOUNDATION-GATE.md` and `ROADMAP.md`. Server work can run
in parallel after E0 because it has no dependency on the Mac runtime.

Exit: Planipus Server independently passes its web/Kubernetes acceptance matrix.

## Acceptance matrix

### Mac edition must prove

1. Two Google identities are authorized directly on the Mac.
2. A qualifying personal event creates the privacy-correct work copy while the
   app runs; changes and deletion converge.
3. A non-qualifying event produces no copy.
4. Quit means no sync. A source change made during quit remains unapplied until
   relaunch, then converges to one attached destination copy. HTTP requests may
   repeat while ambiguous results are verified.
5. Sleep and offline periods likewise produce no sync, show an honest stale
   timestamp after return, and catch up to one converged destination copy.
6. Crash between remote effect and local commit does not duplicate.
7. Revoked OAuth affects only that local account; secrets do not appear in logs,
   diagnostics, database rows, exports, or notifications.
8. New-Mac/recovery flow adopts or previews existing copies without a duplicate
   or deletion storm.
9. A network trace contains Google endpoints but no Planipus Server traffic.
10. The application contains no server URL/pairing UI, Server runtime, PostgreSQL, Valkey,
    daemon, LaunchAgent, or inbound listener.

### Server edition must prove

1. The same Google behavior passes through its own web UI and server workers.
2. The Kubernetes workload continues with all browsers and Macs closed because
   it is an independent installation.
3. Backup/restore/upgrade preserves mapping identity without duplicate writes.
4. Provider tokens are envelope-encrypted and never enter a Mac edition.
5. The solo and standard profiles have the same product features.

### Independence must prove

1. Install both editions and connect different test accounts; neither discovers
   or modifies the other.
2. Delete/revoke one installation; the other is unchanged.
3. Version skew creates no compatibility concern because there is no protocol
   between them.
4. Shared conformance fixtures pass independently in Swift and TypeScript.

## Decision summary

Planipus is one open-source product family with two self-contained editions.
The Mac edition earns simplicity and privacy from local ownership, accepting
that it only works when the app and Mac can run. The Server edition earns
continuity from an independently operated Kubernetes service. We share exact
behavioral evidence between them and deliberately share no live authority.

## Primary references

- Google: [OAuth 2.0 for native apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- Google Calendar: [Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync)
- Apple: [Keychain Services](https://developer.apple.com/documentation/security/keychain-services/)
- Apple: [App Sandbox](https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox)
- Apple: [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- GRDB: [GRDB.swift](https://github.com/groue/GRDB.swift)
- SQLCipher: [SQLCipher](https://github.com/sqlcipher/sqlcipher)
- Kubernetes: [StatefulSet API and storage identity](https://kubernetes.io/docs/reference/kubernetes-api/apps/stateful-set-v1/)
