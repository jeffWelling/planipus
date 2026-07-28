import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi, safeRequestLogUrl, type ApiDependencies } from "../src/api/app.js";
import type { ServerConfig } from "../src/config.js";
import type { DatabaseSchema } from "../src/database/types.js";
import {
  OWNER_PRINCIPAL_ID,
  PERSONAL_ORGANIZATION_ID
} from "../src/foundation.js";

const NOW = new Date("2026-07-21T18:00:00.000Z");
const SESSION = {
  sessionId: "session-id",
  principalId: OWNER_PRINCIPAL_ID,
  organizationId: PERSONAL_ORGANIZATION_ID,
  expiresAt: new Date("2026-07-22T18:00:00.000Z")
};

const openApps: Array<Awaited<ReturnType<typeof buildApi>>> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })));
});

describe("Server API", () => {
  it("removes OAuth codes, state, and every query value from request-log URLs", () => {
    const raw = "/api/v1/connections/google/callback?code=secret-code&state=secret-state";
    const safe = safeRequestLogUrl(raw);
    expect(safe).toBe("/api/v1/connections/google/callback");
    expect(safe).not.toContain("secret-code");
    expect(safe).not.toContain("secret-state");
    expect(safeRequestLogUrl("/api/health/live")).toBe("/api/health/live");
  });

  it("exchanges a bootstrap token, exposes a CSRF session, and protects metrics", async () => {
    const fixture = dependencies();
    const app = await trackedApp(fixture.value);

    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/session/bootstrap",
      headers: { origin: fixture.value.config.publicUrl.origin },
      payload: { token: "correct-bootstrap" }
    });
    expect(bootstrap.statusCode).toBe(201);
    expect(bootstrap.headers["cache-control"]).toBe("no-store");
    expect(cookiePairs(bootstrap.headers["set-cookie"])).toContain("planipus_session=valid-session");

    const session = await app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: { cookie: "planipus_session=valid-session" }
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      principal_id: OWNER_PRINCIPAL_ID,
      organization_id: PERSONAL_ORGANIZATION_ID,
      csrf_token: expect.any(String)
    });
    expect(cookiePairs(session.headers["set-cookie"]).some((cookie) => cookie.startsWith("_csrf="))).toBe(true);

    const metrics = await app.inject({ method: "GET", url: "/api/metrics" });
    expect(metrics.statusCode).toBe(401);
    expect(metrics.json()).toMatchObject({ code: "authentication_required" });
  });

  it("rejects cross-origin and missing-CSRF mutations before changing state", async () => {
    const fixture = dependencies();
    const app = await trackedApp(fixture.value);

    const crossOrigin = await app.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: {
        cookie: "planipus_session=valid-session",
        origin: "https://attacker.invalid"
      }
    });
    expect(crossOrigin.statusCode).toBe(403);
    expect(crossOrigin.json()).toMatchObject({ code: "origin_rejected" });

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: {
        cookie: "planipus_session=valid-session",
        origin: fixture.value.config.publicUrl.origin
      }
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json()).toMatchObject({ code: "csrf_invalid" });
    expect(fixture.insertedJobs).toHaveLength(0);
  });

  it("returns the web overview DTO and enqueues an explicit sync request", async () => {
    const fixture = dependencies();
    const app = await trackedApp(fixture.value);

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/overview",
      headers: { cookie: "planipus_session=valid-session" }
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      installation_name: "Personal",
      status: "syncing",
      pending_effect_count: 2,
      connections: [{
        display_label: "Work",
        calendars: [{ connection_id: "connection-1", primary_calendar: true }]
      }],
      bridges: [{
        source_label: "Work",
        destination_label: "Work",
        hours_label: "Weekday work hours",
        privacy_label: "Busy only",
        managed_copy_count: 3
      }],
      recent_activity: [{ message: "Calendar bridge activated", reason: "preview_confirmed" }]
    });

    const csrf = await csrfCredentials(app);
    const sync = await app.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: {
        cookie: csrf.cookie,
        origin: fixture.value.config.publicUrl.origin,
        "x-csrf-token": csrf.token
      }
    });
    expect(sync.statusCode).toBe(202);
    expect(sync.json()).toEqual({
      enqueued: 2,
      policies: 1,
      calendars: 1,
      planning_rules: 0,
    });
    expect(fixture.insertedJobs.map((job) => job["kind"])).toEqual(["sync_calendar", "reconcile_policy"]);
  });

  it("marks the affected bridge recoverable when a projection or effect needs attention", async () => {
    const projectionFixture = dependencies({ projectionAttentionCount: 1 });
    const projectionApp = await trackedApp(projectionFixture.value);
    const projectionOverview = await projectionApp.inject({
      method: "GET",
      url: "/api/v1/overview",
      headers: { cookie: "planipus_session=valid-session" }
    });
    expect(projectionOverview.json()).toMatchObject({
      status: "attention",
      bridges: [{ id: "policy-1", status: "attention" }]
    });

    const deadEffectFixture = dependencies({ deadEffectCount: 1 });
    const deadEffectApp = await trackedApp(deadEffectFixture.value);
    const deadEffectOverview = await deadEffectApp.inject({
      method: "GET",
      url: "/api/v1/overview",
      headers: { cookie: "planipus_session=valid-session" }
    });
    expect(deadEffectOverview.json()).toMatchObject({
      status: "attention",
      bridges: [{ id: "policy-1", status: "attention" }]
    });
  });

  it("requests safe recovery of blocked bridge effects through a protected mutation", async () => {
    const fixture = dependencies();
    const retryBlocked = vi.fn(async () => 2);
    const app = await trackedApp({
      ...fixture.value,
      policies: { ...fixture.value.policies, retryBlocked }
    });
    const csrf = await csrfCredentials(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/policies/policy-1/recover",
      headers: {
        cookie: csrf.cookie,
        origin: fixture.value.config.publicUrl.origin,
        "x-csrf-token": csrf.token
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ retried: 2 });
    expect(retryBlocked).toHaveBeenCalledWith(
      PERSONAL_ORGANIZATION_ID,
      OWNER_PRINCIPAL_ID,
      "policy-1"
    );
  });

  it("accepts the Google label/role contract only with a protected session", async () => {
    const fixture = dependencies();
    const begin = vi.fn(async () => ({
      authorizationUrl: "https://accounts.google.test/authorize",
      expiresAt: new Date("2026-07-21T18:10:00.000Z")
    }));
    const complete = vi.fn(async () => ({
      connectionId: "connection-new",
      remoteSubject: "subject-new",
      maskedEmail: "p***@example.com"
    }));
    const app = await trackedApp({
      ...fixture.value,
      googleOAuth: {
        begin,
        complete
      }
    });
    const csrf = await csrfCredentials(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/connections/google/authorize",
      headers: {
        cookie: csrf.cookie,
        origin: fixture.value.config.publicUrl.origin,
        "x-csrf-token": csrf.token
      },
      payload: { label: "Personal", role: "source" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authorization_url: "https://accounts.google.test/authorize",
      expires_at: "2026-07-21T18:10:00.000Z"
    });
    expect(begin).toHaveBeenCalledWith(
      PERSONAL_ORGANIZATION_ID,
      OWNER_PRINCIPAL_ID,
      { label: "Personal", role: "source" }
    );

    const callback = await app.inject({
      method: "GET",
      url: "/api/v1/connections/google/callback?code=code-value&state=state-value"
    });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe("/");
    expect(complete).toHaveBeenCalledWith("code-value", "state-value");
  });

  it("previews and activates protected-time planning rules behind the same trust boundary", async () => {
    const fixture = dependencies();
    const preview = vi.fn(async () => ({
      preview_token: "planning-preview-1",
      expires_at: "2026-07-21T19:10:00.000Z",
      kind: "availability_boundary" as const,
      occurrences: [],
      scheduled_count: 12,
      unmet_count: 0,
      warnings: [],
      hours_summary: "09:00–17:00 · America/Vancouver"
    }));
    const activate = vi.fn(async () => ({ id: "planning-rule-1" }));
    const app = await trackedApp({
      ...fixture.value,
      planning: {
        preview,
        activate,
        list: vi.fn(async () => []),
        listSuggestions: vi.fn(async () => []),
        resolveSuggestion: vi.fn(async () => undefined),
        setPaused: vi.fn(async () => undefined),
        requestReplan: vi.fn(async () => "job-1"),
        remove: vi.fn(async () => undefined)
      }
    });
    const csrf = await csrfCredentials(app);
    const draft = {
      kind: "availability_boundary",
      name: "After-work protection",
      target_calendar_id: "calendar-1",
      timezone: "America/Vancouver",
      working_days: [1, 2, 3, 4, 5],
      workday_start: "09:00",
      workday_end: "17:00",
      protect_before_work: false,
      protect_after_work: true,
      protect_closed_days: false,
      title: "Personal time",
      visibility: "private",
      horizon_days: 21
    };
    const previewResponse = await app.inject({
      method: "POST",
      url: "/api/v1/planning/preview",
      headers: {
        cookie: csrf.cookie,
        origin: fixture.value.config.publicUrl.origin,
        "x-csrf-token": csrf.token
      },
      payload: draft
    });
    expect(previewResponse.statusCode).toBe(200);
    expect(preview).toHaveBeenCalledWith(PERSONAL_ORGANIZATION_ID, OWNER_PRINCIPAL_ID, draft);

    const activationResponse = await app.inject({
      method: "POST",
      url: "/api/v1/planning/rules",
      headers: {
        cookie: csrf.cookie,
        origin: fixture.value.config.publicUrl.origin,
        "x-csrf-token": csrf.token
      },
      payload: { preview_token: "planning-preview-1" }
    });
    expect(activationResponse.statusCode).toBe(201);
    expect(activationResponse.json()).toEqual({ id: "planning-rule-1" });
    expect(activate).toHaveBeenCalledWith(
      PERSONAL_ORGANIZATION_ID,
      OWNER_PRINCIPAL_ID,
      "planning-preview-1"
    );
  });

  it("serves the built UI with safe fallback, caching, MIME, and traversal behavior", async () => {
    const webRoot = await mkdtemp(join(tmpdir(), "planipus-web-"));
    temporaryDirectories.push(webRoot);
    await mkdir(join(webRoot, "assets"));
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Planipus</title>");
    await writeFile(join(webRoot, "assets", "app-12345678.js"), "globalThis.planipus = true;");
    await writeFile(join(webRoot, "secret.txt"), "must not escape assets");
    const fixture = dependencies();
    const app = await trackedApp({ ...fixture.value, webRoot });

    const index = await app.inject({ method: "GET", url: "/" });
    expect(index.statusCode).toBe(200);
    expect(index.headers["content-type"]).toContain("text/html");
    expect(index.headers["cache-control"]).toBe("no-cache");
    expect(index.headers["content-security-policy"]).toContain("default-src 'self'");

    const asset = await app.inject({ method: "GET", url: "/assets/app-12345678.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(asset.headers["cache-control"]).toContain("immutable");

    const fallback = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { accept: "text/html" }
    });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.body).toContain("Planipus");

    const traversal = await app.inject({ method: "GET", url: "/assets/%2e%2e/secret.txt" });
    expect(traversal.statusCode).toBe(404);
    expect(traversal.body).not.toContain("must not escape assets");

    const missingApi = await app.inject({ method: "GET", url: "/api/v1/missing" });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.headers["cache-control"]).toBe("no-store");
  });
});

async function trackedApp(value: ApiDependencies): Promise<Awaited<ReturnType<typeof buildApi>>> {
  const app = await buildApi(value);
  openApps.push(app);
  return app;
}

async function csrfCredentials(
  app: Awaited<ReturnType<typeof buildApi>>
): Promise<{ readonly cookie: string; readonly token: string }> {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/session",
    headers: { cookie: "planipus_session=valid-session" }
  });
  const body = response.json() as { csrf_token: string };
  const cookies = ["planipus_session=valid-session", ...cookiePairs(response.headers["set-cookie"])]
    .join("; ");
  return { cookie: cookies, token: body.csrf_token };
}

function cookiePairs(header: string | string[] | undefined): string[] {
  const values = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return values.map((value) => value.split(";", 1)[0] ?? value);
}

interface FixtureOptions {
  readonly projectionAttentionCount?: number;
  readonly deadEffectCount?: number;
}

function dependencies(options: FixtureOptions = {}): {
  readonly value: ApiDependencies;
  readonly insertedJobs: Array<Record<string, unknown>>;
} {
  const database = fixtureDatabase(options);
  const config: ServerConfig = {
    environment: "test",
    host: "127.0.0.1",
    port: 8080,
    publicUrl: new URL("http://127.0.0.1:8080"),
    databaseUrl: "postgresql://unused.invalid/planipus",
    masterKey: Buffer.alloc(32, 7),
    masterKeyId: "test-v1",
    bootstrapToken: "correct-bootstrap",
    cookieSecure: false,
    sessionTtlSeconds: 3_600,
    providerMode: "fake",
    googleClientId: null,
    googleClientSecret: null,
    migrationsDirectory: "migrations",
    migrationAttempts: 1,
    schedulerIntervalMs: 15_000,
    workerIntervalMs: 1_000,
    jobLeaseSeconds: 60
  };
  return {
    insertedJobs: database.insertedJobs,
    value: {
      config,
      db: database.db,
      sessions: {
        exchangeBootstrapToken: async (token) => token === "correct-bootstrap"
          ? { ...SESSION, token: "valid-session" }
          : null,
        authenticate: async (token) => token === "valid-session" ? SESSION : null,
        revoke: async () => undefined
      },
      policies: {
        preview: vi.fn(),
        activate: vi.fn(),
        list: vi.fn(),
        setPaused: vi.fn(),
        retryBlocked: vi.fn(),
        requestReconcile: vi.fn()
      }
    }
  };
}

function fixtureDatabase(options: FixtureOptions = {}): {
  readonly db: Kysely<DatabaseSchema>;
  readonly insertedJobs: Array<Record<string, unknown>>;
} {
  const insertedJobs: Array<Record<string, unknown>> = [];
  const connection = {
    id: "connection-1",
    provider: "google",
    display_label: "Work",
    intended_role: "both",
    email_masked: "w***@example.com",
    status: "active",
    last_success_at: NOW,
    safe_error_code: null,
    updated_at: NOW
  };
  const calendar = {
    id: "calendar-1",
    connection_id: "connection-1",
    name: "Primary",
    timezone: "America/Vancouver",
    readable: true,
    writable: true,
    primary_calendar: true,
    provider: "google",
    account: "w***@example.com"
  };
  const policy = {
    id: "policy-1",
    revision: 1,
    source_calendar_id: "calendar-1",
    status: "active",
    safe_error_code: null,
    last_success_at: NOW,
    policy_document: { privacy: { preset: "busy_only" } },
    source_calendar: "Primary",
    source_label: "Work",
    destination_calendar: "Primary",
    destination_label: "Work",
    hours_name: "Weekday work hours"
  };

  const database: Record<string, unknown> = {};
  database["selectFrom"] = (table: string) => selectBuilder(table);
  database["insertInto"] = (table: string) => insertBuilder(table);
  database["transaction"] = () => ({
    execute: async (callback: (transaction: unknown) => unknown) => callback(database)
  });

  function selectBuilder(table: string): Record<string, unknown> {
    const whereValues: unknown[] = [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const method of [
      "select",
      "selectAll",
      "innerJoin",
      "leftJoin",
      "orderBy",
      "limit",
      "groupBy",
      "forUpdate"
    ]) {
      builder[method] = chain;
    }
    builder["where"] = (_column: unknown, _operator: unknown, value: unknown) => {
      whereValues.push(value);
      return builder;
    };
    const rows = (): unknown[] => {
      switch (table) {
        case "organizations": return [{ name: "Personal" }];
        case "provider_connections": return [connection];
        case "calendar_endpoints": return [calendar];
        case "sync_policies": return [policy];
        case "projections": return [{
          policy_id: "policy-1",
          managed_copy_count: 3,
          attention_count: options.projectionAttentionCount ?? 0
        }];
        case "outbox_effects": return whereValues.includes("dead")
          ? (options.deadEffectCount ?? 0) > 0
            ? [{ policy_id: "policy-1", count: options.deadEffectCount }]
            : []
          : [{ count: 2 }];
        case "scheduled_jobs": return [{ count: 0 }];
        case "sync_notices": return [{ count: 0 }];
        case "audit_facts": return [{
          id: "audit-1",
          action: "policy.activated",
          reason_code: "preview_confirmed",
          created_at: NOW
        }];
        default: return [];
      }
    };
    builder["execute"] = async () => rows();
    builder["executeTakeFirst"] = async () => rows()[0];
    builder["executeTakeFirstOrThrow"] = async () => {
      const first = rows()[0];
      if (first === undefined) throw new Error(`missing fixture row for ${table}`);
      return first;
    };
    return builder;
  }

  function insertBuilder(table: string): Record<string, unknown> {
    let value: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder["values"] = (next: Record<string, unknown>) => {
      value = next;
      return builder;
    };
    builder["onConflict"] = () => builder;
    builder["returning"] = () => builder;
    builder["executeTakeFirst"] = async () => {
      if (table === "scheduled_jobs") insertedJobs.push(value);
      return { id: value["id"] };
    };
    return builder;
  }

  return { db: database as unknown as Kysely<DatabaseSchema>, insertedJobs };
}
