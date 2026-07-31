import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "./api.js";
import { ConflictResponseScreen } from "./ConflictResponseScreen.js";
import { ProtectionScreen, SmartMeetingsScreen } from "./PlanningScreens.js";
import { SettingsScreen } from "./SettingsScreen.js";
import type {
  Bridge,
  CalendarEndpoint,
  Capabilities,
  Connection,
  Overview,
  Preview,
  PreviewRequest,
  Session,
  StatusTone,
  SyncNotice
} from "./types.js";

type Screen = "overview" | "notifications" | "calendars" | "bridges" | "private" | "protect" | "meetings" | "settings";
type ActionRunner = (action: () => Promise<unknown>) => void;
type MascotMode = "idle" | "attention" | "syncing";

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  screen?: Screen;
  actionLabel?: string;
  retryOverview?: boolean;
}

const statusText: Record<StatusTone, string> = {
  current: "All bridges current",
  syncing: "Syncing",
  delayed: "Delayed",
  paused: "Paused",
  attention: "Action needed"
};

function formatWhen(value?: string): string {
  if (!value) return "No successful sync yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function copyCountLabel(count: number): string {
  return `${count} ${count === 1 ? "copy" : "copies"}`;
}

function attentionItems(data: Overview, error?: string): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (error) {
    items.push({
      id: "app-error",
      title: "Planipus could not refresh",
      detail: error,
      actionLabel: "Try again",
      retryOverview: true
    });
  }

  data.connections
    .filter((connection) => connection.status !== "connected")
    .forEach((connection) => {
      items.push({
        id: `connection-${connection.id}`,
        title: `${connection.label} needs to reconnect`,
        detail: connection.status === "revoked"
          ? `${connection.maskedEmail} no longer grants Planipus calendar access. Reconnect it before bridges can continue.`
          : `${connection.maskedEmail} needs a quick account check before Planipus can keep it current.`,
        screen: "calendars",
        actionLabel: "View calendars"
      });
    });

  data.bridges
    .filter((bridge) => bridge.status === "attention" || bridge.status === "delayed")
    .forEach((bridge) => {
      items.push({
        id: `bridge-${bridge.id}`,
        title: bridge.status === "attention" ? "A bridge needs a safe retry" : "A bridge is taking longer than usual",
        detail: `${bridge.sourceLabel} · ${bridge.sourceCalendar} → ${bridge.destinationLabel} · ${bridge.destinationCalendar}`,
        screen: "bridges",
        actionLabel: "View bridge"
      });
    });

  if (data.status === "delayed" && !items.some((item) => item.id.startsWith("bridge-"))) {
    items.push({
      id: "installation-delayed",
      title: "Calendar updates are delayed",
      detail: "Planipus has not confirmed a current sync yet. Open the overview to retry safely.",
      screen: "overview",
      actionLabel: "Open overview"
    });
  } else if (data.status === "attention" && items.length === (error ? 1 : 0)) {
    items.push({
      id: "installation-attention",
      title: "Planipus needs a quick check",
      detail: "The installation reported an issue, but no calendar details were exposed here. Open the overview for the latest safe status.",
      screen: "overview",
      actionLabel: "Open overview"
    });
  }

  return items;
}

function StatusPill({ tone, compact = false }: { tone: StatusTone; compact?: boolean }) {
  return (
    <span className={`status status--${tone}`} role="status">
      <span className="status__dot" aria-hidden="true" />
      {compact ? statusText[tone].replace("All bridges ", "") : statusText[tone]}
    </span>
  );
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onLogin(await api.login(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in did not complete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="welcome-title">
        <div className="brand brand--large" aria-label="Planipus">
          <span className="pip-mark" aria-hidden="true">P</span>
          <span>Planipus</span>
        </div>
        <p className="eyebrow">Your calendar boundary, kept tidy</p>
        <h1 id="welcome-title">Keep work availability honest without sharing the details of your life.</h1>
        <p className="lede">
          Source events stay where you made them. Planipus maintains privacy-controlled copies on the calendars you choose.
        </p>
        <form onSubmit={submit} className="login-form">
          <label htmlFor="bootstrap-token">Installation access token</label>
          <input
            id="bootstrap-token"
            name="bootstrap-token"
            type="password"
            autoComplete="current-password"
            value={token}
            minLength={32}
            required
            onChange={(event) => setToken(event.target.value)}
          />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button--primary" disabled={busy || token.length < 32}>
            {busy ? "Opening Planipus…" : "Open Planipus"}
          </button>
        </form>
        <p className="quiet-note">This token belongs to this self-hosted installation. Calendar credentials are encrypted separately.</p>
      </section>
      <aside className="login-aside" aria-label="How Planipus works">
        <div className="orbit-diagram" aria-hidden="true">
          <span className="orbit orbit--source">Personal</span>
          <span className="orbit-line" />
          <span className="orbit orbit--pip">Pip</span>
          <span className="orbit-line" />
          <span className="orbit orbit--destination">Work</span>
        </div>
        <ul className="plain-list">
          <li>Copies only during the hours you choose</li>
          <li>Busy, type-only, private, or selected details</li>
          <li>Or keep zero copies and decline private conflicts</li>
          <li>After-hours boundaries and flexible Smart Meetings</li>
        </ul>
      </aside>
    </main>
  );
}

function Navigation({
  current,
  onChange,
  capabilities,
  notificationCount = 0
}: {
  current: Screen;
  onChange: (screen: Screen) => void;
  capabilities: Capabilities | undefined;
  notificationCount?: number;
}) {
  const items = ([
    { id: "overview", label: "Overview", glyph: "◌" },
    { id: "notifications", label: "Attention", glyph: "!" },
    { id: "calendars", label: "Calendars", glyph: "▦" },
    { id: "bridges", label: "Bridges", glyph: "⇢" },
    { id: "private", label: "Private", glyph: "⊘" },
    { id: "protect", label: "Protect", glyph: "◒" },
    { id: "meetings", label: "Meet", glyph: "◎" },
    { id: "settings", label: "Settings", glyph: "⌁" }
  ] satisfies Array<{ id: Screen; label: string; glyph: string }>).filter((item) => item.id !== "notifications" || notificationCount > 0 || current === "notifications")
    .filter((item) => item.id !== "private" || capabilities?.conflictAutoDecline === "alpha")
    .filter((item) => item.id !== "protect" || capabilities?.availabilityProtection === "alpha")
    .filter((item) => item.id !== "meetings" || capabilities?.smartMeetings === "alpha");
  return (
    <nav className="navigation" aria-label="Planipus">
      {items.map((item) => (
        <button
          key={item.id}
          className={current === item.id ? "navigation__item is-current" : "navigation__item"}
          aria-current={current === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          <span aria-hidden="true">{item.glyph}</span>
          {item.label}
          {item.id === "notifications" && notificationCount > 0
            ? <span className="navigation__badge" aria-label={`${notificationCount} items`}>{notificationCount}</span>
            : null}
        </button>
      ))}
    </nav>
  );
}

function PipMascot({
  mode,
  notificationCount,
  compact = false,
  onOpenNotifications
}: {
  mode: MascotMode;
  notificationCount: number;
  compact?: boolean;
  onOpenNotifications: () => void;
}) {
  const content = mode === "syncing"
    ? {
        image: "/mascot/pip-syncing.png",
        title: "Comparing calendars",
        detail: "Pip is checking all three schedules."
      }
    : mode === "attention"
      ? {
          image: "/mascot/pip-attention.png",
          title: `${notificationCount} ${notificationCount === 1 ? "item needs" : "items need"} attention`,
          detail: "Pip has the details."
        }
      : {
          image: "/mascot/pip-idle.png",
          title: "Everything looks tidy",
          detail: "Pip is happy and content."
        };

  const body = (
    <>
      <img key={mode} className="pip-mascot__image" src={content.image} alt="" />
      {!compact ? (
        <span className="pip-mascot__copy" aria-live="polite">
          <b>{content.title}</b>
          <small>{content.detail}</small>
        </span>
      ) : null}
    </>
  );

  if (mode === "attention") {
    return (
      <button
        className={compact ? "pip-mascot pip-mascot--compact pip-mascot--attention" : "pip-mascot pip-mascot--attention"}
        aria-label={`${content.title}. Open notification details.`}
        onClick={onOpenNotifications}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      className={compact ? `pip-mascot pip-mascot--compact pip-mascot--${mode}` : `pip-mascot pip-mascot--${mode}`}
      role="status"
      aria-label={`${content.title}. ${content.detail}`}
    >
      {body}
    </div>
  );
}

function ConnectionCard({ connection }: { connection: Connection }) {
  const roleLabel = connection.role === "availability"
    ? "Private availability only"
    : connection.role === "source"
      ? "Read events"
      : connection.role === "destination"
        ? "Write copies"
        : "Read and write events";
  return (
    <article className="connection-card">
      <div className="connection-mark" aria-hidden="true">{connection.label.slice(0, 1).toUpperCase()}</div>
      <div>
        <h3>{connection.label}</h3>
        <p>{connection.maskedEmail}</p>
        <p className="subtle">{connection.calendars.length} calendars · {roleLabel} · {connection.status === "connected" ? "Google access current" : "Google access needs attention"}</p>
      </div>
      <span className={`connection-state connection-state--${connection.status}`}>
        {connection.status === "connected" ? "Connected" : "Attention"}
      </span>
    </article>
  );
}

function BridgeCard({
  bridge,
  onPause,
  onRecover
}: {
  bridge: Bridge;
  onPause: (bridge: Bridge) => void;
  onRecover: (bridge: Bridge) => void;
}) {
  return (
    <article className="bridge-card">
      <div className="bridge-card__route">
        <span><b>{bridge.sourceLabel}</b><small>{bridge.sourceCalendar}</small></span>
        <span className="route-line" aria-label="copies to">→</span>
        <span><b>{bridge.destinationLabel}</b><small>{bridge.destinationCalendar}</small></span>
      </div>
      <div className="bridge-card__meta">
        <span>{bridge.hoursLabel}</span>
        <span>{bridge.privacyLabel}</span>
        <span>{bridge.managedCopyCount} managed copies</span>
      </div>
      <div className="bridge-card__footer">
        <div>
          <StatusPill tone={bridge.status} compact />
          <small>
            {bridge.lastSuccessAt
              ? `Current as of ${formatWhen(bridge.lastSuccessAt)}`
              : "Waiting for the first successful sync"}
          </small>
        </div>
        <div className="bridge-card__actions">
          {bridge.status === "attention" ? (
            <button className="button button--secondary" onClick={() => onRecover(bridge)}>
              Retry safely
            </button>
          ) : null}
          <button className="button button--quiet" onClick={() => onPause(bridge)}>
            {bridge.status === "paused" ? "Resume" : "Pause"}
          </button>
        </div>
      </div>
    </article>
  );
}

const noticeHeadline: Record<SyncNotice["kind"], string> = {
  copy_edit_reverted: "A mirrored copy was edited directly — Planipus put it back",
  copy_delete_restored: "A mirrored copy was deleted directly — Planipus restored it",
  copy_edit_held: "A mirrored copy was edited directly — waiting for your decision",
  copy_delete_held: "A mirrored copy was deleted directly — waiting for your decision"
};

function noticeExplanation(notice: SyncNotice): string {
  switch (notice.kind) {
    case "copy_edit_reverted":
      return "The change happened on the copy, so the original event never moved and no attendee was told. Planipus restored the copy. To really reschedule, edit the original event on its own calendar.";
    case "copy_delete_restored":
      return "Only the copy was deleted; the original event still exists. Planipus recreated the copy so the time stays blocked. To remove it for good, exclude or delete the original event.";
    case "copy_edit_held":
      return "Planipus has not changed anything on either calendar. The original event is unchanged and no attendee was notified. Choose whether to restore the copy or keep your change.";
    case "copy_delete_held":
      return "Planipus has not recreated the copy. The original event still exists and blocks no time on this calendar until you decide.";
  }
}

function noticeWhen(notice: SyncNotice): string | undefined {
  if (!notice.copyStartAt) return undefined;
  if (notice.copyAllDay) return `All day, ${notice.copyStartAt}`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(notice.copyStartAt));
}

function NoticeCard({ notice, runAction }: { notice: SyncNotice; runAction: ActionRunner }) {
  const held = notice.requiresDecision;
  return (
    <article className={held ? "notice-card notice-card--held" : "notice-card"}>
      <div className="notice-card__body">
        <b>{noticeHeadline[notice.kind]}</b>
        <p className="subtle">
          {[notice.copySummary, noticeWhen(notice), notice.destinationCalendar, notice.policyName]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p>{noticeExplanation(notice)}</p>
      </div>
      <div className="notice-card__actions">
        {held ? (
          <>
            <button
              className="button button--primary"
              onClick={() => runAction(() => api.resolveNotice(notice.id, "restore"))}
            >
              Restore the copy
            </button>
            <button
              className="button button--secondary"
              onClick={() => runAction(() => api.resolveNotice(notice.id, "keep_and_detach"))}
            >
              Keep my change, stop managing it
            </button>
          </>
        ) : (
          <button
            className="button button--quiet"
            onClick={() => runAction(() => api.acknowledgeNotice(notice.id))}
          >
            Got it
          </button>
        )}
      </div>
    </article>
  );
}

function NoticesSection({ notices, runAction }: { notices: SyncNotice[]; runAction: ActionRunner }) {
  // Held notices stay until decided; informational ones disappear once read.
  const visible = notices.filter((notice) => notice.requiresDecision || notice.status === "unread");
  if (visible.length === 0) return null;
  return (
    <section aria-label="Sync notices">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Direct changes to managed copies</p>
          <h2>Needs a look</h2>
        </div>
      </div>
      <div className="notice-stack">
        {visible.map((notice) => <NoticeCard key={notice.id} notice={notice} runAction={runAction} />)}
      </div>
    </section>
  );
}

function EmptyOverview({ onConnect }: { onConnect: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-state__pond" aria-hidden="true"><span>P</span></div>
      <p className="eyebrow">A clean start</p>
      <h2>Connect the first calendar you live in.</h2>
      <p>Connecting only reads account identity and calendars. Planipus creates nothing until you preview and turn on a bridge.</p>
      <button className="button button--primary" onClick={onConnect}>Connect first Google account</button>
      <details>
        <summary>What access will Planipus ask for?</summary>
        <p>Source accounts need calendar read access. Destinations need calendar-list and event-write access. Identity scopes keep accounts distinct.</p>
      </details>
    </section>
  );
}

function ConnectPanel({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [label, setLabel] = useState("Personal");
  const [role, setRole] = useState<Connection["role"]>("availability");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLInputElement>("#account-label")?.focus();
    });
    return () => previousFocus?.focus();
  }, []);

  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      await api.beginGoogle(label.trim(), role);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Google authorization did not start");
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]"
          ));
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <button className="dialog__close" aria-label="Close" onClick={onClose}>×</button>
        <p className="eyebrow">Google account</p>
        <h2 id="connect-title">Name this calendar boundary</h2>
        <p>Use a familiar label. Planipus always shows it beside the Google identity so matching calendar names stay clear.</p>
        <label htmlFor="account-label">Label</label>
        <input id="account-label" value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} />
        <fieldset className="role-picker">
          <legend>How will this account be used?</legend>
          {([
            { value: "availability", title: "Private availability only", detail: "Free/busy access only—no event details and no calendar writes" },
            { value: "source", title: "Read events from it", detail: "Calendar event read access for bridges" },
            { value: "destination", title: "Write copies to it", detail: "Calendar list and event write access" },
            { value: "both", title: "Read and write events", detail: "Needed for a work calendar that receives invitations and sends RSVP responses" }
          ] as const).map((option) => (
            <label key={option.value}>
              <input type="radio" name="role" value={option.value} checked={role === option.value} onChange={() => setRole(option.value)} />
              <span><b>{option.title}</b><small>{option.detail}</small></span>
            </label>
          ))}
        </fieldset>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button
          className="button button--primary"
          disabled={busy || label.trim().length === 0}
          onClick={() => void connect()}
        >
          {busy ? "Opening Google…" : "Continue to Google"}
        </button>
      </section>
    </div>
  );
}

function OverviewScreen({
  data,
  notices,
  onConnect,
  onCreate,
  onSync,
  syncPresentationActive,
  runAction
}: {
  data: Overview;
  notices: SyncNotice[];
  onConnect: () => void;
  onCreate: () => void;
  onSync: () => void;
  syncPresentationActive: boolean;
  runAction: ActionRunner;
}) {
  const canCreateBridge = data.connections.some(
    (connection) => connection.role !== "destination" && connection.calendars.some((calendar) => calendar.readable)
  ) && data.connections.some(
    (connection) => connection.role !== "source" && connection.calendars.some((calendar) => calendar.writable)
  );
  if (data.connections.length === 0) return <EmptyOverview onConnect={onConnect} />;
  return (
    <div className="content-stack">
      <section className="hero-status">
        <div>
          <p className="eyebrow">Installation health</p>
          <h2>{statusText[data.status]}</h2>
          <p>{formatWhen(data.lastSuccessAt)} · {data.pendingEffectCount} pending effects</p>
        </div>
        <button className="button button--secondary" disabled={syncPresentationActive} onClick={onSync}>
          {syncPresentationActive ? "Comparing calendars…" : "Sync now"}
        </button>
      </section>
      <NoticesSection notices={notices} runAction={runAction} />
      <section>
        <div className="section-heading"><div><p className="eyebrow">Calendar boundaries</p><h2>Connected accounts</h2></div><button className="button button--quiet" onClick={onConnect}>Connect another</button></div>
        <div className="connection-grid">{data.connections.map((connection) => <ConnectionCard key={connection.id} connection={connection} />)}</div>
      </section>
      <section>
        <div className="section-heading"><div><p className="eyebrow">Automatic copies</p><h2>Active bridges</h2></div><button className="button button--primary" disabled={!canCreateBridge} onClick={onCreate}>Create a bridge</button></div>
        {data.bridges.length ? <div className="bridge-grid">{data.bridges.map((bridge) => <BridgeCard key={bridge.id} bridge={bridge} onPause={(item) => runAction(() => item.status === "paused" ? api.resume(item.id) : api.pause(item.id))} onRecover={(item) => runAction(() => api.recover(item.id))} />)}</div> : <div className="inline-empty"><p>No bridges yet. Nothing has been copied.</p><button className="text-button" disabled={!canCreateBridge} onClick={onCreate}>Choose a direction and preview it →</button></div>}
      </section>
      <section>
        <div className="section-heading"><div><p className="eyebrow">Privacy-safe record</p><h2>Recent activity</h2></div></div>
        <ol className="activity-list">{data.recentActivity.length ? data.recentActivity.map((item) => <li key={item.id}><span className="activity-mark" aria-hidden="true" /><div><b>{item.message}</b><small>{item.reason} · {formatWhen(item.occurredAt)}</small></div></li>) : <li className="subtle">Activity will appear after a bridge evaluates events.</li>}</ol>
      </section>
    </div>
  );
}

function endpointLabel(endpoint: CalendarEndpoint, connections: Connection[]): string {
  const connection = connections.find((item) => item.id === endpoint.connectionId);
  return `${connection?.label ?? "Account"} · ${connection?.maskedEmail ?? ""} · ${endpoint.name}`;
}

function endpointHasRole(
  endpoint: CalendarEndpoint,
  connections: Connection[],
  role: "source" | "destination"
): boolean {
  const connection = connections.find((item) => item.id === endpoint.connectionId);
  return connection?.role === role || connection?.role === "both";
}

function BridgeWizard({ connections, onClose, onActivated }: { connections: Connection[]; onClose: () => void; onActivated: () => void }) {
  const endpoints = useMemo(() => connections.flatMap((connection) => connection.calendars), [connections]);
  const sourceCandidates = endpoints.filter((item) => item.readable && endpointHasRole(item, connections, "source"));
  const destinationCandidates = endpoints.filter((item) => item.writable && endpointHasRole(item, connections, "destination"));
  const [step, setStep] = useState(1);
  const [sourceCalendarId, setSource] = useState(sourceCandidates[0]?.id ?? "");
  const [destinationCalendarId, setDestination] = useState(
    destinationCandidates.find((item) => item.id !== sourceCandidates[0]?.id)?.id ?? ""
  );
  const [hoursMode, setHoursMode] = useState<PreviewRequest["hoursMode"]>("overlaps_profile");
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [weekdayStart, setWeekdayStart] = useState("09:00");
  const [weekdayEnd, setWeekdayEnd] = useState("17:00");
  const [privacyPreset, setPrivacy] = useState<PreviewRequest["privacyPreset"]>("busy_only");
  const [genericLabel, setGenericLabel] = useState("Personal commitment");
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const source = endpoints.find((item) => item.id === sourceCalendarId);
  const destination = endpoints.find((item) => item.id === destinationCalendarId);
  const privacyOptions: Array<{ id: PreviewRequest["privacyPreset"]; title: string; sample: string; description: string }> = [
    { id: "busy_only", title: "No details", sample: "Busy", description: "Only time and busy state. Safest default." },
    { id: "commitment", title: "Type only", sample: genericLabel, description: "A generic category, never the original title." },
    { id: "private_details", title: "Details private", sample: "Busy", description: "The owner sees selected details; ordinary viewers see only busy time." },
    { id: "shared_details", title: "Share selected details", sample: "Dentist appointment", description: "Destination access may reveal copied fields." }
  ];
  const previewCounts = preview ? [
    {
      label: "Add copies",
      count: preview.creates,
      help: "New Planipus blocks on the destination calendar."
    },
    {
      label: "Refresh copies",
      count: preview.updates,
      help: "Existing Planipus blocks whose time or privacy output changed."
    },
    {
      label: "Remove Planipus copies",
      count: preview.deletes,
      help: "Only copies Planipus previously created, never source events."
    },
    {
      label: "Already correct",
      count: preview.unchanged,
      help: "Managed copies that already match these rules."
    },
    {
      label: "Left out",
      count: preview.excluded,
      help: "Source events seen but not copied because of bridge rules."
    }
  ] : [];

  async function createPreview() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.preview({ sourceCalendarId, destinationCalendarId, hoursMode, timeZone, privacyPreset, genericLabel, weekdayStart, weekdayEnd });
      setPreview(result);
      setStep(4);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Preview did not complete");
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    if (!preview) return;
    setBusy(true);
    try {
      await api.activate(preview.id);
      onActivated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bridge did not activate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wizard-shell">
      <header className="wizard-header"><button className="text-button" onClick={onClose}>← Back to overview</button><span>New bridge · Step {step} of 4</span></header>
      <div className="step-track" aria-label={`Step ${step} of 4`}>{[1,2,3,4].map((value) => <span key={value} className={value <= step ? "is-active" : ""} />)}</div>
      <main className="wizard-card">
        {step === 1 ? <>
          <p className="eyebrow">Step 1 · Direction</p><h1>Where should availability travel?</h1><p>The source stays authoritative. Planipus maintains a separate copy on the destination.</p>
          <div className="direction-picker">
            <label>From<select value={sourceCalendarId} onChange={(event) => {
              const nextSource = event.target.value;
              setSource(nextSource);
              if (destinationCalendarId === nextSource) {
                setDestination(destinationCandidates.find((item) => item.id !== nextSource)?.id ?? "");
              }
            }}>{sourceCandidates.map((item) => <option key={item.id} value={item.id}>{endpointLabel(item, connections)}</option>)}</select></label>
            <span className="direction-arrow" aria-label="copies to">→</span>
            <label>To<select value={destinationCalendarId} onChange={(event) => setDestination(event.target.value)}>{destinationCandidates.filter((item) => item.id !== sourceCalendarId).map((item) => <option key={item.id} value={item.id}>{endpointLabel(item, connections)}</option>)}</select></label>
          </div>
          <div className="explanation-strip"><b>{source?.name ?? "Source"} remains untouched.</b><span>Copies appear on {destination?.name ?? "destination"} only after preview and activation.</span></div>
        </> : null}
        {step === 2 ? <>
          <p className="eyebrow">Step 2 · When</p><h1>Which hours should the bridge cover?</h1><p>Partial overlap copies the complete event so the unavailable time stays accurate.</p>
          <div className="choice-stack">
            {([ ["overlaps_profile", "Events that overlap work hours"], ["all_times", "All qualifying events"], ["contained_in_profile", "Only events fully inside work hours"] ] as const).map(([value,label]) => <label className="radio-card" key={value}><input type="radio" checked={hoursMode === value} onChange={() => setHoursMode(value)} /><span><b>{label}</b><small>{value === "overlaps_profile" ? "Recommended for personal → work" : value === "all_times" ? "Ignores the weekly schedule" : "Advanced strict containment"}</small></span></label>)}
          </div>
          <div className="hours-row"><label>Weekday start<input type="time" value={weekdayStart} onChange={(event) => setWeekdayStart(event.target.value)} /></label><label>Weekday end<input type="time" value={weekdayEnd} onChange={(event) => setWeekdayEnd(event.target.value)} /></label><label>Timezone<input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} /></label></div>
          <p className="quiet-note">Safe defaults: skip all-day and redacted free events, omit declined events, skip when the destination is invited, and honor #nosync.</p>
        </> : null}
        {step === 3 ? <>
          <p className="eyebrow">Step 3 · Privacy</p><h1>What may the destination reveal?</h1><p>Every copy has no attendees, organizer, source reminders, attachments, or provider metadata.</p>
          <div className="privacy-grid">{privacyOptions.map((option) => <label className={privacyPreset === option.id ? "privacy-card is-selected" : "privacy-card"} key={option.id}><input type="radio" checked={privacyPreset === option.id} onChange={() => setPrivacy(option.id)} /><span className="privacy-card__check" aria-hidden="true">✓</span><b>{option.title}</b><small>{option.description}</small><span className="coworker-view"><em>Coworker view</em><strong>{option.sample}</strong><small>Unavailable</small></span></label>)}</div>
          {privacyPreset === "commitment" ? <label className="field-row">Generic destination label<input value={genericLabel} onChange={(event) => setGenericLabel(event.target.value)} /></label> : null}
          {privacyPreset === "private_details" ? <p className="warning-note">Google Workspace administrators and calendar editors may still see private event details.</p> : null}
          {privacyPreset === "shared_details" ? <p className="warning-note">Destination access rules can reveal copied title, description, or location. Review the disclosure table in the preview.</p> : null}
        </> : null}
        {step === 4 && preview ? <>
          <p className="eyebrow">Step 4 · Preview</p><h1>Review before anything is written.</h1><p>This preview expires {formatWhen(preview.expiresAt)}. Refresh it if source data or rules change.</p>
          <div className="preview-counts">
            {previewCounts.map((item) => (
              <span key={item.label}>
                <b>{item.count}</b>
                <strong>{item.label}</strong>
                <small>{item.help}</small>
              </span>
            ))}
          </div>
          <div className="preview-columns"><section><h2>Destination owner view</h2><div className="event-preview"><span className="event-preview__bar" /><div><b>{preview.sample.summary}</b><small>{weekdayStart}–{weekdayEnd} · {timeZone}</small><small>{preview.sample.visibility} · {preview.sample.transparency} · no reminders</small></div></div></section><section><h2>Fields written</h2><ul className="disclosure-list">{preview.sample.disclosedFields.map((field) => <li key={field}>{field}</li>)}</ul></section></div>
          {preview.excludedByReason.length ? <details><summary>{preview.excluded} events stay out</summary><ul>{preview.excludedByReason.map((item) => <li key={item.reason}>{item.reason}: {item.count}</li>)}</ul></details> : null}
        </> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <footer className="wizard-actions"><button className="button button--quiet" disabled={step === 1 || busy} onClick={() => setStep((value) => Math.max(1, value - 1))}>Back</button>{step < 3 ? <button className="button button--primary" disabled={!sourceCalendarId || !destinationCalendarId || sourceCalendarId === destinationCalendarId} onClick={() => setStep((value) => value + 1)}>Continue</button> : null}{step === 3 ? <button className="button button--primary" disabled={busy} onClick={() => void createPreview()}>{busy ? "Building preview…" : "Preview this bridge"}</button> : null}{step === 4 ? <button className="button button--primary" disabled={busy || !preview} onClick={() => void activate()}>{busy ? "Turning on bridge…" : `Turn on bridge and add ${copyCountLabel(preview?.creates ?? 0)}`}</button> : null}</footer>
      </main>
    </div>
  );
}

function NotificationScreen({
  items,
  onNavigate,
  onRefresh
}: {
  items: AttentionItem[];
  onNavigate: (screen: Screen) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="content-stack">
      <section className="notification-hero">
        <div>
          <p className="eyebrow">Pip noticed something</p>
          <h1>{items.length ? "A few things need your attention." : "Everything is tidy again."}</h1>
          <p>
            {items.length
              ? "These details stay intentionally brief—enough to recover safely, without exposing private calendar content."
              : "There are no current calendar or connection notifications."}
          </p>
        </div>
        <img
          src={items.length ? "/mascot/pip-attention.png" : "/mascot/pip-idle.png"}
          alt=""
          aria-hidden="true"
        />
      </section>
      {items.length ? (
        <section className="notification-list" aria-label="Notification details">
          {items.map((item) => (
            <article className="notification-card" key={item.id}>
              <span className="notification-card__mark" aria-hidden="true">!</span>
              <div>
                <h2>{item.title}</h2>
                <p>{item.detail}</p>
              </div>
              {item.retryOverview ? (
                <button className="button button--quiet" onClick={onRefresh}>{item.actionLabel}</button>
              ) : item.screen ? (
                <button className="button button--quiet" onClick={() => onNavigate(item.screen!)}>{item.actionLabel}</button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function SecondaryScreen({
  screen,
  data,
  notifications,
  onNavigate,
  onRefresh,
  onConnect,
  onCreate,
  runAction,
  capabilities
}: {
  screen: Exclude<Screen, "overview">;
  data: Overview;
  notifications: AttentionItem[];
  onNavigate: (screen: Screen) => void;
  onRefresh: () => void;
  onConnect: () => void;
  onCreate: () => void;
  runAction: ActionRunner;
  capabilities: Capabilities | undefined;
}) {
  if (screen === "notifications") return <NotificationScreen items={notifications} onNavigate={onNavigate} onRefresh={onRefresh} />;
  if (screen === "calendars") return <div className="content-stack"><div className="section-heading"><div><p className="eyebrow">Provider identities</p><h1>Calendars</h1><p>Every calendar stays attached to the account that authorized it.</p></div><button className="button button--primary" onClick={onConnect}>Connect Google account</button></div><div className="connection-grid">{data.connections.map((item) => <ConnectionCard key={item.id} connection={item} />)}</div></div>;
  if (screen === "bridges") {
    return <div className="content-stack"><div className="section-heading"><div><p className="eyebrow">Directed policies</p><h1>Bridges</h1><p>Each direction has independent hours, privacy, health, and recovery.</p></div><button className="button button--primary" onClick={onCreate}>Create a bridge</button></div><div className="bridge-grid">{data.bridges.map((item) => <BridgeCard key={item.id} bridge={item} onPause={(bridge) => runAction(() => bridge.status === "paused" ? api.resume(bridge.id) : api.pause(bridge.id))} onRecover={(bridge) => runAction(() => api.recover(bridge.id))} />)}</div></div>;
  }
  if (screen === "protect" && capabilities?.availabilityProtection === "alpha") return <ProtectionScreen connections={data.connections} runAction={runAction} />;
  if (screen === "meetings" && capabilities?.smartMeetings === "alpha") return <SmartMeetingsScreen connections={data.connections} runAction={runAction} />;
  if (screen === "private" && capabilities?.conflictAutoDecline === "alpha") return <ConflictResponseScreen connections={data.connections} capabilities={capabilities} runAction={runAction} />;
  return <SettingsScreen />;
}

export function App() {
  const [session, setSession] = useState<Session>();
  const [loadingSession, setLoadingSession] = useState(true);
  const [screen, setScreen] = useState<Screen>("overview");
  const [overview, setOverview] = useState<Overview>();
  const [notices, setNotices] = useState<SyncNotice[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [error, setError] = useState<string>();
  const [connectOpen, setConnectOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mascotSyncing, setMascotSyncing] = useState(false);
  const mascotSyncStartedAt = useRef<number | undefined>(undefined);
  const mascotSyncTimeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  useEffect(() => {
    void api.session().then(setSession).catch((cause) => {
      if (!(cause instanceof ApiError) || cause.status !== 401) setError(cause instanceof Error ? cause.message : "Planipus is unavailable");
      setSession({ authenticated: false });
    }).finally(() => setLoadingSession(false));
  }, []);

  async function refresh(): Promise<void> {
    if (!session?.authenticated) return;
    try {
      // notices() swallows its own failure so a notices outage cannot blank
      // the overview; overview() and capabilities() still surface theirs.
      const [value, available, openNotices] = await Promise.all([
        api.overview(),
        api.capabilities(),
        api.notices().catch(() => [])
      ]);
      setOverview(value);
      setCapabilities(available);
      setNotices(openNotices);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Overview is unavailable");
    }
  }

  function runAction(action: () => Promise<unknown>) {
    void action()
      .then(refresh)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "The requested action did not complete"));
  }

  function beginMascotSync() {
    if (mascotSyncTimeout.current !== undefined) {
      window.clearTimeout(mascotSyncTimeout.current);
      mascotSyncTimeout.current = undefined;
    }
    if (mascotSyncStartedAt.current === undefined) mascotSyncStartedAt.current = performance.now();
    setMascotSyncing(true);
  }

  function finishMascotSync() {
    const startedAt = mascotSyncStartedAt.current;
    if (startedAt === undefined) return;
    const remaining = Math.max(0, 3_000 - (performance.now() - startedAt));
    if (mascotSyncTimeout.current !== undefined) window.clearTimeout(mascotSyncTimeout.current);
    mascotSyncTimeout.current = window.setTimeout(() => {
      mascotSyncStartedAt.current = undefined;
      mascotSyncTimeout.current = undefined;
      setMascotSyncing(false);
    }, remaining);
  }

  function runSync() {
    beginMascotSync();
    void api.syncNow()
      .then(refresh)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Calendar sync did not start"))
      .finally(finishMascotSync);
  }

  useEffect(() => {
    void refresh();
  }, [session?.authenticated]);

  useEffect(() => {
    if (overview?.status === "syncing") beginMascotSync();
    else finishMascotSync();
  }, [overview?.status]);

  useEffect(() => () => {
    if (mascotSyncTimeout.current !== undefined) window.clearTimeout(mascotSyncTimeout.current);
  }, []);

  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail === "protect" && capabilities?.availabilityProtection === "alpha") setScreen("protect");
    };
    window.addEventListener("planipus:navigate", navigate);
    return () => window.removeEventListener("planipus:navigate", navigate);
  }, [capabilities?.availabilityProtection]);

  if (loadingSession) return <main className="boot-screen"><span className="pip-mark" aria-hidden="true">P</span><p>Opening Planipus…</p></main>;
  if (!session?.authenticated) return <Login onLogin={setSession} />;
  if (wizardOpen && overview) return <BridgeWizard connections={overview.connections} onClose={() => setWizardOpen(false)} onActivated={refresh} />;

  const notifications = overview ? attentionItems(overview, error) : [];
  const syncPresentationActive = mascotSyncing || overview?.status === "syncing";
  const mascotMode: MascotMode = syncPresentationActive
    ? "syncing"
    : notifications.length > 0
      ? "attention"
      : "idle";
  const openNotifications = () => setScreen("notifications");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="pip-mark" aria-hidden="true">P</span><span>Planipus</span></div>
        <Navigation current={screen} onChange={setScreen} capabilities={capabilities} notificationCount={notifications.length} />
        <PipMascot mode={mascotMode} notificationCount={notifications.length} onOpenNotifications={openNotifications} />
        <div className="sidebar__status">{overview ? <><StatusPill tone={overview.status} /><small>{formatWhen(overview.lastSuccessAt)}</small></> : <span>Loading health…</span>}</div>
        <button className="text-button sidebar__logout" onClick={() => void api.logout().then(() => setSession({ authenticated: false })).catch((cause) => setError(cause instanceof Error ? cause.message : "Sign out did not complete"))}>Sign out</button>
      </aside>
      <main className="workspace">
        <header className="mobile-header">
          <div className="brand"><span className="pip-mark" aria-hidden="true">P</span><span>Planipus</span></div>
          <div className="mobile-header__status">
            {overview ? <StatusPill tone={overview.status} compact /> : null}
            <PipMascot compact mode={mascotMode} notificationCount={notifications.length} onOpenNotifications={openNotifications} />
          </div>
        </header>
        {error ? <div className="error-banner" role="alert"><div><b>Planipus needs attention</b><span>{error}</span></div><button onClick={refresh}>Try again</button></div> : null}
        {overview ? screen === "overview"
          ? <OverviewScreen data={overview} notices={notices} onConnect={() => setConnectOpen(true)} onCreate={() => setWizardOpen(true)} onSync={runSync} syncPresentationActive={syncPresentationActive} runAction={runAction} />
          : <SecondaryScreen screen={screen} data={overview} notifications={notifications} onNavigate={setScreen} onRefresh={() => void refresh()} onConnect={() => setConnectOpen(true)} onCreate={() => setWizardOpen(true)} runAction={runAction} capabilities={capabilities} />
          : <div className="loading-sheet">Reading installation state…</div>}
      </main>
      <div className="mobile-nav"><Navigation current={screen} onChange={setScreen} capabilities={capabilities} notificationCount={notifications.length} /></div>
      {connectOpen ? <ConnectPanel onClose={() => setConnectOpen(false)} /> : null}
    </div>
  );
}
