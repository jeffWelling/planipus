import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "../src/config.js";

const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PLANIPUS_PUBLIC_URL: "http://127.0.0.1:8080",
  DATABASE_URL: "postgresql://planipus:secret@db/planipus",
  PLANIPUS_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  PLANIPUS_BOOTSTRAP_TOKEN: "a-bootstrap-token-that-is-longer-than-32-bytes",
  PLANIPUS_PROVIDER_MODE: "fake"
};

describe("loadConfig", () => {
  it("loads a complete local configuration", () => {
    const config = loadConfig(VALID_ENV);

    expect(config.publicUrl.origin).toBe("http://127.0.0.1:8080");
    expect(config.providerMode).toBe("fake");
    expect(config.masterKey).toEqual(Buffer.alloc(32, 7));
    expect(config.googleClientId).toBeNull();
    expect(config.experimentalGoogleInvitationDecline).toBe(false);
    expect(config.migrationAttempts).toBe(30);
  });

  it("rejects insecure production and malformed secret material together", () => {
    expect(() => loadConfig({
      ...VALID_ENV,
      NODE_ENV: "production",
      PLANIPUS_MASTER_KEY: Buffer.alloc(16).toString("base64"),
      PLANIPUS_COOKIE_SECURE: "false"
    })).toThrowError(ConfigurationError);
    try {
      loadConfig({
        ...VALID_ENV,
        NODE_ENV: "production",
        PLANIPUS_MASTER_KEY: Buffer.alloc(16).toString("base64"),
        PLANIPUS_COOKIE_SECURE: "false"
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).problems).toEqual(expect.arrayContaining([
        expect.stringContaining("HTTPS"),
        expect.stringContaining("32 random bytes"),
        expect.stringContaining("COOKIE_SECURE")
      ]));
    }
  });

  it("requires Google OAuth credentials in Google mode", () => {
    expect(() => loadConfig({ ...VALID_ENV, PLANIPUS_PROVIDER_MODE: "google" }))
      .toThrowError(/GOOGLE_CLIENT_ID/u);
  });

  it("validates the bounded migration-attempt setting", () => {
    expect(loadConfig({ ...VALID_ENV, PLANIPUS_MIGRATION_ATTEMPTS: "60" }).migrationAttempts)
      .toBe(60);
    expect(() => loadConfig({ ...VALID_ENV, PLANIPUS_MIGRATION_ATTEMPTS: "0" }))
      .toThrowError(/PLANIPUS_MIGRATION_ATTEMPTS/u);
    expect(() => loadConfig({ ...VALID_ENV, PLANIPUS_MIGRATION_ATTEMPTS: "301" }))
      .toThrowError(/PLANIPUS_MIGRATION_ATTEMPTS/u);
  });

  it("accepts only an explicit boolean for live Google invitation declines", () => {
    expect(loadConfig({
      ...VALID_ENV,
      PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE: "true"
    }).experimentalGoogleInvitationDecline).toBe(true);
    expect(() => loadConfig({
      ...VALID_ENV,
      PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE: "yes"
    })).toThrowError(/PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE/u);
  });
});
