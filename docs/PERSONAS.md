# Personas

Nine users constructed to stress the disclosure model from unrelated directions.
They are research instruments, not marketing material: each one exists to ask a
question the product does not currently answer, and each is analysed against the
implemented truth in `STATE.md` rather than against the specification.

Every persona below independently arrived at the same defect. It is stated once,
here, because it is the single most important finding in this document:

> **The four privacy presets redact content and publish rhythm.** `transform()`
> assigns `desired.timing = input.source.timing` verbatim and no preset touches
> timing, so `busy_only` applied to a weekly 17:15 appointment publishes a
> perfect weekly 17:15 signal. Eight of nine personas discovered this from eight
> different threat models, and two derived the correct mechanism unprompted.

The second cross-cutting finding is that these people do not primarily ask for
features. Read the deal-breakers rather than the feature lists: seven of nine
name the Protect/Meet screens reporting success while the experimental write
gate silently swallows the write; nine of nine are blocked by the absence of any
route to remove copies already created, and four have personally hand-deleted
managed events at midnight.

The disclosure vocabulary used throughout is three-tiered, and the third tier is
the one the product has no word for:

| Tier | Question it answers |
|---|---|
| **Content** | Who may read what this event *says*? |
| **Presence** | Who may see that *something* is here, and on what rhythm? |
| **Existence** | Who must not be able to learn it happened at all? |

---

## P-01 · Marisol "Sol" Reyes-Okonkwo (she/her), 38

Director of Payer Analytics at a ~2,100-person health system in Chicago.
Polyamorous: a nesting partner, a second partner of three years who has their own
nesting partner, and a newer connection of seven months. Two kids on an iCloud
calendar shared with her co-parent Rob. Out to friends, not out at work. Five
calendar surfaces across three providers.

**What she is defending against.** Rob, who is a co-parent in a jurisdiction
where relationship structure is usable in a family-law context; and Kestrel
Ridge, where a VP decision is pending and she has not disclosed ADHD.

**The demand she makes of the product.** Not secrecy — *boredom*. She has
already lived a forty-minute title leak and she has independently invented the
project's own release gate S1(b), asking a colleague for a quarterly screenshot
of what her work calendar looks like from outside.

> "Rob doesn't need a title. He needs a pattern. Every other Friday at six, clear
> by Saturday eleven — that's a pattern, and it's a pattern whether or not you
> put a word on it."

> "If Brandon in FP&A can look at my Thursday and go 'huh', the system failed —
> and 'huh' is a much lower bar than a title."

**Deal-breakers.** Any hosted SaaS holding the graph of her relationships. Any
design requiring her partners to create accounts or pay. A UI that reports
success while nothing was written — she was burned by a silent Zapier failure on
14 June.

**What she proves.** That existence-concealment is a *safety* requirement, not a
preference, and that cadence defeats content redaction completely.

---

## P-02 · Devrim Aksoy (they/them), 34

Three jobs in Berlin: overnight production baker (03:30–11:30, four nights),
a Saturday farmers-market stall for a different employer, and two bar shifts a
week. The bakery contract carries a *Nebentätigkeit* clause the market work
breaches. Phone-first with near-zero competence outside a phone; will not install
anything, rent a VPS, or follow a five-step guide.

**The structural problem.** The post-shift sleep block is as inviolable as a
shift, and publishing its exact boundaries to the bar tells the bar exactly when
the bakery shift ended. Shift swaps arrive in a WhatsApp group at 22:51 and are
gone in eleven minutes.

> "I don't need them to know why. I need them to know no."

> "Marco doesn't want my calendar. He wants a WhatsApp message by the twentieth
> with the nights I can do. If your thing can't produce that message, it hasn't
> helped me — it's just given me a fourth place to keep the same information."

**Deal-breakers.** Any requirement to run or pay for a server. A shared instance
whose administrator can read contents. Anything that assumes a laptop.
Google-only — two of their three employers are not on Google at all.

**What they prove.** Two things the product must say plainly rather than solve:
Planipus publishes *busy*, not *availability*, and it will not produce Marco's
message. And a phone-first user with no laptop is a real and common shape.

---

## P-03 · Priya Raghunathan (she/her), 41

General Manager of a 22-person specialty grocery in Scarborough, Ontario.
Rosters 22 staff, runs five recurring manager 1:1s, and — confidentially — a
series of acquisition-diligence meetings with an acquirer's counsel, plus an HR
matter heading toward a termination.

**The three-tier case in its purest form.** She has all three classes
simultaneously and they are not negotiable:

| Class | Requirement |
|---|---|
| All-hands, delivery windows, statutory closures | Full detail *must* propagate — the failure mode is under-disclosure and the store opens late |
| Manager 1:1s | Busy only; staff must not be able to reconstruct the 1:1 grid, because a 1:1 that moves to Friday and grows to 45 minutes is read as a status map |
| Diligence and HR | Existence must not be learnable at all |

**The incident that already happened.** Three consecutive Tuesdays of a 90-minute
wall on her work calendar. No title. Marlon asked her on the shop floor, in front
of the deli case, whether the store was being sold and whether he still had a job.

> "I don't need it to say nothing. I need it to say nothing in a boring way.
> Three Tuesdays at the same time and Fatima's already done the arithmetic."

> "I hadn't told him a thing. The calendar told him."

**The hard limit she runs into.** For Priya the Workspace administrator *is* the
adversary — the founder selling the company holds the admin login. No setting in
this product touches that, and she must be told so before consent, not after.

**What she proves.** That `#nosync`-by-title cannot work: counsel's assistant
puts the meeting on her calendar, so she does not own the title.

---

## P-04 · Jonah Whitfield (he/him), 47

Independent brand-strategy consultant in Portland. Eight authenticated calendar
identities, ~14 calendars, six client Workspaces. Two clients are direct
competitors and one ran a written conflicts questionnaire. One client is an RIA
under indefinite Vault legal hold.

**Why he is here.** He is not buying sync. He is buying *evidence*.

> "I don't need my calendar to be secret. I need it to be boring. The second it's
> interesting to somebody, I've already lost the client."

> "The tool copied a title I'd redacted one hop earlier. Forty minutes it sat
> inside Cascadia's Workspace. I deleted it, and I still don't know whether
> anyone opened it, or whether it's in a Vault export."

**Deal-breakers.** No outside-eyes evidence, no install. Any success reported
while the provider write is gated. Any write into a client Workspace not preceded
by a preview approved for that specific direction. Kubernetes in any form — he
runs Synology Container Manager and there is no image and no compose file.

**What he proves.** That the third-viewer verification gate is not a release
chore, it is *the product* for a whole class of user; and that deletion is not
erasure, because his exposure survives in an admin audit log and a Vault export
he cannot reach.

---

## P-05 · Ama Boateng (she/her), 38

ICU charge nurse in Hamilton, Ontario. Rotating 12-hour pattern self-scheduled
six weeks out in a hospital system that exports only a poor ICS feed. Picks up
on-call, swaps shifts through a Facebook group, co-parents two children with a
partner who also works shifts.

**The failure that defines her.** She said yes to a shift at 22:50 from bed, with
eleven minutes before someone else took it. Her phone said Thursday was clear.
Thursday was not clear, and the consequence was a daycare door at 18:22.

> "I don't need him to know I'm at the General. I need him to know that at
> quarter to five on Thursday, he is the one standing at the daycare door."

**The sharpest third-tier case in the set.** EFAP counselling, every second
Thursday 13:30. The title is irrelevant; a 60-minute block on a fortnightly
cadence *is* the disclosure, and her manager can query her hospital free/busy.

**Deal-breakers.** Any path by which the hospital could see or infer a personal
event. Anything requiring hospital IT cooperation. A safety verdict delivered
without its own staleness on the same screen. Silent inertness.

**What she proves — by being refused.** Coverage modelling ("an adult must be
present 17:30–20:30, Marcus or Grace are eligible") and turnaround rules
("twelve hours since the last shift ended") are a second product. She must be
told directly that the daycare-door failure is not one Planipus will catch,
because a tool that is vague about that will be trusted to catch it.

---

## P-06 · Tomás Delgado-Kerr (he/him), 39

PACS administrator in Ottawa, co-parenting two children on a 2-2-3 rotation after
a contentious divorce, with court-ordered handover anchors and a shared calendar
that is adversarial by construction. Already pays for OurFamilyWizard because the
order requires it. Runs a Synology; will not put custody data on someone else's
server.

**What he actually wants, and cannot have.**

> "I don't need it to stop her changing things. I need it to be able to say, in
> writing, what the calendar said on the seventeenth of June at nine in the
> morning."

> "Everyone keeps offering me a better place to put the appointment. I've got
> five places to put the appointment. What I haven't got is a receipt."

**The structural refusal.** Google exposes `creator`, `organizer` and an
`updated` timestamp — no per-revision edit-actor history and no prior values.
"Who moved this event" is unanswerable by any product against Google. He must be
told this before he invests hope in it. A hash-chained ledger that a self-hosting
operator can also rewrite is not tamper-evidence against the party a court would
ask about.

**His new partner's name.** Reaching the shared calendar once is permanent — it
was screenshotted within an hour in March.

**What he proves.** That the non-weekly rotation cycle (2-2-3) is not a contract
change. `HoursProfile.weekly_intervals` is keyed on weekday 1–7 across the JSON
schema, the TypeScript engine, the independent Swift evaluator and 24 frozen
cases feeding a canonical SHA-256 vector. Once Hours CRUD exists, a rotation is
generated dated exceptions over a bounded horizon, which the contract already
handles.

---

## P-07 · Dr. Rin Matsuda (they/them), 33

NIH-funded cryo-EM postdoc in Seattle. Collaborators across JST, CET and PT;
teaching, instrument shifts, a constantly-moving advisor meeting, conference
travel, and a K99 deadline. Lives with a chronic illness and operates on a strict
energy budget: a hard cap on high-demand interaction per day and mandatory
recovery after long meetings. Does not intend to disclose the medical reason to
anyone at the university. Runs their own Linux box, self-hosts today, and uses
Radicale deliberately so that medical and job-search calendars never enter Google.

> "I don't need my calendar to be secret. I need it to be boring. About seventy
> percent of it should be wide open — it's the other six things, and they're
> always the same six things."

> "Marguerite is a lovely person and she did nothing wrong. She read a title that
> was sitting on a calendar I gave her permission to read. I can't make her
> unread it."

**Deal-breakers.** Any UI state reporting success while the write gate is off —
Rin will find this by reading the source, and will say so publicly. No bridge
cleanup route. Requiring a Mac (they run Fedora; the only Mac they can touch is
Jamf-managed with unsigned apps blocked). Requiring the private calendar to move
into Google before the privacy features apply.

**What they prove.** That the pacing constraint is a *pattern* disclosure — "Rin
can't handle a full day" becomes the PI's working model and is never said out
loud. And that the university's OAuth allowlist will reject an unrecognised
client before any feature matters.

---

## P-08 · Elliot Voss (they/them), 29

Senior backend engineer in Columbus. ADHD, transgender. Prints the day at 08:40
so they can diff it against Google later, because they no longer trust the
calendar not to change underneath them. Shares a family calendar with their
mother, who runs their father's entire care schedule off it — and who granted an
aunt read access in 2023 that Elliot only discovered recently.

> "An auto-moved meeting is worse than a conflict. A conflict I can see, and I
> can decide. A move rewrites the thing I was using to remember my day."

> "Nobody needs to read the title. Something at 5:15 every Tuesday for four
> months IS the title. My mother isn't snooping, she's just competent."

**The three classes.** Gender-affirming endocrinology on a 12-week cadence and a
probate name-change hearing must be existence-hidden from the family calendar.
Therapy is deliberately included as a *contrast* class — not everything is a
secret, and a product that forces uniform paranoia is wrong. PagerDuty on-call
has no privacy requirement at all but arrives as an all-day transparent ICS
event, which is precisely the class the wizard currently skips silently.

**Deal-breakers.** No installable artefact — Helm chart, no image, no compose
file. A Protect screen that displays fences never written to Google. No route to
remove copies already written: activation without undo is an irreversible
disclosure. Any automatic move reachable by accident.

**What they prove.** That destination ACL readability is the feature — and that
for the calendar that motivated it, which their mother owns, Planipus can *never*
enumerate the readers. "Readers unknown" is therefore the correct output.

---

## P-09 · Kwame Osei (he/him), 52

Technical operations lead and elected member-director at a 14-person worker-owned
design co-op in Bristol. Nextcloud CalDAV is the authoritative internal calendar.
The software budget is £4,200/year for 14 people, voted at a members' meeting.
Two clients bid against each other. He has fortnightly venesection appointments
at Southmead.

> "Thirteen co-owners have to vote yes on this, and one of them is going to ask
> me, on the record, whether I can read her Tuesday evenings."

> "Busy at eight in the morning, every eighth Thursday, and never otherwise?
> That's a diagnosis. Nobody needs to read the title. You've built a beautiful
> machine for hiding what an event says and no machine at all for hiding when it
> happens."

**Deal-breakers.** No second user — bootstrap always mints the same owner
principal, so deploying for the co-op means handing thirteen colleagues an owner
session. No CalDAV: Google-to-Google addresses four of fourteen members. Any
deployment in which he as operator could read a member's event title — and the
honest answer today is that he can, via `psql` or last night's restic snapshot,
because `normalized_event` is unencrypted `jsonb`. An unsigned image from a
two-commit repository on a cluster that also holds payroll.

**What he proves.** That `retention` is a third axis, orthogonal to content and
presence. "Not copied to destination" is not "not stored", and the current
preview says "never copied", which a self-hosting operator will read as a claim
about his database. He states plainly that he would rather run a weaker tool with
a true privacy story than a strong tool with a caveated one.

---

## Cross-persona findings

### The three axes

Content redaction is one axis and the product implements it well. Two more axes
are missing and both are load-bearing:

- **Presence** — whether, and on what rhythm, a block appears at all. Zero hits
  for `jitter`, `coarsen`, `decoy` or `round_to` anywhere in the codebase.
- **Retention** — what Planipus itself stores. `busy_only`, the preset every
  privacy-motivated persona selects, currently persists the real title,
  description, location, attendee emails and organizer in cleartext PostgreSQL
  and in every backup, while the preview says "never copied".

### What no tier can ever promise

1. Nothing hides from a Workspace administrator, the Calendar admin audit log,
   or a Vault/eDiscovery export. `visibility: private` is not honoured against
   these.
2. No tier makes an event both invisible and blocking. Reserving an interval *is*
   publishing that an interval is reserved.
3. No transform of real events defeats a long-horizon observer. Coarsening,
   rounding, padding and jitter all leave the published shape a function of the
   underlying event, so differencing across weeks recovers the signal. **Only a
   fence whose shape is a function of the policy alone is cadence-safe.**
4. Readership of a calendar the user does not own is not enumerable. "Readers
   unknown" is the honest answer and is more useful than a partial list.
5. Disclosure is not recallable. Deletion removes the event and reaches nothing
   else. Three personas were screenshotted within 40 minutes, one hour, and the
   same evening respectively.
6. Client-side per-calendar default alerts are outside Planipus's control. The
   guarantee is "we do not notify anyone", never "your recipient will not be
   notified".
7. A Workspace admin can enumerate third-party OAuth grants and their scopes.
   Planipus cannot hide that it is connected. Say so before the first work-account
   consent.
8. Providers have no per-viewer visibility dimension. Four audiences means four
   destination calendars and four bridges.
9. Actor attribution is structurally unavailable. "Who moved this event" must
   never be implied.

### Provider reach, quantified

Google-only reaches roughly half of each life and hard-blocks three personas
outright. Devrim's bar rota is Papershift, Ama's roster is a hospital ICS export,
Kwame's co-op is entirely Nextcloud, Rin deliberately keeps medical and
job-search on Radicale, and Sol's kid calendar is iCloud. The cheapest honest
answer available today is documentation: Google Calendar can already subscribe to
an external ICS URL, and the resulting calendar can already be bridged — at a
doubled staleness that must be stated.

### Deliberate non-goals confirmed by this exercise

Rostering and availability publication; coverage and dependent modelling;
turnaround and minimum-gap constraints; non-weekly rotation as a contract change;
merging and jitter as cadence protection; decoy block generation; tamper-evident
legal-evidence export; actor attribution; time-tracking and relationship-fairness
ledgers; push notifications and native mobile; per-viewer visibility. Reasoning
for each is recorded in the plan that accompanies this document.
