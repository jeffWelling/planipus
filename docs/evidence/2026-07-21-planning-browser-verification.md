# Planning browser and worker verification — 2026-07-21

This is a pre-commit development evidence record for the follow-up worktree
based on public commit `551e79c` (`Initial Planipus alpha`). It records the exact
credential-free flow completed before the follow-up commit; it is not live
Google evidence and does not certify a release.

## Environment and boundary

- Local macOS development host, America/Vancouver.
- Node 24/npm 11 workspace build.
- Disposable local PostgreSQL 17 database on loopback.
- `PLANIPUS_PROVIDER_MODE=fake`; no Google credentials, network calls,
  invitations, or notifications.
- Compiled React interface served by the Planipus API at
  `http://127.0.0.1:8081/` and exercised in the in-app browser.
- Independent API, scheduler, and worker processes from `npm run dev:server`.
- Existing Personal-to-Work Busy-only bridge retained as a background load.

## Defects found and corrected

### Preview staleness followed bookkeeping rather than planning input

Planning preview hashes included endpoint `updated_at`, cursor heartbeat
timestamps, full observation hashes, and planned-event status. Calendar
rediscovery updates endpoint timestamps even when capabilities and Busy time do
not change. A fresh Availability Boundary preview could therefore be rejected
immediately as `preview_stale` after a normal scheduler tick.

`PlanningService` now hashes a versioned semantic snapshot: target and selected
calendar capabilities, the ready availability-calendar set, and sorted derived
Busy intervals. Provider refresh timestamps, title-only observation changes,
and `pending_create -> converged` bookkeeping cannot invalidate a preview.
Changed Busy timing/capabilities/readiness still do. Unit coverage fixes these
expectations.

### Fake provider crossed account boundaries

The in-memory fake provider originally keyed discovered calendars only by remote
calendar ID and returned the same collection for every fake connection. A
Personal source and Work destination could discover each other's calendars;
after restart, the wrong role-scoped capability could overwrite the Work
calendar's writable flag.

Fake access tokens and fake calendar/observation stores are now scoped by
connection. The seed command also restores the two canonical demo endpoints'
roles and capabilities on every run instead of leaving poisoned existing rows
unchanged. Normal and planning event stores are token-scoped as well, including
same-calendar/same-event-ID isolation coverage. The seed's narrow upgrade repair
removes only the two known cross-injected endpoint shapes and refuses to remove
a referenced row. Two such local rows were inspected across every foreign-key
consumer and removed from the disposable demo database; no policy, observation,
cursor, projection, planning rule, planned event, or user data referenced them.

### Completed jobs defeated time-window deduplication

The scheduled-job unique index intentionally covers active states only so
constant-key source sync can be scheduled repeatedly. That also meant an hourly
discovery or 15-minute reconciliation key could be recreated every 15-second
scheduler tick once its prior row succeeded. `PostgresJobQueue.enqueueOnce()`
now serializes equal keys with a transaction advisory lock and checks indexed
terminal history for windowed work. Migration 0005 adds that non-partial lookup
index. Scheduler replicas traverse lock-producing collections in stable-ID
order, while constant-key source sync continues to use ordinary active-only
enqueueing.

## Browser scenario and results

1. Seeded exactly one readable Personal calendar and one writable Work calendar.
2. Reloaded the compiled interface and confirmed both accounts reported one
   calendar and the existing Busy-only bridge remained current.
3. Opened **Protect**, selected Work, kept 09:00–17:00 America/Vancouver hours,
   and previewed 21 days.
4. Preview disclosed 15 private Busy blocks, zero invitations/reminders, the
   exact target calendar, and four example times.
5. Activated the preview after background rediscovery; activation succeeded.
6. Worker converged all 15 `availability_boundary` planned events.
7. Opened **Meet** and previewed six weekly Tuesday 10:00–10:30 Smart Meeting
   occurrences inside 09:00–17:00 Meeting Hours, using Personal as the selected
   availability calendar and no attendee.
8. The current-day occurrence was explicitly unmet because its allowed window
   had already passed. Five future occurrences were placed at the preferred
   time; Planipus did not escape Meeting Hours.
9. Activated the preview and observed the rule card with five upcoming and one
   needs-attention occurrence.
10. Worker converged five `smart_meeting` planned events; the sixth remained
    `unmet` by design.
11. Browser diagnostics contained only React development-mode informational
    messages and no warnings/errors.

Final database status grouping:

| Rule kind | Planned-event status | Count |
|---|---:|---:|
| `availability_boundary` | `converged` | 15 |
| `smart_meeting` | `converged` | 5 |
| `smart_meeting` | `unmet` | 1 |

## Automated checks run on the follow-up worktree

- Server typecheck: passed.
- Server tests: 76 passed, 1 opt-in PostgreSQL suite skipped under its normal
  environment gate.
- The opt-in isolated-schema PostgreSQL integration suite was then run against
  the disposable local PostgreSQL service: 1 test passed.
- Server/calendar-sync/web production build: passed; Server artifact verifier
  reported 90 emitted paths and no test/Vitest output.
- The full repository gate subsequently passed provenance, documentation,
  TypeScript checks, 96 calendar-sync tests, 76 Server tests, production builds,
  58 Swift tests, and both Helm profile lints.

## Evidence not established

- No real Google fence event was created or viewed from another account.
- No live attendee invitation, update, cancellation, RSVP, or notification was
  sent.
- No external-attendee free/busy mapping was tested.
- No DST transition, quota, high-latency, crash/restart, backup/restore, or
  Kubernetes deployment was exercised in this walkthrough.
- Google planning writes remain default-off behind
  `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`.

These remain release gates; the result above proves only the credential-free
compiled UI, PostgreSQL transaction, scheduler, worker, and fake-provider
vertical slice.
