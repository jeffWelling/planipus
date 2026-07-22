# Scheduling solver specification

Status: **limited Server alpha implemented; full solver deferred**.
`CALENDAR-SYNC.md` remains authoritative for calendar bridges. The implemented
planning slice covers only Availability Boundary and independently materialized
Smart Meeting occurrences. The general task, project, capacity, fairness,
booking, recurrence-series, and optimization design later in this document is
still target research, not a claim about the running system.

The alpha planning engine is deterministic and side-effect free for a supplied
draft, busy snapshot, and evaluation instant. Snapshot collection and provider
writes remain application concerns. The fuller solver contract requires the
same canonical snapshot, solver version/config, horizon, and seed to return
byte-equivalent canonical plan content, but those versioned plan artifacts and
explanations do not yet exist.

## Implemented alpha planning slice

The Server planning engine accepts one validated rule draft, an explicit `now`,
and normalized timed busy intervals. It does not query PostgreSQL, fetch a
provider, or write an event. Validation currently rejects overnight local
windows and bounds horizons, occurrence counts, attendees, calendar lists, and
text lengths as described in `API.md`.

### Availability Boundary

For each local date beginning with the rule timezone's date at `now`, through a
configured 1–60 day horizon, the engine materializes selected weekday working
hours using the shared earlier-offset/shift-forward DST policy. It returns the
complement intervals requested by the rule: before work, after work, and/or the
entire day on closed weekdays. Each interval becomes an independent private or
default-visibility event with no attendees and no update notifications.

This is calendar protection, not a general constraint object. It supports one
same-day working interval per selected weekday, has no date exceptions, holiday
calendar, buffer composition, multiple shifts, or external calendar search.

### Smart Meeting

For each requested occurrence, starting at `start_date` and advancing by
`cadence_weeks`:

1. materialize the allowed same-day local windows for that occurrence week;
2. pool every supplied busy interval across the selected availability calendars;
3. try duration values from maximum down to minimum by the configured 15, 30, or
   60 minute step;
4. align candidate starts to that step on the UTC epoch, reject overlap with
   pooled busy time and already selected occurrences, and stop reducing duration
   once any candidate exists;
5. score feasible candidates by absolute local-minute distance from the preferred
   time plus a shorter-duration penalty; then tie-break by start and end instant;
6. return the best independent event or an `unmet` occurrence.

Attendees are copied to every created event. When any attendee is present, the
Google adapter uses `sendUpdates=all` for create, update, and delete. There is no
provider recurrence series and no conference-link generation. Required attendee
availability that has no attendee calendar mapping produces
`required_attendee_availability_unknown` but does **not** block placement or
suppress invitations. At the service boundary, every explicitly selected
calendar must be active/readable with a ready successful sync no more than 30
minutes old; otherwise planning fails with `availability_not_ready` rather than
using an incomplete busy snapshot. Timed busy observations contribute their
instants; all-day busy observations are materialized as full local days under
the shared DST policy before reaching the engine.

The optional availability-calendar identifier is not modeled per attendee;
calendar identity is ignored once intervals are loaded. The target/organizer
calendar is not automatically included in availability. Preparation excludes an
observed event carrying the current rule's Google private marker and omits the
same rule's desired rows. Desired events for other Smart Meeting rules are still
pooled without checking that their destination is among the selected
availability calendars.

### Preview, activation, and repair semantics

Preview stores the validated draft, result, and a hash of relevant calendar and
observation inputs for ten minutes. Activation re-reads those inputs, requires
the input hash to match, and recomputes the result before it creates revision-1
rule and planned-event state. It does not compare the recomputed result with the
stored preview result, which matters because the evaluation instant is absent
from the snapshot. Scheduler reconciliation later re-runs the same engine and
compares desired hashes by occurrence.

Conflict behavior is currently:

- `auto_move`: enqueue a provider update to the newly selected time;
- `suggest`: keep the converged event and create a pending suggestion record;
  the API can later accept or dismiss it;
- `keep_with_warning`: put the planned event in `held` state;
- `lock_before_minutes`: before applying any changed desired state, hold an
  existing future event whose current start is inside the no-move window;
- priority is accepted and stored but is not used by the engine/coordinator.

Rule removal marks future/current managed or possibly in-flight occurrences for
deletion and retains past provider events. Suggestion acceptance revalidates its
basis, no-move window, recent availability, and latest occurrence result, then
advances intent and can create, update, or delete the event; dismissal keeps
current state. These are coordinator/application semantics, not part of the pure
placement algorithm.

The alpha result is an occurrence list plus warning/unmet reason codes. It is not
an immutable operation plan: it has no before/after diff, score breakdown,
alternative list, approval-risk classification, global planning revision, safe
rebase, or compensating operation graph.

### Known algorithm and consistency gaps

- Candidate-step alignment uses the UTC epoch rather than the local-window
  origin. In half-hour or quarter-hour offset zones, a 60-minute step can yield
  surprising local start minutes.
- Snapshot calendar rows are not explicitly ordered before hashing, and the
  evaluation instant is not hashed. Unchanged input can falsely appear stale or
  a preview can cross a local-day boundary without a stale conflict.
- Selected calendars fail closed when not recently ready, but required attendees
  can still have no mapped calendar and remain warning-only. An attendee's
  calendar reference need not appear in the selected calendar list.
- Unchanged pending events are re-enqueued by reconciliation/resume, and active
  `target_unavailable` holds are retried. Ownership/policy holds lack recovery.
  Already-started events are not protected by the no-move check; after lock
  expiry a `suggest` rule that is now held can fall through to automatic update
  because suggestion generation requires `converged` state.
- Reconciliation rolls Smart Meeting `start_date` forward by complete cadence
  cycles. Its stale-occurrence deletion path does not check an attached event's
  end time, so it can delete past meeting history with attendee updates.
- Periodic rule reconciliation does not remotely verify unchanged managed
  events. External edits and deletes can remain undetected.
- There is no task placement, dependencies, splitting, focus defense, movement
  budget, attendee-specific availability/fairness, RSVP-aware repair, booking,
  capacity, or bounded search/backtracking.
- The existing unit tests demonstrate a handful of examples, not all required
  properties or timezone/provider behavior below.

No Keeper source, schema, tests, fixtures, or other AGPL-licensed implementation
material may be copied, adapted, translated, linked, vendored, or used as a code
dependency. Public product behavior may inform independently written
requirements, but all Planipus implementation and fixtures remain clean-room.

## Historical reference

Planipus does not adopt or run a solver in the calendar-sync foundation. A
future planner may use Fluxure only as behavior research unless a new license,
provenance, and architecture ADR explicitly approves a compatible reuse path.
The historically audited Fluxure engine was pure TypeScript and passed 201
focused tests at its pinned historical revision. It:

- converts habits, tasks, smart-meeting objects, and focus rules to day-specific
  schedule items;
- sorts priority then type, generates candidates, applies Gaussian ideal-time
  scoring, and greedily places the best legal slot;
- splits tasks by min/max chunk with ordering dependencies;
- classifies external/managed/locked/completed events and applies buffers;
- places focus last according to target risk;
- returns minimal create/update/delete calendar operations and unschedulable
  items; and
- calculates a 0–100 quality score from placement, ideal-time, focus, buffer,
  and priority components.

The rest of this document is target behavior for any future Planipus-authored
planner. Preserve engine purity and testability while adding stable reason
codes, factor explanations, explicit hard/soft separation, movement budgets,
richer recurrence/capacity/fairness, and bounded repair/search. Do not add
Timefold, another optimizer, or a model without the measured escalation gate in
`REUSE-MAP.md`.

## Input snapshot

- organization/user/team timezone and policy versions;
- horizon and immutable planning revision;
- fixed busy/tentative/free events and existing managed placements;
- work items, recurrence occurrences, dependencies, estimates, priorities;
- smart meeting occurrences, attendees, routing sets, availability/capacity;
- working/preferred/forbidden windows, energy curves, travel/buffer rules;
- booking holds and provider state freshness;
- stability pins, no-move windows, completed/in-progress history;
- solver configuration version, weights, candidate granularity, seed.

Snapshot creation normalizes time intervals and validates invariants. The solver
never fetches a calendar, queries a database, reads current time, or calls a model.

## Output

- immutable placements and ordered operations;
- unscheduled/unmet items with stable reason codes;
- quality metrics before/after;
- per-operation and per-unmet explanation factors;
- alternative candidates for interactive inspection;
- solver version/config hash, base revision, input hash, elapsed/complexity stats.

## Hard constraints

A candidate is excluded if it violates any active hard rule:

1. Overlap with non-movable busy event, locked placement, confirmed booking, or
   active booking hold including buffers/travel.
2. Outside allowed date/working windows or inside protected/blackout windows.
3. Before earliest start, after hard deadline, or outside recurrence occurrence.
4. Duration/chunk/gap/daily-chunk rules.
5. Dependency order, lag, or required predecessor completion.
6. Required attendee/resource unavailable; round-robin member ineligible.
7. Capacity ceiling or mandatory rest/lunch policy.
8. Provider/calendar is stale beyond safety threshold for external booking.
9. Movement inside a no-move window or of an attendee-owned immutable meeting.
10. Permission/policy forbids changing the target calendar or disclosure level.

Hard exclusions return codes with policy/resource references. They are not
represented as merely enormous negative scores.

## Candidate generation

1. Build normalized busy interval sets per person/resource/calendar.
2. Expand recurrence only within horizon plus boundary padding.
3. Derive free intervals by subtracting busy, buffers, travel, and hard policy.
4. Generate candidate starts on configurable granularity plus meaningful
   boundaries (event ends, preferred-window starts, deadlines).
5. For splittable work, generate legal chunk decompositions without combinatorial
   explosion; prefer existing chunks and common sizes.
6. For team meetings, intersect required availability, union optional utility,
   and compute eligible routing assignments.
7. Deduplicate canonical candidates; cap per item using safe dominance pruning.

Granularity begins at five minutes for booking and fifteen minutes for flexible
work, configurable by policy. DST days operate on instants derived from local
windows; a day is not assumed to contain 24 hours.

## Ordering

Initial deterministic ordering:

1. locked/in-progress items (preserve rather than place);
2. hard-deadline and smart-meeting occurrences by slack;
3. P1 through P4;
4. dependency depth and downstream criticality;
5. descending duration scarcity;
6. stable item ID tie-break.

Incremental repair first freezes unaffected regions, then opens the smallest
neighborhood capable of restoring feasibility. Full solve is an explicit mode.

## Soft objective

Scores are normalized to comparable units and emitted individually:

```text
total =
  deadline_urgency
  + priority_value
  + preferred_window_fit
  + energy_fit
  + focus_contiguity
  + context_batching
  + meeting_fairness
  + capacity_balance
  + booking_value
  - movement_cost
  - fragmentation_cost
  - context_switch_cost
  - after_hours_cost
  - travel_risk
  - uncertainty_risk
```

Weights are versioned policy, never magic UI constants. Higher priority does not
override hard personal time. Near-deadline urgency increases smoothly with slack
and expected remaining work. P1 items should displace P4 flexible blocks but not
silently erase them; displaced work remains unmet or is relocated.

### Stability/movement

Movement cost considers time delta, date change, notification impact, proximity
to start, prior move count, user pin, attendee count, and whether the person has
already seen/accepted an invitation. The solver prefers no-op. Any movement above
policy threshold requires preview approval even under automatic mode.

### Focus and fragmentation

Reward contiguous deep-work windows and matching energy. Penalize unusable gaps,
too many chunks, adjacent high-switch contexts, and isolated short blocks. Do not
optimize a numeric focus score at the cost of missed hard deadlines.

### Meeting fairness

Track inconvenience by attendee over a rolling window: outside preferred hours,
lunch intrusion, early/late local time, movement, and meeting load. Optimize
maximum regret then total regret rather than always favoring organizer timezone.
Explanations expose aggregate fairness without private calendars.

### Round robin

Eligibility is hard. Assignment score then balances availability fit, configured
weight/priority, recent assignment count, booked minutes, capacity, continuity,
and optional customer ownership. Atomic holds prevent concurrent double-routing.

## Planning modes

- `repair`: minimal changes after new information; default background mode.
- `rebalance`: improve horizon while honoring stability budget.
- `pack`: consolidate work to create larger free windows.
- `spread`: limit daily load and preserve recovery.
- `deadline_rescue`: show maximum feasible work and explicit sacrifices.
- `meeting_search`: optimize attendee slots without altering task placements until
  a candidate is chosen.
- `booking_displacement`: assess whether a high-priority bookable slot may move
  flexible blocks within policy.
- `what_if`: no plan expiry/apply capability unless user promotes result.

## Preview and apply

The solver returns a plan at revision N. Apply:

1. authorizes actor/delegation and verifies plan not expired/superseded;
2. checks organization planning revision equals N;
3. validates operation preconditions and provider connection health;
4. atomically records local desired state, execution, audit, and outbox;
5. asynchronously performs idempotent provider effects;
6. reconciles results and exposes applied/partial/failed status.

Any planning-relevant change between preview/apply returns revision conflict and
requires a new preview. A future safe-rebase mode still returns a new plan ID.

## Explanations

Every placed item answers:

- why this item was selected now;
- why this slot won;
- which hard constraints were checked;
- what moved and why;
- score factors with human labels;
- closest alternatives and their material disadvantage;
- policy/source citations.

Every unmet item has one primary reason and supporting details: no legal window,
insufficient capacity before deadline, dependency blocked, duration larger than
all free intervals, attendee conflict, stale provider, policy conflict, or search
budget exhausted. “AI could not schedule it” is never a valid reason.

## Algorithms by milestone

### M1: deterministic greedy + bounded repair

Sorted-item placement, interval indexes, candidate scoring, limited backtracking,
and local swap/ejection chain. Suitable for one user and explainable debugging.

### M3: constraint model behind same port

Add CP-SAT or a native bounded search only after license/supply-chain review.
Model optional intervals, precedence, capacity, and multi-attendee objectives.
Keep the greedy solver as fallback/oracle and record solver kind/version.

### M6: incremental team solve

Partition by affected calendars/time regions, preserve solution hints, enforce
fairness history, and bound solve time. Timeout returns best feasible plan plus
quality gap/search-exhausted explanation; it never applies silently.

## Safety and capacity bounds

- maximum horizon, items, candidates/item, recurrence instances, attendees, and
  solver milliseconds per request;
- cancellation token checked during long solves;
- background deduplication by snapshot/options hash;
- memory estimates before model construction;
- deterministic degradation: prune dominated candidates, shorten alternatives,
  then return explicit capacity error rather than OOM;
- no user-provided expression language inside solver.

## Required properties

1. No returned hard-constraint overlap.
2. Each occurrence placed at most once; chunk sums do not exceed remaining work.
3. Locked/completed/provider-owned immutable events never change.
4. Dependencies and deadlines obey semantics.
5. Same canonical input gives same plan.
6. Timezone conversion round-trips local intent where representable.
7. Applying plan then solving unchanged state yields no material operation.
8. Adding unrelated distant event does not perturb stable local placements.
9. Removing a constraint cannot reduce the feasible candidate set.
10. Higher priority does not receive worse outcome when all else is identical,
    except where fairness/stability policy explicitly explains it.
11. No plan references an input version absent from its snapshot.
12. Explanations contain no data the requester cannot read.

## Benchmarks and quality corpus

Maintain anonymized/synthetic scenarios:

- DST transition, all-day, recurrence exception, travel crossing timezones;
- overfull week/deadline rescue;
- fragmented focus versus context batching;
- new urgent task minimal repair;
- 2/20/500-person meetings across timezones;
- round-robin race and fairness history;
- booking displacing flexible work;
- provider stale/conflict/partial apply;
- 12-week team capacity.

Release budgets define p50/p95 solve latency and peak memory by scenario. A
quality change needs golden explanation review; faster is not better if plans
become unstable or opaque.
