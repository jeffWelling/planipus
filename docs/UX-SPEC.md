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
5. whether a meeting change is only suggested, approved, or automatic; and
6. whether private time is represented by a copy/fence or used only for a
   no-copy invitation response.

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

- **Server alpha:** Bridges, Protect availability fences, Smart Meetings,
  no-copy conflict response, scoped API tokens, and stdio MCP have implementation
  foundations and capability flags;
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

The current Server alpha has seven primary destinations:

- **Overview:** connection health, active bridges, recent decisions, errors;
- **Calendars:** connected identities and their calendars;
- **Bridges:** directed sync policies and their projections;
- **Protect:** availability fences that publish private Busy time outside the
  workday;
- **Meet:** Smart Meeting rules, upcoming materialized occurrences, conflicts,
  and suggestions;
- **Private replies:** no-copy rules that can decline an unanswered work
  invitation when selected private calendars are busy; and
- **Settings:** Hours explanation, installation, backup, security, diagnostics,
  and API-token/MCP setup.

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

Role choices explain scope before OAuth:

- **Availability only (recommended for private conflict checks):** calendar list
  and busy/free intervals; cannot read event titles or details and cannot be a
  bridge source;
- **Source:** event read plus free/busy for bridges and availability;
- **Destination:** event write for copies/planning; and
- **Both:** event read/write plus free/busy, required for a work account that
  receives invitations Planipus may respond to.

If an old source/both grant lacks free/busy, show **Reconnect to add private
availability permission**; never fail as if an event or calendar were invalid.

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

## Private replies: no-copy conflict response

This screen must not look like another bridge wizard. Its hero says:

> **Keep the details home. Decline the collision.** Private replies do not copy
> personal events. When a new, unanswered work invitation overlaps private busy
> time, Planipus can decline it with your message.

A persistent summary shows **0 new copies from private replies** and explains
that the strict-private availability account contributes busy/free intervals
only. If setup pauses an existing bridge, show a separate warning that its
already-created managed copies remain; never collapse that state into zero.
Guardrails are visible before the composer:

- only unanswered work invitations;
- only future timed overlaps on explicitly selected calendars;
- never when the connected identity organizes the meeting;
- never accepted, tentative, declined, cancelled, started, or changed events;
- no event/fence created on either calendar; and
- pause stops future replies but never auto-accepts or undoes one already sent.

The new-rule composer collects:

1. a name;
2. the work calendar that receives invitations (readable/writable `both` only);
3. one through 32 private availability calendars, preferring/highlighting
   `availability` role and a dedicated calendar with no bridge history, while
   warning when `source|both` has broader event access;
4. look-ahead horizon (2 weeks, 30, 60, or 90 days in current UI; API accepts
   1–90); and
5. static decline comment, maximum 500 characters, with live character count
   and “same message every time; event details are never inserted.”

If any selected private availability calendar is the source of an **active**
bridge to work or any other schedule, block preview and offer **Pause outbound
bridges** or a different private calendar. Before pausing, list the affected
destinations and say plainly that existing managed copies remain; enabling no-
copy does not delete, detach, or redact them, and the current alpha has no
cleanup flow. A paused bridge permits preview but retains that warning. The
bridge wizard and resume action apply the opposite block whenever either
endpoint is protected by any non-deleted no-copy rule, even a paused rule.

If a selected availability calendar is the destination of an active **or
paused** bridge, block preview with `availability_copy_feedback`. Pausing is not
enough because surviving inbound copies can appear as private busy time; choose
a dedicated clean calendar until an explicit bridge-copy cleanup flow exists.
Never imply
that the whole installation has zero copies when older bridge copies remain.

The composer repeats **Private replies create no personal-event copies**
immediately before the primary **Preview automatic declines** action. If no `both` work account
exists, disable creation and explain how to reconnect it. If no availability-
only account exists, allow event-readable source/both calendars but recommend
the narrower connection rather than misrepresenting whole-installation storage.
Availability-only calendar rows may carry `readable: false`; use
`capabilities.freebusy_readable: true` to show **Free/busy only**, never
**Unreadable** or an event-read permission.

Do not show two delegated Google aliases of one underlying calendar as valid
source/destination or response/availability choices. If submitted anyway, map
`same_provider_calendar` to **These choices point to the same Google calendar**.
A quarantined historical alias self-copy bridge is not an ordinary user pause:
show it as stopped for safety, explain that old destination copies remain, and
offer review guidance from audit reason
`policy.quarantined_same_provider_calendar` without offering Resume.

When reauthorization returns `availability_role_change_blocked`, explain that
pausing is not enough. Offer retirement for supported planning/private-reply
rules. For a bridge or historical projection/action blocker, state that this
alpha cannot safely retire/purge it and recommend keeping the broader role or
connecting a separate dedicated availability-only Google account. Never
instruct the user to edit PostgreSQL or imply the privacy downgrade succeeded. A
successful transition can report the audited
counts of observations/cursors removed and endpoints restricted.

When OAuth returns `oauth_scope_overbroad`, explain: **Google kept broader
calendar access from an earlier connection. Revoke Planipus in your Google
account, then connect again as Free/busy only.** Do not imply that retrying the
same callback, pausing a rule, or changing a Planipus label removed Google's
grant. The existing connection/data state remains unchanged until a later
successful guarded callback.
Map `oauth_scope_unverified` to the same recovery with **Google did not report
which calendar access it granted, so Planipus stopped instead of guessing.**

Preview shows:

- `0 new calendar copies from this rule` as the leading count; if a bridge was
  paused, separately show its remaining managed-copy count/impact;
- eligible conflicting invitation count and selected private calendar count;
- the total unanswered work invitations checked, overlaps found, and conflicts
  safely held for missing revision;
- at most three time-only examples—no title, event ID, personal event identity,
  calendar content, attendee, or reason revealing private subject matter;
- exact configured response comment;
- expiry and a statement that activation rechecks invitation and availability;
- calm mapped warnings for paused legacy copies, broader source/both storage,
  and conflicts above the 20-per-rolling-24-hours automatic decline budget;
- `provider_writes_enabled` as an activation gate; and
- `message_delivery` as **Simulated** or **Not verified by Google**, never as a
  generic success badge.

The primary action is **Turn on private conflict replies**. If the preview goes
stale, retain the draft, explain that invitation or availability changed, and
offer **Refresh preview**; never activate an older result.

Active rule cards show work calendar, On/Paused, selected private calendar
count, `0 copies created by this rule`, configured message, declined/pending/
held counts, horizon, safe error and last safe check. Explain that a successful
work sync triggers a check immediately and the 15-minute timer is a fallback.
Actions are **Check now**,
**Pause/Resume**, and **Retire private replies**. Retirement confirmation says
pending/held actions are superseded, applied declines are not undone, old bridge
copies are not cleaned, and a previously paused bridge may then resume. Only one
live rule may control the same provider work calendar/alias. Raw safe error
codes should ultimately map to calm explanations and repair actions; exposing
underscore-separated codes is alpha debt.

Map `decline_comment_not_retained` to **Reply declined; Google did not retain the
comment** with supporting copy: “The meeting is declined and counts toward your
24-hour safety limit. Planipus will not keep rewriting a confirmed response.”
This is an applied-with-warning state, not held/failed and not proof the
organizer saw a message. Budget copy explains that immutable decline history
survives reschedules, retirement, and internal action reuse.

That warning may appear when the first exact check for a pending action already
finds the meeting declined. In that recovery case Planipus made no new write but
conservatively counts the result because it cannot distinguish a previous
crash-after-write from a manual decline. Say **No additional reply was sent**;
never claim Planipus definitely caused the decline. Accepted/tentative responses
remain untouched.

A release-gate notice remains visible while live Google behavior is unproven:
Google documents the RSVP status change, not guaranteed organizer delivery of
the attendee comment. Planipus requests a quiet update and deliberately avoids
broad guest notifications, but cannot promise that Google sends no email. When
`provider_writes_enabled=false`, disable **Turn on private conflict replies** and
explain that activation will return `invitation_writes_disabled`; preview remains
available, but no active rule is created. Disable rule **Resume** for the same
reason. Fake mode is visibly **Simulated**.
Even when the Google write gate is on, keep message delivery labeled **Not
verified by Google** and never imply that the provider RSVP or comment changed
until apply succeeds.

This screen is Server-only. Do not show it disabled in Mac or imply Kubernetes
can continue a Mac-installed rule.

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

## Settings: API tokens and MCP

Only the owner browser session can manage machine credentials. The default form
uses a human label, `Read` + `Preview` scopes, 90-day expiry in the current UI,
and leaves `Apply` unchecked. Copy explains that Apply can activate/pause/resume/
reconcile and also requires an MCP process opt-in; it is not needed for reading
or previews.

After creation, show the plaintext token in a one-time panel with:

- **Copy token**;
- **Copy MCP configuration** using the current public API origin;
- warning that dismissing loses the value and it cannot be recovered; and
- explicit instruction to store it as a secret, never in Git or chat.

The generated MCP configuration defaults
`PLANIPUS_MCP_ENABLE_APPLY=false` even if a broader token was issued, unless the
owner makes a separate deliberate choice. Explain that MCP is a local stdio
process that calls this Server API; it is not a remote endpoint and does not
connect to Planipus for Mac.

The token list shows label, scopes, creation, expiry, last used, revoked state,
and **Revoke**. It never shows token prefix/material beyond non-secret metadata.
Revocation confirmation names the likely client impact and is not bundled with
calendar/provider cleanup. Expired/revoked tokens remain clearly inactive until
retention removes metadata.

Required error states: owner authorization lost, expiry invalid, copy-to-
clipboard unavailable, API tokens unavailable during migration, token expired,
insufficient scope, MCP API unreachable, and apply disabled. Error copy must not
echo a token or arbitrary remote body.

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

Private replies additionally distinguish `No eligible invitations`, `Preview
expired/stale`, `Waiting to check`, `Held safely`, `Declined`, `Paused`,
`Reconnect for free/busy`, and `Google invitation replies disabled`. A held
action is success of a safety check, not a silent failure and not a completed
provider decline.

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
