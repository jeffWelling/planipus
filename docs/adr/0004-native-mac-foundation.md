# ADR-004 — Autonomous native Mac foundation

Status: accepted; OAuth and encrypted-store choices implemented, release gates pending

Date: 2026-07-21

Owners/reviewers: Planipus maintainers; macOS security/release review required

Requirements/risks: MAC-001–MAC-012, CAL-009–CAL-015

## Context

Planipus for Mac must directly authorize Google and synchronize only while that
Mac process is running and online. It cannot use a loopback web server, daemon,
Server API, or unencrypted local production store.

## Decision

Use a Swift 6 native SwiftUI/AppKit application with modules for Core, Google,
Store, Secrets, Sync, Design, and test support. Core is Foundation-only and
consumes the shared JSON semantics. The coordinator is actor-isolated and uses
short staged cursor batches; no database transaction spans network requests.

The packaged app will use a Google installed-app OAuth client and exact custom
callback scheme. Tokens and the database key use the data
protection Keychain, non-synchronizing application-only items, and
`AfterFirstUnlockThisDeviceOnly` accessibility. Access tokens remain in memory
where practical and a missing refresh token never overwrites an existing one.

The preferred gated store is the SQLCipher-maintained GRDB Swift package backed
by official SQLCipher.swift, using one actor-owned `DatabaseQueue`. The initial
compileable foundation keeps OAuth/storage behind protocols and fakes until
dependency, encryption, migration, signing, notarization, and clean-machine
spikes pass; it must not present an unencrypted fake as production-ready.

Destination creates use the same behavior-level provenance rules and a
deterministic Google-compatible event ID, independently implemented in Swift.
Sleep/offline/quit cancels scheduled work using a lifecycle epoch. A request
whose outcome is unknown is verified before retry.

## Consequences

Closing the main window may leave the menu-bar process running; explicit Quit
stops synchronization. The app does not prevent sleep or disable App Nap. A
connectivity monitor is only a scheduling hint—the provider response is
authoritative. There is no incoming listener or Server communication.

## Implementation addendum — 2026-07-21

The OAuth dependency gate selected a smaller original adapter over AppAuth:
`ASWebAuthenticationSession` handles the system browser while Planipus owns
PKCE/state/exact-callback/token exchange behind its Google module. No AppAuth
code or dependency is present. Roles are chosen before consent; source-only
accounts request read-only event scope and destinations request event-write.

ADR-005 selected and integrated SQLCipher-managed GRDB 7.11.1 with
SQLCipher.swift 4.17.0. Five migrations, encrypted-file/wrong-key behavior and
durable transaction tests pass. Key rotation/recovery/export, lifecycle proof,
packaging, signing and notarization remain open release gates.

## Validation/revisit trigger

The foundation persistence/OAuth gates have passed. Release additionally
requires key rotation/recovery, entitlement inspection, Keychain attribute tests,
plaintext scans, crash-after-write recovery, lifecycle/network tests, signing,
notarization, and live disposable Google evidence.

## Supersedes / superseded by

Clarifies the autonomous-edition decision and installed-app OAuth wording.
