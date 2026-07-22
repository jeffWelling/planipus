# Foundation audit evidence — 2026-07-20

Status: **superseded foundation decision; historical evidence only**. The tests
below remain a truthful record of the earlier Fluxure evaluation, but the
clarified calendar-copy product previously selected Keeper. That decision is
superseded by the clean-room policy; see
`2026-07-20-keeper-audit.md` and `../ADOPT-OR-BUILD.md`.

This file records the decision-grade summary. Temporary clones and downloaded
dependencies are not part of the project repository and may no longer exist in
a future session. Do not import this upstream as implementation work; reproduce
the audit only in a separately approved historical-research environment.

## Environment

- Date: 2026-07-20
- Host: macOS, Apple Silicon
- Node: `v24.9.0`
- npm: `11.6.0`
- pnpm: `9.15.4` through Corepack
- Local timezone: America/Vancouver
- Explicit test timezone for portable result: UTC

## Fluxure

- Repository: `https://github.com/FluxureCalendar/Fluxure.git`
- Audited commit: `724d45c9766f483b97d4162039d34a0ad5252da7`
- Commit date: 2026-06-22
- Package version: `1.0.86`
- License: AGPL-3.0-only

### Reproduction

From a clean shallow checkout, the frozen pnpm lockfile installed successfully.
The engine's documented direct command initially failed because
`@fluxure/shared` had not been built. Building shared first resolved the package
entry; the root recursive build already performs the correct topological order.

The full production build succeeded with the documented public build variable:

```text
PUBLIC_API_URL=http://localhost:3000 pnpm build
```

The complete test suite succeeded with timezone fixed and loopback sockets
allowed for Supertest:

```text
TZ=UTC pnpm test

shared: 3 files, 166 tests passed
engine: 8 files, 201 tests passed
web:    12 files, 158 tests passed
api:    31 files, 512 tests passed
total:  54 files, 1,037 tests passed
```

Without `TZ=UTC`, two web formatting tests returned the preceding local date for
midnight UTC input. This is a portability weakness in the tests/format contract.

Inside the restricted audit sandbox, API tests initially failed because
Supertest could not bind `0.0.0.0` (`listen EPERM`). They passed unchanged once
loopback binding was permitted; those failures were environmental, not product
failures.

### Production advisory audit

`pnpm audit --prod` reported:

- high: Nodemailer `8.0.10`, advisory `GHSA-p6gq-j5cr-w38f`, patched in `9.0.1+`;
- moderate: transitive `qs` `6.15.0`, advisory `GHSA-q8mj-m7cp-5q26`, patched in
  `6.15.2+`.

Both must be remediated and verified before feature work or image publication.

### Source observations

- Engine is a pure TS package with no database/auth/network side effects.
- Google provider has incremental sync, token-expiry recovery, pagination,
  bounded ranges, retry/backoff, event CRUD, and provenance fields.
- Credential ciphertext uses AES-256-GCM and requires `ENCRYPTION_KEY`.
- Only Google exists; there is no provider abstraction broad enough for Graph
  and CalDAV yet.
- Smart-meeting limits are disabled for both Free and Pro. Calendar operations
  do not carry attendees/conference behavior.
- `SELF_HOSTED=true` maps authenticated requests to Pro, but Pro still contains
  product gates and `meetingsEnabled: false`.
- Redis is optional at startup, but BullMQ queues/workers are skipped without it;
  guaranteed maintenance/export/reschedule semantics need a solo-profile answer.

## FluidCalendar

- Repository: `https://github.com/dotnetfactory/fluid-calendar.git`
- Audited working tree: current main at time of audit
- License: MIT

### Reproduction

- `npm ci`: succeeded; 1,296 packages installed.
- `npm run type-check`: passed.
- `npm run test:unit -- --runInBand`: failed with 35 suites passing, 2 failing,
  1 skipped; 261 tests passing, 6 failing, 1 skipped.
- Failures concern Google Tasks start/due/completion mapping.
- Database-coupled logger calls emitted asynchronous Prisma errors when no
  `DATABASE_URL` was present.
- npm audit summary at install: 38 vulnerabilities—7 low, 14 moderate, 16 high,
  1 critical.

### Source observations

- Valuable Google/Outlook/CalDAV calendar and task provider code.
- OAuth tokens/client secrets stored as ordinary strings in Prisma schema.
- Scheduler is Prisma/store coupled, has a seven-day active horizon, and writes
  task placement immediately rather than returning an immutable plan.
- No team/booking/routing/delegation model.

## Cal.rs

- Repository: `https://github.com/olivierlambert/calrs.git`
- Audited commit: `13a584f54fa6b7870b3e1dc7b4c658b6bd7254bd`
- Version: `1.14.0`
- License: AGPL-3.0

Source audit found a mature booking/provider/self-host platform with CalDAV,
Google, EWS, teams, collective/round-robin booking, OIDC, encrypted tokens, CLI,
and extensive tests. It has no task/habit/focus/adaptive-planning domain, no
preview/apply planner contract, and no clean broad service API for sidecar use.
Its large web module also raises insertion cost. Under the current Apache-2.0
clean-room strategy it remains a behavior/interoperability reference only, not
an implementation donor or running authority.

## Kaboome

- Repository: `https://github.com/kaboome-org/kaboome.git`
- Audited commit: `23fc246e10d7969a5129b98d1097e12c238b954e`
- Commit date: 2024-11-18
- License: GPL-3.0

The scheduler is a small client-side first-fit loop. It sorts blockers, walks
tasks in input order, chooses the first gap, mutates start/end, and writes to the
calendar. It is not a competitive adaptive scheduler foundation.

## Name screen

The exact string “Planipus” produced no software, calendar, package, repository,
or trademark result in the broad web searches performed on 2026-07-20. Results
were biological/historical uses of the word, including *Matuta planipus*.

This is a preliminary collision screen, not legal trademark clearance and not a
domain-registration guarantee. Repeat repository/package/domain/mark checks
immediately before public launch.
