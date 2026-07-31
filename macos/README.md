# Planipus for Mac

This directory is the autonomous native macOS edition of Planipus. It shares
product semantics and conformance fixtures with the Kubernetes edition, but it
does not call, embed, discover, or fall back to a Planipus Server. Sync stops
when this Mac sleeps, loses network access, quits, or is replaced.

## Current vertical slice

- Swift 6 / macOS 14 SwiftUI app with a `MenuBarExtra`, onboarding, bridge
  overview, privacy preview, and explicit local-runtime language.
- Pure policy evaluator for hours, privacy, RSVP, all-day/free selection,
  `#nosync`, duplicate invitation, loop, and deletion decisions.
- Native implementation of the complete language-neutral
  `calendar-sync/v1` contract, including weekly hours and exceptions, explicit
  DST fold/gap policy, selection, privacy/disclosure manifests, validation, and
  reconciliation operations. The Swift conformance runner loads the canonical
  manifest and executes all 91 cases directly from the repository; it rejects
  missing, duplicate, or unexpected manifest/bundle case IDs and validates emitted
  reason, privacy-preset, and disclosure-field vocabulary against the v1
  registries.
- Google Calendar transport adapter with deterministic Google-safe destination
  IDs, private managed markers, disabled reminders, and `sendUpdates=none`.
- Account-explicit Google routing: every source read, destination verification,
  create, update, and delete carries `provider + OAuth account + calendar`.
  There is no global or implicit "currently signed-in" account. A personal
  account read and employer account write therefore request different Keychain-
  backed access tokens even when both calendars are named `primary`.
- Users choose source, destination, or both before consent. Source-only accounts
  request read-only event access; destinations request event-write access.
  Granted capability metadata is persisted without tokens and is compared with
  the device Keychain credential before any restored bridge is scheduled.
- Dependency-free Google installed-app OAuth using `ASWebAuthenticationSession`,
  PKCE-S256, one-time state, exact custom callback validation, token refresh and
  revocation, and device-bound Keychain persistence. No client secret is used.
- Lifecycle-aware actor coordinator with staged cursor commits, idempotent
  outbox effects, ambiguous-create recovery, destination repair, and bounded
  retry state. Multiple policies remain active at once; policies sharing the
  exact same source endpoint share one poll, while different accounts route
  independently.
- Cursorless refreshes are hard-bounded by default to 30 days back, 400 days
  ahead, and 100 provider pages. Each page is staged through the repository
  before the next is fetched. A repeated page token or exceeded page limit
  abandons the batch and does not advance the cursor.
- Destination updates and deletes carry the last observed provider revision as
  `If-Match`. Reads and ambiguous-write recovery verify the managed, policy,
  and projection markers before adopting, changing, or deleting an event.
- Per-policy destination-edit behavior: a managed copy edited or deleted
  directly on the destination is restored with a locally stored sync notice by
  default, restored silently, or held untouched until the person resolves the
  notice with restore or keep-and-detach. Notices repeat only the copy's
  privacy-transformed summary and timing.
- Device-bound, non-synchronizing Data Protection Keychain wrapper.
- Production SQLCipher database using the SQLCipher-managed GRDB fork. A
  separately generated 32-byte database key is kept as a
  `AfterFirstUnlockThisDeviceOnly`, non-synchronizing Keychain item. The key is
  configured before the first schema access; an existing file with a missing
  or wrong key fails closed and is never replaced.
- Five transactional schema migrations cover native account/bridge
  configuration, the stable installation identity, account-scoped cursors,
  observations, durable staged pages, projections, and outbox effects. The UI
  restores connected-account metadata and complete account-explicit policies
  on relaunch; OAuth credentials remain separately in Keychain.
- Production app composition asynchronously authenticates and migrates the
  encrypted store, retains the real `SyncCoordinator`, and only then enables
  policies. It never substitutes the preview or in-memory repository.
- `NWPathMonitor` joins sleep/wake state to pause polling while offline.
  Ownership-mismatched effects enter a durable terminal quarantine; they remain
  visible as action-needed but cannot block effects for other bridges.
- Compileable in-memory stores, fake provider, scripted HTTP transport, and
  credential-free tests.

The production store is built from exactly pinned
`sqlcipher/GRDB.swift` 7.11.1 and `sqlcipher/SQLCipher.swift` 4.17.0; both the
manifest constraints and `Package.resolved` are present in the source tree and
must be included in the first commit. With an
installed-app client configuration, the Connect button performs real OAuth,
stores each account credential in the device Keychain, persists non-secret
account and bridge configuration in SQLCipher, and schedules all enabled
policies through the account-explicit coordinator. Without OAuth configuration,
connection and live sync fail closed. Preview fakes never silently become
production storage.

## Google installed-app configuration

Create an OAuth client suitable for a native installed app in Google Cloud,
enable the Google Calendar API, and configure the consent screen. The redirect
must be a custom URI associated with that client, for example:

```text
com.googleusercontent.apps.CLIENT-ID:/oauthredirect
```

For a packaged app, set these Info.plist values at build/signing time:

```text
PlanipusGoogleClientID
PlanipusGoogleRedirectURI
```

For local SwiftPM development, the same public values can be supplied as:

```sh
PLANIPUS_GOOGLE_CLIENT_ID='CLIENT-ID.apps.googleusercontent.com' \
PLANIPUS_GOOGLE_REDIRECT_URI='com.googleusercontent.apps.CLIENT-ID:/oauthredirect' \
swift run PlanipusApp
```

Planipus requests offline access, opens only the Apple-managed system browser,
validates the callback path and state before exchanging the code, and stores the
refresh credential under service `org.planipus.macos.google-oauth` with Data
Protection Keychain, `AfterFirstUnlockThisDeviceOnly`, and iCloud Keychain sync
disabled. The client ID and redirect URI are public configuration; never add a
client secret to the app. No credentials are required by the test suite.

## Encrypted data and recovery limits

The native database is stored at
`~/Library/Application Support/Planipus/planipus.sqlite`. Its independent
32-byte key uses Keychain service `org.planipus.macos.database`, account
`sqlcipher-key-v1`. OAuth credentials use the separate service
`org.planipus.macos.google-oauth`. Neither kind of item synchronizes through
iCloud Keychain.

Current recovery behavior is deliberately conservative:

- losing the database Keychain item makes the existing database unreadable;
  Planipus does not generate a replacement key for an existing file;
- a wrong key leaves the database bytes untouched and stops sync;
- database-key rotation/rekey, recovery-key escrow, export/import, and
  migration to a replacement Mac are **not implemented**;
- there is no supported operation that deletes the database and Keychain key
  together; manual deletion can strand one half of the pair; and
- an operator backup of only the database file is not independently
  recoverable. A designed, authenticated export format is a release follow-up.

Do not claim recoverability or device migration until those workflows have a
threat model, atomic rekey protocol, tests for interrupted rotation, and a UI
that makes destructive consequences explicit.

## Build and test

```sh
swift build
swift test
swift run PlanipusApp
```

The first build resolves the two exact Swift package versions above. Store
tests use temporary SQLCipher files and an in-memory secret store; they never
touch the user's Keychain or production database. They verify encrypted file
headers, absence of plaintext event data, persistence across reopen, wrong- and
missing-key failure without overwrite, migration idempotence, atomic staged
cursor commits, outbox durability, and separation of policies whose calendars
are both named `primary` but belong to different Google accounts.

`swift test --filter CanonicalConformanceTests` runs the focused shared-contract
gate. It uses the JSON fixtures as data only: the Mac and Server editions keep
independent evaluator implementations and share no executable runtime.
The full repository gate also runs the Node/AJV schema validator. The Swift-only
runner enumerates `cases/**/*.json` and rejects unlisted bundle paths, but it is
not a standalone JSON Schema validator.

The coordinator now reaches that native canonical evaluator through the
account-explicit Mac adapter. The engine is contract-complete, while a few Mac
domain/UI inputs are intentionally narrower today: bridge configuration exposes
weekly hours but not date exceptions or selectable DST resolution (the adapter
uses `earlier_offset` and `shift_forward_by_gap`); all-day source observations
currently retain UTC date boundaries rather than a separate source timezone;
and the Mac bridge model exposes active/disabled rather than every canonical
policy lifecycle state. Those are model and UI follow-ups, not silently separate
evaluation rules.

The package contains these boundaries:

- `PlanipusCore`: provider-neutral domain, account-explicit endpoints,
  Mac evaluator, native canonical v1 evaluator, fixture codec, contracts.
- `PlanipusGoogle`: Google REST transport, deterministic identity, native OAuth.
- `PlanipusStore`: account-scoped atomic cursor/page/outbox protocol, test
  implementation, and production GRDB/SQLCipher repository.
- `PlanipusSecrets`: Keychain and test secret stores.
- `PlanipusSync`: reconciliation and lifecycle owner.
- `PlanipusDesign` and `PlanipusApp`: native presentation.
- `PlanipusTestSupport`: fakes only; never link this into a release runtime.
