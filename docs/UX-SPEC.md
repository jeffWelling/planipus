# Active alpha experience specification

Planipus should feel like calm personal software: a trustworthy control panel
for calendar boundaries, protected time, and adaptable meetings. It is not a
dense productivity dashboard and not a chatbot that silently owns the calendar.
The UI must make five facts obvious:

1. where an event originates;
2. where a managed copy will appear;
3. exactly what the destination can reveal;
4. whether an Hours rule merely constrains Planipus or publishes Busy time to a
   provider; and
5. whether a meeting change is only suggested, approved, or automatic.

`CALENDAR-SYNC.md` controls bridge behavior. `REQUIREMENTS.md` controls active
protected-time and Smart Meeting acceptance. This document controls
presentation and interaction.

## Product surfaces

The browser belongs to Planipus Server. The native SwiftUI/AppKit application
belongs to an independent Planipus for Mac installation; it is not a WebView or
a server client. The editions use the same user concepts, privacy preset names,
reason codes, and disclosure expectations through shared conformance fixtures,
not a shared API. Their accounts, bridges, health, and settings never appear in
one another.

The Mac adds a MenuBarExtra for status, open-error, and Sync Now. Closing the
main window may leave the menu-bar application running. **Quit Planipus** stops
all synchronization. Sleep, power-off, network loss, or replacing the Mac also
stops the local installation; it catches up after wake/relaunch/reconnect. The
UI, onboarding, help, and release notes state this plainly and show the actual
last successful sync time.

The Server browser may be closed without stopping its independent Kubernetes
workers. Never use this fact to describe or imply continuity for the Mac
edition.

Current edition truth must be visible, not buried in release notes:

- **Server alpha:** Bridges, Protect availability fences, and Smart Meetings
  have implementation foundations and capability flags;
- **Mac alpha:** only the native bridge flow exists; Protect and Meet are absent;
  and
- neither edition has passed the live Google/release evidence needed for a
  trustworthy public feature claim.

In Server Google-provider mode, Protect/Meet provider writes are disabled unless
the operator sets `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`. Fake-provider
writes remain enabled for testing. The current browser does not surface this
gate, so it can accept an activation while effects remain pending. Before any
public alpha, expose `Google planning writes disabled` near both primary actions
and never report a calendar event as created from queued local intent alone.

## Navigation

The current Server alpha has six primary destinations:

- **Overview:** connection health, active bridges, recent decisions, errors;
- **Calendars:** connected identities and their calendars;
- **Bridges:** directed sync policies and their projections;
- **Protect:** availability fences that publish private Busy time outside the
  workday;
- **Meet:** Smart Meeting rules, upcoming materialized occurrences, conflicts,
  and suggestions;
- **Settings:** Hours explanation, installation, backup, security, and
  diagnostics.

Mac retains its native onboarding/sidebar/menu-bar bridge structure until the
planning features independently satisfy the native P1 acceptance. Do not show
disabled Server-shaped screens as if pairing will unlock them.

Use the word “bridge” in ordinary UI copy and “sync policy” in detailed/admin
contexts. Never imply that connecting an account starts writing events.

Server desktop uses a quiet left rail; its mobile browser uses a compact bottom
navigation. Mac uses native sidebar/window conventions. A persistent status
control shows `All bridges current`, `Syncing`, `Delayed`, `Offline`, `Paused`,
or `Action needed`, with the last successful observation. “Current” is only
shown after provider reads and pending effects succeed, never from local intent
alone.

## First run

The welcome screen states the narrow promise:

> Keep work availability honest without sharing the details of your life.

It explains that source events stay in their original calendar and Planipus can
create sanitized copies elsewhere. The primary action is **Connect first Google
account**. Secondary links explain self-hosted data storage and OAuth scopes.

On Mac, a compact **Runs on this Mac** panel adds:

> Planipus syncs while this app is running and your Mac is awake and online. If
> you quit, sleep, or go offline, changes wait and catch up next time.

Do not call the local edition “always on” or show a Kubernetes upgrade path as
if it continues the local installation.

Account onboarding:

1. name the boundary before OAuth: `Personal`, `Work`, or a custom label;
2. show requested Google scopes and why read/write access is eventually needed;
3. complete OAuth in the provider;
4. show connected identity, calendars, read/write capability, and token health;
5. return to an explicit **Connect another account** action.

No destination event is created during account connection.

After two writable endpoints exist, the primary action becomes **Create a
bridge**.

## Create bridge wizard

### Step 1 — Direction

Show two large endpoint selectors with an arrow:

```text
From: Personal · jeff@example.net · Primary
  →
To: Work · jeff@employer.example · Primary
```

Copy states: “Events originate on Personal. Planipus will maintain separate
copies on Work. It will never modify the Personal originals.”

The same endpoint cannot occupy both sides. A reciprocal bridge is offered only
after this one is active, and is stored as a second policy.

### Step 2 — When

Default: **Only events that overlap my work hours**. Alternatives are **All
times** and advanced **Only events fully inside these hours**.

The selected hours profile is rendered as a simple weekly schedule in its named
timezone. Partial overlap copy explains: “If any part overlaps, the complete
event is copied so your unavailable time stays accurate.” Exceptions and DST
diagnostics are available without technical jargon.

Separate controls cover:

- all-day: skip / busy all-day only / all;
- free events: skip / copy as free / copy as busy;
- tentative and unanswered invitations;
- declined events, always skipped by default;
- skip when the destination identity is already invited;
- source `#nosync` override, enabled by default.

### Step 3 — Privacy

Four choices are presented from safest to most revealing:

- **No details:** destination says `Busy`;
- **Type only:** destination says `Personal commitment`, `Work commitment`,
  `Travel`, or another selected generic label;
- **Details private:** copy selected detail fields but ask Google to show ordinary
  viewers only busy;
- **Share selected details:** destination access rules can expose copied fields.

Each card includes a miniature “coworker view.” Selecting a choice opens a field
table for title, description, location, conference information, attendees,
organizer, reminders, and provider metadata. The table says `copied`, `replaced`,
or `never copied`.

Attendees and organizer are never copied in P0. Reminders are always none. For
private details, show the permanent warning that destination calendar editors
and Workspace administrators may still see private event content. For shared
details, require an acknowledgement of the exact fields being disclosed.

### Step 4 — Preview

Preview performs no provider write. It shows:

- create/update/delete/unchanged/excluded counts;
- excluded counts by calm reason labels such as `Outside work hours`;
- three or more representative transformations, redacting source details when
  the current screen does not need them;
- a destination-event rendering with summary, time, visibility, color, and no
  reminders;
- warnings for large deletion sets, inaccessible calendars, stale provider data,
  administrator visibility, or reciprocal-loop risk.

Primary action names the effect: **Turn on bridge and create 4 copies**. A stale
preview disables activation and offers **Refresh preview**.

### Step 5 — Active

The confirmation screen says the bridge is automatic. It links to the newly
created policy, recent projections, and **Create reverse bridge**. It does not
ask the user to approve each ordinary event.

## Overview

The top section shows connection health and active direction cards, for example:

```text
Personal → Work
Work hours · No details · 18 managed copies
Current as of 2:31 PM
```

Cards have Pause, View, and More menus. Pause stops future effects without
deleting copies until the user chooses cleanup. Recent activity uses policy
decisions, not source content: `Created busy copy`, `Removed after source was
declined`, `Skipped outside work hours`.

An error card always gives impact and recovery: what is stale, whether existing
copies remain, last success, next retry, and Reconnect/Reconcile action.

## Bridge detail

Header: direction, state, privacy preset, hours profile, last observation, last
successful effect, projection counts, and next safety sync.

Tabs:

- **Activity:** redacted decision timeline;
- **Managed copies:** source reference, destination reference, time, status,
  reason, attempts, and safe diagnostics;
- **Rules:** readable summary plus Edit;
- **Health:** watches/cursors, lag, provider permissions, queue/dead letters;
- **Danger zone:** pause, detach, delete copies, or delete policy.

Managed-copy actions distinguish:

- **Reconcile:** restore the destination to current policy;
- **Detach:** stop managing it and leave the current destination event;
- **Remove copy:** delete only the managed destination event; if the source still
  qualifies, explain that active policy would otherwise recreate it.

Never offer an action that mutates the source event.

## Editing policy

Opening Edit creates a draft. Material changes—direction, hours, selection,
privacy, or destination behavior—produce a fresh impact preview. The comparison
shows current → proposed settings and counts. The button says what changes, for
example **Save and remove 12 copies now outside work hours**.

Ordinary cosmetic labels can save without provider impact. Every accepted change
records actor, policy version, timestamp, counts, and disclosure transformation.

## Hours editor

Use day rows with one or more start/end intervals and an explicit timezone.
Copying a weekday schedule is easy; overnight intervals are allowed and displayed
across the day boundary. Date exceptions support Closed or Replacement hours.

Before changing a used profile, show all affected bridges and projection counts.
Exactly-at-boundary examples and current timezone offset are available under
“How overlap works.”

## Protect: Hours and availability fences

The Protect screen starts with a permanent distinction:

> **Meeting Hours** stop Planipus from placing a meeting outside the chosen
> window. An **availability fence** creates managed private Busy events so other
> calendar tools also see that time as unavailable.

Never shorten that to “Planipus blocks after-hours meetings.” Hours do not prove
that an arbitrary provider invitation will be rejected. A fence publishes Busy
time but also does not guarantee that another organizer cannot invite the user.

The current Server alpha composer supports:

- one writable target calendar, labeled with account boundary and calendar;
- timezone, workday start, and workday end;
- Monday–Friday working days;
- always-on after-work protection;
- optional before-work protection and weekend/closed-day protection;
- a destination label such as `Personal time`; and
- a 21-day rolling preview.

Preview shows the exact private Busy interval count, representative dates/times,
target calendar, and `0 invitations or reminders`. Activation copy names the
count: **Turn on and add 12 blocks**. Generated fence events have no attendees,
no reminders, Busy transparency, private visibility by default, and separate
planning ownership markers. The active card shows managed blocks, items needing
attention, proposed changes, upcoming intervals, and Pause/Resume.

The implemented UI must carry an **Alpha** explanation until these gaps close:

- the capability API reports `alpha`, but the current Protect screen does not
  yet render that status or a known-limitations link;
- Hours are stored inside each rule; reusable named Working/Meeting/Personal/
  Custom Hours, multiple ranges, and dated exceptions are not yet editable;
- Remove now uses an explicit confirmation and queues owned-copy cleanup, but
  rule edit/detach and a count/interval impact preview before removal are absent;
- planned-event drift/ambiguity recovery is incomplete;
- the UI does not yet show last successful provider write or stale availability
  independently from bridge health; and
- private presentation, zero mail/reminders, rolling renewal, and recovery have
  not been observed against live Google accounts or an ordinary viewer.

Pause leaves existing fence events in place and stops maintenance. Resume
re-enqueues any pending owned writes. **Remove** expires the rule and queues
deletion only for marker-owned blocks; the current confirmation explains that
effect. Before release, replace the count-free confirmation with a preview of
every deletion and continue to hold any marker mismatch.

## Meet: Smart Meetings

The Meet screen explains a Smart Meeting as a recurring rule with room to move,
not as invisible calendar autonomy. It must also explain the product-version
choice:

- **Suggest a move** is the default, matching Reclaim 2.0's documented
  suggest-first attendee behavior; and
- **Move automatically** is a distinct Reclaim 1.0-style opt-in, visibly marked
  experimental until notification, RSVP, concurrency, lock, recurrence, and
  live-provider tests pass.

The current Server alpha composer asks for meeting name, writable target
calendar, one optional required attendee email, one preferred weekday, Meeting
Hours start/end, ideal time, fixed 15/30/45/60-minute duration, timezone, and
which connected readable calendars count as availability. It defaults to six
weekly occurrences, P2, 15-minute candidate steps, a 24-hour lock value, and
`suggest` conflict policy. Those hidden defaults must be disclosed in an
advanced summary. The no-move window is enforced for existing occurrences;
P1–P4 priority is not yet used to rank slots and must not be described as
effective.

Availability-calendar rows say only that Busy observations block candidates;
titles stay private. If an attendee has no connected/mapped availability, show:

> These times are safe for your selected calendars, but Planipus could not check
> this attendee's availability.

Never label that result “mutual availability.” Preview lists every occurrence,
chosen time, reason, rejected-conflict count, unmet count, and warnings. The
activation action explicitly says whether it will send invitations, for example
**Create 6 meetings and send invite**. Initial attendee writes are therefore a
socially visible mutation and require the fresh preview; a no-attendee rule does
not send updates.

The current hero and preview-loading copy still use “mutual” even when an
external attendee has no mapped calendar. Replace those strings with “selected
calendar availability” unless every required attendee is actually represented.

Preview is unavailable unless every selected calendar has a `ready` sync cursor
whose last success is no more than 30 minutes old. Candidate search excludes
past starts and treats other active Smart Meeting planned events as Busy. A
Google observation carrying this rule's private marker is ignored so the rule
does not block itself. These checks establish current local input safety; they
do not prove external-attendee availability or live provider completeness.

Active cards show upcoming independent planned events, unmet occurrences,
pending suggestion count, Check again, Remove, and Pause/Resume. Pause leaves
existing meetings in place; resume re-enqueues pending writes. Remove warns that
future owned meetings will be cancelled and queues marker-verified cleanup.
Cards must not imply that the provider stores one fully managed recurrence
series: current alpha events are separately materialized occurrences.

The implemented suggestion shelf is actionable. A move shows current → proposed
time with **Keep current** and **Approve move**. A skip explains that no safe
replacement exists and offers **Keep current** or **Cancel this occurrence**.
Accept/dismiss is audited, suggestions expire, accepted skips queue
cancellation, and provider jobs carry an expected intent sequence so older jobs
cannot apply after a newer decision.

The remaining suggest-first UX and safety work is:

1. show affected attendees, reason, cursor freshness, and notification
   consequence on every suggestion;
2. add **Choose another time**;
3. revalidate rule revision, provider state, occurrence identity, lock window,
   suggestion basis, and availability immediately before accept;
4. make a stale result send no update and offer a recomputed proposal; and
5. surface the audit/activity entry after accept, dismiss, expiry, cancellation,
   or automatic movement.

The capability API reports `alpha`, but the current Meet screen does not yet
render that status or a known-limitations link. Rule editing/detach, complete
external-attendee free/busy, provider recurrence exceptions, RSVP/decline
handling, manual-move locking, and live invitation/update recovery are also
incomplete.

## Deletion and disconnect

Destructive flows never combine unrelated choices.

Deleting a bridge asks separately whether to:

- stop management and leave its existing copies; or
- delete its existing managed copies.

Disconnecting an account previews affected bridges and managed copies, then asks
whether to revoke at Google. Source calendars and original events are never
deleted. The completion screen reports partial cleanup and retryable failures.

## Required states

Every relevant screen implements: first-use empty, loading, success, validation,
forbidden, offline, provider stale, OAuth revoked, rate limited, partial job,
conflict, no filter results, and destructive confirmation. Empty activity is not
shown as a failure. A provider outage does not produce a misleading green state.

Protect and Meet additionally distinguish `Planning`, `Pending provider write`,
`Current`, `Unmet`, `Suggestion waiting`, `Held for ownership review`, and
`Paused`, plus installation-level `Google planning writes disabled`. Their
status cannot be derived from bridge status. An unmet meeting is not an error if
the rule correctly refused to escape Meeting Hours; it is an action-needed
scheduling result.

## Accessibility and responsive behavior

- WCAG 2.2 AA target; complete critical flow by keyboard and screen reader.
- Direction and privacy never rely on arrow shape or color alone.
- Every account is named by boundary plus masked identity; identical calendar
  names remain distinguishable.
- Status updates use concise live regions and never announce every sync item.
- 200% zoom and 320 CSS-pixel width retain all actions without horizontal page
  scrolling; tables become labeled rows.
- Motion is restrained and respects reduced-motion preference.
- Times always expose timezone and offset; ambiguous DST times are explained.
- Destructive focus returns predictably and validation focuses a summary.

## Visual direction

Use the calm “working almanac” idea provisionally: warm neutral canvas, ink-like
text, restrained endpoint colors, crisp rules, and small moments of playful
Planipus character. Avoid generic productivity gradients, glowing AI controls,
dense calendar grids, and card walls. Bundle fonts/icons; no runtime asset CDN.

## Copy rules

- Say `source` and `destination` in detailed explanations, `from` and `to` in the
  wizard.
- Say `copy`, never `share`, when a provider event will be created.
- Say `private to ordinary viewers`, never promise absolute privacy.
- Say `current as of…`, not `live`, unless watch and lag evidence support it.
- State effect counts in buttons when known.
- Avoid blame: `Google access needs attention`, not `Your sync failed`.
- Say `inside Meeting Hours`, not `after-hours invitations are blocked`.
- Say `private to ordinary viewers`, not `secret`, for availability fences.
- Say `suggested move` until the user applies it; never describe a recorded
  suggestion count as a completed reschedule.
- Label automatic conflict movement `Automatic · experimental (1.0-style)`
  until its release evidence passes. The default label is
  `Suggest first · recommended (2.0-style)`.

## Later parity surfaces

Week/Today planners, work capture, Tasks, Habits, Focus goals/timers, buffers,
public/team/round-robin booking, Meeting Quality, team capacity,
privacy-preserving insights, and assistant UI remain later broad-parity work.
They are intended product direction, not current implementation and not a reason
to postpone the release-critical bridge or active planning safety gaps.
