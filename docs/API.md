# Planipus Server API, CLI, webhook, and MCP contract

Status: implementation contract for Calendar Sync plus the bounded alpha
availability-protection/Smart Meeting slice introduced by migration `0004`.
The complete planner, task, booking, analytics, and assistant APIs still require
later requirements/ADR evidence and are not part of this version. This is
exclusively the Kubernetes Server edition contract.
Planipus for Mac neither implements nor calls it; the Mac's local module ports
and persistence are private implementation details, not a remote API.

The canonical HTTP API is JSON under `/api/v1`. The web application calls the
same application services. Generate and release an OpenAPI document; tests must
fail when implementation, schema, or examples disagree.

## Implementation status at 0.1.0

This document intentionally describes the complete target contract. The current
working slice implements the routes below; every other route/CLI/MCP item in
this file remains a specified backlog item and must not be advertised as
available.

| Area | Implemented routes |
|---|---|
| Bootstrap/session | `POST /api/v1/session/bootstrap`, `GET /api/v1/session`, `DELETE /api/v1/session` |
| Google connections | `GET /api/v1/connections`, `POST /api/v1/connections/google/authorize`, `GET /api/v1/connections/google/callback` |
| Calendars/overview | `GET /api/v1/calendars`, `GET /api/v1/overview` |
| Capabilities | `GET /api/v1/capabilities` |
| Directed policies | `GET /api/v1/policies`, `POST /api/v1/policies/preview`, `POST /api/v1/policies`, `POST /api/v1/policies/{id}/pause`, `/resume`, `/recover`, `/reconcile` |
| Alpha planning | `POST /api/v1/planning/preview`, `POST`/`GET /api/v1/planning/rules`, `POST /api/v1/planning/rules/{id}/pause`, `/resume`, `/replan`, `DELETE /api/v1/planning/rules/{id}`, `GET /api/v1/planning/suggestions`, `POST /api/v1/planning/suggestions/{id}/accept`, `/dismiss` |
| Manual work | `POST /api/v1/sync` |
| Operations | `GET /api/health/live`, `/startup`, `/ready`; authenticated `GET /api/v1/health/detail` and `GET /api/metrics`; `GET /api/openapi.json` |

The current policy draft embeds a new hours profile in `hours_profile`; activation
persists that profile and replaces it with `hours_profile_id` atomically. Saved
hours-profile CRUD, policy edits/deletion/detach/cleanup, connection disconnect,
projection inspection, provider webhooks, API tokens, CLI, outbound webhooks and
MCP are not implemented yet. The React app uses only the implemented subset.
`POST /api/v1/policies/{id}/recover` is an explicit bounded retry for held or
failed projections and their dead effects, including verifier-only ownership
holds. It enables provider read-before-write, preserves effect ordering, and
does not assume an ownership collision has been removed. A retry whose source
hash, tombstone state, policy revision, or desired payload changed retires the
old effect locally and schedules current-source reconciliation instead of
calling the provider.

Current mutations use same-origin browser session + CSRF protection. The target
idempotency-key and ETag conventions below still apply to the larger public API
but are not yet uniformly exposed by this private setup slice.

The planning routes are deliberately labeled `alpha` by
`GET /api/v1/capabilities`. They have no Fastify JSON request/response schemas,
pagination, API idempotency keys, resource ETags, edit command, cleanup preview,
or owner/delegate authorization beyond the current single-owner organization
session. `GET /api/openapi.json` therefore inventories the routes but is not yet
a complete machine-readable planning contract.

## Conventions

- UTF-8 JSON; target command objects reject unknown fields. The current planning
  parser normalizes known fields but silently ignores unknown properties; this
  is a documented validation gap, not a compatibility promise.
- IDs are opaque. Instants are RFC 3339 UTC; wall-clock hours always include an
  IANA timezone and explicit DST policy.
- Lists use bounded cursor pagination: `items`, `next_cursor`, `has_more`.
- Errors contain stable `code`, safe `message`, `request_id`, optional field
  `details`, and retry metadata. Provider bodies and tokens are never returned.
- Mutating POST commands require `Idempotency-Key`. Mutable resources expose a
  version and ETag; PATCH/DELETE require `If-Match`.
- Asynchronous commands return HTTP 202 with a job or reconciliation identifier.
- Preview responses expire and bind the policy draft hash, account capability
  snapshot, source cursor, horizon, and current policy version.

The generic conventions above are target conventions unless the implementation
status says otherwise. Current planning mutations do not accept
`Idempotency-Key` or `If-Match`, and planning lists are unpaginated.

## Authentication

Browser sessions use secure HttpOnly SameSite cookies, CSRF protection, exact
origin validation, and rotation after login or privilege changes. API tokens are
scoped, expiring, random, stored hashed, and shown once. Initial single-user mode
still enforces authorization boundaries so future multi-user operation cannot
accidentally expose credentials or source details.

OAuth callbacks consume server-held, single-use, principal/organization-scoped
state and PKCE. The current callback is not bound to the initiating browser
session; adding that binding requires a separately designed callback cookie
whose cross-site behavior is tested explicitly.
The browser never receives provider access or refresh tokens.

Planipus for Mac has a separate installed-app OAuth relationship directly with
Google and no Planipus Server session. Do not add native-auth, device, pairing,
or instance-discovery endpoints for it.

## Session and installation

- `GET /api/v1/session`
- `DELETE /api/v1/session`
- `GET /api/v1/installation`
- `PATCH /api/v1/installation` — locale, default timezone, registration policy
- `GET /api/v1/health/detail` — privileged, privacy-safe component health

## Provider connections

- `GET /api/v1/connections`
- `POST /api/v1/connections/google/authorize`
- `GET /api/v1/connections/google/callback`
- `GET /api/v1/connections/{id}`
- `PATCH /api/v1/connections/{id}` — human label only
- `POST /api/v1/connections/{id}/reauthorize`
- `POST /api/v1/connections/{id}/sync`
- `POST /api/v1/connections/{id}/disconnect:preview`
- `POST /api/v1/connections/{id}/disconnect`

Authorize returns a same-origin redirect target and never a token. A connection
response may expose provider, masked identity, scopes, capability flags, last
success, lag, and action-required reason; it omits token material and raw OAuth
responses.

Disconnect preview reports affected policies and projections and offers explicit
choices: stop only, remove managed destination copies, or leave copies detached.
The command never deletes source events.

## Calendar endpoints

- `GET /api/v1/connections/{id}/calendars`
- `GET /api/v1/calendars/{id}`
- `PATCH /api/v1/calendars/{id}` — local label/color/ignore metadata only

Responses identify the owning connection, provider calendar ID through an opaque
local reference, provider timezone, primary/readable/writable flags, and health.
Privacy and filtering do not live on a source calendar: they belong to each
directed sync policy.

## Hours profiles

- `GET /api/v1/hours-profiles`
- `POST /api/v1/hours-profiles`
- `GET/PATCH/DELETE /api/v1/hours-profiles/{id}`
- `POST /api/v1/hours-profiles/{id}/evaluate`

Representative profile:

```json
{
  "name": "Employer hours",
  "timezone": "America/Vancouver",
  "weekly": {
    "monday": [{"start": "09:00", "end": "17:00"}],
    "tuesday": [{"start": "09:00", "end": "17:00"}],
    "wednesday": [{"start": "09:00", "end": "17:00"}],
    "thursday": [{"start": "09:00", "end": "17:00"}],
    "friday": [{"start": "09:00", "end": "17:00"}]
  },
  "exceptions": [
    {"date": "2026-08-03", "kind": "closed"},
    {"date": "2026-08-07", "kind": "replace", "intervals": [{"start": "10:00", "end": "14:00"}]}
  ]
}
```

Evaluate accepts a bounded date range and returns concrete intervals plus DST
diagnostics. Changing or deleting a used profile requires a projection-impact
preview and explicit policy reassignment.

## Directed sync policies

- `GET /api/v1/sync-policies`
- `POST /api/v1/sync-policies:preview`
- `POST /api/v1/sync-policies`
- `GET /api/v1/sync-policies/{id}`
- `POST /api/v1/sync-policies/{id}:preview-change`
- `PATCH /api/v1/sync-policies/{id}`
- `POST /api/v1/sync-policies/{id}:pause`
- `POST /api/v1/sync-policies/{id}:resume`
- `POST /api/v1/sync-policies/{id}:reconcile`
- `POST /api/v1/sync-policies/{id}:recover` — bounded explicit retry with
  read-before-write ownership validation; a still-foreign event remains held
- `POST /api/v1/sync-policies/{id}:delete-preview`
- `DELETE /api/v1/sync-policies/{id}`
- `GET /api/v1/sync-policies/{id}/health`

Representative personal-to-work draft:

```json
{
  "name": "Personal commitments during work",
  "source_calendar_id": "cal_personal_primary",
  "destination_calendar_id": "cal_employer_primary",
  "hours": {
    "mode": "overlaps_profile",
    "profile_id": "hours_employer"
  },
  "privacy": {
    "preset": "busy_only",
    "generic_summary": "Busy",
    "destination_visibility": "private",
    "copy_title": false,
    "copy_description": false,
    "copy_location": false,
    "copy_conference": false,
    "copy_attendees": false
  },
  "selection": {
    "timed": "include",
    "all_day": "skip",
    "free_events": "skip",
    "declined": "skip",
    "tentative": "busy",
    "unanswered": "free",
    "skip_when_destination_identity_invited": true,
    "source_exclusion_marker": "#nosync"
  },
  "destination": {
    "transparency": "opaque",
    "reminders": "none",
    "color": null
  },
  "horizon": {"past_days": 30, "future_days": 365},
  "destination_edit_behavior": "restore_managed_state"
}
```

The server expands presets into an explicit, versioned transformation and
returns both. It rejects the same source and destination, unwritable targets,
credential/account mismatches, unsafe attendee/invitation behavior, recursive
policy graphs, invalid hours, and unbounded horizons.

Create requires the unexpired preview token. Activation writes the policy and
durable reconciliation intent atomically; provider effects happen asynchronously.
After activation, ordinary source create/update/delete events reconcile without
manual preview.

## Preview

A policy preview returns:

```json
{
  "preview_token": "opaque-short-lived-token",
  "expires_at": "2026-07-20T22:15:00Z",
  "counts": {"create": 4, "update": 1, "delete": 0, "unchanged": 27, "excluded": 18},
  "excluded_by_reason": {"outside_hours": 12, "all_day": 3, "free": 2, "nosync": 1},
  "disclosure": {
    "summary": "Busy",
    "fields_written": ["start", "end", "summary", "visibility", "transparency", "provenance"],
    "fields_omitted": ["source_title", "description", "location", "conference", "attendees", "organizer"]
  },
  "examples": [{
    "source": {"start": "2026-07-22T17:00:00Z", "end": "2026-07-22T18:00:00Z", "details_redacted": true},
    "destination": {"summary": "Busy", "visibility": "private", "reminders": []},
    "decision": "create",
    "reason_codes": ["overlaps_hours", "privacy_busy_only"]
  }],
  "warnings": []
}
```

Examples deliberately avoid returning source detail when the current viewer does
not need it. A material provider change after preview returns HTTP 409
`preview_stale`; the client obtains a new preview rather than silently applying.

## Observations and projections

- `GET /api/v1/sync-policies/{id}/projections`
- `GET /api/v1/projections/{id}`
- `POST /api/v1/projections/{id}:reconcile`
- `POST /api/v1/projections/{id}:detach`
- `POST /api/v1/projections/{id}:remove-copy`
- `GET /api/v1/sync-events` — redacted decision/audit stream
- `GET /api/v1/jobs/{id}`

Projection responses expose source/destination references, occurrence identity,
status, hashes, reason codes, last observation/effect times, attempt count, and
safe error class. They do not expose source fields suppressed by the policy.

States are `pending_create`, `active`, `pending_update`, `pending_delete`,
`excluded`, `detached`, `conflict`, `action_required`, and `deleted`. Reconcile is
idempotent. Deleting a managed copy externally normally queues recreation;
removing the source or excluding it queues deletion. These semantics are defined
fully in `CALENDAR-SYNC.md`.

## Alpha planning rules

These routes are implemented and used by the React Protect and Smart Meetings
screens:

- `POST /api/v1/planning/preview` — validate and compute a ten-minute preview;
- `POST /api/v1/planning/rules` — consume `{ "preview_token": "..." }` and
  create the rule plus durable per-occurrence provider intent; returns HTTP 201
  `{ "id": "..." }`;
- `GET /api/v1/planning/rules` — all non-deleted organization rules, without
  pagination; status can be `active`, `paused`, or asynchronous cleanup state
  `deleting`;
- `POST /api/v1/planning/rules/{id}/pause` — returns 204; existing remote
  events remain and new/retried planning jobs do not write while paused;
- `POST /api/v1/planning/rules/{id}/resume` — returns 204 and requests one
  reconciliation plus apply jobs for currently pending events;
- `POST /api/v1/planning/rules/{id}/replan` — returns HTTP 202 with
  `{ "enqueued": boolean, "job_id": string|null }`;
- `DELETE /api/v1/planning/rules/{id}` — returns 204 after moving the rule to
  `deleting`, expiring pending suggestions, and atomically enqueuing delete
  intent for future/current managed or possibly in-flight events. Past events
  remain at the provider. The rule reaches `deleted` only after cleanup; target
  and precondition failures retry, while ownership mismatch becomes
  action-needed/dead work. It has no preview/detach choice and Smart Meeting
  deletion can send attendee cancellation updates;
- `GET /api/v1/planning/suggestions` — pending, unexpired suggestions for active
  organization rules, without pagination;
- `POST /api/v1/planning/suggestions/{id}/accept` and `/dismiss` — return 204.
  Accept rechecks the stored basis, no-move window, fresh availability, and
  occurrence result; then it replaces desired state, increments intent, expires
  sibling pending suggestions, and enqueues create/update/delete as appropriate.

The deterministic fake-provider mode enables this surface for local development.
In Google provider mode the API and capability are unavailable unless the
operator explicitly sets `PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING=true`; the
default is false pending live invitation/privacy evidence.

All planning mutations require the same authenticated browser session, exact
`Origin`, and CSRF token as policy mutations. Planning data belongs to the
session organization. The current service does not enforce that the caller is
the rule's `owner_principal_id`; this is acceptable only while the installation
has one owner and blocks a multi-user claim.

### Availability-boundary draft

An availability boundary creates ordinary opaque provider events outside the
configured same-day work window. Representative request:

```json
{
  "kind": "availability_boundary",
  "name": "Keep evenings quiet",
  "target_calendar_id": "018fa0b0-0000-7000-8000-000000000001",
  "timezone": "America/Vancouver",
  "working_days": [1, 2, 3, 4, 5],
  "workday_start": "09:00",
  "workday_end": "17:00",
  "protect_before_work": false,
  "protect_after_work": true,
  "protect_closed_days": false,
  "title": "Personal time",
  "visibility": "private",
  "horizon_days": 21
}
```

Implemented bounds/defaults:

- `name` and `title`: normalized nonempty text, at most 160 Unicode code
  points; `title` defaults to `Personal time`;
- `target_calendar_id`: currently only bounded as text by the parser, then
  looked up as an organization-owned writable calendar on an active
  destination-capable connection;
- `timezone`: an `Intl`-recognized IANA timezone, at most 100 characters;
- days: one to seven unique ISO weekdays (`1` Monday through `7` Sunday);
- clocks: `HH:MM` or `HH:MM:SS`, normalized to seconds, with start strictly
  before end; overnight work windows are not implemented;
- booleans default to `false`, `true`, and `false` respectively;
- `visibility` is `private` by default or `default` explicitly;
- `horizon_days` is required and limited to 1–60.

The preview starts on the rule timezone's local date at request time and
contains one scheduled occurrence for each materialized protected interval.
The preview persists that planning reference instant. Activation recomputes with
the same instant, so crossing local midnight cannot silently shift its rolling
horizon.

### Smart Meeting draft

Representative request:

```json
{
  "kind": "smart_meeting",
  "name": "Weekly one-to-one",
  "target_calendar_id": "018fa0b0-0000-7000-8000-000000000001",
  "timezone": "America/Vancouver",
  "start_date": "2026-07-27",
  "weekdays": [2, 4],
  "window_start": "09:00",
  "window_end": "17:00",
  "preferred_time": "10:00",
  "cadence_weeks": 1,
  "occurrence_count": 8,
  "minimum_duration_minutes": 30,
  "maximum_duration_minutes": 60,
  "start_step_minutes": 15,
  "priority": 2,
  "attendees": [{
    "email": "teammate@example.net",
    "required": true,
    "availability_calendar_id": "018fa0b0-0000-7000-8000-000000000002"
  }],
  "availability_calendar_ids": [
    "018fa0b0-0000-7000-8000-000000000003",
    "018fa0b0-0000-7000-8000-000000000002"
  ],
  "conflict_policy": "suggest",
  "lock_before_minutes": 1440,
  "description": "Bring an agenda",
  "location": "Google Meet",
  "visibility": "default"
}
```

Implemented bounds/defaults:

- one to seven unique ISO weekdays and a same-day meeting window;
- preferred time inside `[window_start, window_end)`;
- cadence 1–12 weeks and occurrence count 1–16;
- minimum/maximum duration 15–480 minutes, maximum not below minimum;
- step exactly 15, 30, or 60 minutes;
- priority 1–4, accepted but not yet used by the engine;
- at most 25 case-normalized unique syntactically valid attendee emails;
- at most 32 unique availability calendar IDs;
- conflict policy `suggest` (default), `auto_move`, or
  `keep_with_warning`;
- lock window 0–10,080 minutes; not used to choose the initial slot, but a later
  desired-state change is held when the existing future event begins inside the
  window;
- description at most 4,000 and location at most 500 Unicode code points;
- visibility `private` by default or `default` explicitly.

The owner/target calendar is not added to `availability_calendar_ids`
automatically. A required attendee may omit an availability calendar; the
preview then warns `required_attendee_availability_unknown` but can still choose
a time and later send an invitation. Every explicitly selected availability
calendar must be readable, active, and have a ready successful sync no more than
30 minutes old; otherwise preview fails with HTTP 400
`availability_not_ready`. Caller-supplied attendee-to-calendar references are
not validated against the availability list, and all loaded busy intervals are
pooled rather than attributed during scoring. Timed observations use their
instants; all-day busy observations are materialized as full local days. Other
active Smart Meeting desired events on selected or target calendars also block
candidate time, and same-rule observed/provider desired state is excluded.

### Planning preview response

Both rule kinds return:

```json
{
  "kind": "smart_meeting",
  "occurrences": [{
    "occurrence_key": "week:2026-07-27",
    "decision": "schedule",
    "reason_code": "preferred_time_available",
    "rejected_candidate_count": 0,
    "event": {
      "timing": {
        "start_instant": "2026-07-28T17:00:00.000Z",
        "end_instant": "2026-07-28T18:00:00.000Z",
        "timezone": "America/Vancouver"
      },
      "summary": "Weekly one-to-one",
      "transparency": "opaque",
      "visibility": "default",
      "attendees": [{"email": "teammate@example.net", "optional": false}],
      "reminders": [],
      "write_controls": {"send_updates": true}
    }
  }],
  "scheduled_count": 1,
  "unmet_count": 0,
  "warnings": [],
  "hours_summary": "09:00–17:00 · America/Vancouver",
  "preview_token": "opaque-uuid",
  "expires_at": "2026-07-21T20:10:00.000Z"
}
```

An unmet Smart Meeting omits `event` and uses
`no_mutual_time_inside_meeting_hours`. Preview output contains attendee emails,
description, and location when supplied and is therefore restricted data. The
UI/API must not treat it as a redacted Calendar Sync preview.

The preview row binds the normalized draft hash, planning reference instant, and
a snapshot hash covering target/calendar/cursor metadata, ordered observation
hashes, and relevant planned-event state. Activation recomputes at that same
instant and rejects an expired, consumed, wrong-principal, wrong-organization,
changed snapshot, or Smart Meeting slot that has since started as
`preview_stale` (HTTP 409).

### Rule and suggestion responses

Each list item returns rule identity/kind/name/status, target calendar identity
and display name, the full normalized draft, counts for scheduled/unmet/pending
events and pending suggestions, up to eight occurrences ordered by
`occurrence_key`, and `last_success_at`. It does not return suggestion content,
provider event identity, safe error, planning lag, or complete occurrence
pagination.

Each suggestion list item includes suggestion/rule/planned-event IDs, rule name,
`move|shorten|skip` kind, reason, current/proposed start and end, and expiry. The
current coordinator emits `move` or `skip`; `shorten` is schema/API-compatible
but is not classified separately yet. The response omits attendee/content and
provider identifiers.

Suggestion resolution requires pending, unexpired state and an active rule. It
recomputes the basis and latest occurrence against current recent availability
and rejects a no-longer-valid proposal as `suggestion_stale`. Composite foreign
keys require the suggestion's planned event to belong to the same rule and
organization.

Not implemented:

- get-one, edit/re-preview/update, cleanup-preview, or detach rule commands;
- get-one suggestion or resolve/recover a held planning event;
- RSVP-triggered series repair, provider recurrence-series operations, booking,
  tasks/focus, or full `SOLVER.md` plans;
- planning API tokens/MCP/CLI/webhooks;
- request rate limits specific to preview, replan, or invitation volume.

`suggest` creates database suggestions that expire after 14 days and can be
accepted or dismissed. `keep_with_warning`, no-move, target-capability and
ownership/precondition conditions can place an occurrence in `held`; there is
no general held recovery command. An active target-capability hold is retried on
later reconciliation; ownership and keep holds are not. `auto_move` can update
the Google event and, when attendees exist, uses `sendUpdates=all`. The no-move
check protects a future existing start inside the configured window, but an
apply that reaches the Smart Meeting start is separately held as
`meeting_start_too_close`. After lock expiry, a previously held `suggest` rule
can currently fall through to update instead of creating a suggestion because
it is no longer `converged`.

### Internal planning provider port

The provider interface is internal, not an HTTP promise:

- `getPlanningEvent` reads event revision plus six ownership/intent facts: kind,
  rule, planned event, occurrence, generation, and intent sequence;
- `createPlanningEvent` uses a deterministic provider event ID and create
  precondition;
- `updatePlanningEvent` uses the last provider revision when known;
- `deletePlanningEvent` is idempotent for 404/410 and accepts the rule's
  attendee-notification choice.

Google planning events always set explicit start/end timezone, opaque
transparency, selected visibility, no default reminders, and private extended
ownership properties. Availability fences contain no attendees and send no
updates. Smart Meetings include configured attendees and send updates to all on
create/update/delete. No conference object is generated.

## Provider webhooks and polling

Provider callbacks live under `/api/v1/provider-events/{provider}`. They validate
channel identity/token/signature where available, acknowledge quickly, enqueue a
deduplicated observation, and never write a destination event inline. Google
watch renewal and a periodic cursor-based safety poll are both required.

Outbound user webhooks are post-P0. Internal event names remain stable reasoned
facts such as `policy.action_required`, `projection.created`,
`projection.updated`, `projection.deleted`, and `sync.degraded`.

## CLI

```text
serve
doctor
config show|validate
user create|list|disable
connection list|authorize-url|status|reauthorize|disconnect
calendar list
hours list|create|update|evaluate
policy list|show|preview|create|update|pause|resume|reconcile|delete
projection list|show|reconcile|detach|remove-copy
sync run|status
jobs list|show|retry|cancel
backup create|verify|restore
export create
migrate status|run
upstream version
```

Human output and stable `--json` are both supported. Destructive commands show
exact counts/targets and require confirmation; noninteractive use requires
`--yes` and an explicit target. Secrets never appear in command arguments.

## MCP

P0 tools are read/propose oriented:

- `list_connections`, `list_calendars`, `get_sync_health`;
- `list_policies`, `get_policy`, `list_projection_errors`;
- `preview_sync_policy`, `preview_policy_change`;
- `pause_policy`, `resume_policy`, and `reconcile_policy` only when apply
  capability is explicitly configured.

MCP never returns OAuth credentials or source event detail suppressed by policy.
Provider event text is data and cannot alter tool capabilities.

## Rate and size controls

Separate budgets apply to authorization attempts, provider callbacks, manual
sync, preview, activation, reconcile, export, and failed jobs. Enforce bounded
horizon, events, examples, recurrence expansion, page size, body size, attempts,
and provider concurrency. Return `Retry-After` when meaningful. Equivalent pending
reconciliation is deduplicated by policy/source occurrence/desired-state hash.

## Deferred API surface

Projects, work items, full adaptive plans, booking pages, team analytics,
assistant commands, conferencing, and collaboration notifications are
intentionally absent. The alpha planning routes above do not satisfy the full
Smart Meeting or solver requirements. These surfaces may not be expanded merely
because earlier research or excluded Keeper/AGPL projects described them; each
needs evidence, a requirements update, provenance review, and an ADR after the
live Google-to-Google Calendar Sync acceptance suite passes.
