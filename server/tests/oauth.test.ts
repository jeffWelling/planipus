import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";

import type { ServerConfig } from "../src/config.js";
import { decryptJson, type EncryptedEnvelope } from "../src/crypto/envelope.js";
import type { DatabaseSchema } from "../src/database/types.js";
import {
  GoogleOAuthError,
  GoogleOAuthService,
  googleScopesForRole,
  removesEventReadAccess,
  normalizeConnectionIntent,
  resolveGoogleGrantedScopes,
  validateGoogleGrantedScopes
} from "../src/providers/google/oauth.js";

describe("Google OAuth intent", () => {
  it("encrypts a normalized label and source-only role into the one-time transaction", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const service = new GoogleOAuthService(insertOnlyDatabase(rows), config());
    const authorization = await service.begin("organization-1", "principal-1", {
      label: "  🐙 Personal  ",
      role: "source"
    });
    const transaction = rows[0];
    expect(transaction).toBeDefined();
    const id = transaction?.["id"];
    const envelope = transaction?.["intent_envelope"];
    expect(typeof id).toBe("string");
    const intent = decryptJson<{ version: number; label: string; role: string }>(
      envelope as EncryptedEnvelope,
      { id: "test-v1", bytes: Buffer.alloc(32, 7) },
      `oauth_transaction:${String(id)}:intent`
    );
    expect(intent).toEqual({ version: 1, label: "🐙 Personal", role: "source" });

    const scopes = new URL(authorization.authorizationUrl).searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toContain("https://www.googleapis.com/auth/calendar.events.readonly");
    expect(scopes).toContain("https://www.googleapis.com/auth/calendar.freebusy");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/calendar.events");
  });

  it("requests write access only for destination-capable roles", () => {
    expect(googleScopesForRole("destination")).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(googleScopesForRole("both")).toContain("https://www.googleapis.com/auth/calendar.events");
    expect(googleScopesForRole("source")).not.toContain("https://www.googleapis.com/auth/calendar.events");
    expect(googleScopesForRole("source")).toContain("https://www.googleapis.com/auth/calendar.freebusy");
    expect(googleScopesForRole("both")).toContain("https://www.googleapis.com/auth/calendar.freebusy");
    expect(googleScopesForRole("destination")).not.toContain("https://www.googleapis.com/auth/calendar.freebusy");
    expect(googleScopesForRole("availability")).toContain("https://www.googleapis.com/auth/calendar.freebusy");
    expect(googleScopesForRole("availability"))
      .not.toContain("https://www.googleapis.com/auth/calendar.events.freebusy");
    expect(googleScopesForRole("availability")).not.toContain("https://www.googleapis.com/auth/calendar.events.readonly");
    expect(googleScopesForRole("availability")).not.toContain("https://www.googleapis.com/auth/calendar.events");
  });

  it("rejects hidden labels and unknown roles before persisting OAuth state", () => {
    expect(() => normalizeConnectionIntent({ label: "Work\u0000", role: "source" }))
      .toThrowError(GoogleOAuthError);
    expect(() => normalizeConnectionIntent({ label: "Work", role: "sideways" as "source" }))
      .toThrowError(GoogleOAuthError);
  });

  it("requires an explicit data migration whenever a reauthorization removes event reads", () => {
    expect(removesEventReadAccess("source", "availability")).toBe(true);
    expect(removesEventReadAccess("both", "availability")).toBe(true);
    expect(removesEventReadAccess("both", "destination")).toBe(true);
    expect(removesEventReadAccess("availability", "source")).toBe(false);
    expect(removesEventReadAccess("source", "both")).toBe(false);
  });

  it("fails availability-only completion when Google retains event scopes", () => {
    const availability = googleScopesForRole("availability");
    expect(() => validateGoogleGrantedScopes("availability", availability)).not.toThrow();
    expect(() => validateGoogleGrantedScopes("availability", [
      ...availability,
      "https://www.googleapis.com/auth/calendar.events.readonly"
    ])).toThrowError(expect.objectContaining({ code: "oauth_scope_overbroad" }));
    expect(() => validateGoogleGrantedScopes("availability", [
      ...availability,
      "https://www.googleapis.com/auth/calendar.events.freebusy"
    ])).toThrowError(expect.objectContaining({ code: "oauth_scope_overbroad" }));
    expect(() => validateGoogleGrantedScopes("availability", availability.filter(
      (scope) => scope !== "https://www.googleapis.com/auth/calendar.freebusy"
    ))).toThrowError(expect.objectContaining({ code: "oauth_scope_incomplete" }));
  });

  it("fails closed when Google omits the availability grant scope report", () => {
    expect(() => resolveGoogleGrantedScopes("availability", undefined))
      .toThrowError(expect.objectContaining({ code: "oauth_scope_unverified" }));
    expect(resolveGoogleGrantedScopes("source", undefined))
      .toEqual(googleScopesForRole("source"));
  });
});

function insertOnlyDatabase(rows: Array<Record<string, unknown>>): Kysely<DatabaseSchema> {
  const database = {
    insertInto: () => {
      let value: Record<string, unknown> = {};
      const builder = {
        values(next: Record<string, unknown>) {
          value = next;
          return builder;
        },
        async executeTakeFirstOrThrow() {
          rows.push(value);
          return { id: value["id"] };
        }
      };
      return builder;
    }
  };
  return database as unknown as Kysely<DatabaseSchema>;
}

function config(): ServerConfig {
  return {
    environment: "test",
    host: "127.0.0.1",
    port: 8080,
    publicUrl: new URL("http://127.0.0.1:8080"),
    databaseUrl: "postgresql://unused.invalid/planipus",
    masterKey: Buffer.alloc(32, 7),
    masterKeyId: "test-v1",
    bootstrapToken: "a-bootstrap-token-that-is-longer-than-32-bytes",
    cookieSecure: false,
    sessionTtlSeconds: 3_600,
    providerMode: "google",
    googleClientId: "google-client-id.apps.googleusercontent.com",
    googleClientSecret: "google-client-secret",
    migrationsDirectory: "migrations",
    migrationAttempts: 1,
    schedulerIntervalMs: 15_000,
    workerIntervalMs: 1_000,
    jobLeaseSeconds: 60
  };
}
