# Keeper.sh historical research audit — excluded from implementation

Audit date: 2026-07-20  
Repository: `https://github.com/ridafkih/keeper.sh.git`  
Revision: `1c274dbe74fce3b8464c8686e1cec63c14e34557`  
Nearest tag: `v2.13.5` plus one commit  
License: AGPL-3.0-only  
Runtime used: Bun 1.3.11 on Apple Silicon macOS

## Reproducibility

- clean filtered clone completed;
- `bun install --frozen-lockfile`: 964 packages installed;
- `bun run types`: 17 tasks passed;
- `bun run build`: five production build tasks passed;
- `bun run test`: nine package tasks passed, 126 files and 1,027 tests total:
  - calendar: 654;
  - API: 211;
  - web: 66;
  - sync: 29;
  - cron: 21;
  - MCP: 19;
  - database: 15;
  - auth: 9;
  - worker: 3.

The suite emitted several Vitest warnings for unawaited promise assertions and
mock hoisting that will become errors in a future Vitest version. They are
remediation work even though the current suite passes.

## Historically observed capabilities (not reusable)

- multiple calendar accounts and calendars;
- Google and Outlook OAuth sources/destinations;
- CalDAV sources/destinations and ICS sources;
- explicit source→destination mappings;
- event-state and destination-copy mapping tables;
- create/update/delete reconciliation and orphan cleanup;
- recurrence materialization, timezone/ICS/provider fixtures;
- Google/Outlook/CalDAV serialization and error/retry handling;
- source-level options for name template, description/location stripping,
  all-day exclusion, focus/OOO exclusion;
- PostgreSQL, Redis/BullMQ worker, cron, API, web, MCP, auth, and self-host image;
- AGPL license and self-host mode without hosted source/destination limits.

## Material gaps against Planipus P0

1. No working-hours or named-hours-profile filter exists in source, schema, or
   UI. Sync windows are horizon bounds, not weekly work hours.
2. Privacy/filter settings live on the source `calendars` row, so one source has
   the same transformation for every destination. Reclaim/Planipus requires
   per source→destination policy settings.
3. Google destination serialization does not set event `visibility`, suppress
   reminders explicitly, or implement the four Reclaim-equivalent disclosure
   modes. It copies summary/description/location after source-level filtering.
4. Attendees and organizer are not serialized, which is a safe P0 default, but
   there is no explicit disclosure contract or UI explaining this.
5. No Reclaim-equivalent RSVP policy, already-invited destination check,
   `#nosync`, or email-created event behavior was found in the sync policy path.
6. The polling/worker architecture is strong, but Google push-watch behavior
   must be verified; the public self-host description advertises one-minute
   refresh rather than Reclaim-style near-real-time change propagation.
7. OAuth access and refresh tokens are ordinary text columns in
   `oauth_credentials`. CalDAV passwords use authenticated secretbox
   encryption, but OAuth tokens do not. P0 requires envelope encryption and
   migration/rotation.
8. Commercial entitlement logic and UI gates remain in the tree. Self-host mode
   grants unlimited accounts/mappings, but Planipus community behavior must be
   structurally independent of billing.
9. The convenience standalone image places web/API/cron/worker/Postgres/Redis/
   Caddy processes in one container. Planipus should preserve the one-pod user
   experience but use explicit containers and health/backup contracts.

## Dependency audit

`bun audit --prod` reported 100 advisories: 2 critical, 37 high, 56 moderate,
and 5 low. The report includes dev/build dependencies despite `--prod`, so each
path requires reachability classification, but production-relevant findings
include Better Auth/OAuth, Drizzle ORM, Hono/MCP transitive packages,
protobuf/OpenTelemetry, and XML parsing. These advisories describe Keeper's
historical graph only. That graph is excluded from Planipus; Planipus release
gates apply to Planipus's own dependencies and artifacts.

## Voided historical conclusion

> The conclusion below records a rejected decision made during research on
> 2026-07-20. Keeper is AGPL and Planipus must not reuse its code, tests,
> fixtures, assets, schema, dependencies, Git history, runtime, or copied
> expression. Retain this file only for historical feature behavior; do not use
> it as a coding, test, architecture, or dependency template.

The rejected conclusion at that moment was that Keeper looked like a
substantially closer domain foundation than Fluxure because it already covered
calendar ingestion, normalization, mapping, reconciliation, providers, and
self-hosting. The research characterized the remaining work as policy semantics
and hardening.

The associated proposal to adopt a full-history fork after remediation was
voided later that day by the binding clean-room decision. It is not selected,
gated, vendored, or eligible as a Planipus implementation foundation.
