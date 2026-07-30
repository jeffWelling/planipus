import { useEffect, useMemo, useState } from "react";

import { api } from "./api.js";
import type { ApiTokenScope, ApiTokenSummary, CreatedApiToken } from "./types.js";

function formatWhen(value?: string): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function scopeLabel(scope: ApiTokenScope): string {
  if (scope === "read") return "Read";
  if (scope === "propose") return "Preview";
  return "Apply";
}

function ApiTokenSettings() {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [created, setCreated] = useState<CreatedApiToken>();
  const [label, setLabel] = useState("My MCP client");
  const [scopes, setScopes] = useState<ApiTokenScope[]>(["read", "propose"]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string>();
  const [copied, setCopied] = useState<"token" | "config">();
  const [error, setError] = useState<string>();

  function refresh() {
    void api.apiTokens()
      .then((items) => {
        setTokens(items);
        setError(undefined);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "API tokens are unavailable"));
  }

  useEffect(refresh, []);

  const mcpConfiguration = useMemo(() => {
    const token = created?.token ?? "PASTE_THE_ONE_TIME_TOKEN_HERE";
    return JSON.stringify({
      mcpServers: {
        planipus: {
          command: "node",
          args: ["/path/to/planipus/mcp/dist/src/stdio.js"],
          env: {
            PLANIPUS_API_URL: window.location.origin,
            PLANIPUS_API_TOKEN: token,
            ...(scopes.includes("apply") ? { PLANIPUS_MCP_ENABLE_APPLY: "true" } : {})
          }
        }
      }
    }, null, 2);
  }, [created?.token, scopes]);

  async function createToken() {
    setCreating(true);
    setError(undefined);
    setCreated(undefined);
    try {
      const result = await api.createApiToken({ label: label.trim(), scopes, expiresInDays });
      setCreated(result);
      setTokens((current) => [result, ...current.filter((token) => token.id !== result.id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The API token was not created");
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(token: ApiTokenSummary) {
    if (!window.confirm(`Revoke “${token.label}”?\n\nAny MCP or API client using it will stop working immediately.`)) return;
    setRevokingId(token.id);
    setError(undefined);
    try {
      await api.revokeApiToken(token.id);
      setTokens((current) => current.filter((item) => item.id !== token.id));
      if (created?.id === token.id) setCreated(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The API token was not revoked");
    } finally {
      setRevokingId(undefined);
    }
  }

  async function copy(value: string, kind: "token" | "config") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(undefined), 1800);
    } catch {
      setError("Copying was blocked by the browser. Select the value and copy it manually.");
    }
  }

  function toggleScope(scope: ApiTokenScope, checked: boolean) {
    setCreated(undefined);
    setScopes((current) => {
      if (scope === "apply" && checked) return ["read", "propose", "apply"];
      if (scope === "propose" && !checked) return current.filter((item) => item !== "propose" && item !== "apply");
      if (checked) return Array.from(new Set([...current, scope]));
      if (scope === "read") return current;
      return current.filter((item) => item !== scope);
    });
  }

  return (
    <section className="settings-sheet api-token-settings" aria-labelledby="api-token-title">
      <div className="settings-sheet__heading">
        <div>
          <p className="eyebrow">API & MCP</p>
          <h2 id="api-token-title">Give automation its own key.</h2>
          <p>Each client gets a revocable, scoped token. The MCP server uses the same HTTP API as this interface; it never opens the Planipus database.</p>
        </div>
        <span className="api-path-badge">API → MCP</span>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <div className="token-creator">
        <div className="form-grid form-grid--three">
          <label className="form-span">
            Token label
            <input value={label} maxLength={80} onChange={(event) => { setLabel(event.target.value); setCreated(undefined); }} />
          </label>
          <label>
            Expires after
            <select value={expiresInDays} onChange={(event) => { setExpiresInDays(Number(event.target.value)); setCreated(undefined); }}>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
            </select>
          </label>
        </div>

        <fieldset className="scope-picker">
          <legend>What may this token do?</legend>
          <label>
            <input type="checkbox" checked disabled />
            <span><b>Read</b><small>Connections, calendars, rules, status, and safe summaries.</small></span>
          </label>
          <label>
            <input type="checkbox" checked={scopes.includes("propose")} onChange={(event) => toggleScope("propose", event.target.checked)} />
            <span><b>Preview</b><small>Build expiring proposals. A preview alone writes no calendar data.</small></span>
          </label>
          <label className={scopes.includes("apply") ? "scope-picker__apply is-selected" : "scope-picker__apply"}>
            <input type="checkbox" checked={scopes.includes("apply")} onChange={(event) => toggleScope("apply", event.target.checked)} />
            <span><b>Apply and retire rules</b><small>Activate, pause, resume, reconcile, and permanently retire conflict-response rules. Enable only for a trusted client.</small></span>
          </label>
        </fieldset>

        <button className="button button--primary" disabled={creating || !label.trim()} onClick={() => void createToken()}>
          {creating ? "Creating one-time key…" : "Create API token"}
        </button>
      </div>

      {created ? (
        <aside className="token-reveal" role="status" aria-live="polite">
          <div>
            <p className="eyebrow">Shown once</p>
            <h3>Save this token now.</h3>
            <p>Planipus stores only its cryptographic fingerprint. Closing this panel cannot be undone; create a replacement if the value is lost.</p>
          </div>
          <div className="secret-line">
            <code>{created.token}</code>
            <button className="button button--secondary" onClick={() => void copy(created.token, "token")}>{copied === "token" ? "Copied" : "Copy token"}</button>
          </div>
          <details className="mcp-config">
            <summary>MCP client configuration</summary>
            <p>Build the repository’s MCP workspace, replace the example path with its compiled stdio entry point, and paste this object into your MCP client.</p>
            <pre><code>{mcpConfiguration}</code></pre>
            <button className="button button--quiet" onClick={() => void copy(mcpConfiguration, "config")}>{copied === "config" ? "Copied configuration" : "Copy configuration"}</button>
          </details>
          <button className="text-button" onClick={() => setCreated(undefined)}>I saved it; hide the token</button>
        </aside>
      ) : (
        <details className="mcp-config mcp-config--quiet">
          <summary>How the MCP server connects</summary>
          <p>The MCP process runs beside your MCP client over stdio and calls this installation over HTTPS. Set <code>PLANIPUS_API_URL</code> and <code>PLANIPUS_API_TOKEN</code>; apply-capable tools also require <code>PLANIPUS_MCP_ENABLE_APPLY=true</code>.</p>
          <pre><code>{mcpConfiguration}</code></pre>
        </details>
      )}

      <div className="token-list-heading">
        <h3>Active API tokens</h3>
        <button className="text-button" onClick={refresh}>Refresh</button>
      </div>
      {tokens.length > 0 ? (
        <div className="token-list">
          {tokens.map((token) => (
            <article key={token.id}>
              <div>
                <span className="token-title-line">
                  <b>{token.label}</b>
                  {token.revokedAt ? <small className="token-state token-state--revoked">Revoked</small> : null}
                  {!token.revokedAt && token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now() ? <small className="token-state token-state--expired">Expired</small> : null}
                </span>
                <span className="token-scopes">{token.scopes.map((scope) => <small key={scope}>{scopeLabel(scope)}</small>)}</span>
              </div>
              <dl>
                <div><dt>Last used</dt><dd>{formatWhen(token.lastUsedAt)}</dd></div>
                <div><dt>Expires</dt><dd>{token.expiresAt ? formatWhen(token.expiresAt) : "No expiry"}</dd></div>
              </dl>
              <button className="button button--danger-quiet" disabled={Boolean(token.revokedAt) || revokingId === token.id} onClick={() => void revokeToken(token)}>
                {token.revokedAt ? "Revoked" : revokingId === token.id ? "Revoking…" : "Revoke"}
              </button>
            </article>
          ))}
        </div>
      ) : <p className="quiet-note">No API tokens exist. Browser sessions and the bootstrap token are separate.</p>}
    </section>
  );
}

export function SettingsScreen() {
  return (
    <div className="content-stack">
      <div>
        <p className="eyebrow">Installation</p>
        <h1>Settings</h1>
        <p>Planipus Server continues in its own Kubernetes workload when this browser is closed.</p>
      </div>

      <section className="settings-sheet">
        <h2>Your hours</h2>
        <div className="hours-setting-grid">
          <article><b>Working Hours</b><span>When bridges and solo work belong.</span></article>
          <article><b>Meeting Hours</b><span>The hard boundary for Smart Meetings.</span></article>
          <article><b>Personal Hours</b><span>Reserved for personal routines and future planning.</span></article>
        </div>
        <p className="quiet-note">Each bridge and Smart Meeting currently stores its own explicit hours. Reusable named-hour editing is the next settings migration.</p>
      </section>

      <section className="settings-sheet">
        <h2>How after-hours protection works</h2>
        <p>Meeting Hours constrain Planipus suggestions. The optional availability fence in Protect writes private Busy blocks so other calendar tools also see the boundary.</p>
        <button className="button button--quiet" onClick={() => window.dispatchEvent(new CustomEvent("planipus:navigate", { detail: "protect" }))}>Open Protect</button>
      </section>

      <ApiTokenSettings />

      <section className="settings-sheet">
        <h2>Data and diagnostics</h2>
        <p>Provider tokens are envelope-encrypted. Event details are omitted from metrics and routine logs.</p>
        <div className="settings-links"><a href="/api/v1/health/detail">Health detail</a><a href="/api/metrics">Prometheus metrics</a></div>
      </section>
    </div>
  );
}
