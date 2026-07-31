# Calendar Sync product contract

Status: authoritative P0 product specification  
Research date: 2026-07-20  
Primary scenario: personal Google Calendar → employer Google Calendar during
configured work hours, with a privacy-controlled maintained copy

## Product definition

Planipus is first a self-hosted calendar availability bridge. It connects
independent calendar accounts and maintains policy-controlled copies of source
events on destination calendars so people and booking systems viewing the
destination see the user's true availability.

This is not calendar sharing and is not merely a combined view:

- a connected/read calendar can inform Planipus without changing another
  calendar;
- a sync policy creates real provider events on a destination calendar;
- the source event remains authoritative;
- the copy has independent visibility, free/busy, title, color, and field rules;
- source create/update/delete and RSVP changes converge on the copy; and
- destination copies are managed projections, not editable peers.

The first success criterion is deliberately concrete:

> When I create or change a personal event that overlaps my configured work
> hours, Planipus creates or updates an appropriate copy on my employer calendar.
> Coworkers see no more detail than the policy permits. Events outside the
> policy's hours do not appear. Deleting or declining the source removes the
> managed copy, and the system does not create loops or duplicates.

Adaptive task planning, habits, focus optimization, smart meetings, booking,
analytics, and AI assistance are optional later product lines. They cannot delay
or complicate the calendar-sync release.

## Reclaim behavior being matched

Reclaim models Calendar Sync as independent one-way policies. Each policy chooses
one source account/calendar and one destination account/calendar. Two policies
are used for two directions. The destination receives a distinct event copy,
not a shared-calendar overlay, and Reclaim updates that copy as the source
changes.

Per-policy behavior documented by Reclaim includes:

- calendar type/category: Personal, Business, or Travel;
- a color override for copies;
- visibility modes ranging from generic commitment or Busy through private/full
  details;
- an option to include or exclude events outside Working Hours;
- all-day policy: skip, sync only busy all-day, or sync all;
- `#nosync` source override;
- RSVP mapping: Yes/Maybe busy, No removes, unanswered free by default with a
  configurable busy alternative;
- free-event handling, including skipping free events for redacted modes;
- special handling for email-created travel/reservation events;
- duplicate avoidance when the destination identity is already invited; and
- no notifications/reminders on managed copies.

Primary first-party references:

- [Calendar Sync overview](https://help.reclaim.ai/en/articles/3600762-calendar-sync-overview-keep-multiple-schedules-in-sync)
- [Create and customize policies](https://help.reclaim.ai/en/articles/6326844-creating-and-customizing-your-calendar-sync-policies)
- [Event-type behavior](https://help.reclaim.ai/en/articles/3639967-how-calendar-sync-syncs-different-kinds-of-events)
- [RSVP behavior](https://help.reclaim.ai/en/articles/3639943-how-rsvp-affects-calendar-sync-events-and-how-to-manage-it)
- [Working, meeting, and personal hours](https://help.reclaim.ai/en/articles/3600766-set-your-working-meeting-personal-custom-hours)
- [Calendar sharing versus copies](https://help.reclaim.ai/en/articles/3713192-how-is-calendar-sync-different-from-sharing-my-calendar-with-someone)
- [`#nosync` override](https://help.reclaim.ai/en/articles/3639946-using-nosync-to-prevent-events-from-being-synced)

Planipus matches the useful semantics, not Reclaim's wording, branding, plan
limits, or implementation.

## Domain model

### Account connection

An independently authorized provider identity. P0 supports multiple Google
accounts owned by one Planipus user. Each connection records provider subject,
email/label, scopes, encrypted token envelope, key version, status, and health.
Tokens for different accounts are never merged or inferred from email aliases.

### Calendar endpoint

A provider calendar under a connection. Endpoint capabilities include readable,
writable, primary, timezone, and provider ID. A calendar can participate in
several policies with different roles.

### Hours profile

A named weekly wall-clock schedule with IANA timezone and exceptions. P0 ships
`Work hours` and `Always`; custom profiles follow. A profile is not a UTC range.
It is evaluated in its configured timezone for every source occurrence, across
DST changes.

### Sync policy

One directed source→destination projection:

- source connection and calendar;
- destination connection and calendar;
- enabled/paused state;
- hours profile and outside-hours mode;
- overlap rule;
- visibility preset and explicit field transform;
- destination busy/transparency and visibility;
- all-day, free-event, RSVP, attendee/organizer, event-type, and exclusion rules;
- color and generic label/category;
- horizon and reconciliation cadence;
- destination-edit policy; and
- revision, health, last success, and audit metadata.

Bidirectional behavior is two policies. The UI may create the pair in one flow,
but storage, provenance, health, pausing, and audit remain independent.

### Projection

The durable relation between one source event/occurrence, one policy revision,
and one destination copy. It records source identity, recurrence identity,
destination identity, source/content hashes, last desired state, last observed
destination state, status, and tombstone. It must not contain more sensitive
source fields than the policy requires for reconciliation.

## Hours semantics

The policy asks whether source time should project to the destination.

P0 modes:

1. `all_times`: every qualifying source event in the horizon;
2. `overlaps_profile`: include when any positive duration overlaps a profile
   interval; and
3. `contained_in_profile`: include only when the full event lies inside profile
   intervals.

The default matching the stated use case is `overlaps_profile` using Work hours.
For an event spanning inside and outside hours, P0 copies the full event so the
destination correctly blocks the real commitment. A future explicit clipping
mode may copy only the intersection, but must never be an accidental default.

Rules:

- interpret the source event using its instant(s); evaluate the hours profile in
  the profile timezone;
- split overnight hours into concrete intervals without losing DST semantics;
- half-open intervals `[start,end)` avoid boundary duplicates;
- all-day events are governed by all-day policy before timed-hour evaluation;
- changing hours immediately reconciles existing copies: newly excluded copies
  are deleted, newly included events are created;
- temporary exceptions/holidays can add or remove intervals for a local date;
- a timezone/profile change creates a preview count before destructive apply.

Required boundary tests include exactly-at-open, exactly-at-close, partial
overlap on both sides, overnight hours, spring-forward gap, fall-back fold,
timezone travel, event timezone different from profile timezone, recurring
exceptions, and multi-day events.

## Privacy and visibility presets

The UI offers calm presets but stores explicit transformations. Presets are
versioned so future changes do not silently alter existing policies.

### No details — `busy_only`

- destination summary: `Busy` (customizable generic label);
- description, location, conference data, attachments, attendees, organizer,
  source URL, and provider metadata: omitted;
- destination transparency: opaque/busy unless RSVP policy says free;
- destination visibility: private where supported;
- reminders/notifications: none;
- only timing, recurrence representation, generic label/color, and opaque
  Planipus provenance are written.

### Some details — `commitment`

- generic category label such as `Personal commitment`, `Work commitment`,
  `Meeting`, `PTO`, `Travel`, or `Flight`;
- no original title, description, location, conference link, attendee email, or
  organizer identity;
- opaque/private by default; no reminders;
- category can be selected directly in P0; automatic classification is optional
  and must never reveal more information.

### Full details for me, busy to others — `private_details`

- copy source title, description, location, and conference information selected
  by explicit field switches;
- set destination event private so ordinary viewers see only busy;
- warn that destination calendar editors and domain administrators may still see
  details; this is a provider permission fact, not end-to-end secrecy;
- attendee and organizer identities remain excluded by default because copying
  them can send invitations or disclose third parties.

### Full details according to destination access — `shared_details`

- selected source fields are copied;
- destination default visibility/access rules apply;
- UI presents a high-friction disclosure summary before enable/apply;
- attendee/organizer/invitation copying is a separate advanced capability and is
  off in P0.

Every policy editor shows an example destination event and a field-by-field
disclosure table. The owning edition's policy engine is authoritative; no UI can
bypass it and the Mac edition does not call a server.

## Event selection semantics

### Timed events

Include when enabled, within horizon, within hours policy, and not excluded.
Preserve start/end instants and recurrence identity. Never move the source.

### All-day events

Policy values:

- `skip` (default);
- `busy_only`: include only source all-day events that block availability; or
- `all`: include regardless of source transparency.

The destination copy remains an all-day date event unless a future explicit
conversion policy says otherwise.

### Free events

Policy values:

- `skip_when_redacted` (default for `busy_only`/`commitment`);
- `preserve_free`; or
- `force_busy` with an explicit warning.

No privacy preset may accidentally turn a free reminder into a busy commitment.

### RSVP

For events where the connected source identity is an attendee:

- accepted or tentative → include and busy by default;
- declined → delete/omit;
- needs-action/no response → include as free by default, configurable to busy or
  omit.

Organizer-without-attendee events are treated as accepted unless overridden.

### Duplicate and loop prevention

- If the destination account identity is already an attendee of the source
  event, omit the projection by default.
- Every managed copy carries a non-sensitive policy/projection marker using
  provider private extended properties where possible.
- Ingestion recognizes Planipus markers and does not treat a copy as an original
  for a reciprocal policy.
- Identity also uses durable database mappings; markers alone are not trusted.
- A graph validator rejects self-maps and warns about cycles. Two-direction
  policy pairs are safe because managed copies are excluded.

### Source overrides

P0 recognizes a configurable `#nosync` token in title, description, or RSVP note
where providers expose them. Matching is case-insensitive and token-boundary
aware. The UI warns the token may itself be visible to source-calendar viewers.
Longer-term structured provider properties should be preferred when available.

## Reconciliation state machine

For each qualifying source occurrence and policy:

1. normalize the provider event without mutating it;
2. evaluate selection, hours, RSVP, duplicates, and overrides;
3. apply the privacy transformation to produce desired destination state;
4. compare desired hash with projection and observed destination state;
5. create, update, replace, delete, or no-op through an idempotent outbox;
6. record provider precondition/result and update projection atomically; and
7. expose per-policy lag, last success, errors, and counts without event details.

Source deletion or exclusion deletes the managed copy. Direct destination-copy
edits and deletions follow the policy's destination-edit behavior (next
section); restoring remains the default because the source policy stays
authoritative, and the UI offers `Pause policy`, `Exclude source event`, and
`Detach copy` so users can express durable intent. Verification reads the
durable destination ID first and restores only when the provider-private policy,
projection, and generation markers all match. A marker mismatch is held for
review without a write. Deleted Google copies are replaced under an incremented
generation and new deterministic event ID; their deleted custom ID is not
reused, including when deletion races a queued edit repair or follows an
ambiguous create response. Planipus never writes back from a copy to its source
in P0.

## Destination-edit behavior

People edit or delete managed copies directly — often by accident, such as
dragging the copy of a meeting instead of the real invite on the source
calendar. The cautionary counterexample is the silent-move failure some sync
products exhibit: the copy moves, the real meeting does not, no attendee is
notified, and the person believes they rescheduled. Planipus must never let a
direct copy change silently become the truth, and it never writes from a copy
back to its source in P0. What is configurable per policy is how loudly the
divergence is surfaced and whether the person confirms before the copy is
written again.

The policy field `destination_edits` (versioned; stored explicitly with the
concrete default when omitted) chooses a mode independently for in-place edits
(`on_edit`) and deletions (`on_delete`):

1. `restore_and_notify` (default): the next verification pass restores the
   copy to the policy-transformed source state and records a sync notice, so
   someone who moved the copy by mistake learns the original meeting did not
   move and nobody was notified — and can go reschedule the real event.
2. `restore`: restore silently. This is for people who treat copies as pure
   projections and do not want notice noise.
3. `hold_for_review`: leave the copy exactly as the person changed it, hold the
   projection, and raise a decision notice. The person resolves it with
   `restore` (re-apply the source-authoritative copy through marker-verified
   ambiguous recovery, safe even if the copy was deleted meanwhile) or
   `keep_and_detach` (keep the direct change and detach the copy from
   management — the durable-intent control above).

Rules:

- restores and holds require every provider-private ownership marker to match
  the durable projection; a marker mismatch is always held as unknown
  ownership regardless of mode;
- a destination-edit hold survives safety reconciliation: a source change
  refreshes the shadow-evaluated recovery evidence without releasing the hold
  or touching the destination;
- notices disclose only what the destination copy already shows (the
  privacy-transformed summary and timing) plus non-sensitive references — no
  raw source event fields, matching the audit/log redaction rules;
- both editions implement the same three modes and hold semantics; the Mac
  edition records notices in its local encrypted store and resolves them
  through the coordinator, without any server; and
- automatic write-back from copy to source, or organizer-visible reschedule
  proposals, remain out of scope until a dedicated bidirectional contract
  exists; `hold_for_review` is the safe expression of "my copy edit meant
  something".

Push notifications reduce latency, but periodic safety reconciliation is
mandatory because channels expire and notifications can be dropped or
coalesced. Source-calendar safety sync and bounded destination-copy verification
are distinct: destination verification checks only the oldest due durable
projections and does not make a destination calendar eligible as a policy
source. Cursors advance only after normalized observations commit.

## First-run experience

1. Explain that Planipus creates real copies, unlike calendar sharing.
2. Connect Personal Google account with read scope for selected source calendar.
3. Connect Work Google account with event-write scope for selected destination.
4. Choose source and destination; disallow same-calendar mapping.
5. Choose `Work hours` and show the actual upcoming local intervals.
6. Choose privacy with a realistic example and disclosure table.
7. Configure all-day, free, RSVP, and `#nosync` behavior using safe defaults.
8. Run a read-only preview over the next 30 days: creates, updates, deletions,
   skipped counts by reason, and sample transformed events.
9. Require explicit Start Syncing confirmation.
10. Create copies, then show health and a reversible stop/cleanup control.

Routine provider-driven updates after activation are automatic; they do not
require manual approval. Preview is required for policy creation, material
policy changes, bulk cleanup, and reconnect ambiguity—not for every ordinary
source edit. This avoids turning an automatic sync product into a manual planner.

## Acceptance suite

The release gate uses two disposable Google identities and calendars plus
recorded provider fixtures. It proves:

- create/update/move/resize/delete convergence within the published latency;
- work-hours inclusion/exclusion and cleanup after a profile change;
- every privacy preset's exact provider payload and viewer-visible result;
- no description/location/conference/attendee leakage in redacted modes;
- recurrence master, occurrence exception, cancellation, and timezone fidelity;
- RSVP, free/busy, all-day, organizer, and already-invited behavior;
- `#nosync`, pause/resume, detach, disconnect, token revoke, and reconnect;
- no duplicate or loop across two opposite policies;
- idempotency under duplicate/out-of-order webhooks and retry after timeout;
- cursor expiration/full resync and missing notification recovery;
- destination manual deletion/edit behavior in every destination-edit mode,
  including recorded notices, hold preservation across reconciliation, and
  explicit restore/keep-and-detach resolution;
- clean policy removal with previewed managed-copy cleanup;
- backup/restore followed by reconciliation without duplicate writes; and
- logs, metrics, audit, exports, and errors contain no disallowed event fields or
  credentials.

P0 is not complete until these scenarios pass against live disposable Google
accounts. Unit tests alone cannot establish provider visibility semantics.
