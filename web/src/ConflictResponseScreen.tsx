import { useEffect, useMemo, useState } from "react";

import { api } from "./api.js";
import type {
  CalendarEndpoint,
  Capabilities,
  ConflictResponseDraft,
  ConflictResponsePreview,
  ConflictResponseRule,
  Connection
} from "./types.js";

type ActionRunner = (action: () => Promise<unknown>) => void;

const DEFAULT_DECLINE_MESSAGE = "I have a private conflict at that time. Please choose another time.";

function owningConnection(calendar: CalendarEndpoint, connections: Connection[]): Connection | undefined {
  return connections.find((connection) => connection.id === calendar.connectionId);
}

function endpointName(calendarId: string, connections: Connection[]): string {
  for (const connection of connections) {
    const calendar = connection.calendars.find((item) => item.id === calendarId);
    if (calendar) return `${connection.label} · ${connection.maskedEmail} · ${calendar.name}`;
  }
  return "Calendar";
}

function formatWhen(value?: string): string {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatPrivateTime(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(start);
  const startTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(start);
  const endTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(end);
  return `${date} · ${startTime}–${endTime}`;
}

function warningText(warning: string): string {
  const messages: Record<string, string> = {
    automatic_decline_budget_will_hold_excess: "Conflicts beyond the rolling limit of 20 declines per 24 hours on this work calendar will be held for review.",
    availability_role_may_retain_event_content: "A selected account is also authorized to read events for Bridges. This rule still queries only free/busy, but reconnect as “Private availability only” for the narrowest Google grant.",
    decline_message_delivery_unverified: "Google organizer visibility and notification delivery for the response comment are not yet verified.",
    invitation_writes_disabled: "Provider RSVP writes are off. You may inspect this preview, but activation is blocked.",
    paused_bridge_existing_copies_remain: "A paused Bridge may already have copies on the work calendar. This rule will create none, but it will not remove those older copies."
  };
  if (messages[warning]) return messages[warning];
  if (!warning.includes("_")) return warning;
  const text = warning.replaceAll("_", " ");
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}.`;
}

function ConflictRuleCard({
  rule,
  connections,
  runAction,
  onChanged
}: {
  rule: ConflictResponseRule;
  connections: Connection[];
  runAction: ActionRunner;
  onChanged: () => void;
}) {
  function action(work: () => Promise<unknown>) {
    runAction(async () => {
      await work();
      onChanged();
    });
  }

  return (
    <article className="conflict-rule-card">
      <header>
        <div>
          <p className="eyebrow">No-copy conflict reply</p>
          <h3>{rule.name}</h3>
          <p>{rule.responseCalendarName ?? endpointName(rule.responseCalendarId, connections)}</p>
        </div>
        <span className={`planning-state planning-state--${rule.status}`}>
          {rule.status === "active" ? "On" : "Paused"}
        </span>
      </header>
      <div className="conflict-route" aria-label="Availability calendars protect the response calendar without copies">
        <span><b>{rule.availabilityCalendarCount}</b><small>private availability {rule.availabilityCalendarCount === 1 ? "calendar" : "calendars"}</small></span>
        <span className="conflict-route__arrow" aria-hidden="true">⊘</span>
        <span><b>0</b><small>copies made by this rule</small></span>
      </div>
      <blockquote className="decline-message-preview">
        <small>Attendee response comment requested with a matching decline</small>
        “{rule.declineMessage}”
      </blockquote>
      <div className="conflict-rule-card__facts">
        <span><b>{rule.declinedCount}</b><small>declined</small></span>
        <span><b>{rule.pendingCount}</b><small>waiting to check</small></span>
        <span><b>{rule.heldCount}</b><small>held safely</small></span>
        <span><b>{rule.horizonDays}</b><small>days ahead</small></span>
      </div>
      {rule.safeErrorCode ? (
        <p className="warning-note">This rule needs attention: {rule.safeErrorCode.replaceAll("_", " ")}.</p>
      ) : null}
      {!rule.providerWritesEnabled ? (
        <p className="warning-note">Provider RSVP writes are off. This rule can be previewed and checked, but it will hold new declines safely.</p>
      ) : null}
      {rule.messageDelivery === "unverified_google" ? (
        <p className="quiet-note">Google RSVP state is the durable action. Organizer visibility and notification delivery for the comment are not yet verified.</p>
      ) : null}
      <footer>
        <div>
          <small>Last safe check</small>
          <b>{formatWhen(rule.lastSuccessAt ?? rule.lastEvaluatedAt)}</b>
        </div>
        <div className="conflict-rule-card__actions">
          <button
            className="button button--quiet"
            disabled={rule.status === "paused"}
            title={rule.status === "paused" ? "Resume the rule before checking it" : undefined}
            onClick={() => action(() => api.reconcileConflictResponse(rule.id))}
          >
            Check now
          </button>
          <button
            className="button button--secondary"
            disabled={rule.status === "paused" && !rule.providerWritesEnabled}
            onClick={() => action(() => rule.status === "active"
              ? api.pauseConflictResponse(rule.id)
              : api.resumeConflictResponse(rule.id))}
          >
            {rule.status === "active" ? "Pause" : "Resume"}
          </button>
          <button
            className="button button--danger-quiet"
            onClick={() => {
              if (!window.confirm(`Retire “${rule.name}”?\n\nPending and held declines will be cancelled. Existing RSVP changes and any separate bridge copies will remain.`)) return;
              action(() => api.retireConflictResponse(rule.id));
            }}
          >
            Retire
          </button>
        </div>
      </footer>
      <p className="conflict-rule-card__footnote">
        Pausing stops new automatic declines. Retiring cancels pending work; it never re-accepts an invitation already declined and never cleans copies made by separate bridges.
      </p>
    </article>
  );
}

export function ConflictResponseScreen({
  connections,
  capabilities,
  runAction
}: {
  connections: Connection[];
  capabilities: Capabilities;
  runAction: ActionRunner;
}) {
  const allCalendars = useMemo(
    () => connections.flatMap((connection) => connection.calendars),
    [connections]
  );
  const responseCandidates = useMemo(
    () => allCalendars.filter((calendar) => {
      const connection = owningConnection(calendar, connections);
      return Boolean(calendar.readable && calendar.writable && connection?.role === "both");
    }),
    [allCalendars, connections]
  );
  const availabilityCandidates = useMemo(
    () => allCalendars.filter((calendar) => {
      const connection = owningConnection(calendar, connections);
      return calendar.freeBusyReadable
        && connection !== undefined
        && connection.role !== "destination";
    }),
    [allCalendars, connections]
  );
  const defaultResponse = responseCandidates[0]?.id ?? "";
  const defaultAvailability = availabilityCandidates.find((calendar) => {
    const connection = owningConnection(calendar, connections);
    return calendar.id !== defaultResponse && connection?.role === "availability";
  }) ?? availabilityCandidates.find((calendar) => {
    const connection = owningConnection(calendar, connections);
    return calendar.id !== defaultResponse && connection?.role === "source";
  }) ?? availabilityCandidates.find((calendar) => calendar.id !== defaultResponse);

  const [rules, setRules] = useState<ConflictResponseRule[]>([]);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<ConflictResponsePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [name, setName] = useState("Personal conflicts");
  const [responseCalendarId, setResponseCalendarId] = useState(defaultResponse);
  const [availabilityCalendarIds, setAvailabilityCalendarIds] = useState<string[]>(
    defaultAvailability ? [defaultAvailability.id] : []
  );
  const [declineMessage, setDeclineMessage] = useState(DEFAULT_DECLINE_MESSAGE);
  const [horizonDays, setHorizonDays] = useState(60);

  function refresh() {
    void api.conflictResponseRules()
      .then((items) => {
        setRules(items);
        setError(undefined);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Private conflict rules are unavailable"));
  }

  useEffect(refresh, []);

  useEffect(() => {
    setAvailabilityCalendarIds((current) => current.filter((id) => id !== responseCalendarId));
  }, [responseCalendarId]);

  useEffect(() => {
    setPreview(undefined);
  }, [name, responseCalendarId, availabilityCalendarIds, declineMessage, horizonDays]);

  function draft(): ConflictResponseDraft {
    return {
      name: name.trim(),
      response_calendar_id: responseCalendarId,
      availability_calendar_ids: availabilityCalendarIds,
      decline_message: declineMessage.trim(),
      horizon_days: horizonDays
    };
  }

  async function buildPreview() {
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await api.previewConflictResponse(draft()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The private-conflict preview did not complete");
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.activateConflictResponse(preview.previewToken);
      setEditing(false);
      setPreview(undefined);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Private conflict replies did not turn on");
    } finally {
      setBusy(false);
    }
  }

  const selectableAvailability = availabilityCandidates.filter((calendar) => calendar.id !== responseCalendarId);
  const canPreview = name.trim().length > 0
    && responseCalendarId.length > 0
    && availabilityCalendarIds.length > 0
    && declineMessage.trim().length > 0
    && declineMessage.trim().length <= 500
    && horizonDays >= 1
    && horizonDays <= 90;

  return (
    <div className="content-stack">
      <section className="feature-hero feature-hero--private">
        <div>
          <p className="eyebrow">Private conflicts</p>
          <h1>Keep the details home. Decline the collision.</h1>
          <p>
            This rule never copies personal events to work. When a new, unanswered work invitation overlaps private busy time, Planipus can decline it and request your attendee response comment.
          </p>
        </div>
        <button
          className="button button--primary"
          disabled={responseCandidates.length === 0 || selectableAvailability.length === 0}
          onClick={() => {
            setEditing(true);
            setPreview(undefined);
          }}
        >
          Add private conflict rule
        </button>
      </section>

      <aside className="zero-copy-note">
        <span className="zero-copy-note__number">0</span>
        <div>
          <b>copies created by this rule</b>
          <p>It asks personal calendars only for busy intervals. Titles, locations, descriptions, attendees, and personal event identifiers are not read or copied. Separate Bridges are independent; paused or existing bridges may still have copies.</p>
        </div>
      </aside>

      <section className="privacy-contract" aria-labelledby="privacy-contract-title">
        <div>
          <p className="eyebrow">The guardrails</p>
          <h2 id="privacy-contract-title">A narrow automatic reply—not control of your inbox.</h2>
        </div>
        <ul>
          <li><b>Only unanswered invitations</b><span>Accepted, tentative, and already-declined meetings are left alone.</span></li>
          <li><b>Only real overlaps</b><span>The work invitation must overlap busy time on a calendar you selected.</span></li>
          <li><b>Never when you organize</b><span>Planipus will not decline a meeting that you own or created.</span></li>
          <li><b>No calendar blocks</b><span>This rule creates no work or personal calendar event. Existing Bridges remain separate.</span></li>
        </ul>
      </section>

      <aside className="provider-caveat">
        <b>{capabilities.conflictAutoDeclineProviderWrites ? "Experimental provider replies are enabled." : "Provider replies are safely switched off."}</b>
        <span>{capabilities.conflictDeclineMessageDelivery === "simulated"
          ? "This local fake-provider demo simulates the decline and response comment. No real invitation is changed."
          : capabilities.conflictAutoDeclineProviderWrites
            ? "Google decline writes are enabled, but organizer visibility and notification delivery for the response comment still require a live-account check."
            : "You can build and inspect previews, but activation is blocked until the operator explicitly enables experimental Google invitation declines after a live-account check."}</span>
      </aside>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {rules.length > 0 ? (
        <div className="conflict-rule-grid">
          {rules.map((rule) => (
            <ConflictRuleCard
              key={rule.id}
              rule={rule}
              connections={connections}
              runAction={runAction}
              onChanged={refresh}
            />
          ))}
        </div>
      ) : (
        <section className="inline-empty inline-empty--roomy">
          <p>No private-conflict rule is on. Work invitations will keep their provider’s normal RSVP behavior.</p>
        </section>
      )}

      {responseCandidates.length === 0 ? (
        <aside className="warning-note">
          Auto-decline needs a work connection authorized to read invitations and write RSVP responses. Reconnect that account as “Read and write events” before creating this rule.
        </aside>
      ) : null}

      {selectableAvailability.length === 0 ? (
        <aside className="warning-note">
          Connect at least one personal account as “Private availability only,” or use a readable source account. Planipus needs free/busy access, not personal event details.
        </aside>
      ) : null}

      {editing ? (
        <section className="composer conflict-composer" aria-labelledby="conflict-composer-title">
          <div className="composer__heading">
            <div>
              <p className="eyebrow">New private conflict rule</p>
              <h2 id="conflict-composer-title">Choose what protects your replies.</h2>
            </div>
            <button className="dialog__close" aria-label="Close" onClick={() => setEditing(false)}>×</button>
          </div>

          {!preview ? (
            <>
              <div className="form-grid form-grid--three">
                <label className="form-span">
                  Rule name
                  <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
                </label>
                <label>
                  Work calendar that receives invitations
                  <select value={responseCalendarId} onChange={(event) => setResponseCalendarId(event.target.value)}>
                    {responseCandidates.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>{endpointName(calendar.id, connections)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Look ahead
                  <select value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))}>
                    <option value={14}>2 weeks</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </label>
              </div>

              <fieldset className="calendar-checks">
                <legend>Personal calendars that count as private busy time</legend>
                {selectableAvailability.map((calendar) => (
                  <label key={calendar.id}>
                    <input
                      type="checkbox"
                      checked={availabilityCalendarIds.includes(calendar.id)}
                      onChange={(event) => setAvailabilityCalendarIds((current) => event.target.checked
                        ? [...current, calendar.id]
                        : current.filter((id) => id !== calendar.id))}
                    />
                    <span>
                      <b>{endpointName(calendar.id, connections)}</b>
                      <small>Only busy/free intervals protect this rule; event details remain on this account.</small>
                    </span>
                  </label>
                ))}
              </fieldset>

              <label className="message-field">
                Your decline message
                <textarea
                  rows={4}
                  maxLength={500}
                  value={declineMessage}
                  onChange={(event) => setDeclineMessage(event.target.value)}
                />
                <small>{declineMessage.length}/500 characters · Sent as an attendee response comment when the provider supports it.</small>
              </label>

              <div className="no-copy-confirmation">
                <span aria-hidden="true">✓</span>
                <div><b>This rule will copy no personal event.</b><small>It is independent from Bridges. Existing bridge copies, if any, remain until managed through Bridges.</small></div>
              </div>

              <button className="button button--primary" disabled={busy || !canPreview} onClick={() => void buildPreview()}>
                {busy ? "Checking private availability…" : "Preview automatic declines"}
              </button>
            </>
          ) : (
            <>
              <div className="preview-summary preview-summary--private">
                <span><b>0</b><small>copies from this rule</small></span>
                <span><b>{Math.max(0, preview.conflictCount - preview.heldCount)}</b><small>eligible overlapping invitations</small></span>
                <span><b>{availabilityCalendarIds.length}</b><small>private availability {availabilityCalendarIds.length === 1 ? "calendar" : "calendars"}</small></span>
              </div>

              <div className="preview-privacy-line">
                <b>What the preview knows</b>
                <span>Times and overlap results only. It checked {preview.invitationCount} unanswered work {preview.invitationCount === 1 ? "invitation" : "invitations"}, found {preview.conflictCount} private {preview.conflictCount === 1 ? "overlap" : "overlaps"}, and held {preview.heldCount} safely ({preview.budgetHeldCount} because of the rolling limit of 20 declines per 24 hours on this work calendar). Other holds indicate that Planipus could not prove a safe revision. It does not contain personal event titles or identities.</span>
              </div>

              {preview.examples.length > 0 ? (
                <ol className="slot-list private-time-list">
                  {preview.examples.map((example, index) => (
                    <li key={`${example.startAt}-${example.endAt}-${index}`}>
                      <span className="slot-dot" aria-hidden="true" />
                      <div><b>{formatPrivateTime(example.startAt, example.endAt)}</b><small>Unanswered work invitation · private overlap · final RSVP rechecked before action</small></div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="quiet-note">No eligible overlapping invitation is waiting right now. The rule will watch future invitations inside the {horizonDays}-day window.</p>
              )}

              <blockquote className="decline-message-preview decline-message-preview--large">
                <small>Attendee response comment requested with each matching decline</small>
                “{declineMessage.trim()}”
              </blockquote>

              {preview.warnings.map((warning) => (
                <p className="warning-note" key={warning}>{warningText(warning)}</p>
              ))}

              <p className="provider-caveat provider-caveat--inline">
                <b>{preview.providerWritesEnabled ? "Final provider check:" : "Activation unavailable:"}</b>
                <span>{preview.providerWritesEnabled
                  ? preview.messageDelivery === "simulated"
                    ? "This demo will simulate the RSVP and comment."
                    : "The declined RSVP is the intended durable action. Comment visibility and notification delivery remain unverified Google behavior."
                  : "This installation may preview safely, but its provider RSVP write gate is off."}</span>
              </p>

              <p className="quiet-note">Preview expires {formatWhen(preview.expiresAt)}. Activation rechecks availability and invitation state before any decline.</p>

              <div className="composer__actions">
                <button className="button button--quiet" disabled={busy} onClick={() => setPreview(undefined)}>Back</button>
                <button className="button button--primary" disabled={busy || !preview.providerWritesEnabled} onClick={() => void activate()}>
                  {busy ? "Turning on private replies…" : preview.providerWritesEnabled ? "Turn on private conflict replies" : "Provider replies are off"}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
