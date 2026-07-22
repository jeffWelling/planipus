import { useEffect, useMemo, useState } from "react";

import { api } from "./api.js";
import type {
  AvailabilityBoundaryDraft,
  Connection,
  PlanningPreview,
  PlanningRule,
  PlanningSuggestion,
  SmartMeetingDraft
} from "./types.js";

type ActionRunner = (action: () => Promise<unknown>) => void;

function writableCalendars(connections: Connection[]) {
  return connections.flatMap((connection) => connection.calendars).filter((calendar) => calendar.writable);
}

function readableCalendars(connections: Connection[]) {
  return connections.flatMap((connection) => connection.calendars).filter((calendar) => calendar.readable);
}

function endpointName(id: string, connections: Connection[]): string {
  for (const connection of connections) {
    const calendar = connection.calendars.find((item) => item.id === id);
    if (calendar) return `${connection.label} · ${calendar.name}`;
  }
  return "Calendar";
}

function localStartDate(): string {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatSlot(start?: string, end?: string): string {
  if (!start || !end) return "No safe time found";
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(startDate)} · ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(startDate)}–${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(endDate)}`;
}

function reasonLabel(reason: string): string {
  const values: Record<string, string> = {
    outside_working_hours: "Outside working hours",
    preferred_time_available: "Preferred time is open",
    closest_mutual_opening: "Closest mutual opening",
    no_mutual_time_inside_meeting_hours: "No mutual opening inside Meeting Hours",
    conflict_found_better_time: "A safer time is ready to review",
    conflict_kept_for_manual_resolution: "Conflict needs a decision"
  };
  return values[reason] ?? reason.replaceAll("_", " ");
}

function PlanningRuleCard({ rule, runAction, onChanged }: {
  rule: PlanningRule;
  runAction: ActionRunner;
  onChanged: () => void;
}) {
  function action(work: () => Promise<unknown>) {
    runAction(async () => {
      await work();
      onChanged();
    });
  }
  function remove() {
    if (rule.status === "deleting") {
      action(() => api.removePlanning(rule.id));
      return;
    }
    const effect = rule.kind === "smart_meeting"
      ? "This removes the future meetings Planipus owns and sends cancellations to invitees."
      : "This removes the private Busy blocks Planipus owns.";
    if (window.confirm(`Remove “${rule.name}”?\n\n${effect}`)) {
      action(() => api.removePlanning(rule.id));
    }
  }
  return (
    <article className="planning-card">
      <header>
        <div>
          <p className="eyebrow">{rule.kind === "smart_meeting" ? "Smart Meeting" : "Availability fence"}</p>
          <h3>{rule.name}</h3>
          <p>{rule.targetCalendarName}</p>
        </div>
        <span className={`planning-state planning-state--${rule.status}`}>{rule.status === "active" ? "On" : rule.status === "paused" ? "Paused" : "Cleaning up"}</span>
      </header>
      <div className="planning-card__counts">
        <span><b>{rule.scheduledCount}</b><small>{rule.kind === "smart_meeting" ? "upcoming" : "managed blocks"}</small></span>
        <span><b>{rule.unmetCount}</b><small>need attention</small></span>
        <span><b>{rule.suggestionCount}</b><small>suggested changes</small></span>
      </div>
      {rule.nextOccurrences.length > 0 ? (
        <ol className="slot-list slot-list--compact">
          {rule.nextOccurrences.slice(0, 4).map((occurrence) => (
            <li key={occurrence.id}>
              <span className={`slot-dot slot-dot--${occurrence.status}`} aria-hidden="true" />
              <div><b>{formatSlot(occurrence.startAt, occurrence.endAt)}</b><small>{reasonLabel(occurrence.reasonCode)}</small></div>
            </li>
          ))}
        </ol>
      ) : <p className="subtle">Planning the first window…</p>}
      <footer>
        <button className="button button--danger-quiet" onClick={remove}>{rule.status === "deleting" ? "Retry cleanup" : "Remove"}</button>
        {rule.kind === "smart_meeting" && rule.status === "active" ? <button className="button button--quiet" onClick={() => action(() => api.replan(rule.id))}>Check again</button> : <span />}
        {rule.status !== "deleting" ? <button className="button button--secondary" onClick={() => action(() => rule.status === "active" ? api.pausePlanning(rule.id) : api.resumePlanning(rule.id))}>{rule.status === "active" ? "Pause" : "Resume"}</button> : <span />}
      </footer>
      <p className="planning-card__footnote">{rule.status === "deleting" ? "Planipus keeps this visible until every future event it owns is removed. Completed meetings stay in calendar history." : "Pausing stops maintenance but leaves existing calendar events in place. Remove cleans up future events Planipus owns."}</p>
    </article>
  );
}

export function ProtectionScreen({ connections, runAction }: { connections: Connection[]; runAction: ActionRunner }) {
  const targets = useMemo(() => writableCalendars(connections), [connections]);
  const [rules, setRules] = useState<PlanningRule[]>([]);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<PlanningPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [before, setBefore] = useState(false);
  const [weekends, setWeekends] = useState(false);
  const [title, setTitle] = useState("Personal time");

  function refresh() {
    void api.planningRules().then((items) => setRules(items.filter((item) => item.kind === "availability_boundary"))).catch((cause) => setError(cause instanceof Error ? cause.message : "Protection rules are unavailable"));
  }
  useEffect(refresh, []);

  function draft(): AvailabilityBoundaryDraft {
    return {
      kind: "availability_boundary",
      name: "After-work protection",
      target_calendar_id: target,
      timezone,
      working_days: [1, 2, 3, 4, 5],
      workday_start: start,
      workday_end: end,
      protect_before_work: before,
      protect_after_work: true,
      protect_closed_days: weekends,
      title,
      visibility: "private",
      horizon_days: 21
    };
  }

  async function buildPreview() {
    setBusy(true); setError(undefined);
    try { setPreview(await api.previewPlanning(draft())); } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview did not complete"); }
    finally { setBusy(false); }
  }

  async function activate() {
    if (!preview) return;
    setBusy(true); setError(undefined);
    try {
      await api.activatePlanning(preview.previewToken);
      setPreview(undefined); setEditing(false); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Protection did not turn on"); }
    finally { setBusy(false); }
  }

  return (
    <div className="content-stack">
      <section className="feature-hero feature-hero--protect">
        <div><p className="eyebrow">Protect</p><h1>Let the workday have an edge.</h1><p>Meeting Hours guide Planipus. An availability fence goes further: it adds private Busy blocks after work so ordinary Google free/busy also shows that time as unavailable.</p></div>
        <button className="button button--primary" disabled={targets.length === 0} onClick={() => { setEditing(true); setPreview(undefined); }}>Protect after work</button>
      </section>
      <aside className="truth-note"><b>Two different protections</b><span><strong>Meeting Hours</strong> stop Planipus from scheduling outside the window. <strong>Availability fence</strong> creates managed destination events for other calendar tools to see.</span></aside>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {rules.length > 0 ? <div className="planning-grid">{rules.map((rule) => <PlanningRuleCard key={rule.id} rule={rule} runAction={runAction} onChanged={refresh} />)}</div> : <section className="inline-empty inline-empty--roomy"><p>No after-work protection is on. Planipus still honors the hours in each bridge and Smart Meeting.</p></section>}
      {editing ? (
        <section className="composer" aria-labelledby="protect-composer-title">
          <div className="composer__heading"><div><p className="eyebrow">New availability fence</p><h2 id="protect-composer-title">What should look unavailable?</h2></div><button className="dialog__close" aria-label="Close" onClick={() => setEditing(false)}>×</button></div>
          {!preview ? <>
            <div className="form-grid form-grid--three">
              <label>Calendar<select value={target} onChange={(event) => setTarget(event.target.value)}>{targets.map((calendar) => <option key={calendar.id} value={calendar.id}>{endpointName(calendar.id, connections)}</option>)}</select></label>
              <label>Work starts<input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
              <label>Work ends<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
              <label className="form-span">Timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
              <label className="form-span">Calendar label<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
            </div>
            <div className="toggle-stack">
              <label><input type="checkbox" checked={before} onChange={(event) => setBefore(event.target.checked)} /><span><b>Protect mornings too</b><small>Add private Busy time before the workday starts.</small></span></label>
              <label><input type="checkbox" checked={weekends} onChange={(event) => setWeekends(event.target.checked)} /><span><b>Protect weekends</b><small>Show Saturdays and Sundays as unavailable.</small></span></label>
            </div>
            <button className="button button--primary" disabled={busy || !target || start >= end} onClick={() => void buildPreview()}>{busy ? "Checking the next three weeks…" : "Preview the fence"}</button>
          </> : <>
            <div className="preview-summary"><span><b>{preview.scheduledCount}</b><small>private Busy blocks</small></span><span><b>0</b><small>invitations or reminders</small></span><span><b>21</b><small>days covered</small></span></div>
            <p>Planipus will maintain these blocks on <b>{endpointName(target, connections)}</b>. It never changes existing events and only removes blocks it owns.</p>
            <ol className="slot-list">{preview.occurrences.slice(0, 4).map((occurrence) => <li key={occurrence.occurrenceKey}><span className="slot-dot" /><div><b>{formatSlot(occurrence.startAt, occurrence.endAt)}</b><small>Private · Busy · no reminders</small></div></li>)}</ol>
            <div className="composer__actions"><button className="button button--quiet" onClick={() => setPreview(undefined)}>Back</button><button className="button button--primary" disabled={busy} onClick={() => void activate()}>{busy ? "Turning on protection…" : `Turn on and add ${preview.scheduledCount} blocks`}</button></div>
          </>}
        </section>
      ) : null}
    </div>
  );
}

export function SmartMeetingsScreen({ connections, runAction }: { connections: Connection[]; runAction: ActionRunner }) {
  const targets = useMemo(() => writableCalendars(connections), [connections]);
  const availability = useMemo(() => readableCalendars(connections), [connections]);
  const [rules, setRules] = useState<PlanningRule[]>([]);
  const [suggestions, setSuggestions] = useState<PlanningSuggestion[]>([]);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<PlanningPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [name, setName] = useState("Weekly one-to-one");
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [selectedAvailability, setSelectedAvailability] = useState<string[]>(availability.map((calendar) => calendar.id));
  const [attendee, setAttendee] = useState("");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:00");
  const [preferred, setPreferred] = useState("10:00");
  const [duration, setDuration] = useState(30);
  const [weekday, setWeekday] = useState(2);
  const [conflictPolicy, setConflictPolicy] = useState<SmartMeetingDraft["conflict_policy"]>("suggest");

  function refresh() {
    void Promise.all([api.planningRules(), api.planningSuggestions()])
      .then(([items, changes]) => {
        setRules(items.filter((item) => item.kind === "smart_meeting"));
        setSuggestions(changes);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Smart Meetings are unavailable"));
  }
  useEffect(refresh, []);

  function resolveSuggestion(suggestion: PlanningSuggestion, decision: "accept" | "dismiss") {
    runAction(async () => {
      if (decision === "accept") await api.acceptPlanningSuggestion(suggestion.id);
      else await api.dismissPlanningSuggestion(suggestion.id);
      refresh();
    });
  }

  function draft(): SmartMeetingDraft {
    return {
      kind: "smart_meeting",
      name,
      target_calendar_id: target,
      timezone,
      start_date: localStartDate(),
      weekdays: [weekday],
      window_start: windowStart,
      window_end: windowEnd,
      preferred_time: preferred,
      cadence_weeks: 1,
      occurrence_count: 6,
      minimum_duration_minutes: duration,
      maximum_duration_minutes: duration,
      start_step_minutes: 15,
      priority: 2,
      attendees: attendee.trim() ? [{ email: attendee.trim(), required: true }] : [],
      availability_calendar_ids: selectedAvailability,
      conflict_policy: conflictPolicy,
      lock_before_minutes: 24 * 60,
      visibility: "default"
    };
  }

  async function buildPreview() {
    setBusy(true); setError(undefined);
    try { setPreview(await api.previewPlanning(draft())); } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview did not complete"); }
    finally { setBusy(false); }
  }

  async function activate() {
    if (!preview) return;
    setBusy(true); setError(undefined);
    try {
      await api.activatePlanning(preview.previewToken);
      setEditing(false); setPreview(undefined); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Smart Meeting did not turn on"); }
    finally { setBusy(false); }
  }

  return (
    <div className="content-stack">
      <section className="feature-hero feature-hero--meet">
        <div><p className="eyebrow">Meet</p><h1>Recurring meetings that can breathe.</h1><p>Choose a cadence, mutual window, and preferred time. Planipus places each occurrence inside Meeting Hours and watches for conflicts.</p></div>
        <button className="button button--primary" disabled={targets.length === 0 || availability.length === 0} onClick={() => { setEditing(true); setPreview(undefined); }}>New Smart Meeting</button>
      </section>
      <aside className="truth-note"><b>Attendee-safe by default</b><span>When a conflict appears, Planipus suggests another time for you to approve. Automatic moves are optional because other people’s calendars deserve manners too.</span></aside>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {suggestions.length > 0 ? <section className="suggestion-shelf" aria-labelledby="suggestion-title"><div><p className="eyebrow">Needs your okay</p><h2 id="suggestion-title">Planipus found a kinder fit.</h2></div>{suggestions.map((suggestion) => <article className="suggestion-card" key={suggestion.id}><div><b>{suggestion.ruleName}</b><p>{suggestion.kind === "skip" ? "No safe replacement exists inside Meeting Hours." : <><span>{formatSlot(suggestion.currentStartAt, suggestion.currentEndAt)}</span><span className="suggestion-arrow" aria-hidden="true">→</span><strong>{formatSlot(suggestion.proposedStartAt, suggestion.proposedEndAt)}</strong></>}</p></div><div className="suggestion-card__actions"><button className="button button--quiet" onClick={() => resolveSuggestion(suggestion, "dismiss")}>Keep current</button><button className="button button--primary" onClick={() => resolveSuggestion(suggestion, "accept")}>{suggestion.kind === "skip" ? "Cancel this occurrence" : "Approve move"}</button></div></article>)}</section> : null}
      {rules.length > 0 ? <div className="planning-grid">{rules.map((rule) => <PlanningRuleCard key={rule.id} rule={rule} runAction={runAction} onChanged={refresh} />)}</div> : <section className="inline-empty inline-empty--roomy"><p>No Smart Meetings yet. A normal recurring calendar event stays at one fixed time; a Smart Meeting keeps a safe window and can adapt.</p></section>}
      {editing ? (
        <section className="composer" aria-labelledby="meeting-composer-title">
          <div className="composer__heading"><div><p className="eyebrow">New Smart Meeting</p><h2 id="meeting-composer-title">Give the meeting room to move.</h2></div><button className="dialog__close" aria-label="Close" onClick={() => setEditing(false)}>×</button></div>
          {!preview ? <>
            <div className="form-grid form-grid--three">
              <label className="form-span">Meeting name<input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></label>
              <label>Place it on<select value={target} onChange={(event) => setTarget(event.target.value)}>{targets.map((calendar) => <option key={calendar.id} value={calendar.id}>{endpointName(calendar.id, connections)}</option>)}</select></label>
              <label>Required attendee<input type="email" placeholder="person@example.com" value={attendee} onChange={(event) => setAttendee(event.target.value)} /></label>
              <label>Preferred day<select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{[[1,"Monday"],[2,"Tuesday"],[3,"Wednesday"],[4,"Thursday"],[5,"Friday"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Meeting Hours start<input type="time" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} /></label>
              <label>Meeting Hours end<input type="time" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} /></label>
              <label>Ideal time<input type="time" value={preferred} onChange={(event) => setPreferred(event.target.value)} /></label>
              <label>Duration<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select></label>
              <label>When conflicts appear<select value={conflictPolicy} onChange={(event) => setConflictPolicy(event.target.value as SmartMeetingDraft["conflict_policy"])}><option value="suggest">Suggest a move</option><option value="auto_move">Move automatically</option><option value="keep_with_warning">Keep it and warn me</option></select></label>
              <label className="form-span">Timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
            </div>
            <fieldset className="calendar-checks"><legend>Calendars that count as your availability</legend>{availability.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={selectedAvailability.includes(calendar.id)} onChange={(event) => setSelectedAvailability((current) => event.target.checked ? [...current, calendar.id] : current.filter((id) => id !== calendar.id))} /><span><b>{endpointName(calendar.id, connections)}</b><small>Busy events block candidate times; titles stay private.</small></span></label>)}</fieldset>
            <p className="quiet-note">If the attendee does not have a connected availability calendar, Planipus can invite them but cannot promise the slot is free for them.</p>
            <button className="button button--primary" disabled={busy || !name.trim() || !target || selectedAvailability.length === 0 || windowStart >= windowEnd} onClick={() => void buildPreview()}>{busy ? "Finding mutual openings…" : "Preview six meetings"}</button>
          </> : <>
            <div className="preview-summary"><span><b>{preview.scheduledCount}</b><small>meetings placed</small></span><span><b>{preview.unmetCount}</b><small>without a safe slot</small></span><span><b>P2</b><small>high priority</small></span></div>
            {preview.warnings.includes("required_attendee_availability_unknown") ? <p className="warning-note">The attendee’s availability is not connected. These times are safe for your selected calendars, but Planipus could not check theirs.</p> : null}
            <ol className="slot-list">{preview.occurrences.map((occurrence) => <li key={occurrence.occurrenceKey}><span className={`slot-dot slot-dot--${occurrence.decision}`} /><div><b>{formatSlot(occurrence.startAt, occurrence.endAt)}</b><small>{reasonLabel(occurrence.reasonCode)}{occurrence.rejectedCandidateCount ? ` · ${occurrence.rejectedCandidateCount} conflicts passed over` : ""}</small></div></li>)}</ol>
            <div className="composer__actions"><button className="button button--quiet" onClick={() => setPreview(undefined)}>Back</button><button className="button button--primary" disabled={busy || preview.scheduledCount === 0} onClick={() => void activate()}>{busy ? "Creating the series…" : attendee.trim() ? `Create ${preview.scheduledCount} meetings and send invite` : `Create ${preview.scheduledCount} meetings`}</button></div>
          </>}
        </section>
      ) : null}
    </div>
  );
}
