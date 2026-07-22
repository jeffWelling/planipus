# Product specification

## Promise

Planipus is calm, self-hosted calendar orchestration. It keeps a person's
availability truthful across independent calendars, protects the edges of the
day, and helps recurring meetings find safe times while disclosing only what
the user chooses. The intended product is broadly competitive with Reclaim's
calendar-policy and adaptive-planning surface, built as original open-source
software from reviewed compatible components.

The product is not "AI that owns your calendar." Google, Outlook, and CalDAV
remain sources of truth; deterministic policy, explicit previews, provenance,
and understandable recovery remain the mutation boundary. Model integrations
may later help express intent, but are never required to schedule or sync.

Cross-account Calendar Sync is the **release-critical wedge**, not the entire
product definition. No edition may claim a trustworthy release until its
directed bridge passes the live two-account and ordinary-viewer privacy gates.
Protected Hours, availability fences, and Smart Meetings are active product
scope and have Server alpha foundations, but they do not weaken or replace that
gate. `CALENDAR-SYNC.md` remains authoritative for bridge behavior.

## Primary users

1. **Self-hoster:** one person with separate employer and personal Google
   accounts who needs work-calendar availability blocked without exposing
   personal event details, using a low-maintenance pod.
2. **Busy contributor/manager:** calendars and recurring meetings compete for
   limited work time; wants defended personal boundaries and calm, reviewable
   conflict recovery.
3. **Future — planner user:** tasks, routines, meetings, and focus compete for
   one week; wants an actionable plan and low-friction execution.
4. **Future — team lead:** wants focus/meeting policies and capacity without
   surveillance.
5. **Future — scheduler/executive assistant:** manages delegated calendars with
   explicit scope and audit.
6. **Platform operator:** needs OIDC, secret rotation, retention, metrics, backup,
   upgrades, and egress control.

## Scope and release truth

| Capability family | Product status | Current implementation truth |
|---|---|---|
| Directed Calendar Sync | Release-critical wedge | Server and Mac foundations; credential-free only; live two-account and third-viewer gates remain |
| Working/Meeting/Personal/Custom Hours | Active common substrate | bridge Hours engine exists; planning rules still embed narrow weekly windows instead of reusable profiles |
| Availability fences | Active P1 | Server alpha preview/materialization/owned writes; no Mac or live Google evidence |
| Smart Meetings | Active P1 | Server alpha placement, 24-hour no-move lock, and actionable accept/dismiss suggestions; full recurrence, external-attendee availability, and live-provider proof missing |
| Buffers and travel | Planned parity | research/specification only |
| Scheduling Links and routing | Planned parity | research/specification only |
| Habits, Tasks, and Focus | Planned parity | research/specification only |
| Meeting Quality, overload defense, and team policy | Planned parity | research/specification only |
| Planner, Insights, Assistant, API/MCP automation | Planned parity | generic Server REST foundation only; no Insights, Assistant, or MCP workflow |

“Active” authorizes scoped implementation; it does not mean production-ready.
“Planned parity” records intended product direction; it does not authorize a
release claim or imply that every Reclaim behavior will be copied literally.

## Active domain language

- **Connection:** one independently authorized Google identity.
- **Endpoint:** a calendar owned by one connection.
- **Hours profile:** weekly local-time intervals and dated exceptions.
- **Bridge / sync policy:** one directed source→destination rule.
- **Observation:** normalized knowledge of a source or destination event.
- **Projection / copy:** the maintained destination event for one source event
  or occurrence under one policy.
- **Privacy preset:** versioned field and visibility transformation.
- **Decision reason:** stable explanation for create/update/delete/exclude.
- **Working Hours:** windows in which solo work and bridge policies normally
  apply.
- **Meeting Hours:** the hard candidate window for Planipus-created meeting
  placements. It is not, by itself, a provider-level invitation firewall.
- **Availability fence:** Planipus-owned private Busy events before/after the
  workday or on closed days so ordinary provider free/busy also sees the
  boundary.
- **Smart Meeting:** a recurring meeting rule with cadence, attendees,
  availability calendars, preferred time, allowed Meeting Hours, and conflict
  policy.
- **Suggestion:** a proposed attendee-visible change that remains inert until a
  user reviews and applies it. The Server alpha lists expiring move/skip
  suggestions and supports accept/dismiss; accepting a skip queues cancellation
  of the owned occurrence. Full at-click availability/provider-basis
  revalidation and choose-another-time remain incomplete.

## Core journeys

### Keep work and personal calendars in sync without leaking details

Connect each Google account separately, name the boundary (“Work” and
“Personal”), choose which calendars participate, and create a mirror route. The
default employer-to-personal route publishes only a private busy block; it does
not copy title, description, attendees, location, or conferencing. Planipus
shows a dry-run and first-write preview, identifies every target event it will
create/update/delete, marks copies with provenance, and can pause, detach, or
reconcile a route without losing the source event.

The policy can restrict copies to configured work hours. Ordinary source
creates/updates/deletes reconcile automatically after activation; a preview is
used when creating or materially changing the policy.

### Protect the edge of the day

Choose a writable calendar, working days, workday start/end, and whether to
protect mornings, evenings, and closed days. Planipus previews a rolling set of
private Busy events with no attendees or reminders, then maintains only events
that carry its planning provenance. Meeting Hours still constrain Planipus's
own scheduling; the optional fence is what publishes the boundary to other
calendar tools.

The current implementation is a **Server alpha**: it supports preview,
activation, rolling owned events, pause/resume with pending-write recovery,
bounded replanning, and rule removal that cleans up marker-owned events. It does
not yet have reusable named Hours, date exceptions, rule editing/detach, an
impact preview before removal, planning-event drift verification, live Google
proof, or a Mac implementation. In Google mode, fence effects also remain
disabled unless the experimental planning flag is explicitly enabled.

### Keep recurring meetings alive

A Smart Meeting has cadence and flexibility rather than one permanent
timestamp. Planipus previews occurrences inside explicit Meeting Hours, avoids
Busy observations from selected readable calendars, warns when required
attendee availability is unknown, and records why a slot was selected or could
not be found.

The conflict default follows the safer **Reclaim 2.0 suggest-first** model:
detect a conflict, stage a proposed move, and require human approval before an
attendee-visible provider update. Reclaim 1.0's automatic movement is a distinct
behavior and may exist only as an explicit opt-in policy. The current Server
alpha excludes past slots; requires every selected availability calendar to
have a ready sync cursor successful within 30 minutes; treats other active Smart
Meeting occurrences as Busy; excludes the same rule's own observed Google event
by private marker; and holds changes inside the configured 24-hour no-move
window. It lists actionable move/skip suggestions, accepts or dismisses them,
queues cancellation for an accepted skip, resumes stranded pending writes, and
rejects stale provider jobs by intent sequence.

These are still independent planned events, not proven recurrence-series
semantics. External-attendee availability remains unknown unless explicitly
mapped; P1–P4 priority is stored but not used to rank slots; accepted
suggestions do not yet perform the complete at-click basis/provider/freshness
revalidation; and no live invitation/update evidence exists. Google planning
writes are therefore disabled by default and require the explicit
`PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true` operator flag. Those gaps prevent a
parity or release claim.

## Planned Reclaim-parity journeys

The remaining journeys are intended product breadth, sequenced behind the
release-critical bridge and the active protected-time/Smart Meeting hardening
work. They are not evidence that the features already exist.

### Start with a truthful week

Connect calendars, select which affect availability, choose privacy mirror rules,
set working/personal hours, seed a focus goal and routines, then preview before
Planipus writes anything.

### Capture and schedule work

Capture a task by form, keyboard command, API, MCP, or integration. Add only the
minimum fields; defaults are visible. Planipus shows the proposed block(s), risk,
and why. Manual drag creates a lock or preference according to the chosen action.

### Recover a disrupted day

New anchor arrives. Planipus creates a pending plan with moved work, unmet
capacity, and affected people. User can apply all, reject all, lock one item and
recompute, or edit constraints. Undo creates a new compensating plan.

### Protect focus without disappearing

Focus goals progressively defend useful contiguous blocks while retaining an
operator-set amount of meeting availability. Qualified work counts toward the
goal. The week view shows protected, achieved, and at-risk minutes.

### Let someone book the right person

Booking rules combine provider free/busy, Planipus priority, buffers, caps,
ownership, round-robin load, and form answers. The routing decision has an
explanation and idempotency key. No lower-priority event moves invisibly.

### Review, then shut down

Morning: clear inbox, inspect risks, accept/edit plan, choose daily outcomes.
Focus: work one item, track actuals and interruptions. Shutdown: reconcile undone
work and preview tomorrow. Weekly: compare focus, meeting load, estimate error,
and capacity without productivity scoring people.

## Information architecture

The current Server alpha exposes:

- **Overview:** bridge health, recent decisions, and errors;
- **Calendars:** connected identities and provider calendars;
- **Bridges:** directed privacy-controlled copies;
- **Protect:** protected-hours availability fences;
- **Meet:** Smart Meeting rules and occurrence status; and
- **Settings:** installation, Hours explanation, security, and diagnostics.

The current Mac alpha exposes only its native connection, bridge, preview,
health, and menu-bar flow. Protect and Meet do not silently proxy to Server and
are not yet implemented on Mac.

Future broad-parity information architecture may add:

- **Week:** primary combined calendar, backlog, goals, and pending-plan impact.
- **Today:** agenda, focus execution, quick capture, recovery controls.
- **Work:** inbox, tasks, projects, routines, focus goals.
- **Meet:** smart meetings, booking pages, routing, meeting quality.
- **People:** team availability, policies, OOO, aggregate capacity.
- **Insights:** personal/team time categories, focus, meetings, workload, estimate
  accuracy, and plan churn.
- **Automations:** provider/task/chat integrations, rules, assistant, MCP, webhooks.
- **Admin:** identity, roles, policy, retention, audit, secrets, health, backup.

## Trust rules

1. Account connection is read-only in effect; no destination writes until the
   applicable bridge or planning preview is explicitly activated.
2. Once activated, ordinary source changes reconcile automatically without
   repeated approval.
3. Never disclose a source field the policy does not authorize.
4. Never promise that provider-private detail is hidden from calendar editors or
   domain administrators.
5. Never send invitations or reminders from a P0 projection.
6. Never modify or delete a source event.
7. All managed destination effects are attributable, idempotent, and auditable.
8. Meeting Hours constrain Planipus-created placements; do not claim they block
   arbitrary invitations unless a separately tested provider policy does so.
9. Availability fences contain no attendees or reminders, default to private
   visibility, and mutate only marker-verified Planipus-owned events.
10. Attendee-visible Smart Meeting conflict changes default to suggest-first.
    Any automatic move is explicit opt-in, clearly labeled as Reclaim 1.0-style
    behavior, and release-gated by notification/concurrency evidence.
11. Fake-provider planning remains available for testing, but real Google
    availability-fence and Smart Meeting writes remain disabled unless the
    operator explicitly enables the experimental planning flag.
