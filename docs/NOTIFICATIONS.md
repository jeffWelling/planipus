# Sync-notice delivery plan (email first)

Status: planned design, not implemented  
Depends on: destination-edit behavior and the `sync_notices` model
(`CALENDAR-SYNC.md` "Destination-edit behavior", `DATA-MODEL.md`
`sync_notice`)

## Problem

Sync notices exist so a person who edits or deletes a managed copy directly —
usually by dragging the mirrored copy of a meeting instead of the real invite —
finds out that the real meeting did not move and nobody was told. Today the
notice waits inside the product (API, overview count, and UI). That is enough
when the person opens Planipus soon, and useless when they walk into the wrong
meeting time first. The gap is push delivery: tell a configured address when a
notice is created, especially for `hold_for_review` policies where sync is
deliberately paused on a copy until a human decides.

## Product shape

Per-organization notification settings (one settings document, editable in the
web UI), not per-policy SMTP plumbing:

- `email_enabled`: boolean, default off. Self-hosted installs must opt in.
- `email_address`: one explicit recipient. Deliberately a single address in the
  first slice — "email me" — not lists, routing, or escalation. The address is
  free-form so a team alias works.
- `email_events`: which notice kinds send mail. Defaults: held kinds
  (`copy_edit_held`, `copy_delete_held`) on, reverted kinds
  (`copy_edit_reverted`, `copy_delete_restored`) off. Held notices block sync
  on that copy until resolved, so they warrant interruption; reverted notices
  are informational and would train people to ignore the mail.
- `email_digest`: `immediate` (default) or `daily`. Daily batches all
  still-open notices into one message at a configured local hour.

A future `webhook` channel (generic POST with the same payload) reuses the same
settings document and dispatch pipeline; it is out of scope for the first
slice but the schema below leaves room for it.

## Delivery pipeline

Reuse the existing durable machinery instead of adding a mail queue:

1. Notice creation already happens inside the verifier's transaction. In the
   same transaction, when settings enable email for that kind, enqueue a
   `notify_email` scheduled job (existing `scheduled_jobs` table) keyed
   `notice:<id>:email` for exactly-once dispatch. Crash-safety and retries come
   free from the job runner; a dead job surfaces in `dead_jobs` health counts.
2. The worker job renders and sends the message, then stamps
   `sync_notices.emailed_at` (new nullable column). A job that finds
   `emailed_at` set or the notice already resolved exits as a no-op, so
   retries never double-send and a fast in-app resolution suppresses stale
   mail.
3. Daily digest mode replaces per-notice jobs with one
   `notify_email_digest:<organization>:<local-date>` job; the job reads all
   open notices at send time.

Transport is pluggable behind a small `MailTransport` interface with exactly
two production implementations planned:

- **SMTP** (first): host/port/TLS-mode/username + password stored with the
  existing versioned AES-GCM envelope encryption used for OAuth credentials.
  Self-hosted installs almost always have an SMTP relay; this avoids a
  provider dependency and keeps the no-phone-home rule.
- **Webhook** (later): same payload, generic POST, no secrets beyond an
  optional bearer token in an envelope.

No bundled third-party email SaaS SDK. A `fake` transport (in-memory capture)
serves tests, mirroring the fake calendar provider pattern.

## Message content rules

The email is a pointer, not a data export. It inherits the notice-detail
disclosure rule and the log/audit redaction rules:

- subject: `Planipus: a mirrored event was changed on <destination calendar
  name>` (calendar display name only — never the event title);
- body: notice kind in plain language, the privacy-transformed copy summary and
  local time (exactly the fields the destination calendar already shows, and
  nothing more), which bridge (policy name), what Planipus did or is waiting
  on, and a deep link to the notices screen to decide;
- for held kinds, one explicit sentence: "Planipus has not changed anything on
  either calendar. The original event is unchanged and no attendee was
  notified."; and
- no raw source titles, descriptions, locations, conference links, attendee
  addresses, or provider IDs, so a shared inbox or forwarded mail cannot leak
  more than the destination calendar itself would.

Resolution stays in the product. The first slice ships no signed one-click
action links in mail; that is a separate authenticated-action design with its
own token lifetime and replay review.

## Settings surface

- `organization_settings` (new table or a JSON document on `organizations`):
  the fields above, SMTP credentials by envelope reference.
- API: `GET/PATCH /api/v1/settings/notifications` plus
  `POST /api/v1/settings/notifications/test` which sends a test message and
  reports the transport error class without leaking SMTP details.
- Web UI: a Notifications card on the settings screen with a required
  "send test email" step before enable, mirroring the preview-before-apply
  pattern used elsewhere.

## Mac edition

The Mac edition never talks to the Server, so it does not use this pipeline.
Its equivalent is local macOS User Notifications for the same notice kinds
under the same no-event-details rule (REQUIREMENTS MAC-007 already caps what a
notification may contain). Email from the Mac app is explicitly rejected:
storing SMTP credentials in a desktop app to send mail about the calendar it
already shows adds risk without a matching benefit.

## Acceptance sketch

- enabling email requires a successful test send; disabled settings send
  nothing;
- a held notice produces exactly one email across worker crash/retry and none
  when resolved before dispatch;
- digest mode sends one message per day listing only still-open notices;
- messages contain no source event fields beyond the transformed copy
  summary/timing (asserted against a captured fake-transport corpus, the same
  way disclosure manifests are asserted); and
- SMTP failures mark the job retrying/dead and surface in health detail
  without event details or credentials in logs.

## Ordered follow-ups

1. Settings document + API + fake transport + immediate-mode dispatch.
2. Web settings card with test-send gating.
3. Daily digest.
4. Webhook channel.
5. Mac local notifications for notice kinds.
