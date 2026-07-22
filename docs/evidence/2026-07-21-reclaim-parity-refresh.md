# Reclaim.ai parity refresh — July 2026

Date researched: 2026-07-21 (America/Vancouver)  
Evidence status: public-product research; no Reclaim account or live provider was
used  
Primary source policy: official Reclaim product and Help Center pages wherever
available

## Purpose

This record refreshes the Reclaim behavior benchmark after Reclaim published a
new 2.0 experience in June 2026. It is intentionally separate from Planipus's
binding product and conformance contracts:

- this file records publicly documented behavior and open questions;
- it does not prove that Reclaim behaves exactly as documented;
- it does not authorize copying Reclaim code, UI text, visual expression, or
  branding;
- it does not expand Planipus P0 beyond trustworthy cross-account Calendar Sync;
- it distinguishes Reclaim 1.0 from the 2.0 private beta instead of merging
  their incompatible behavior into one imaginary product; and
- `../CALENDAR-SYNC.md` remains authoritative for Planipus behavior.

The research focuses on Smart Meetings, scheduling hours and after-hours
protection, Scheduling Links, Habits, Tasks, Focus, buffers/travel, scheduling
policies, user-visible control, and their implications for Planipus.

## Executive conclusions

1. **Reclaim has a material version split.** Official 1.0 documentation remains
   relevant to users who have not entered the 2.0 private beta. Reclaim 2.0 adds
   Planner, Assistant chat, Preview Mode, Agents, Issues, and a stronger
   human-in-the-loop control model.
2. **Smart Meeting behavior changed.** Reclaim 1.0 automatically reschedules
   around accepted conflicts. The 2.0 FAQ says a Smart Meeting never
   automatically reschedules because changing an attendee event sends
   notifications; it instead detects a problem, recommends mutual times, and
   waits for explicit action.
3. **Hours are reusable scheduling policy, not merely account working hours.**
   Working, Meeting, Personal, Custom, and one-off windows feed smart events,
   links, and Calendar Sync. The documented controls constrain Reclaim-created
   scheduling; they are not evidence of a universal firewall against arbitrary
   invitations created outside Reclaim.
4. **Scheduling Links expose willingness, not only free/busy.** P1–P4 priority
   determines which lower-priority flexible events are offered as bookable.
   Reclaim moves the displaced flexible item, while a confirmed link booking is
   protected from later Reclaim smart events.
5. **The reusable product substrate matters more than any individual planner
   feature.** Event presentation is separated from automation rules; priorities,
   Hours, Preview Mode, issues/explanations, pause/remove, and locks are common
   control concepts.
6. **Planipus already targets the most important Reclaim behavior:** a real,
   maintained personal→work calendar copy with per-policy hours and privacy.
   Its explicit overlap and disclosure rules are stronger specifications than
   Reclaim's public material in several edge cases.
7. **Planipus should not chase broad parity before P0 is proven live.** Smart
   Meetings, links, tasks, habits, focus, travel, and team analytics remain later
   modules. If added, build the common scheduling-policy substrate first.

## Source and version boundary

### Reclaim 2.0 status on the research date

Reclaim's official 2.0 overview and FAQ are dated 2026-06-11. Both identify 2.0
as an early-access/private-beta experience and tell 1.0 users to request access.
The 2.0 product consists of:

- a full Planner calendar;
- Assistant chat;
- Preview Mode that stages changes before provider mutation;
- Agents for Habits, Buffers, Focus, Smart Meetings, Meeting Quality, and meeting
  overload defense;
- Tasks and task-tool integrations;
- Scheduling Links;
- Calendar Sync;
- Insights; and
- MCP access from external AI clients, with mutations staged for approval.

Primary sources:

- [Reclaim 2.0 FAQ](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)
- [Reclaim.ai 2.0 overview](https://help.reclaim.ai/en/articles/14846468-reclaim-ai-2-0-overview)

### Reclaim 1.0 status on the research date

Many detailed Help Center pages were refreshed in June 2026 but explicitly say
that they describe Reclaim 1.0. These pages remain useful evidence for the
current non-beta product and for behavioral edge cases, but they must not be
silently attributed to 2.0. In particular:

- 1.0 Smart Meetings autonomously move;
- 1.0 Tasks explicitly auto-block and chunk work before deadlines;
- 1.0 Focus exposes Proactive and Reactive modes;
- 1.0 Travel Time documents address/flight heuristics; and
- 1.0 smart events use automatic Free/Busy transitions and locks.

The 2.0 FAQ confirms the stable concepts but does not promise that every 1.0
mechanic or setting is preserved.

### Version comparison

| Area | Reclaim 1.0 public behavior | Reclaim 2.0 public behavior | Research implication |
|---|---|---|---|
| Primary surface | Feature pages plus Planner/settings | Planner, Assistant, Agents, Issues, Preview Mode | Treat 2.0 as a control-model redesign |
| Smart Meeting conflict | May automatically move after a qualifying conflict/decline | Warns and proposes times; user applies the move | Prefer 2.0's human approval for attendee mutation |
| Tasks | Explicit deadline blocking, chunking, priority and Hours | Tasks view/chat/integrations, Focus recommendations and timer | Do not assume all 1.0 auto-chunking migrated unchanged |
| Habits | Rich recurrence, adaptive Free/Busy, time defense and dependencies | Event template plus move/shorten/skip/defend rules | The flexible recurring-event semantics remain |
| Focus | Proactive/Reactive modes and weekly goals | Daily/weekly target Agent plus optional auto-decline | Stable goal semantics; UI/rules changed |
| Buffers/travel | Global travel/decompression/break rules with detailed heuristics | Buffer Agent template plus applicability rules | Detailed travel heuristics are not yet documented for 2.0 |
| Mutation safety | Locks, free/busy and direct calendar edits | Preview, review/apply, per-change discard, Issues | Generalize Preview Mode, not surprise mutation |

## Product-wide scheduling and control model

### Priorities

Reclaim's priority vocabulary is Critical (P1), High (P2), Medium (P3), and Low
(P4). It applies to smart events and, in 1.0, can also be assigned to ordinary
provider events.

Documented 1.0 behavior:

- higher-priority items schedule before and may overbook lower-priority flexible
  items;
- at equal priority, Smart Meetings precede Habits, then Tasks; equal-priority
  Tasks use the nearer deadline;
- non-Reclaim provider events default to Critical;
- lowering an ordinary event does not permit Habits, Tasks, or Smart Meetings to
  overwrite it; only a higher-priority Scheduling Link may expose that time to a
  booker; and
- an accepted or tentative external invitation becomes a real conflict, while an
  unanswered invitation generally does not move a flexible smart event.

Source:

- [How Reclaim manages a schedule automatically](https://help.reclaim.ai/en/articles/6207587-how-reclaim-manages-your-schedule-automatically)

### Event presentation versus automation rules

Reclaim 2.0 repeatedly separates two concepts:

1. **Event template/defaults:** title, duration, normal time, recurrence,
   Free/Busy or visibility, reminders, notifications, color, attendees, and
   priority.
2. **Automation rules:** permitted movement, window, shortening, skip behavior,
   defense, thresholds, applicability, and Hours.

This is a useful architectural seam for future Planipus scheduling modules. It
prevents editing event appearance from silently changing the automation's
authority.

### Preview Mode

In Reclaim 2.0, Preview Mode is a provider-mutation staging area:

- the live Google/Outlook calendar continues to sync into the preview;
- all enabled Agents run against the staged calendar so cascading changes are
  visible;
- attendees are not notified until apply;
- the user can discard all changes or open a review dialog;
- the review identifies additions, moves, and cancellations;
- individual changes can be removed before applying the remainder; and
- Assistant and MCP mutations enter Preview Mode instead of applying directly.

This is broader than Planipus's current policy-activation preview. Planipus does
not need a general planner sandbox for P0, but should preserve the invariant that
material policy changes and destructive cleanup are previewed before mutation.

### Agents, pausing, and Issues

Agents can be created from the Agents panel, a top-level create menu, or chat.
Users can edit, disable without losing configuration, re-enable, or remove them.
Changes go through review/apply.

Issues provide explanations and recovery actions in multiple places:

- warning icons on Planner events;
- Assistant recommendations;
- Daily Digest;
- Smart Meeting and Meeting Quality Agent views; and
- one-click fixes, ignore-for-event/series, or settings changes.

Issue categories include conflicts, RSVP, missing conferencing, attendee
availability, room/resource decline, buffer/travel problems, and team-policy
warnings.

## Smart Meetings

### Reclaim 2.0 behavior

A 2.0 Smart Meeting is an Agent applied to an existing or newly configured
recurring meeting with attendees. The FAQ recommends it for flexible small-group
meetings of no more than five attendees, such as one-on-ones and team check-ins.

| Concern | Documented 2.0 behavior |
|---|---|
| Conflict response | Detect conflict or decline; do not automatically move |
| Recommendation | Suggest mutually available alternatives inside a configured reschedule window |
| User action | One-click reschedule after review; attendee notification follows the approved provider update |
| Surfaces | Event warning icon, Daily Digest, Assistant `Resolve Problems` flow |
| Creation | Agents panel, create menu, or convert a recurring Planner event |
| Default event controls | title, default time/duration, frequency, required/optional attendees, visibility, reminders, color, priority |
| Rule controls | reschedule window, conflict behavior, optional minimum duration |
| Lifecycle | edit defaults/rules, disable, remove, review and apply |
| Recommended boundary | small/flexible recurrence; leave large or fixed meetings as ordinary events |

The official 2.0 overview uses broader “auto-schedule” language, while the more
detailed FAQ says that rescheduling is never automatic. The likely distinction
is initial recurrence management versus attendee-affecting conflict resolution,
but that is an inference. Live 2.0 observation is required before treating it as
a normative fact.

### Reclaim 1.0 behavior

Reclaim 1.0 describes a more autonomous recurring-meeting scheduler.

| Setting or behavior | Documented 1.0 detail |
|---|---|
| Attendees | required or optional; optional attendees remain invited but their availability does not constrain placement |
| Availability | mutual free/busy, Hours, priorities and timezones where visible |
| Frequency | daily, weekly, monthly, or custom interval |
| Duration | minimum and maximum; the scheduler may shorten in a constrained week |
| Placement | ideal day/time inside overlapping attendee Hours |
| Start | immediately or on a future date |
| Priority | organizer-controlled P1–P4 for the series |
| No-risk failure | optionally leave at ideal time with a warning rather than remove when no valid slot exists |
| Location | Google Meet, Zoom, physical/custom location, or Workspace room/resource |
| Target calendar | selected primary calendar; documented as immutable after series creation |
| Dependencies | relative ordering with a Habit or other scheduling item |
| Accepted conflict | automatically move to the next mutual time unless locked |
| RSVP decline | organizer/required attendee decline can trigger rescheduling |
| Manual drag | accept the user's chosen time and lock the occurrence |
| Delete/skip | deleting one occurrence skips the current recurrence period |
| Explanation | skipped periods, change log, at-risk digest and optional update emails |

An attendee does not necessarily need a Reclaim account. However, without a
Reclaim account or sufficient provider free/busy sharing, Reclaim cannot
accurately use the attendee's availability, timezone, Hours, or priorities.

### Smart Meeting uncertainties

1. Two current 1.0 Help Center pages disagree on when a flexible Smart Meeting
   automatically flips from Free to Busy: one says less than 24 hours; another
   says less than 12 hours. Do not encode either as presumed parity.
2. The 2.0 overview mentions auto-scheduling while the FAQ rejects automatic
   rescheduling. Treat the FAQ as the safer attendee-notification contract.
3. Public documents do not fully specify concurrent edits, organizer transfer,
   recurrence-split behavior, or failure after a provider update but before
   Reclaim records the result.
4. Availability for an external non-Reclaim invitee depends on provider sharing,
   so “works with anyone” does not mean equal optimization quality.

Primary sources:

- [Reclaim 2.0 FAQ — Smart Meetings](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)
- [Smart Meetings Overview (1.0)](https://help.reclaim.ai/en/articles/5604990-smart-meetings-overview-automatically-schedule-your-recurring-meetings)
- [Managing Smart Meetings (1.0)](https://help.reclaim.ai/en/articles/5617432-managing-smart-meetings-on-your-calendar)
- [Smart Meeting flexibility and Free/Busy (1.0)](https://help.reclaim.ai/en/articles/6330965-how-smart-meetings-keep-your-calendar-flexible)
- [Smart Meeting troubleshooting (1.0)](https://help.reclaim.ai/en/articles/6493804-why-are-my-smart-meetings-not-scheduling)

## Scheduling Hours and after-hours protection

### Hours types

| Hours type | Main documented use |
|---|---|
| Working | solo work, work Tasks, Focus, and work Habits |
| Meeting | collaborative meetings and most Scheduling Link availability |
| Personal | personal Tasks, Habits, and personal scheduling |
| Custom | reusable specialized time policy, such as client calls, a side gig, or a themed day |
| One-off | item-specific Hours for a Habit, Smart Meeting, or Scheduling Link |

Hours may overlap. Reclaim recommends making Meeting Hours narrower than Working
Hours when the user wants more focus protection.

### User controls

- select active weekdays;
- configure one or more time ranges per day;
- copy one day's ranges to other days;
- choose the displayed scheduling timezone;
- assign an item to Working, Meeting, Personal, or Custom Hours;
- create item-specific one-off Hours for Habits, Smart Meetings, and Scheduling
  Links; and
- map Task Hours types to different destination calendars.

The 1.0 page says one-off Hours are not available to Tasks. Reusable Custom Hours
are described as paid-plan behavior. It says the timezone follows Google Calendar
settings even though Reclaim now supports Outlook; current Outlook timezone
precedence needs live verification.

### What after-hours protection does and does not prove

The documentation supports these conclusions:

- Reclaim-created work items should remain within their assigned Hours;
- Smart Meetings and links use Meeting or explicitly selected Hours;
- narrower Meeting Hours reduce bookable collaboration time;
- Calendar Sync may include or exclude events outside Working Hours per policy;
- optional Focus settings can auto-decline invitations that interrupt defended
  focus; and
- Defend Meeting Overload can block the remaining calendar after a daily/weekly
  meeting-minute threshold is exceeded.

It does **not** prove that Reclaim rejects every arbitrary provider invitation
created outside those Hours. Therefore Planipus should use precise copy such as
“Planipus-created suggestions and booking availability stay inside these Hours,”
not claim a complete provider-level after-hours firewall unless implemented and
tested.

### Calendar Sync outside-hours toggle

Each Reclaim Calendar Sync Policy exposes a `Sync outside of working hours?`
preference. Reclaim recommends all-time sync when preventing evening/weekend
double-booking matters, but allows work-hours-only copying for cases such as a
side gig.

The public documentation does not define what happens when an event partially
overlaps Working Hours. Planipus explicitly chooses `overlaps_profile`: any
positive overlap includes the full source event, while events fully outside the
profile are omitted. That Planipus behavior is testable and should remain
explicit unless product evidence justifies another mode.

Primary sources:

- [Working, Meeting, Personal, and Custom Hours](https://help.reclaim.ai/en/articles/3600766-set-your-working-meeting-personal-custom-hours)
- [Reclaim working-hours product page](https://reclaim.ai/features/working-hours)
- [Calendar Sync Policy customization](https://help.reclaim.ai/en/articles/6326844-creating-and-customizing-your-calendar-sync-policies)
- [Reclaim 2.0 FAQ — Hours and overload defense](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)

## Scheduling Links

### Link types

| Type | Availability rule | Important edge behavior |
|---|---|---|
| Individual | one organizer's availability | books directly to the selected organizer/calendar |
| Team | all required organizers must be free | optional organizers do not constrain availability |
| Round Robin | any member of a pool may be free | prefers fewer prior bookings through that link; may prefer named organizers |
| One-off | tailored copy of an existing link | original link is unchanged; documented 2.0 expiry is 30 days |

Round Robin attempts to retain the original host when a guest reschedules. When
several members are free, it uses bookings through that link as the load signal;
the public FAQ does not promise global workload balancing across every calendar
event.

### Priority-based availability

Every link has a priority:

- Critical/P1 exposes all lower-priority flexible time;
- High/P2 exposes Medium and Low;
- Medium/P3 exposes Low; and
- Low/P4 exposes only truly free time.

If a guest books over a lower-priority flexible Reclaim item, Reclaim moves that
item. A confirmed Scheduling Link meeting is never overbooked by a later Reclaim
smart event, regardless of priority.

This is a critical semantic distinction: the booking page presents what the user
is willing to move for this class of meeting, not only static free/busy.

### Link controls

The current documentation describes:

- title, group, hidden versus main booking page, URL slug, organizer and host;
- up to three meeting durations;
- selected booking calendar;
- minimum notice / earliest start and fixed or rolling booking horizon;
- a legacy maximum rolling horizon of 100 days;
- P1–P4 priority;
- maximum bookings per day and/or week;
- Meeting, Personal, Custom, or one-off Hours;
- Google Meet, Zoom, phone, physical address, or custom location;
- multiple locations from which the guest may choose;
- screening questions on paid plans;
- reminder email and custom message;
- Business/Enterprise redirect URL;
- meeting-break/buffer inclusion;
- personal booking page, link groups, sharing, embed and branding;
- URL parameters for timezone, day, time, and duration;
- availability troubleshooting visible only to a logged-in organizer; and
- webhooks for booking, reschedule, and cancellation workflows.

Legacy multi-organizer behavior uses the longest organizer buffer when meeting
breaks are enabled. A physical location may remove slots that lack enough room
for travel. Reclaim recommends disabling breaks on large organizer groups when
maximum availability matters.

### Scheduling Link uncertainties

- Some detailed settings are documented on 1.0 pages and should be verified in
  2.0 before claiming exact UI parity.
- The priority model assumes Reclaim can safely move every surfaced flexible
  item; a Planipus implementation would need durable ownership and ambiguity
  recovery before offering such a slot.
- Round Robin fairness is documented in terms of prior bookings through the link,
  not working hours consumed, meeting value, PTO, or total workload.
- Public pages do not fully specify race handling when two guests choose the same
  slot concurrently.

Primary sources:

- [Reclaim 2.0 FAQ — Scheduling Links](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)
- [Creating and customizing Scheduling Links](https://help.reclaim.ai/en/articles/6666663-creating-and-customizing-scheduling-links)
- [Scheduling Links product page](https://reclaim.ai/features/scheduling-links)
- [Scheduling Links Help Center collection](https://help.reclaim.ai/en/collections/3671631-scheduling-links)

## Habits

### Stable behavior

A Habit is flexible automation around a solo recurring event. Its user contract
is richer than an ordinary fixed recurrence: the user expresses when it may move,
how short it may become, and whether it should disappear or defend time when the
calendar becomes constrained.

### Reclaim 2.0 controls

| Layer | Controls |
|---|---|
| Default event | title, preferred time, duration, visibility/Free-Busy, reminders, notifications, color, priority |
| Conflict rules | move window, minimum duration, shorten permission, skip behavior, defended-time behavior |
| Creation | Agent template, create menu, chat, or convert an existing recurring solo event |
| Lifecycle | preview, edit, disable while preserving configuration, remove |

### Additional documented 1.0 behavior

- daily, weekly, monthly, and complex custom recurrence;
- ideal time within a flexible Hours window;
- min/max duration;
- Work/Personal category for analytics;
- target writable calendar, documented as immutable after series creation;
- leave an unschedulable occurrence with a warning or remove it;
- title/notes/privacy/color/time defense;
- snooze until a future date;
- manual past work logging;
- duplicate-keyword suppression;
- auto-decline of an interrupting invitation with a configurable message;
- dependencies such as one Habit before a Smart Meeting, two Habits ordered, or
  two Habits forbidden on the same day; and
- CC attendees who receive no Habit notifications and whose availability is not
  considered.

### Habit edge cases

- Duplicate-keyword suppression checks only the intended Habit time window and
  does not consider other Reclaim-created events.
- Auto-decline is explicitly sharp-edged: it sends a real provider response when
  someone books over a defended Busy Habit.
- A flexible event may initially be Free and later become Busy as the allowed
  window disappears or the start approaches.
- A Habit may be important but still movable; Planipus must not conflate priority,
  Free/Busy visibility, lock, and movement authority.

Primary sources:

- [Reclaim 2.0 FAQ — Habits](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)
- [Habits Overview (1.0)](https://help.reclaim.ai/en/articles/4129152-habits-overview-auto-schedule-flexible-time-for-your-routines)

## Tasks

### Reclaim 2.0 behavior

Tasks can originate in Reclaim chat/the Tasks panel or from Google Tasks,
Todoist, ClickUp, Jira, Asana, or Linear. They appear in the Assistant sidebar.
During Focus, Reclaim may recommend work using deadline, priority, context, and
the current schedule. The user may start a timer, then log the elapsed session to
the calendar or discard it.

The 2.0 overview also describes a Getting Things Done recommendation mode and
conversational requests for a different/lighter task. Those are product claims,
not a published deterministic solver contract.

### Reclaim 1.0 scheduling controls

| Control | Documented meaning |
|---|---|
| Name | only required field; defaults fill the rest |
| Priority | P1–P4 defense/order; default described as High/P2 |
| Total duration | work estimate; minimum task total is 15 minutes |
| Due date | date by which calendar time should be scheduled |
| Earliest start | do not schedule work before this date |
| Min/max session | chunk a long task into feasible work blocks |
| Hours | Working, Meeting, Personal, or Custom |
| Notes | Markdown-capable event content |
| Visibility | how task events appear to other calendar viewers |
| Up Next | schedule as soon as possible ahead of ordinary priority order |
| Target calendar | inherited from the selected Hours type |

Users can filter/sort by deadline, start, state, Hours, priority, and smart
scheduling order. A task may be created in Reclaim, by clicking/dragging in the
Planner, or through integrations such as provider add-ons, Slack, and Raycast.
A Planner-created task locks at that chosen time.

### Task uncertainties

- The 2.0 FAQ emphasizes suggestions during Focus and timers, while the 1.0 page
  emphasizes autonomous deadline blocking and chunking. Do not assume exact
  algorithmic parity without 2.0 live evidence.
- Public documentation does not define optimization quality, lateness handling,
  dependency graphs, or behavior when no feasible schedule exists before the
  due date.
- `Up Next` is an override separate from P1–P4; a future Planipus model should
  represent it explicitly rather than inventing a hidden priority value.

Primary sources:

- [Reclaim 2.0 FAQ — Tasks](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)
- [Tasks Overview (1.0)](https://help.reclaim.ai/en/articles/5108936-tasks-overview-protect-time-for-task-work-before-deadlines)

## Focus

### Reclaim 2.0 behavior

Focus is proactive deep-work protection. An Agent schedules blocks against a
daily or weekly target. Its event template controls title, visibility/Free-Busy,
reminders, and presentation. Rules control the amount, minimum block size,
selected Hours, thresholds, and optional auto-decline.

Defend Meeting Overload is a different, reactive Agent: when meeting minutes
exceed a daily/weekly threshold, it blocks the remaining eligible time so more
meetings cannot be booked. Reclaim recommends pairing proactive Focus with
reactive overload defense.

### Reclaim 1.0 Focus modes

| Mode | Behavior | Key controls |
|---|---|---|
| Proactive | progressively reserves time even while the calendar is open | weekly goal, ideal/max daily Focus, min/max block duration |
| Reactive | waits until the schedule risks missing a daily/weekly minimum | target plus minimum block duration; favors meeting availability |

Other documented behavior:

- event title/emoji, description, Hours, target calendar, visibility, and
  auto-decline message;
- moving a Focus event locks it;
- deleting a Focus event skips that time range;
- accepted higher-priority conflicts move an unlocked Focus block;
- Work Tasks and Work Habits count toward the Focus goal;
- Google Workspace native Focus events count;
- `#focus` can make an ordinary event count;
- Habits, Tasks, and Smart Meetings schedule before generic Focus, regardless of
  their nominal P1–P4 priority; and
- Scheduling Links treat Focus as High, so only Critical links expose it.

### Focus implications

Focus demonstrates that “priority” alone is not the whole ordering model.
Category precedence, goal accounting, lock state, current Free/Busy state,
accepted invitations, and link-specific willingness all affect placement. A
future Planipus solver must expose these rules rather than claim a single opaque
AI score.

Primary sources:

- [Reclaim 2.0 FAQ — Focus and Defend Meeting Overload](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)
- [Focus Time Overview (1.0)](https://help.reclaim.ai/en/articles/6332766-focus-time-overview-defend-time-for-productive-work)
- [Focus Time product page](https://reclaim.ai/features/focus-time)

## Buffers, breaks, and travel

### Reclaim 2.0 Buffer Agent

A Buffer Agent adds event time before or after qualifying meetings. The event
template controls title, visibility/Free-Busy, reminders, and other provider
defaults. The rules control:

- before versus after;
- duration;
- which meetings qualify; and
- whether to skip when the buffer cannot fit.

Official examples include travel before/after an offsite meeting, prep before an
external/customer call, and decompression after an intense meeting.

### Reclaim 1.0 detailed mechanics

| Buffer | Documented behavior |
|---|---|
| Task/Habit break | creates free space, not an event, between consecutive work blocks |
| Travel | fixed-duration event before and after a Busy event with a physical location |
| Flight | two hours before and one hour after a detected or forced flight |
| Decompression | adaptive event after all meetings or video meetings |

Travel edge behavior:

- only the main account's primary calendar receives Travel Time;
- it also applies around Calendar Sync copies on that calendar;
- it is created only when space is free;
- the source event must be Busy;
- Reclaim does not query a maps database or calculate a route;
- an address is expected to be sufficiently formed; the help page uses at least
  two commas as the heuristic;
- `#needs_travel` forces default before/after travel;
- `#flight` forces the flight category and two-hour/one-hour blocks;
- `#travel` categorizes an event without asking for extra travel blocks;
- blocks move when the event moves;
- a manually changed buffer duration is preserved rather than overwritten;
- main-calendar Travel events are documented as publicly titled travel events;
  travel associated with a synced event follows the Sync Policy visibility; and
- a user may manually lengthen a rough Travel block.

Decompression controls include duration, all meetings versus video meetings,
title/emoji, and title-visible versus generic Busy. It is skipped when another
event starts immediately after the meeting.

### Buffer uncertainties

- The detailed address, calendar, public-visibility, and flight rules are 1.0
  evidence. The 2.0 FAQ promises flexible Buffer Agents but does not state that
  all heuristics remain identical.
- No route estimation means Travel is coarse blocking, not commute planning.
- The documented “skip if no room” behavior may leave a physically impossible
  transition visible but unresolved; Issues can warn, but public docs do not
  promise a feasible-route solver.

Primary sources:

- [Reclaim 2.0 FAQ — Buffers](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)
- [Buffer Time, Travel, Decompression, and breaks (1.0)](https://help.reclaim.ai/en/articles/4281992-buffer-time-overview-travel-decompression-and-tasks-habit-breaks)
- [Travel hashtags (1.0)](https://help.reclaim.ai/en/articles/5644743-using-needs_travel-flight-and-travel)

## Calendar Sync Policies

Calendar Sync is the Reclaim capability most directly relevant to Planipus P0.
Reclaim distinguishes it from Connected Calendars:

- a Connected Calendar informs Reclaim's private availability calculation;
- a Sync Policy creates real copies on a destination calendar so the destination
  account's coworkers and booking tools see blocked time; and
- source changes keep the destination copy current.

### Policy direction and topology

A Sync Policy has exactly one source calendar and one destination calendar.
Bidirectional sync is two independent policies. Multiple calendars or client
accounts use additional policies. Reclaim says it recognizes copies and avoids
syncing them onward in a chain.

### User-visible Sync Policy controls

- source account/calendar;
- destination account/calendar;
- calendar type: Business, Personal, or Travel;
- event-copy color override;
- privacy/visibility mode;
- all-day event behavior;
- include/exclude outside Working Hours;
- status toggle; and
- destructive delete.

The policy can be edited after creation. Reclaim warns that rapidly toggling a
policy can produce enough provider writes to trigger Google limiting and delayed
resync. Delete is documented as irreversible.

### Privacy modes

| Reclaim mode | Destination behavior | Important caveat |
|---|---|---|
| Personal/Work/Travel Commitment | generic category such as Personal Commitment, Work Commitment, Meeting, PTO, Travel, or Flight | communicates event type without source detail |
| Busy for all | title is Busy and details are suppressed | closest to a provider-private availability block |
| Details for you, Busy for most others | owner sees copied description/location/conferencing; ordinary viewers see Busy | calendar editors and organization administrators may still see details |
| Details for authorized viewers, Busy otherwise | provider-default detail sharing | anyone with sufficient calendar detail access can see copied content |

The free plan is documented as limiting Calendar Sync visibility choices; an
open-source Planipus distribution should not reproduce artificial feature caps.

### Event-type behavior

| Source event condition | Reclaim's documented result |
|---|---|
| Timed Busy event | normal policy/privacy copy |
| All-day event | skipped by default; policy may include only Busy all-day or every all-day event |
| Timed Free event with full-details privacy | copied as Free |
| Timed Free event with Commitment/Busy privacy | skipped |
| Gmail/Outlook generated flight/reservation | copied as Busy even when source is Free |
| Destination identity already invited | skip the copy to avoid duplicate blocking |
| RSVP Yes or Maybe | copy is Busy |
| RSVP No | remove the destination copy |
| RSVP unanswered | copy is Free by default; policy may choose to block |
| `#nosync` | exclude the event; tag may itself be visible on the source |

### Calendar Sync uncertainties

1. Partial work-hours overlap is not specified publicly.
2. Provider-private visibility still depends on Google/Outlook ACL and
   administrator behavior; only an ordinary third-viewer test proves expected
   disclosure.
3. Public docs do not define provider revision handling, ambiguous writes,
   deterministic identity, concurrency, or exact loop marker format.
4. Shared iCloud calendars may be visible through a connected Google calendar,
   but Reclaim warns of long delays; this is not native iCloud parity.
5. Reclaim supports Google and Outlook Calendar; Planipus P0 is Google only.

Primary sources:

- [Calendar Sync Overview](https://help.reclaim.ai/en/articles/3600762-calendar-sync-overview-keep-multiple-schedules-in-sync)
- [Creating and customizing Sync Policies](https://help.reclaim.ai/en/articles/6326844-creating-and-customizing-your-calendar-sync-policies)
- [Managing, disabling, and removing Sync Policies](https://help.reclaim.ai/en/articles/3600826-managing-disabling-or-removing-sync-policies)
- [How Calendar Sync handles event types](https://help.reclaim.ai/en/articles/3639967-how-calendar-sync-syncs-different-kinds-of-events)
- [Multiple directions](https://help.reclaim.ai/en/articles/3654852-using-calendar-sync-to-sync-calendars-in-multiple-directions)
- [Calendar Sync versus calendar sharing](https://help.reclaim.ai/en/articles/3713192-how-is-calendar-sync-different-from-sharing-my-calendar-with-someone)

## Meeting Quality, overload defense, and team policy

Reclaim 2.0 expands “policy” beyond placement rules:

- Detect Event Conflicts;
- RSVP Reminders;
- Video Link Check, optionally auto-adding a link;
- Attendee Availability Alert;
- Room/Resource Decline Alert;
- Defend Meeting Overload thresholds;
- Focus goals;
- team Hours and scheduling defaults;
- team out-of-office calendars; and
- Insights for meeting load, focus, fragmentation, missed routines, and
  after-hours patterns.

Meeting Quality Agents create warnings and recommendations, not proof that every
meeting can be repaired automatically. Team policy warnings are visible as
Issues. The 2.0 overview describes team expectations as guidance rather than
rigid enforcement.

These capabilities are not required for Planipus Calendar Sync P0. If introduced
later, team analytics must preserve individual privacy and avoid exposing event
details or employee ranking.

Primary sources:

- [Reclaim 2.0 FAQ — Meeting Quality, Issues, overload, and Insights](https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq)
- [Team settings (1.0)](https://help.reclaim.ai/en/articles/6080403-how-to-manage-account-settings-for-your-team)
- [Team statistics privacy (1.0)](https://help.reclaim.ai/en/articles/8215812-team-stats-overview)

## User-visible controls summary

| Control | Reclaim behavior | Planipus implication |
|---|---|---|
| Direction | one source→destination policy; reverse is separate | already a Planipus invariant |
| Hours | reusable and item-specific windows | keep named IANA-timezone profiles; later separate Work/Meeting/Personal concepts |
| Priority | P1–P4 plus category-specific precedence | do not reduce future scheduling to one opaque score |
| Preview | stage cascading changes, inspect, discard individual changes, apply | extend only when Planipus gains multi-item planning; retain P0 policy preview |
| Explainability | warning icon, issue reason, digest, chat, change log | keep reason codes and privacy-safe activity as the source of truth |
| Pause | disable automation without losing configuration | Planipus already supports policy pause; reuse the concept for later modules |
| Remove | permanent deletion, distinct from pause | always preview remote cleanup separately |
| Lock | user-chosen event stops automatic movement | future scheduler must distinguish lock from Busy and priority |
| Skip | suppress one recurrence period | future recurrence model needs durable per-occurrence intent |
| Visibility | event-specific display versus automation authority | preserve disclosure manifests and third-viewer tests |
| Calendar edits | 1.0 often treats a manual move as a lock | never overwrite user intent without explicit documented policy |
| Assistant/MCP | propose in Preview Mode before apply | any future assistant remains optional and cannot bypass normal authorization/audit |

## Planipus parity matrix

Legend:

- **Implemented** — credential-free behavior exists in the current worktree;
- **Partial** — contract/foundation exists but the full UX/evidence is incomplete;
- **Blocked** — implementation claim requires live provider/release evidence;
- **Future** — intentionally outside Calendar Sync P0.

| Capability | Reclaim benchmark | Planipus state | Required next evidence/work |
|---|---|---|---|
| Directed Calendar Sync | one source→destination policy | **Implemented** | live two-account proof in both editions |
| Multiple directions/pairs | separate policy per direction/pair | **Implemented** in contract/domain | live independent-policy and loop tests |
| Real maintained destination copy | update with source | **Implemented** credential-free | Google create/update/move/recurrence/delete matrix |
| Work Hours versus all time | per-policy outside-hours toggle | **Implemented** in engine/Server; Mac editor partial | complete Mac exceptions/DST choice and live partial-overlap proof |
| Partial-overlap semantics | not publicly specified | **Implemented** as any-overlap/full-event copy | retain explicit conformance tests |
| Busy only | Busy with no source details | **Implemented** | ordinary-viewer and admin/editor disclosure evidence |
| Generic commitment | category without source details | **Implemented** | live title/category/color provider proof |
| Owner-private details | owner sees details, ordinary viewer Busy | **Implemented** in transform | third-viewer plus Workspace admin/editor caveat proof |
| Authorized/shared details | provider ACL controls detail access | **Implemented** in transform | live ACL matrix |
| All-day/free/RSVP/`#nosync` | policy-specific selection | **Implemented** in conformance | source-timezone all-day and live provider matrix |
| Already-invited duplicate skip | no redundant copy | **Implemented** in conformance | live identity/alias/delegation cases |
| Color and calendar type | per-policy type/category/color | **Partial** | complete user-facing control and provider evidence |
| Pause/resume | preserve configuration | **Implemented** | live quota/race and recovery proof |
| Delete/detach/cleanup | distinct remote consequences | **Partial** | complete UI, preview and provider cleanup tests |
| Working/Meeting/Personal/Custom Hours | reusable system-wide policies | **Future/Partial**; Planipus has bridge Hours profiles | decide only after P0; preserve reusable Hours aggregate |
| General Preview Mode | cascade all schedule changes | **Future** | do not build before a general scheduling module exists |
| Universal P1–P4 priority | cross-feature flexible scheduling | **Future** | new solver ADR and deterministic fixture corpus |
| Smart Meetings | recurring attendee optimization | **Future** | human-approved conflict proposal is recommended baseline |
| Scheduling Links | individual/team/round-robin/one-off | **Future** | booking threat model, holds, abuse limits, concurrency and mail |
| Habits | flexible recurring solo routines | **Future** | event-template/rules/occurrence intent model |
| Tasks | deadline chunks/integrations/timers | **Future** | task domain and solver ADR |
| Focus | daily/weekly goal protection | **Future** | goal accounting, lock, auto-decline safety, insights privacy |
| Buffers/travel | prep/decompression/travel blocks | **Future** | provider ownership, collision, visibility and infeasible-transition UX |
| Meeting Quality/overload | warnings and reactive protection | **Future** | issue vocabulary and safe optional enforcement |
| Team Insights/policies | aggregate schedule patterns | **Future** | privacy/cohort policy; no individual surveillance/ranking |
| Outlook | Calendar Sync and planner provider | **Future** | provider-specific parity gate after Google P0 |

## Recommended sequencing for Planipus

### P0 — finish before adding planner breadth

1. Prove personal Google source→employer Google destination with two disposable
   identities in both autonomous editions.
2. Verify every privacy preset using an ordinary third viewer, not only the owner.
3. Complete create/update/time move/recurrence exception/delete/RSVP/all-day/free/
   `#nosync`/already-invited cases.
4. Prove hours/DST/partial-overlap behavior against provider events.
5. Prove ambiguous writes, provider revision conflicts, 410 cursor recovery,
   quota, revoke/reconnect, destination manual edit/delete, pause, detach, cleanup,
   and lost-state recovery boundaries.
6. Complete Mac key/recovery/distribution and Server image/backup/restore/upgrade
   release gates.

### First reusable post-P0 substrate

If broad scheduling work is approved later, implement these shared concepts
before Habits/Tasks/Focus/Meetings separately:

1. named Hours categories and custom item-specific windows;
2. event template versus automation rules;
3. explicit priority plus lock, Free/Busy, accepted-conflict, and category
   precedence;
4. durable occurrence-level skip/move/shorten/defend intent;
5. provider-neutral desired effects and ambiguity recovery;
6. staged preview with an exact change list;
7. privacy-safe reason/Issue vocabulary and change log;
8. pause versus remove versus remote cleanup; and
9. deterministic solver fixtures shared between Swift and TypeScript only if both
   editions adopt the module independently.

### Suggested module order after the substrate

1. **Buffers** — constrained adjacency automation with a smaller solver surface.
2. **Habits** — flexible single-user recurrence and occurrence intent.
3. **Focus** — goal accounting over Habits/Tasks and defended blocks.
4. **Tasks** — deadlines, chunking, integrations, and timers.
5. **Scheduling Links** — public concurrency, booking holds, team topology, abuse,
   and notifications.
6. **Smart Meetings** — attendee authority, recurrence, notifications, and
   cross-user conflict proposal.

This order is risk-based, not a product commitment.

## Behavior cases worth preserving for a future fixture corpus

### Hours

- multiple ranges on one day;
- Work and Meeting Hours overlap but are not identical;
- event exactly on a boundary;
- event partially overlaps a range;
- overnight range;
- DST gap/fold;
- temporary travel timezone;
- item-specific one-off Hours;
- no mutual attendee Hours;
- after-hours external invitation not created by Planipus.

### Priority and flexible events

- higher-priority link displaces an unlocked lower-priority Habit;
- equal priority uses documented category precedence;
- accepted invitation moves a flexible item; unanswered invite does not;
- manual move locks the item;
- delete means skip for a recurrence but reschedule for a Task;
- an ordinary provider event remains protected from a non-link smart event;
- Focus goal accounting includes a qualifying Task exactly once.

### Smart Meetings

- required versus optional attendee;
- invitee without calendar visibility;
- no mutual time;
- shorten to minimum duration;
- suggestion inside a reschedule window;
- user rejects or edits a suggestion;
- recurrence cadence after a manual move;
- attendee decline while update is in flight;
- provider write succeeds but local commit fails;
- large/fixed meeting is rejected or treated as ordinary.

### Scheduling Links

- simultaneous booking race;
- team link all-required overlap;
- optional organizer does not constrain;
- Round Robin tie and preferred organizer;
- reschedule retains original host when feasible;
- P1 link exposes P2–P4 but not P1;
- confirmed booking is not displaced;
- capacity limit reached atomically;
- buffer and physical-travel constraint;
- one-off expiry;
- webhook replay and signature failure;
- timezone/DST and minimum-notice boundary.

### Buffers/travel

- before, after, and both;
- no adjacent room;
- event moved after buffer creation;
- user-edited duration remains authoritative;
- source switches Busy→Free;
- valid/invalid address heuristic;
- forced travel/flight tag;
- privacy follows the owning policy;
- two adjacent meetings request incompatible buffers;
- flight blocks cross dates/timezones.

## Product decisions suggested by the evidence

These are recommendations, not accepted Planipus decisions:

1. **Human approval for attendee moves.** Follow the safer Reclaim 2.0 direction:
   detect, explain, propose, preview, then mutate. Solo flexible work may move
   automatically under an explicit rule.
2. **No hidden “AI” authority.** A policy must compile to inspectable inputs,
   precedence, constraints, and desired effects.
3. **Hours should be first-class.** Do not duplicate weekday/timezone fields in
   every future module.
4. **Lock, Busy, priority, and immovability are different.** Model each
   independently.
5. **A public booking slot is a promise.** Never expose lower-priority time unless
   Planipus can durably and safely relocate the owned item.
6. **Travel should remain privacy-preserving by default.** Fixed or user-entered
   duration avoids transmitting locations to a route service; any future maps
   adapter must be optional and explicitly consented.
7. **Preview destructive and socially visible changes.** Attendee notifications,
   bulk movement, link bookings over flexible time, and managed-copy cleanup
   deserve explicit review boundaries.
8. **Do not reproduce SaaS caps.** The self-hosted open-source edition may use
   resource/safety bounds, but should not artificially limit policies, links, or
   features by subscription tier.

## Research limitations and update protocol

Limitations:

- no Reclaim account was used;
- no Google or Outlook calendar was connected;
- no attendee/third-viewer observation was made;
- product pages include marketing claims that are less precise than Help Center
  behavior;
- current 1.0 and 2.0 pages occasionally conflict;
- plan availability and beta behavior can change; and
- search-index freshness does not prove rollout state for every account.

Before using this record for implementation:

1. check whether Reclaim 2.0 is still private beta;
2. prefer an updated version-labeled Help Center page over a marketing page;
3. record the exact page date and observed account version;
4. live-test any behavior that affects attendees, disclosure, provider mutation,
   recurrence, or payment-tier assumptions;
5. add the observation as a new dated evidence file rather than rewriting this
   historical record; and
6. change Planipus behavior only through its requirement/ADR/conformance process.

