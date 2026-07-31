# Edition migration plan (Mac ↔ Server)

Status: planned design, not implemented  
Scope: moving one person's calendar bridges between Planipus for Mac and a
Planipus Server instance — self-managed or employer-managed — and moving back
again later.  
Depends on: the Calendar Sync contract (`CALENDAR-SYNC.md`), the two-edition
topology (`MACOS-AND-KUBERNETES.md`), and destination-edit notices.

## Why this is a plan and not a feature toggle

The editions are autonomous by design: no pairing, no shared database, no
Mac↔server API, and — explicitly forbidden — no automatic copying of
configuration or credentials between them. Migration therefore cannot be
"sign in and sync." It is a deliberate, human-driven cutover built from three
parts that already respect every standing rule:

1. a small, credential-free, edition-neutral **bridge export file** the person
   carries between editions;
2. re-authorization of each Google account **on the target edition** with its
   own OAuth client and its own token storage; and
3. an ordered **provider-state cutover** in which exactly one edition owns a
   directed bridge at any moment.

The person's real data — source events — never moves and is never touched.
Only managed copies (recreated, not transplanted) and bridge configuration
(exported, then re-previewed) change hands.

## What moves and what deliberately does not

| State | Migrates? | How |
|---|---|---|
| Bridge configuration: direction, hours mode/profile, privacy preset and field switches, selection rules, `#nosync` marker, destination-edit modes, manual exclusions | Yes | Portable export file |
| Google OAuth tokens/credentials | Never | Re-authorize on the target; tokens never leave an edition |
| Managed destination copies | Recreated | Origin deletes only its own marker-verified copies; target creates fresh ones under its own provenance |
| Projections, outbox, cursors, generations | No | Internal per-edition mechanics; the target rebuilds them from the provider |
| Audit history, sync notices | No | Local history stays with the edition that produced it |
| Detached copies | Stay on the calendar | Both editions exclude marked copies from ingestion and never delete a copy they detached |
| Open destination-edit holds | Blocker | Must be resolved (restore or keep-and-detach) before cutover; a held copy contains a person's direct change that teardown would otherwise destroy |

Recreate-not-adopt is a v1 decision, not an accident. Managed copies carry no
attendees, reminders, or notifications, so deleting and recreating them is
invisible to other people except as a bounded free/busy gap (or a bounded
duplicate-busy overlap in the gap-free ordering below). Adopting the other
edition's copies in place would require cross-edition provenance-marker
compatibility and imported projection mappings — a later optimization with its
own review, listed under follow-ups.

## The portable bridge export (`planipus-bridges/v1`)

A versioned JSON document, schema kept in `conformance/` beside the other
shared contracts so both editions validate the same shape:

- one entry per bridge: source and destination referenced by provider,
  account email, and provider calendar ID — never by either edition's
  internal row IDs;
- the full explicit policy: hours mode with the inline hours profile
  (timezone, weekly intervals, exceptions), privacy preset version and field
  switches, generic label, all-day/free/RSVP rules, duplicate-avoidance flag,
  `#nosync` marker, `destination_edits` modes, and manual exclusions by
  provider event ID;
- no tokens, no secrets, no event titles/details, no projection or copy IDs.

Because it contains account emails and calendar names, the file is personal
but not sensitive the way credentials are. It is small enough to keep in a
password manager. The UI copy calls it a **bridge passport** and recommends
re-exporting after any material policy change — this matters most in the
employer scenario below, where the person may lose access to the instance
before they can export.

Import on either edition creates *drafts only*. Import maps each referenced
account email to a connected account on the target and **fails closed** when
an account or calendar is missing, listing exactly what must be connected
first. Every draft still goes through the target edition's normal
preview-before-activate flow; import never silently writes to a calendar.

## Migration A — Mac → self-managed Server

Ordered checklist. Every step is verifiable, and each step names its rollback.

1. **Settle open decisions on the Mac.** Resolve every open destination-edit
   hold (restore or keep-and-detach). Export refuses — or loudly warns — while
   holds are open.
2. **Export the bridge passport** from Mac Settings.
3. **Stand up the Server** and connect the same Google accounts with the same
   roles (for the primary scenario: personal account read-only as source,
   work account write as destination). This is safe to do early; connecting
   writes nothing.
4. **Import the passport** on the Server. Confirm every bridge maps to a
   connected calendar. Do not activate yet. *(Rollback so far: do nothing;
   the Mac is still authoritative.)*
5. **Stop the Mac's bridges** (pause/stop sync). Copies remain in place;
   writes stop. *(Rollback: resume the Mac.)*
6. **Choose the cutover order:**
   - **Simple (default):** run the Mac's previewed managed-copy cleanup —
     it deletes only marker-verified Planipus-for-Mac copies and never
     touches detached copies — then preview and activate each imported
     bridge on the Server. Destination availability shows a gap of minutes
     between cleanup and the Server's first convergence.
   - **Gap-free (for booking-sensitive calendars):** activate the Server
     bridges *first* (previews should roughly match the Mac's copy counts),
     verify the Server's copies exist, then run the Mac cleanup. During the
     overlap the destination briefly shows duplicate busy blocks — viewers
     still just see busy — and the Mac's marker-scoped deletion cannot touch
     the Server's copies because their provenance differs.
7. **Verify as an ordinary viewer:** the destination calendar shows exactly
   one copy per qualifying source event, with the expected privacy preset,
   and Server health is green.
8. **Decommission the Mac state:** remove bridges and disconnect accounts
   (Keychain tokens deleted; optionally revoke the Mac's grant in Google
   security settings). Keep or delete the Mac's encrypted backup — it can no
   longer write anything once its grants are gone.

## Migration B — Mac → employer-managed Server

Mechanically identical to Migration A, with one added trust boundary that the
product must present honestly rather than smooth over: **connecting a personal
Google account to an employer's instance places the personal calendar's
read token — envelope-encrypted, but administered by the employer — on
infrastructure the person does not control.** That is a materially different
position than the Mac's device-bound Keychain, and the first-run import flow
on a multi-user instance shows it as an explicit consent step, not fine print.

What the employer instance stores and admins can see: bridge configuration,
masked account emails, privacy-redacted audit and health, encrypted tokens.
Event details remain excluded from logs, metrics, and audit by the standing
redaction rules — but a runtime administrator ultimately controls the process
that holds the token, and the disclosure says so plainly.

Recommended defaults the import flow proposes for employer instances:

- `busy_only` or `commitment` privacy for every personal→work bridge;
- do **not** migrate any bridge that writes to a personal calendar (keeping a
  personal-calendar *write* token off employer infrastructure); such bridges
  can stay on the person's Mac — the editions are independent, so running
  different bridges in different places is fully supported, as long as any
  single directed bridge lives in exactly one place;
- know the instance's retention and offboarding policy before connecting.

**Offboarding is the safety valve and must never depend on admin goodwill:**
the person can unilaterally revoke the instance's access to their personal
account in Google's security settings at any time. Revocation fail-closes the
instance's reads within a safety cycle (`action_required`), after which the
employer's copies stop updating and can be cleaned up by the instance or
manually. This unilateral exit is a documented, tested property, and it is
why the bridge passport recommendation matters: the person can rebuild on
their Mac without any cooperation from the instance they left.

## Migration C — Server → Mac (migrating back)

Symmetric, with the export starting on the Server:

1. Resolve open notices/holds on the Server (notices UI).
2. Export the bridge passport (planned `GET /api/v1/bridges/export`), or use
   the copy kept from the original migration — an employer offboarding may
   mean the instance is no longer reachable, and the passport plus Google's
   own revocation page are enough to proceed without it.
3. On the Mac: connect the accounts (device OAuth flow), import the passport,
   confirm mapping; do not activate yet.
4. On the Server: pause the policies, then run the previewed managed-copy
   cleanup (the planned policy-removal flow). If the instance is
   unreachable, revoke its Google grants instead; its copies become inert
   marked events that the Mac ignores as sources and that can be deleted
   manually or by a later orphan-cleanup tool.
5. On the Mac: preview and activate. The same simple/gap-free ordering choice
   from Migration A applies.
6. Finish decommissioning the Server side: self-managed, destroy the
   instance and its backups on your own schedule; employer-managed, request
   deletion *and* verify by checking the personal account's third-party
   access list — verification never depends on the deletion request being
   honored.

## Safety invariants (all paths)

- **Single writer:** one edition owns a directed bridge at a time; the
  checklists never activate the target's bridge while the origin's is
  unpaused, except in the explicitly bounded gap-free overlap.
- **Marker-scoped deletion only:** each edition deletes only copies whose
  provenance markers it can verify as its own; cleanup can never delete the
  other edition's copies, detached copies, or any original event.
- **Sources are never mutated** in any step of any path.
- **No credential ever crosses editions**; the export file is credential-free
  by schema, and import cannot be made to carry tokens.
- **Fail-closed import:** unmatched accounts/calendars block activation with
  a precise list, never a best-effort guess.
- **Orphan story:** copies left by a dead installation (lost Mac, vanished
  instance) are inert — both editions recognize Planipus markers and refuse
  to re-ingest marked copies as originals — so the worst case is stale busy
  blocks awaiting manual or tooled cleanup, never loops or duplicates of
  future events.

## Acceptance sketch

- Round-trip: export → import → export on the other edition yields an
  equivalent canonical policy document (shared-schema fixtures run by both
  editions' test suites).
- Live rehearsal with disposable accounts, both orderings: after cutover
  exactly one copy per qualifying event, no loop across the transition,
  availability gap/overlap bounded and measured, detached copies untouched,
  open holds block or warn at export.
- Employer path: revoking the personal Google grant alone stops instance
  reads/writes within one safety cycle, and the Mac rebuild from a passport
  succeeds with the instance unreachable.

## Ordered follow-ups

1. `planipus-bridges/v1` schema plus canonical fixtures in `conformance/`.
2. Mac passport export/import in Settings (file open/save panel grants).
3. Server import API/UI with account mapping, fail-closed validation, and the
   employer-instance disclosure step; Server export endpoint.
4. Guided cutover checklists in both UIs, including the pause-origin-first
   guard copy and the gap-free ordering option.
5. Orphaned-copy cleanup tooling; only after that, evaluate adopt-in-place
   as an alternative to recreate-and-delete.
