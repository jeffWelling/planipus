# Market research: cross-account calendar sync and adjacent scheduling

Research date: 2026-07-20. Sources are first-party product/help pages unless
explicitly labelled community evidence. Features change quickly; dates and
links are preserved so this can be revalidated.

## Executive finding

The clarified product is not the union of every intelligent-planning category.
Its P0 is the Calendar Sync slice: maintain policy-controlled event copies
between independent accounts so the destination exposes true availability
without leaking source details. Reclaim is the behavioral benchmark. Keeper.sh
is historical research only and is excluded from implementation under the
clean-room policy.

The broader market still splits into four categories:

1. **Calendar-defense optimizers** — Reclaim and Clockwise protect focus,
   routines, and meeting quality around an existing calendar.
2. **Automatic work planners** — Motion, SkedPal, FlowSavvy, Trevor AI, and
   TimeHero place tasks against deadlines and capacity.
3. **Intentional daily planners** — Sunsama, Akiflow, and Morgen emphasize
   inbox consolidation, daily rituals, timeboxing, and focus execution.
4. **Booking infrastructure** — Reclaim links and Cal.com handle public
   availability, group/round-robin routing, questions, limits, and reminders.

No researched project combines all four unchanged, but that is no longer the
foundation criterion. The historical Keeper audit demonstrated that the product
domain includes integration/reconciliation complexity, but it is not a reusable
implementation. Fluxure and other evaluated projects likewise remain
research/reference material unless a future independent license/provenance
decision explicitly approves a compatible integration. See
`CLEAN-ROOM-POLICY.md`, `ADOPT-OR-BUILD.md`, `CALENDAR-SYNC.md`, and
`evidence/2026-07-20-keeper-audit.md`.

## Reclaim.ai deep dive

Reclaim's current product is an orchestration layer over Google or Outlook,
rather than a replacement calendar. Reclaim 2.0 combines a calendar, planner,
assistant, preview mode, and background agents. Its source of truth remains the
provider calendar. See the [2.0 overview](https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview),
[2.0 FAQ](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq), and
[feature index](https://help.reclaim.ai/en/).

### Scheduling model

- **Universal priority:** P1–P4 applies to Reclaim-created and ordinary provider
  events. Higher priorities may displace lower flexible items; ordinary events
  are never displaced unless a user explicitly lowers their priority. Reclaim
  documents tie ordering across meeting, habit, and task types in its
  [priority model](https://help.reclaim.ai/en/articles/8291694-how-reclaim-uses-priorities-to-intelligently-plan-your-workweek).
- **Tasks:** duration, due date, earliest start, priority, target hours/calendar,
  automatic placement, rescheduling, sorting by scheduling order, and two-way
  imports from project tools. See the [task overview](https://help.reclaim.ai/en/articles/5108936-tasks-overview-protect-time-for-task-work-before-deadlines).
- **Habits:** flexible recurring routines with minimum/maximum duration,
  scheduling windows, ideal time, rich frequency, dependencies, and a free-to-
  busy defense transition as options disappear. Reclaim ships more than 100
  templates. See [habits](https://help.reclaim.ai/en/articles/4129152-habits-overview-auto-schedule-flexible-time-for-your-routines)
  and [time defense](https://help.reclaim.ai/en/articles/4129290-time-defense-settings-for-habits).
- **Focus:** proactive or reactive weekly goals, daily targets, minimum/maximum
  block sizes, automatic accounting for qualifying tasks/habits, and progressive
  defense against meetings. See [Focus Time](https://help.reclaim.ai/en/articles/6332766-focus-time-overview-defend-time-for-productive-work).
- **Smart Meetings:** recurring meetings are placed around mutual availability,
  preferences, priorities, and time zones; they automatically move on conflicts
  or declined RSVPs. Frequency, ideal day/time, flexible duration, dependencies,
  optional attendees, and cadence preservation are explicit. See
  [Smart Meetings](https://help.reclaim.ai/en/articles/5604990-smart-meetings-overview-automatically-schedule-your-recurring-meetings).
- **Buffers:** travel holds, flight heuristics, post-meeting decompression, and
  breaks between task/habit blocks. See the [buffer overview](https://help.reclaim.ai/en/articles/4281992-buffer-time-overview-travel-decompression-and-tasks-habit-breaks).

### Meetings and coordination

- **Scheduling Links:** one-to-one and group availability, multiple durations,
  custom slugs/groups, configurable target calendar, rolling/fixed horizons,
  P1–P4 availability, per-day/week caps, multiple locations, travel/buffer
  awareness, screening questions, and reminders. See
  [link configuration](https://help.reclaim.ai/en/articles/6666663-creating-and-customizing-scheduling-links).
- **Round robin:** availability pooling, load-sensitive host selection, preferred
  organizers, and shared priority. See [round robin](https://help.reclaim.ai/en/articles/9436383-creating-and-managing-round-robin-links).
- **Team functions:** shared availability, team links, team OOO calendar,
  delegated access, no-meeting days, team focus policies, and privacy-preserving
  aggregate analytics. Team analytics exposes up to 12 weeks/90 days of meeting,
  focus, work-life, and future capacity data; see
  [team stats](https://help.reclaim.ai/en/articles/8215812-team-stats-overview).

### Calendar and integration layer

- Full provider support is Google Calendar and Microsoft Outlook. iCloud and
  other shared calendars must pass through one of those providers; see
  [supported calendars](https://help.reclaim.ai/en/articles/5202336-how-to-use-reclaim-with-your-existing-calendars).
- Calendar Sync creates privacy-controlled copies of source events in another
  calendar so coworkers see true busy state without sensitive details. See
  [Calendar Sync](https://help.reclaim.ai/en/articles/3600762-calendar-sync-overview-keep-multiple-schedules-in-sync).
- Task/collaboration integrations documented for Slack, Zoom, Google Tasks,
  Todoist, Asana, ClickUp, Jira, Linear, and Notion, with Teams still emerging in
  current Outlook documentation. Reclaim 2.0 also exposes MCP and a ChatGPT app.
- Natural-language changes and MCP actions are staged in Preview Mode before
  provider writes. This is an important trust pattern, not cosmetic UI.

### Calendar Sync policy deep dive

Reclaim distinguishes **Connected Calendars** from **Calendar Sync**. Connected
calendars inform Reclaim's own scheduling availability. Calendar Sync creates a
real destination-calendar event visible to coworkers and booking systems. That
distinction is the core Planipus requirement.

A Reclaim sync policy is one directed source account/calendar → destination
account/calendar. The user creates a second policy for the reverse direction.
The copy stays current when the source changes and has independent policy for:

- category/type (Personal, Business, Travel) and color;
- visibility: generic Personal/Work/Travel commitment, Busy only, full details
  private to the user, or full details under destination access rules;
- whether to sync outside configured Working Hours;
- all-day events: skip, busy-only, or all;
- exclusions via `#nosync`;
- RSVP: Yes/Maybe busy, No removed, unanswered free by default or configurable
  busy;
- source free events and email-created travel/reservations; and
- duplicate avoidance if the destination identity is already invited.

This behavior is documented across the
[policy guide](https://help.reclaim.ai/en/articles/6326844-creating-and-customizing-your-calendar-sync-policies),
[event-type guide](https://help.reclaim.ai/en/articles/3639967-how-calendar-sync-syncs-different-kinds-of-events),
[RSVP guide](https://help.reclaim.ai/en/articles/3639943-how-rsvp-affects-calendar-sync-events-and-how-to-manage-it),
[hours guide](https://help.reclaim.ai/en/articles/3600766-set-your-working-meeting-personal-custom-hours),
and [sharing comparison](https://help.reclaim.ai/en/articles/3713192-how-is-calendar-sync-different-from-sharing-my-calendar-with-someone).

The desired personal→work scenario maps precisely to one policy: source personal
calendar, destination employer calendar, Working Hours only, and a selected
privacy preset. `CALENDAR-SYNC.md` makes edge cases and acceptance behavior
explicit where Reclaim documentation leaves implementation details unstated.

### Commercial shape and weaknesses to exploit

The current [pricing page](https://reclaim.ai/pricing) describes a free
individual Lite tier, a $12/seat/month Starter tier, Business/Enterprise
capabilities, per-seat agent limits, and additional attendee-user accounting.
Commercial packaging is increasingly team/agent oriented.

Planipus should not copy product language or UI. It should compete on gaps:

- first-class CalDAV/iCloud/Fastmail/Nextcloud rather than provider detours;
- sovereign deployment, offline deterministic planning, and no mandatory model;
- a public explanation for every placement and displacement;
- reversible plans and append-only audit as core domain objects;
- open API/webhooks and provider-neutral import/export;
- policy-as-code and GitOps-friendly administration;
- no artificial seat, agent, calendar, integration, or attendee limits; and
- user-visible privacy transformations for every mirrored event.

## Direct calendar-bridge competitors

These products compete with the clarified P0 much more directly than automatic
task planners do.

### CalendarBridge

CalendarBridge models a sync as a directed source→destination pair and keeps a
read-only-style placeholder current as the source is created, edited, or
cancelled. It avoids copying its own copies. Google and Microsoft changes are
advertised within roughly one or two minutes; iCloud/ICS are polled every 5–10
minutes. See [About Syncing](https://help.calendarbridge.com/user-docs/about-syncing/).

Its 2026 management flow supports one-way pairs and fully meshed groups. Privacy
is per pair: Busy only, title, or selected subject/description/location/
conference/attendee/reminder fields, optional Private visibility, title tag, and
color. Advanced filters cover free, tentative, unanswered, source color, days,
and a daily time range. It provides status, reauthorization, and manual resync.
See [Manage Syncs](https://help.calendarbridge.com/help/manage-syncs.html).

Useful benchmark details:

- event copies are not intended to edit the source;
- per-direction policy can reveal different fields;
- the wizard shows source, destination, fields, color, and resulting title;
- group setup expands to individual ordered pairs; and
- deletion currently leaves prior copies unless the user cleans them manually,
  an area where Planipus should provide safer previewed cleanup.

### OneCal

OneCal supports Google, Outlook, and iCloud; a one-way source can feed one or
many destinations, while multi-way configuration builds a group. It can copy or
replace title, copy description/location/conference data, put participants in
the description to avoid invitations, mark clones Private, disable reminders,
tag/color clones, filter by RSVP/color, and include free events. Its docs call
sync real-time. See [Understanding Calendar Sync](https://docs.onecal.io/docs/calendar-sync/calendar-sync-intro)
and [How it works](https://www.onecal.io/how-it-works).

OneCal is the clearest commercial benchmark for multiple destinations and
field-level transforms. Its public docs do not show the named timezone-aware
working-hours and exception model required here. It also correctly warns that a
Workspace administrator may still see copied detail, so `Private` must not be
marketed as end-to-end confidentiality.

### SyncBusy

SyncBusy is the narrowest direct competitor and closely matches the personal→work
story: personal Google or iCloud is read, private busy blocks are written to a
Google work calendar, free and declined events are skipped, source changes clean
up copies, and Google uses push while iCloud polls. It also offers selected sync
days, scheduled pause windows, custom owner-visible names, and a reverse accepted-
work-events flow. See [SyncBusy](https://syncbusy.dev/).

Its privacy posture is intentionally fixed: coworkers always see Busy; source
title/description/location/attendees are not written to work. That is an
excellent safe default but does not cover Reclaim's generic/private-full/shared-
full policy range, multiple simultaneous account routes, or hourly work windows.

### SyncGene

[SyncGene](https://www.syncgene.com/) is a broader closed service for two-way
calendar, contact, and task synchronization across Google, iCloud, Outlook,
Office 365, and Exchange. Its emphasis is replicated editable information across
services/devices, not destination-specific availability placeholders and privacy
transforms. It validates provider demand but is a weak behavioral foundation for
the no-leak source→destination use case.

### Keeper.sh — excluded historical research

[Keeper.sh](https://github.com/ridafkih/keeper.sh) was the closest behavioral
match observed among inspected open-source projects: multiple accounts/providers,
directed mappings, event normalization, durable copy mappings, reconciliation,
recurrence/timezone handling, workers, UI/API, and self-host packaging. It was
briefly—but now voidedly—considered for a full-history fork. Keeper is AGPL and
excluded from all implementation reuse; only independently summarized behavior
observations in this research may inform Planipus. Its observed gaps included
hours, per-pair privacy placement, visibility/reminder semantics, and selection
rules.

### Direct capability matrix

`✓` means documented or source-audited; `partial` means narrower behavior; `—`
means not found in the reviewed material. Commercial claims still need live
verification before being treated as conformance evidence. Planipus marks are
specified P0 target behavior, not release evidence; see `STATE.md`.

| Capability | Reclaim | CalendarBridge | OneCal | SyncBusy | Keeper OSS | Planipus P0 target |
|---|---:|---:|---:|---:|---:|---:|
| Real destination copies | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| One-way directed policy | ✓ | ✓ | ✓ | fixed primary flow | ✓ | ✓ |
| Multiple destinations / pair policy | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Loop prevention | ✓ | ✓ | ✓ | limited topology | mapping markers | graph + marker + mapping |
| Busy/no details | ✓ | ✓ | ✓ | ✓ fixed | partial | ✓ |
| Generic commitment/type | ✓ | custom title | custom title | — | custom title | ✓ |
| Private full details | ✓ | selected fields + Private | selected fields + Private | — | partial | ✓ |
| Shared selected/full details | ✓ | ✓ | ✓ | — | partial | ✓ |
| Named hours + timezone + exceptions | working-hours policy | daily range + days | — reviewed docs | days only | — | ✓ |
| RSVP selection | ✓ | partial | ✓ | accepted reverse; decline skip | incomplete policy | ✓ |
| All-day/free filters | ✓ | free filter | free filter | free skip | partial | ✓ |
| No-reminder mode | ✓ | configurable | ✓ | implicit minimal copy | not explicit | mandatory P0 |
| `#nosync` event override | ✓ | — | — | — | — | ✓ |
| Google/Outlook/iCloud | G/O; no native iCloud | G/O/iCloud | G/O/iCloud | G+iCloud source; G target | G/O/CalDAV/ICS | G first; O/CalDAV next |
| Self-host/open source | — | — | — | — | AGPL | Apache-2.0 (release review pending) |

### Competitive decision

Planipus should not attempt to beat direct competitors with a larger planner.
It should combine Reclaim's policy semantics, CalendarBridge/OneCal's clear
per-direction field controls, SyncBusy's safety defaults, and independently
specified behaviors observed in historical Keeper research. Implementation is
original Planipus code composed with approved compatible OSS components—never
Keeper implementation material. Planipus then differentiates with self-hosting,
auditable reason codes, previewed cleanup, per-policy hours exceptions,
encrypted credentials, and no artificial route/account limits.

## Broader planning competitors — deferred research

### Motion

Motion is the broadest all-in-one competitor: automatic task planning plus
projects, docs/wiki, AI chat/notetaker, dashboards, booking, and mobile/desktop
apps. Its scheduler uses availability, duration, chunks, hard/soft deadlines,
priority, start dates, recurrence, and custom schedules, then continuously
reflows on change ([auto-scheduling](https://www.usemotion.com/help/time-management/auto-scheduling)).
It directly connects Google, Outlook, and iCloud
([calendar reference](https://www.usemotion.com/help/time-management/all-things-calendars/reference-all-things-calendars)).
Business features include workload/capacity, time tracking, Gantt/timelines,
permissions, and dashboards ([pricing](https://www.usemotion.com/pricing)).
Booking pages support availability schedules, buffers, questions, daily caps,
and booking horizons ([booking links](https://www.usemotion.com/help/time-management/booking-links)).

**Planipus implication:** support split work, project dependencies, capacity and
portfolio forecasts—not merely a list of independently scheduled tasks.

### Clockwise

Clockwise optimizes team calendars for contiguous focus. Its distinctive surface
is opt-in Flexible Meetings, which move recurring internal meetings to resolve
conflicts and consolidate focus. It also provides Focus goals, lunch/flexible
holds, travel, personal calendar sync, automatic color, meeting breaks, team
availability, team no-meeting days, OOO, Slack, links, and team analytics. See the
[feature overview](https://support.getclockwise.com/article/66-feature-overview-and-ideal-set-up)
and [Flexible Meetings](https://support.getclockwise.com/article/184-flexible-meetings).

**Planipus implication:** optimization must consider the benefit/cost to every
attendee, not greedily improve the organizer's day.

### FlowSavvy

FlowSavvy is a focused individual planner. It auto-schedules and recalculates
tasks using priorities, deadlines, dependencies, customizable scheduling hours,
recurrence, and manual locks; it connects Google, Outlook, and iCloud and offers
full web/iOS/Android clients ([product page](https://flowsavvy.app/)). It avoids
blocking external availability until deadline pressure warrants it.

**Planipus implication:** automatic defense should be progressive, and the
individual experience must remain comprehensible even when team features exist.

### SkedPal

SkedPal combines a hierarchical Outline, flexible time maps, a priority board,
automatic rescheduling, and a live status tracker. Users express constraints in
terms closer to an assistant—finish a project by a date within preferred times—
than fixed calendar blocks. See [how it works](https://www.skedpal.com/how-it-works).

**Planipus implication:** reusable availability/energy maps and an outline are
power-user essentials.

### Sunsama

Sunsama's moat is a guided, humane daily operating rhythm rather than maximum
automation: daily planning, realistic workload, timeboxing, weekly objectives
and reviews, unified email/task/calendar imports, bidirectional sync, focus mode,
timers/Pomodoro, Slack/Teams focus status, actual-vs-planned time, and analytics.
See the [product overview](https://www.sunsama.com/),
[focus mode](https://www.sunsama.com/features/focus-mode), and
[AI estimates](https://www.sunsama.com/features/ai). It integrates Google,
Outlook, iCloud and a broad task/email set. Current pricing is $17 monthly on an
annual plan or $22 month-to-month ([pricing](https://sunsama.com/pricing)).

**Planipus implication:** add deliberate morning/weekly review flows, focus
execution, and end-of-day shutdown. Optimization alone does not create trust.

### Akiflow

Akiflow consolidates tasks from more than 3,000 tools into a Universal Inbox,
then offers calendar timeblocking, projects/folders/tags, priorities, goals,
recurrence, subtasks, task history, recurring slots, booking availability,
notifications, daily/weekly rituals, focus mode/timer, command bar, mobile, and
the Aki assistant/workflows. See [features](https://akiflow.com/features),
[rituals](https://akiflow.com/features/rituals), and
[Aki](https://product.akiflow.com/help/articles/5330825-what-can-aki-do).
Its optimizer is intentionally user-triggered and currently limited to same-day
reflow; it does not move fixed events or split long work across days
([optimizer](https://product.akiflow.com/en/help/articles/3161671-schedule-optimizer)).

**Planipus implication:** a universal capture inbox and keyboard-first command
surface are table stakes, but cross-day optimization is a valuable distinction.

### Morgen

Morgen unifies Google, Microsoft 365, iCloud, Fastmail, Zoho, CalDAV, and feeds;
integrates task systems; provides daily/weekly planning, Frames/routines,
timeblocking, scheduling links, and an approval-first AI planner across desktop,
mobile, and web. Its [official AI summary](https://www.morgen.so/for-ai) lists
eight task integrations and 248,000+ users; its
[developer documentation](https://docs.morgen.so/integrations) confirms provider
and conferencing support.

**Planipus implication:** CalDAV and Linux are not niche checkboxes; they are
central to a credible self-hosted story.

### Trevor AI

Trevor emphasizes a task hub plus drag/drop or suggested timeblocking, list-
specific scheduling windows/calendars, AI duration prediction, Plan My Day,
focus mode with timer/notes/task breakdown, and chat-based bulk planning. It
supports Google and Microsoft calendars and tasks from Todoist, Google Tasks,
and Microsoft To Do. See [product](https://www.trevorai.com/) and
[Todoist integration](https://www.trevorai.com/integrations/todoist).

**Planipus implication:** the assistant should manipulate typed domain commands
and previews rather than bypass scheduling rules.

### TimeHero

TimeHero is a team work-management competitor: adaptive task/project planning,
recurring tasks within flexible periods, templates with task/event dependencies,
automatic risk detection, future forecasting, workload/capacity, assignments,
guests, task chat, and time tracking. See [features](https://www.timehero.com/features).

**Planipus implication:** scheduling quality must be measurable as delivery risk
and team capacity, not only calendar aesthetics.

### Cal.com / Cal.diy

Cal.com is the booking benchmark and an important reuse/integration candidate.
It supports individual/team event types, multiple durations and locations,
recurring/instant/seated bookings, routing forms, ownership and round robin,
booking fields, limits, buffers, workflows across email/SMS/WhatsApp, payments,
API/SDK/embed, and analytics. See [event types](https://cal.com/help/event-types/event-types),
[booking API](https://cal.com/docs/api-reference/v2/bookings/create-a-booking),
and [routing](https://cal.com/routing/routing-for-saas). Cal.com announced the
MIT self-hosted Cal.diy distribution in April 2026
([license change](https://cal.com/blog/calcom-v6-4)).

**Project implication:** if booking is later added, reuse an open-source booking
system or interoperate through an adapter; do not make booking part of the
calendar-sync foundation.

## Open-source landscape

### FluidCalendar

[FluidCalendar](https://github.com/dotnetfactory/fluid-calendar) is an active MIT
Next.js/PostgreSQL project and the closest open-source Motion alternative. It
implements automatic task scheduling with priority, deadline, work hours,
buffers, energy mapping, project grouping, focus mode, Google/Outlook/CalDAV,
and task providers. Its README explicitly warns that it is buggy and not yet
recommended for production. Public issues in July 2026 include timezone,
multi-account CalDAV, sync, and packaging failures. Early maintainer discussion
also scoped team collaboration out.

Source inspection also found ordinary-string OAuth token/client-secret fields in
the audited Prisma schema, a direct task scheduling mutation model rather than an
immutable plan aggregate, and insufficient scheduler tests for the target risk.
It remains an MIT provider/fixture/UI donor, but is not the selected foundation.

### Fluxure

[Fluxure](https://github.com/FluxureCalendar/Fluxure) is an AGPL TypeScript/Svelte
monorepo with a static web client, Express API, Drizzle/PostgreSQL, optional
Redis/BullMQ, shared domain package, and pure scheduling engine. It implements
habits, chunked/deadline tasks, focus rules, buffers, templates, schedule actions,
quality scoring, quick add/search/activity/analytics, Google Calendar incremental
sync/watch/CRUD, scheduling links, booking validation/conflict handling, and
AES-256-GCM credential encryption. Its self-host mode avoids requiring Stripe.

The pinned v1.0.86 clean checkout installed and built successfully; all 1,037
tests passed when timezone and test sockets were configured. The pure engine
alone passed 201 tests and returns minimal create/update/delete operations.

Gaps remain substantial: Google-only providers; no organization/team routing,
CalDAV, Graph, OIDC, privacy mirror, or round robin; smart meetings are disabled
even in Pro and omit invitation/conference semantics; current billing/plan gates
must be removed; and the production audit found one high and one moderate
patched advisory. Those were explicit fork work under the earlier broad-planner
interpretation. The foundation decision is now superseded. Fluxure and Keeper
remain historical research only; neither is an implementation donor. See
`CLEAN-ROOM-POLICY.md` and `ADOPT-OR-BUILD.md`.

### Cal.rs

[Cal.rs](https://cal.rs/) is an AGPL Rust single-binary/SQLite scheduling and
booking system with CalDAV, Google OAuth2/CalDAV and Exchange EWS code, encrypted
credentials, OIDC, teams, round robin, collective availability, booking holds and
lifecycle, buffers, limits, workflows/notifications, CLI, localization, non-root
container, hundreds of commits, releases, and a large test suite.

It has no automatic task/habit/focus planner, Microsoft Graph, privacy mirror, or
immutable plan/apply domain. Its main web module is also very large. The pinned
documentation disagrees with source/current website in places about
Google/Exchange support, so capability claims still require conformance tests.
It is a possible behavioral reference or separately operated interoperability
target only, not an implementation donor, selected running foundation, or
current fallback under the present license strategy.

### Other adjacent projects

- [Plandera](https://plandera.com/) combines an encrypted self-hosted calendar
  and todo list with smart scheduling.
- Nextcloud Calendar, Tasks.org, Vikunja, and similar systems are valuable open
  sources/sinks but do not currently match the cross-account projection
  target.

## Broader planner capability matrix — historical scope research

Legend: **●** strong/current first-party support; **◐** partial or narrower
support; **—** not a documented product focus. This is directional, not a
procurement substitute.

| Product | Auto task plan | Habits / focus defense | Flexible team meetings | Booking / routing | Daily ritual / focus execution | Projects / capacity | AI + approval | G/O/iCloud/CalDAV | Self-host |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Reclaim 2.0 | ● | ● | ● | ● | ◐ | ◐ analytics | ● preview + MCP | ●/●/—/— | — |
| Motion | ● split work | ◐ routines | ◐ | ● personal | ◐ | ● | ◐ | ●/●/●/— | — |
| Clockwise | ◐ holds | ● | ● | ◐ | — | ◐ analytics | ◐ chat/MCP | ●/◐/—/— | — |
| FlowSavvy | ● | ◐ recurring | — | — | ◐ | — | — | ●/●/●/— | — |
| SkedPal | ● | ◐ time maps | — | — | ● tracker | ◐ outline | — | ◐ | — |
| Sunsama | ◐ | ◐ | — | — | ● | ◐ objectives | ◐ estimates | ●/●/●/— | — |
| Akiflow | ◐ same-day | ◐ slots | — | ◐ availability | ● | ◐ | ● Aki/MCP | ●/●/◐/— | — |
| Morgen | ● suggested | ● Frames | — | ● | ● | ◐ | ● approval | ●/●/●/● | — |
| Trevor AI | ● suggested | ◐ blocks | — | — | ● | ◐ lists | ● | ●/●/—/— | — |
| TimeHero | ● | ● recurring | — | — | ◐ | ● | ◐ | ●/●/—/— | — |
| Cal.diy | — | — | — | ● | — | ◐ routing load | ◐ workflows | ●/●/●/◐ | ● MIT |
| FluidCalendar | ● | ◐ | — | — | ● | ◐ | ◐ | ●/●/●/● | ● MIT |
| Fluxure reference | ● | ● | — disabled/incomplete | ◐ personal | ◐ | — | ◐ quick add | ●/—/—/— | ● AGPL |
| Cal.rs reference | — | — | — | ● | — | ◐ booking teams | — | ●/◐ EWS/◐/● | ● AGPL |
| **Possible post-sync Planipus target** | ● | ● | ● | ● | ● | ● | ● optional/approval | ●/●/●/● | ● Apache-2.0 |

## Standards and engineering constraints

- Calendar data must preserve iCalendar recurrence, exceptions, time zones, and
  attendee semantics from [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html).
- CalDAV access follows [RFC 4791](https://datatracker.ietf.org/doc/html/rfc4791),
  with sync-token support where servers implement RFC 6578.
- Google sync uses initial plus incremental sync tokens and treats webhooks as a
  hint rather than a reliable event stream. Google explicitly says notifications
  can be dropped; see [incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync)
  and [push notifications](https://developers.google.com/workspace/calendar/api/guides/push).
- Microsoft tracks each calendar/range independently through opaque next/delta
  links; see [Graph calendar delta](https://learn.microsoft.com/en-us/graph/delta-query-events).
- Provider events and managed destination copies need stable provenance, idempotency
  keys, remote ETags/change keys, tombstones, and a reconciliation loop. Webhook
  delivery alone is never source-of-truth.

## Product thesis

Planipus wins if it becomes the **open availability firewall** between a person's
independent identities:

- policy-controlled real copies make destination availability truthful;
- disclosure is explicit per direction and verifiable from an ordinary viewer;
- hours, RSVP, free/all-day, and override decisions are deterministic and
  explained without revealing event content;
- source events are never mutated and managed copies converge without loops;
- Google works first; Outlook and open CalDAV follow on the same policy contract;
- credentials, mappings, audit, retention, and egress stay operator-visible;
- ordinary sync is automatic, while material policy and cleanup changes preview
  exact effects; and
- one secure pod is the easy start, with no required SaaS, AI, telemetry, or
  commercial entitlement service.
