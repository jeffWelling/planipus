# Planipus

**A calm, playful, self-hosted calendar that protects your time.**

Planipus is personal software for keeping availability consistent across
independent calendar accounts, defending after-work time, and arranging
flexible recurring meetings without exposing more detail than the user intends.

The defining scenario is simple:

> Create an event on a personal Google Calendar. If it overlaps configured work
> hours, Planipus maintains a privacy-controlled copy on an employer Google
> Calendar so coworkers and booking systems see the time as unavailable.

The copy may show only `Busy`, a generic commitment category, private details
visible to the owner, or selected/full details under the destination calendar's
access rules. Source edits, moves, RSVP changes, recurrence exceptions, and
deletion reconcile automatically. Events outside the policy's hours stay out.

Read the authoritative [Calendar Sync contract](docs/CALENDAR-SYNC.md).

The Server alpha also includes two adaptive-calendar foundations:

- **Protect** maintains optional private Busy fences before/after work and on
  closed days, while Meeting Hours remain a separate hard scheduling boundary.
- **Smart Meetings** place a rolling set of recurring occurrences around fresh
  connected-calendar availability, protect a no-move window, and default to
  human-approved conflict suggestions.

These planning paths are fully usable with the deterministic local provider.
Google planning writes are deliberately default-off behind
`PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true` until the live invitation and
ordinary-viewer evidence suite passes.

The Server now also has a **no-copy conflict response** alpha. A personal
account connected with the strict-private `availability` role supplies opaque
provider free/busy intervals only. Its calendar appears as event-content
`readable: false` plus `capabilities.freebusy_readable: true` in API/MCP output.
Changing a previously used source/both account to this role is blocked until
event-content dependencies are safely removed; Planipus never silently leaves or
repopulates mirrored observations after a successful privacy downgrade.
Planipus can then decline a future work invitation that is still awaiting the
connected work attendee's response, using a static configurable comment—without
creating a personal-event copy on the work calendar. Organizer events and
accepted, tentative, declined,
cancelled, all-day, started, changed, or no-longer-conflicting invitations fail
closed. A selected private availability calendar is protected from active
bridges in either direction; an outbound bridge may be paused first and leaves
its copies behind, while an inbound bridge blocks protection even when paused.
Google delegated aliases share one canonical calendar identity, so they cannot
self-copy or bypass protection. An availability-only OAuth callback refuses any
broader Calendar grant Google retained from an older consent; revoke that grant
at Google and reconnect rather than assuming access narrowed. It also fails
closed if Google does not report the granted scope set.
Live Google RSVP writes default off behind
`PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE=false` until comment visibility
and mail/notification behavior are proven with disposable accounts; Google
guarantees the RSVP status boundary, not organizer delivery of the comment. A
provider-confirmed decline with an unretained comment stays applied, consumes
the immutable 20-per-24-hour safety budget, and appears as a warning rather than
being repeatedly rewritten. If a pending action's first exact check already
finds it declined, Planipus sends no additional reply and conservatively applies/
budgets that recovery result; it never overwrites accepted or tentative answers.

Planipus Server exposes the same authority through its HTTP API and an optional
local stdio MCP adapter. The adapter calls only the API with dedicated,
expiring, scoped tokens. Read/proposal tools are registered by default, but a
least-privilege token contains only `read`; conflict proposal contacts provider
free/busy and is explicitly MCP open-world. Apply tools require an `apply` token
plus an explicit process flag. There is no remote
Streamable HTTP MCP endpoint yet. See the complete
[API/MCP/conflict-response contract](docs/CONFLICT-RESPONSE-AND-MCP.md).

## Open-source strategy: compose, do not copy

Planipus composes selected, pinned open-source and platform building blocks under
foundation-level review—but it does **not** adopt, fork, port, embed, or copy
any part of Keeper.sh. Keeper
is AGPL and is retained only as historical behavior research. Its code, tests,
fixtures, assets, schemas, dependencies, runtime, and Git history are excluded.

Planipus Server is an original TypeScript web service composed from reviewed
libraries and standards: PostgreSQL-backed durable jobs, a reviewed HTTP/API
stack, React/accessibility primitives, OpenID/OAuth libraries, and official
provider APIs. Planipus for Mac is an original SwiftUI application using Apple
platform facilities and a pinned GRDB/SQLCipher encrypted store. Both independently
implement the narrow policy/sync engine against Planipus-authored conformance
fixtures.

See [the adoption decision](docs/ADOPT-OR-BUILD.md), the binding
[clean-room policy](docs/CLEAN-ROOM-POLICY.md), and the historical
[Keeper research audit](docs/evidence/2026-07-20-keeper-audit.md).

The earlier Fluxure decision was based on a broader automatic-planner
interpretation and is superseded. Fluxure remains a possible future donor if
Planipus later adds adaptive tasks, habits, focus, or planning; it is not the
calendar-sync runtime.

## Status

Implementation began on 2026-07-21 from the Planipus-authored Calendar Sync
contract. Credential-free Server and native Mac foundations now build and run;
the Server also has working Protect and Smart Meeting alpha slices. This public
repository is not yet a production release: live Google planning writes,
third-viewer privacy, Mac key rotation/recovery, image/cluster recovery, signing
and release-provenance gates remain open. [Current state](docs/STATE.md)
distinguishes implemented behavior from unproven release claims.

## Build and verify

Prerequisites are Node.js 24, npm 11, PostgreSQL 16 or newer, and—when building
the native edition—a Mac with Swift 6.1 or newer. Helm 3 is needed only to render
or install the Kubernetes chart.

```sh
npm install
npm run verify
swift test --package-path macos
swift build -c release --package-path macos
```

`npm run verify` builds workspaces in dependency order, type-checks and tests
the shared contract, Server, web app, and MCP adapter, checks all 91 canonical fixtures, then
runs documentation and excluded-donor provenance gates. It does not contact
Google or mutate a calendar.

## Run Planipus Server locally

Create an empty PostgreSQL database and copy `.env.example` to `.env`. Replace
every `CHANGE_ME`: the master key must be exactly 32 random bytes encoded as
base64, and the bootstrap token must contain at least 32 unpredictable
characters. Keep fake-provider mode for credential-free development.

```sh
npm run build
npm run seed:fake
npm run dev:server
```

Open `http://127.0.0.1:8080`, enter the bootstrap token once, and use the same
origin for every request. `seed:fake` is an idempotent, non-production-only
fixture that creates separate Personal-source and Work-destination accounts,
their primary calendars, a completed source cursor, and one private sample
event. It refuses Google mode and production. The development command compiles
the shared engine, Server and web interface, waits for PostgreSQL, applies
migrations, and starts the API, scheduler, and worker together for local use.
They remain deliberately separate production processes; the Procfile and Helm
chart launch them from one artifact.

To connect real accounts, create a Google **web** OAuth client whose exact
redirect URI is
`https://YOUR_PLANIPUS_HOST/api/v1/connections/google/callback`, set provider
mode to `google`, configure both Google credentials, and serve Planipus over
HTTPS. Do not use production calendars until the live-provider acceptance
matrix is ready. Availability-only connections request CalendarList and
free/busy without event-list access; source connections add read-only event
access; destination connections request event-write access; `both` is required
for a work calendar that must be read and respond to invitations. Existing
source/both connections require reauthorization for the new free/busy grant.

## Run the MCP adapter

Create a short-lived `read` API token in Server Settings and add `propose` only
if that MCP host needs preview tools. Copy its plaintext value immediately
because Planipus stores only its hash. Configure an MCP host to launch the built
stdio command with secrets in its private environment:

```sh
export PLANIPUS_API_URL="https://YOUR_PLANIPUS_HOST"
export PLANIPUS_API_TOKEN="pln_api_REPLACE_WITH_ONE_TIME_VALUE"
export PLANIPUS_MCP_ENABLE_APPLY="false"
npm run build --workspace @planipus/mcp
node mcp/dist/src/stdio.js
```

Plain HTTP is accepted only for loopback development. To expose mutation tools,
issue a separate `apply` token and set the process flag to `true`; the API still
checks scope on every request. Do not put the stdio process behind an ingress.

## Run Planipus for Mac

The Swift package can launch the native app from Xcode or with SwiftPM after
supplying an installed-app Google OAuth configuration. The Mac app talks
directly to Google and never asks for a Planipus Server URL. Its OAuth tokens
are account-scoped Keychain items.

The native runtime now opens and migrates a SQLCipher-encrypted GRDB database,
keeps its independent database key in the non-synchronizing device Keychain,
restores account/policy state, and schedules sync only after durable persistence
succeeds. The in-memory store remains test-only. Key rotation, authenticated
export/import, replacement-Mac recovery, and a coordinated reset workflow are
not implemented; losing the device-bound database key is currently
unrecoverable. See [ADR-005](docs/adr/0005-mac-encrypted-store-foundation.md)
and the [Mac README](macos/README.md).

## Render the Kubernetes profiles

```sh
helm lint deploy/helm/planipus
helm template planipus deploy/helm/planipus
helm template planipus deploy/helm/planipus -f deploy/helm/planipus/values-standard.yaml
```

The solo profile owns one persistent PostgreSQL volume; the standard profile
requires an external PostgreSQL service. Rendering is a configuration check,
not deployment evidence. Follow [operations](docs/OPERATIONS.md) for secrets,
TLS, NetworkPolicy, backup, restore, upgrade and reconciliation requirements.

## Start here in a new session

1. [New-session handoff](docs/HANDOFF.md)
2. [Calendar Sync product contract](docs/CALENDAR-SYNC.md)
3. [No-copy conflict response, API, and MCP contract](docs/CONFLICT-RESPONSE-AND-MCP.md)
4. [Reclaim and market research](docs/RESEARCH.md)
5. [Adoption decision](docs/ADOPT-OR-BUILD.md)
6. [Clean-room policy](docs/CLEAN-ROOM-POLICY.md) and [Keeper behavioral research audit](docs/evidence/2026-07-20-keeper-audit.md)
7. [Foundation gate](docs/FOUNDATION-GATE.md)
8. [Requirements](docs/REQUIREMENTS.md) and [traceability](docs/TRACEABILITY.md)
9. [Architecture](docs/ARCHITECTURE.md), [data model](docs/DATA-MODEL.md), and
   [integration contracts](docs/INTEGRATIONS.md)
10. [Roadmap](docs/ROADMAP.md), [backlog](docs/TODO.md), and
   [decisions](docs/DECISIONS.md)

## Product principles

- The source provider event remains authoritative.
- One directed policy creates and maintains copies on one destination calendar.
- Work-hour and privacy behavior is explicit per policy.
- Safe presets compile to inspectable field transformations.
- Managed copies never become sources for loops.
- Ordinary source changes sync automatically; previews guard policy creation,
  material rule changes, reconnect ambiguity, and—once implemented—bulk cleanup.
- Self-hosted means no feature caps, license server, required telemetry, or SaaS
  control plane.
- A backup is not complete until restore and reconciliation are tested without
  duplicate destination writes.

## Two independent editions

**Planipus for Mac** is a self-contained native SwiftUI application. It connects
directly to Google, keeps its provider credentials in the local Keychain, and
runs its own Swift sync engine against an encrypted local database. It does not
sync while the application is quit, the Mac is asleep/offline, or the Mac has
been replaced; it catches up when the same installation runs online again.

**Planipus Server** is a separate original web service for Kubernetes. It
has its own accounts, credentials, policies, PostgreSQL database and jobs,
web UI, and independent backup/restore responsibility. It can run continuously
in the cluster, but it does not
continue or control a Mac installation.

The editions share a name, behavioral contract, and conformance fixtures. They
do not pair, share state, authenticate to each other, or depend on the same
runtime. See the [edition architecture](docs/MACOS-AND-KUBERNETES.md).

## Scope after calendar sync

Google↔Google privacy-preserving Calendar Sync remains the release-critical
wedge. Protected Hours and Smart Meetings are active Server-alpha tracks built
on the same hours, availability, preview, ownership, and durable-job substrate.
Reusable Hours/Priorities, Focus, Habits, Tasks, Buffers, Scheduling Links,
analytics, Outlook, and CalDAV follow in measured stages; the parity plan keeps
those modules explicit without pretending the current alpha already implements
them.

## License

Planipus source and documentation are licensed under Apache-2.0. This is an
engineering selection, not legal advice. A license/provenance review of the
complete dependency graph and release artifacts remains mandatory before public
distribution.

## Policies

- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)
- [Governance](GOVERNANCE.md)
