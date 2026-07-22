# Open-source planning and scheduling adoption audit

Status: **decision evidence; no third-party application selected as a Planipus
foundation**  
Research date: 2026-07-21  
Timezone: America/Vancouver  
Reviewer: Codex research agent  
Planipus source state: initial uncommitted working tree; the repository had no
source commit at the time of this record  
Decision scope: Planipus Calendar Sync P0, deferred Smart Meetings, booking,
task scheduling, and work-hours/after-hours behavior  

This is a dated product, license, and adoption audit. It is not a release
certification, legal opinion, security audit, dependency approval, or claim that
the evaluated projects were installed and tested. Feature findings are based on
the projects' official repositories, license files, product documentation, and
issue trackers as retrieved on the research date. Repository activity, licenses,
features, and commercial terms can change; every future adoption must re-pin and
re-verify the exact revision.

## Decision

Planipus should **not adopt or fork an existing scheduling application for its
core**. No evaluated permissively licensed application implements Planipus's
defining behavior:

> Observe ordinary events across multiple independently authorized Google
> identities, evaluate each event against a directed work-hours and selection
> policy, and maintain privacy-filtered destination copies with durable
> provenance, recurrence safety, deletion handling, retry convergence, and loop
> prevention.

The original Planipus Calendar Sync engine remains required for
`CAL-009`–`CAL-015`. This is not a preference for unnecessary original code.
The missing behavior is the product itself, while the candidate applications
mainly solve adjacent booking, task management, or manual polling problems.

Planipus should still lean heavily on compatible open source at component and
protocol boundaries:

1. Continue using reviewed permissive libraries for HTTP, OAuth, provider APIs,
   database access, timezone evaluation, metrics, tests, and native storage.
2. Preserve an original Planipus policy, privacy, provenance, reconciliation,
   and conformance layer.
3. Consider a separately deployed booking subsystem after P0, with Calnode as
   the first lightweight proof of concept and Cal.diy as the breadth-oriented
   comparison.
4. Consider Taskwarrior as an optional task-source adapter and Compass Calendar
   as a UI/component reference after P0.
5. Treat FluidCalendar as a permissively licensed scheduler research candidate,
   not a production engine. Any code reuse requires file-level provenance and
   independent Planipus correctness tests.
6. Do not reuse, vendor, port, translate, execute, or ship Keeper material. Use
   only independently expressed product ideas and behavior questions, as the
   binding clean-room policy permits.
7. Do not import AGPL, GPL, Business Source License, source-available, or
   proprietary application code into the Apache-2.0 Planipus codebase. A
   standards-based interoperability target run independently by an operator is
   different from incorporating or shipping that application's code, but it
   still requires an explicit architecture and license review.

## Why superficially similar products are not substitutes

Three capabilities are often described as “calendar scheduling,” but they have
different state machines and safety requirements.

### Calendar projection or blocking

This is Planipus P0. An event already exists on a source calendar. A directed
policy decides whether another calendar should receive a maintained copy and
exactly which information that copy may disclose. The copy must follow source
edits and deletion without mutating the source, duplicating itself, sending
invitations, escalating privacy, or forming a reciprocal-sync loop.

Relevant requirements: `CAL-009`–`CAL-015`, `SEC-004`, `SEC-007`, `MAC-001`–
`MAC-012`, `OPS-001`, `OPS-003`, and `OPS-006`.

### Smart Meetings and flexible scheduling

This is deferred P2 scope. A flexible item or recurring meeting has constraints,
preferences, attendees, and priority. A solver finds or revises a placement as
availability changes. Correctness includes deterministic explanations, stale
preview protection, recurrence semantics, attendee fairness, and no partial
external writes.

Relevant requirements: `SCH-001`–`SCH-010` and `MTG-001`–`MTG-002`.

### Booking pages and scheduling polls

This is also deferred P2 scope. A host publishes eligible slots or candidate
times so another person can choose or vote. Round-robin, collective booking,
questions, notifications, cancellation, and rescheduling are important, but
they do not maintain arbitrary personal-to-work event projections and generally
do not continuously relocate recurring meetings.

Relevant requirements: `MTG-003`–`MTG-006`.

Working-hours support inside a booking product normally limits slots offered to
guests. Nextcloud-style working hours normally affect free/busy. Neither behavior
is equivalent to Planipus's `overlaps_profile` and `contained_in_profile`
selection followed by privacy-controlled destination writes.

## License and adoption summary

“Eligible for investigation” does not mean approved for use. Exact revisions,
transitive dependencies, notices, patent terms, trademarks, security, build
reproducibility, and maintenance must pass the reuse ledger before adoption.

| Project | Observed license/status | Closest useful capability | Planipus decision |
|---|---|---|---|
| [Cal.diy](https://github.com/calcom/cal.diy) | MIT community edition | Broad individual booking infrastructure | Possible separate post-P0 booking service; not a foundation |
| [Calnode](https://github.com/Calnode/calnode) | Apache-2.0 | Lean booking/API/MCP service | First post-P0 booking proof-of-concept candidate; maturity gate required |
| [FluidCalendar](https://github.com/dotnetfactory/fluid-calendar) | MIT | Automatic task placement | Research/selective-module candidate only; not production-ready |
| [Compass Calendar](https://github.com/SwitchbackTech/compass-calendar) | MIT | Calendar/task UI and Google sync | UI/component reference; not a policy engine |
| [General Task](https://github.com/GeneralTask/task-manager) | MIT repository, with a proprietary build dependency documented | Task aggregation and manual calendar blocking | Low-priority reference; clean-build and dependency gate required |
| [Taskwarrior](https://taskwarrior.org/docs/) | MIT | Task model, recurrence, JSON and hooks | Optional task-source adapter; not a scheduler |
| [Nextcloud Calendar](https://github.com/nextcloud/calendar), [Deck](https://github.com/nextcloud/deck), and [Tasks](https://github.com/nextcloud/tasks) | AGPL-3.0 family | CalDAV calendar/task ecosystem | No source reuse; standards-based external interoperability only |
| [Easy!Appointments](https://github.com/alextselegidis/easyappointments) | GPL-3.0 | Appointment/provider booking | Do not incorporate; feature mismatch makes a separate service unattractive |
| [Rallly](https://github.com/lukevella/rallly) | AGPL-3.0-or-later | Manual scheduling polls | Behavior reference only |
| [Vikunja](https://github.com/go-vikunja/vikunja) | AGPL-3.0-or-later | Self-hosted task management | Behavior reference only |
| [DayOtter](https://github.com/Dayotter/dayotter) | AGPL-3.0 core plus commercial `ee/` layer | Broad booking, focus, assistant, and recurring-meeting claims | Closest breadth reference, but prohibited for code reuse and immature |
| [Cal.rs](https://cal.rs/) | AGPL-3.0 | Lean single-binary booking | Behavior reference only |
| [Supercal](https://supercal.cc/about) | Product claims AGPL | Calendar sync, polls, teams, buffers | No reuse; insufficient repository evidence for adoption |
| [GudCal](https://github.com/gudlab/gudcal-core) | Business Source License 1.1 until 2030 | Booking, teams, API/MCP | Not currently OSI open source; do not adopt |
| [zcal](https://zcal.co/) | Proprietary service and code | Booking, polls, multi-calendar conflict checking | Competitor behavior reference only |
| [Keeper](https://github.com/ridafkih/keeper.sh) | AGPL-3.0-only | Calendar-bridge behavior | Absolute prohibition: ideas/behavior questions only |

## Detailed findings

### Cal.diy

Primary sources:

- repository and current community-edition warning:
  <https://github.com/calcom/cal.diy>;
- Cal.com's 2026-04-15 distribution and license announcement:
  <https://cal.com/blog/calcom-v6-4>;
- historical multiple-Google-calendar report, including a 2026 comment that the
  issue still existed for that user:
  <https://github.com/calcom/cal.diy/issues/19878>.

Cal.com changed its public-code model in April 2026. The free community code is
now Cal.diy under MIT, while the commercial Cal.com edition is no longer public.
The Cal.diy repository describes itself as 100% MIT and self-host-only. It also
states that Teams, Organizations, Insights, Workflows, SSO/SAML, and other
enterprise/commercial features were removed. Its maintainers explicitly
recommend it for personal, non-production use and place deployment, database,
and security responsibility on the operator.

Useful capabilities include event types, public booking flows, availability,
calendar integrations, recurring bookings, cancellation/rescheduling, embeds,
payments/integrations, and a substantial existing booking application. That is
valuable breadth for `MTG-003`, but it does not supply `CAL-009`–`CAL-015` or a
Reclaim-style flexible meeting optimizer.

The historical issue about connecting multiple Google accounts was closed soon
after filing, but a February 2026 comment reported that the issue persisted.
That issue is evidence of uncertainty, not proof that every current Cal.diy
installation fails. Any proof of concept must test multiple independent Google
OAuth identities itself rather than rely on marketing or a closed issue state.

Adoption boundary:

- do not fork Cal.diy as Planipus;
- do not import its account, booking, or calendar data model into Calendar Sync;
- if post-P0 booking breadth becomes a priority, deploy an exact reviewed
  revision as a separate service behind a Planipus-owned `BookingProvider`
  boundary;
- verify the complete license tree, removed-feature boundaries, update path,
  Kubernetes footprint, OAuth scopes, rate limits, CSP, tenancy, recurrence,
  API stability, backup/restore, and security before selection;
- never represent current commercial Cal.com documentation as proof that a
  feature remains in Cal.diy.

Decision: **retain as a post-P0 booking candidate, not a core dependency**.

### Calnode

Primary source: <https://github.com/Calnode/calnode>.

Calnode is an Apache-2.0, lean Calendly-style service built as one Go binary
with SQLite. Its documented features include event types, working hours and
date overrides, fixed/round-robin/collective/priority team routing, Google and
Microsoft free/busy and write-back, CalDAV, public booking, cancellation and
rescheduling, REST APIs, HMAC webhooks, MCP, a booking chat option, transactional
double-booking protection, credential encryption, and optional Litestream
replication.

Its stated architecture has a useful conceptual similarity to Planipus: the
local database is authoritative and external calendars are retryable
projections. That general engineering idea is independently valid, but
Calnode's implementation and schema are not a substitute for Planipus's policy
and reconciliation contract.

Maturity concerns observed on the research date:

- approximately 11 GitHub stars and no formal releases;
- instance-per-tenant design;
- SQLite and in-process background work rather than Planipus Server's
  PostgreSQL outbox/worker model;
- no demonstrated privacy-filtered arbitrary event copying;
- no automatic focus/task scheduling or flexible recurring Smart Meetings;
- contributor license agreement and trademark files require review alongside
  the Apache license and create a future-relicensing governance consideration.

Adoption boundary:

- first lightweight post-P0 booking proof of concept if booking is authorized;
- prefer a separate service/API boundary over source merging;
- pin an exact revision and verify releases, signature/provenance, upgrade and
  migration behavior, restore, concurrency, security, OAuth token handling,
  calendar consistency, operational metrics, and load before depending on it;
- reuse of any Apache-licensed module still requires file-level ledger entries,
  notices, tests, and removal/upgrade plans.

Decision: **best lean permissive booking candidate, but too immature to adopt
now and unrelated to the P0 differentiator**.

### FluidCalendar

Primary sources:

- repository: <https://github.com/dotnetfactory/fluid-calendar>;
- current issue tracker: <https://github.com/dotnetfactory/fluid-calendar/issues>.

FluidCalendar is MIT-licensed and targets Motion-style task scheduling. It
documents automatic placement of tasks, Google Calendar integration, Outlook
setup, work-hour preferences, buffers, and smart slot selection.

The repository itself warns that the project is in active development, contains
many bugs and incomplete features, and is not recommended for production use.
Open issues observed during this audit included automatic scheduling in UTC
instead of the user's timezone, tasks placed between existing events, inability
to connect several Google accounts, and inability to add multiple CalDAV
providers. Those are directly material to Planipus's timezone and multi-account
correctness bar.

FluidCalendar schedules tasks into gaps. It does not implement directed,
privacy-transformed copies of arbitrary events, and its current documentation
does not establish Reclaim-equivalent Smart Meeting recurrence, attendee
fairness, deterministic preview/apply, or stale-plan protection.

Adoption boundary:

- do not use it as a production foundation or scheduler of record;
- its publicly documented behavior can inform independent test cases;
- before importing even an MIT module, identify the exact files/commit and
  authorship, inspect dependencies and generated content, record it in the reuse
  ledger, and first create Planipus-owned property/conformance tests;
- an algorithm with unresolved timezone or collision bugs must not cross the
  provider-write boundary.

Decision: **scheduler research and possible selective-module source, only after
a dedicated provenance/correctness audit**.

### Compass Calendar

Primary source: <https://github.com/SwitchbackTech/compass-calendar>.

Compass Calendar is MIT-licensed and documents two-way Google Calendar sync,
calendar/task views, keyboard-oriented interaction, and manual time blocking.
It is a plausible source of independently reviewed UI components or interaction
ideas. It does not document continuous optimization, privacy projection,
multi-account policy reconciliation, or Smart Meetings.

Decision: **post-P0 UI/component reference; no wholesale adoption**.

### General Task

Primary sources:

- repository: <https://github.com/GeneralTask/task-manager>;
- product site: <https://generaltask.com/>.

General Task's MIT repository and site describe aggregation from services such
as GitHub, Linear, Jira, and Slack, a focus mode, and dragging a task onto a
Google calendar to create an event. The repository had no formal releases on
the research date. Its setup documentation requires a Font Awesome Pro registry
token obtained from the original team, which prevents assuming that the MIT
repository produces a clean, fully open build without modification or
dependency replacement.

Decision: **ideas or isolated modules only after a clean-build, dependency, and
provenance audit; lower priority than Taskwarrior or Compass**.

### Taskwarrior

Primary sources:

- documentation and license statement: <https://taskwarrior.org/docs/>;
- recurrence: <https://taskwarrior.org/docs/recurrence/>;
- synchronization: <https://taskwarrior.org/docs/sync/>.

Taskwarrior is a mature MIT task system with recurrence, due/wait dates,
priorities/urgency, dependencies, user-defined attributes, JSON import/export,
hooks, and synchronization. Its “calendar” capability is a report, not a Google
Calendar writer or optimizer. It has no calendar projection policy or Smart
Meeting engine.

Decision: **good optional task-source adapter for `CAL-005`, not a scheduling
foundation**.

### Nextcloud Calendar, Deck, and Tasks

Primary sources:

- Calendar repository: <https://github.com/nextcloud/calendar>;
- Deck repository: <https://github.com/nextcloud/deck>;
- Tasks repository: <https://github.com/nextcloud/tasks>;
- stable Calendar user manual:
  <https://docs.nextcloud.com/server/stable/user_manual/en/groupware/calendar.html>.

The applications are in the AGPL-3.0 family. Together they offer a mature
CalDAV calendar and task ecosystem, recurring events, appointments, buffers,
daily booking limits, manual scheduling proposals, working hours, task due
dates, and Deck integration.

Their behavior does not replace Planipus:

- working hours contribute to availability/free-busy rather than creating
  privacy-filtered copies on independent Google identities;
- scheduling proposals are a human poll/selection flow, not continuous Smart
  Meeting optimization;
- external iCalendar subscriptions are read-only and their refresh is not a
  maintained two-way projection contract;
- free/busy and sharing behavior is centered on the Nextcloud environment;
- no official evidence found in this review established Google OAuth
  multi-identity directed projection with per-destination privacy policies.

Adoption boundary:

- no Nextcloud application source, schema, test, fixture, asset, dependency, or
  container may be incorporated or used as an implementation template under the
  current policy;
- Planipus may implement CalDAV/ICS from RFCs and test interoperability against
  an independently operated Nextcloud instance without shipping Nextcloud;
- such conformance tests must be Planipus-authored from standards and public
  protocol behavior, not copied from Nextcloud tests.

Decision: **external interoperability target only; no source reuse**.

### Easy!Appointments

Primary sources:

- repository and GPL-3.0 license:
  <https://github.com/alextselegidis/easyappointments>;
- application settings and working plans:
  <https://easyappointments.org/documentation/application-settings/>;
- Google Calendar synchronization description:
  <https://easyappointments.org/2021/03/08/syncing-appointments-with-google-calendar/>;
- REST API: <https://easyappointments.org/documentation/rest-api/>.

Easy!Appointments is a mature provider/service appointment scheduler. It
supports working plans, breaks, blocked periods, services/providers/customers,
Google Calendar appointment synchronization, and an API. Its domain is an
appointment business, not arbitrary personal-to-work event projection or
flexible Smart Meetings.

GPL-3.0 is not selected for Planipus. Incorporating GPL code into the shipped
Apache-2.0 project would require a licensing decision and obligations outside
the current policy. A separately operated unchanged service can be a different
legal/architecture analysis, but the feature mismatch offers no reason to add
that operational dependency.

Decision: **do not incorporate or compose into the Planipus distribution**.

### Rallly

Primary sources:

- repository and AGPL license: <https://github.com/lukevella/rallly>;
- self-hosting introduction:
  <https://support.rallly.co/self-hosting/introduction>;
- current self-host licensing documentation:
  <https://support.rallly.co/self-hosting/licensing>;
- schedule workflow: <https://support.rallly.co/workflow/schedule>.

Rallly is a polished manual scheduling-poll application: an organizer proposes
times, participants vote without necessarily creating accounts, a grid shows
responses, and the organizer finalizes a choice. It does not automatically
optimize around live calendars, maintain cross-account blocks, or relocate a
recurring Smart Meeting as availability changes.

Its repository is AGPL. Its current packaged self-host documentation also
describes license-key and user/seat tiers for multi-user deployments. Those
commercial packaging details can change and do not alter the no-source-reuse
decision.

Decision: **behavior reference for a future manual poll, no code reuse**.

### zcal

Primary sources:

- product and feature documentation: <https://zcal.co/> and
  <https://help.zcal.co/>;
- terms: <https://zcal.co/terms>.

zcal can connect work and personal calendars for availability conflict checks,
select a calendar for created bookings, store availability, expose booking
links, run meeting polls, and support collective/round-robin scheduling. Its
terms describe the site, source code, databases, functionality, and related
material as proprietary and restrict copying and reverse engineering. It is not
a self-hostable OSS adoption candidate. Conflict checking also is not arbitrary
event projection.

Decision: **public competitor behavior reference only**.

### Vikunja

Primary sources:

- repository and AGPL license: <https://github.com/go-vikunja/vikunja>;
- CalDAV status: <https://vikunja.io/help/caldav/>;
- dates and reminders: <https://vikunja.io/help/dates-and-reminders/>.

Vikunja is a capable self-hosted task manager with start/end/due dates,
recurrence, reminders, projects, and CalDAV VTODO support. Its documentation
describes CalDAV support as early and client-dependent. It does not supply a
VEVENT scheduling optimizer or calendar blocking projector, and the AGPL
license excludes source reuse under current policy.

Decision: **behavior reference only**.

## Newer self-hosted “Reclaim alternative” claims

The following projects were examined because newer products may be closer than
the established Calendly alternatives. Marketing breadth was not treated as
verified implementation behavior.

### DayOtter

Primary source: <https://github.com/Dayotter/dayotter>.

DayOtter is the closest feature-claim match found. Its README advertises booking
pages, Google/Microsoft/Apple-CalDAV/ICS sync, recurring meetings, group polls,
round-robin and collective availability, payments, focus auto-scheduling,
workflows, reminders, API/webhooks, an assistant, and mobile applications.

However:

- all product code outside `ee/` is AGPL-3.0 and `ee/` is separately licensed;
- the project calls itself pre-1.0 and evolving quickly;
- only a small early community footprint was visible on the research date;
- the claims do not prove Planipus's privacy projection semantics, deterministic
  conformance cases, or third-viewer disclosure behavior;
- an assistant that proposes or confirms actions is not evidence of a
  deterministic Reclaim-style recurring meeting optimizer.

Decision: **closest public feature-behavior reference, but no code, schema,
tests, assets, dependencies, containers, or implementation details may be
reused**.

### Cal.rs

Primary source: <https://cal.rs/>.

Cal.rs advertises a single Rust binary with SQLite, Google/Exchange/CalDAV
sources, delta synchronization, booking pages, group links, working/date
overrides, rescheduling, availability troubleshooting, security controls, and
more than 750 automated tests. It is AGPL-3.0. It remains primarily a booking
platform, not a privacy-filtered event projector or flexible optimizer.

Decision: **use public behavior as a comparison only; no source reuse**.

### Supercal

Primary source: <https://supercal.cc/about>.

Supercal's product site advertises AGPL self-hosting, calendar sync, meeting
polls, team scheduling, buffers, webhooks, and API access. This review did not
obtain sufficient primary repository/release evidence to verify the breadth,
license boundary, maintenance, or implementation. The advertised AGPL license
already makes it ineligible for source reuse under the current Planipus policy.

Decision: **do not adopt; retain only as an unverified market signal**.

### GudCal

Primary sources:

- repository: <https://github.com/gudlab/gudcal-core>;
- actual license file:
  <https://github.com/gudlab/gudcal-core/blob/main/LICENSE.md>.

GudCal's site/repository language calls it open-source scheduling
infrastructure and advertises event types, availability, Google sync, teams,
REST, webhooks, and MCP. The actual repository license is Business Source
License 1.1. It restricts competing hosted scheduling use and changes to
Apache-2.0 on 2030-02-18. It is therefore source-available, not presently an
OSI-approved open-source foundation. The repository also had only a few commits
and no meaningful maturity evidence on the research date.

Decision: **do not adopt or describe as currently open source**.

## Keeper prohibition and clean-room boundary

Binding sources:

- Planipus clean-room policy: [CLEAN-ROOM-POLICY.md](../CLEAN-ROOM-POLICY.md);
- quarantined historical evidence:
  [2026-07-20-keeper-audit.md](./2026-07-20-keeper-audit.md);
- upstream repository, for identification only:
  <https://github.com/ridafkih/keeper.sh>.

Keeper is AGPL-3.0-only. Earlier historical research included a source-level
audit, but its tentative adoption conclusion was expressly voided. Keeper is
not an implementation donor, build tool, conformance oracle, dependency, or
runtime service.

Forbidden Keeper material includes:

- source, copied/ported/retyped implementation, generated output, patches, Git
  history, submodules, packages, binaries, containers, sidecars, or services;
- tests, fixtures, snapshots, sample data, schemas, migrations, APIs, table or
  column layouts, and identifiers copied or adapted from source;
- UI text, assets, CSS, icons, translations, documentation, screenshots used as
  an implementation template, and product-specific expression;
- dependency choices, lockfiles, build scripts, CI, Docker/Kubernetes files, or
  architecture selected merely because Keeper used them;
- superficial rewrites or renames of any uncertain-provenance Keeper material.

Permitted use is limited to independently worded behavior ideas and questions,
for example:

- a calendar bridge needs stable knowledge of which destination copy belongs to
  which source and policy;
- users may connect multiple provider identities;
- source changes, deletion, recurrence, and destination drift require explicit
  outcomes;
- a self-hosted calendar bridge needs observable retry and recovery behavior.

Those ideas must be implemented from Planipus requirements, official provider
documentation, RFCs, Apple documentation, and independently reviewed compatible
components. New contributors do not need—and should not be directed—to read
Keeper source.

This audit applied the same conservative no-source-reuse boundary to AGPL
candidate applications. It did not inspect or copy their implementation
modules. Repository README, license, issue, and public behavior evidence was
used only to decide whether further adoption work was justified.

## Capability conclusions

### Work-hours and after-hours calendar blocking

No evaluated project satisfies this requirement. Booking tools use working
hours to decide which slots to offer. Nextcloud exposes working hours through
availability. Task schedulers use working hours to place tasks. Planipus must
instead decide whether each existing source event overlaps or is contained in a
named timezone-aware profile, then maintain a privacy-controlled event on a
different identity's calendar.

Required original Planipus behavior includes:

- source, destination, and policy identity;
- weekly IANA-timezone hours plus local-date exceptions;
- `all_times`, `overlaps_profile`, and `contained_in_profile` semantics;
- overnight, DST gap/fold, cross-timezone, boundary, multi-day, and recurrence
  behavior;
- independent per-destination privacy and selection settings;
- preview of creates, updates, and deletions after policy changes;
- durable provenance, idempotency, tombstones, cursor recovery, reciprocal-loop
  prevention, and safe destination drift handling;
- explicit no-invitation/no-reminder provider payloads;
- ordinary third-viewer evidence for each privacy preset.

Decision: **continue the original P0 implementation and language-neutral
conformance suite**.

### Smart Meetings

No permissively licensed candidate was found that is sufficiently mature and
demonstrably meets `MTG-001`–`MTG-002`. Booking recurrence is not the same as a
meeting series whose instances can move automatically while respecting attendee
windows, priority, cadence, provider recurrence, declined responses, and stale
preview safety.

Decision: **build an original Planipus solver only after Calendar Sync P0 is
reliable**. FluidCalendar may be evaluated for small MIT modules or test ideas,
but cannot be the scheduler of record without a separate ADR, provenance audit,
property tests, timezone/collision remediation, and deterministic preview/apply
contract.

### Booking pages

Cal.diy is the broadest permissively licensed codebase, while Calnode is the
leanest and architecturally easiest to isolate. Neither should be added during
P0. Adding a large booking application now would increase OAuth, tenancy,
database, Kubernetes, UI, migration, security, and maintenance scope without
advancing `CAL-009`–`CAL-015`.

Decision: **defer implementation; preserve a future provider boundary**.

### Tasks and manual time blocking

Taskwarrior is the clearest permissive external task-source candidate. Compass
offers relevant manual blocking UI patterns. General Task has attractive
integration ideas but a problematic proprietary build dependency and weak
release evidence. Vikunja has broader task functionality but is AGPL and does
not solve scheduling.

Decision: **future adapters, never a task product embedded in P0**.

## Recommended future proof-of-concept sequence

These are gated experiments, not current todos and not authorization to dilute
P0. Start them only after the P0 live Google/privacy/recovery gates are met or a
new decision explicitly changes priority.

### Booking experiment A — Calnode

1. Re-pin an exact tagged release; if none exists, do not progress beyond a
   disposable evaluation.
2. Verify Apache-2.0 at that commit, complete dependency licenses, CLA effects,
   notices, trademarks, image provenance, SBOM, and vulnerability state.
3. Run it as a separate service with synthetic/disposable calendars.
4. Test multiple OAuth identities, Google/Microsoft/CalDAV behavior, recurrence,
   cancellation/rescheduling, conflict races, retry ambiguity, timezones, token
   encryption/rotation, backup/restore, and upgrades.
5. Measure CPU, memory, startup, storage, concurrency, and Kubernetes health.
6. Prototype only a Planipus-owned, versioned booking API boundary. Do not share
   Planipus policy tables or provider credentials.
7. Record whether the operational dependency is smaller than implementing
   `MTG-003` directly.

### Booking experiment B — Cal.diy

1. Pin the community repository, not commercial Cal.com documentation.
2. Verify that every required booking feature actually remains in Cal.diy.
3. Prove a reproducible build with no private registry, commercial module,
   license key, phone-home dependency, or unreviewed service requirement.
4. Test multiple independent Google identities, calendar conflict selection,
   destination calendar choice, recurrence, cancellation, rescheduling, embeds,
   rate limiting, CSP, tenancy, backup/restore, and upgrades.
5. Measure the full PostgreSQL/Node operational footprint and security surface.
6. Compare separate-service composition against Calnode and original
   implementation. Do not merge its user/account/schema model into Planipus.

### Scheduler experiment — FluidCalendar

1. Write Planipus solver acceptance/property tests first from
   `SCH-001`–`SCH-010` and `MTG-001`–`MTG-002`.
2. Pin and inventory only the candidate algorithm files; exclude UI, auth,
   provider, database, and unrelated application code.
3. Establish file authorship/license/provenance and every dependency.
4. Reproduce known timezone and collision failures.
5. Compare the algorithm with an original minimal Planipus baseline on fixed
   synthetic cases.
6. Import nothing unless the module is materially better, removable, covered by
   Planipus tests, and recorded in `REUSE-MAP.md`.

### Task adapter experiment — Taskwarrior

1. Use the documented JSON/hooks interface rather than embedding Taskwarrior.
2. Define an explicit field/conflict mapping under `CAL-005`.
3. Keep tasks external and Planipus placements/projections independently
   identifiable.
4. Prove recurrence, completion, deletion, timezone, malformed input, and
   offline behavior with synthetic fixtures.

## Adoption gate for any third-party code or service

Before import, vendoring, image inclusion, or required runtime composition:

1. Create an ADR describing the user value, exact boundary, alternatives, data
   flow, failure behavior, removal path, and why a library/service is preferable
   to original code.
2. Pin an immutable commit/tag and artifact digest. Do not depend on `latest`.
3. Verify SPDX license from the exact files, all transitive licenses, patent and
   trademark terms, contributor agreement, notices, and source availability.
4. Record project, repository, commit, files/modules, purpose, modifications,
   license, obligations, data access, egress, security review, tests, upgrade
   plan, and removal plan in `REUSE-MAP.md`.
5. Build from a clean environment without private registries, hidden credentials,
   commercial packages, phone-home activation, or required telemetry.
6. Generate an SBOM and run current vulnerability, secret, provenance, and
   license-policy scans.
7. Write Planipus-owned requirements and tests before importing implementation.
8. Confirm that provider credentials, private calendar data, audit data, and
   deletion/export obligations remain within documented boundaries.
9. Prefer a narrow protocol/API boundary for a large application. Do not share
   databases or copy its schema into Planipus.
10. Test upgrade, rollback, backup/restore, provider ambiguity, rate limits,
    network partition, and dependency disappearance.
11. Add required license and attribution text to the release notice bundle.
12. Obtain qualified legal review before public release where license or
    separability is uncertain.

Automatic rejection under the present policy:

- Keeper material in any form;
- AGPL application/library code or artifacts incorporated into Planipus;
- GPL code that would change Planipus's selected distribution obligations;
- BSL/source-available code represented or treated as OSI open source;
- proprietary code, copied UI/assets/text, reverse engineering, or a build that
  needs unavailable commercial packages;
- unpinned images, undocumented generated code, unknown provenance, or a
  dependency selected because an excluded donor used it.

## Decision log

### OSS-AUDIT-001 — Do not replace the Calendar Sync core

Decision: keep `CAL-009`–`CAL-015` as original Planipus implementation.

Reason: no eligible project implements the multi-identity, work-hours,
per-policy privacy, provenance, and convergence contract. Adopting a booking or
task application would add surface area without removing the highest-risk work.

### OSS-AUDIT-002 — Defer booking composition

Decision: do not add Cal.diy or Calnode to P0. Revisit Calnode first and Cal.diy
second after live Calendar Sync gates.

Reason: booking is P2 and introduces substantial independent auth, data,
security, persistence, and operational scope.

### OSS-AUDIT-003 — Permit only gated permissive reuse

Decision: MIT and Apache-2.0 candidates may be investigated but are not approved
until exact-version provenance, dependency, security, test, and notice gates
pass.

Reason: permissive top-level licensing does not prove a clean, compatible,
maintained, or secure artifact.

### OSS-AUDIT-004 — Enforce the Keeper and copyleft boundary

Decision: Keeper remains ideas/behavior questions only. AGPL candidate code is
also excluded from implementation under the binding policy. GPL, BSL, and
proprietary application code are not selected.

Reason: Planipus selected Apache-2.0 and `OPS-006` requires reviewed compatible
third-party obligations with no excluded donor material.

### OSS-AUDIT-005 — Re-evaluate, do not assume

Decision: repeat the license/maturity/feature check immediately before every
proof of concept or adoption.

Reason: Cal.com's April 2026 change demonstrates that repository names,
features, and license boundaries can change materially and quickly.

## Research limitations and confidence

High-confidence findings:

- top-level licenses/statuses taken from the named repositories/license files;
- the Cal.com-to-Cal.diy April 2026 distribution change;
- explicit Cal.diy removal/warning statements;
- stated AGPL/GPL/BSL/proprietary boundaries;
- the basic distinction between booking/poll/task behavior and Planipus P0;
- Keeper's binding exclusion, as already recorded inside Planipus.

Medium-confidence findings:

- feature breadth stated in project READMEs and official documentation;
- repository maturity indicators and issue status as observed on the date;
- whether a public feature works in all deployment/provider combinations.

Not established by this audit:

- production correctness, performance, security, accessibility, or support;
- complete transitive-license compatibility;
- reproducible builds or image provenance;
- real multi-account behavior for any candidate;
- legal conclusions about derivative works or process separation;
- whether a marketing claim has a complete, tested implementation;
- future maintenance, relicensing, or feature availability.

No evaluated candidate was cloned, built, or imported for this audit. No
candidate implementation code, test, fixture, schema, asset, dependency graph,
container, or generated artifact was added to Planipus. The only project file
created by this task is this evidence record.
