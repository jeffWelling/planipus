import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import type { DatabaseSchema } from "../src/database/types.js";
import { FakeCalendarProvider } from "../src/providers/fake.js";
import { GoogleCalendarProvider } from "../src/providers/google/calendar.js";
import {
  createProviderServices,
  invitationDeclineProviderWritesEnabled
} from "../src/runtime.js";

const FAKE_MODE_WITH_GOOGLE_CREDENTIALS: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PLANIPUS_PUBLIC_URL: "http://127.0.0.1:8080",
  DATABASE_URL: "postgresql://planipus:secret@db/planipus",
  PLANIPUS_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  PLANIPUS_BOOTSTRAP_TOKEN: "a-bootstrap-token-that-is-longer-than-32-bytes",
  PLANIPUS_PROVIDER_MODE: "fake",
  GOOGLE_CLIENT_ID: "must-not-enable-google.apps.example.test",
  GOOGLE_CLIENT_SECRET: "must-not-enable-google"
};

describe("provider mode boundary", () => {
  it("keeps fake mode offline even with credentials and stale Google rows", async () => {
    const fetchGoogle = vi.fn<typeof fetch>();
    const createCalendarProvider = vi.fn(
      () => new GoogleCalendarProvider(fetchGoogle)
    );
    const createTokenBroker = vi.fn(() => ({
      accessToken: vi.fn(async () => "must-not-be-returned")
    }));
    const createOAuthService = vi.fn(() => {
      throw new Error("Google OAuth must not be constructed in fake mode");
    });
    const fakeProvider = new FakeCalendarProvider();
    const services = createProviderServices(
      loadConfig(FAKE_MODE_WITH_GOOGLE_CREDENTIALS),
      connectionDatabase("google"),
      fakeProvider,
      { createCalendarProvider, createTokenBroker, createOAuthService }
    );

    expect(createCalendarProvider).not.toHaveBeenCalled();
    expect(createTokenBroker).not.toHaveBeenCalled();
    expect(createOAuthService).not.toHaveBeenCalled();
    expect(services.googleOAuth).toBeUndefined();
    expect(services.providers.resolve("fake")).toBe(fakeProvider);
    expect(() => services.providers.resolve("google")).toThrowError(
      expect.objectContaining({ code: "provider_disabled", retryable: false })
    );
    await expect(services.tokens.accessToken("organization-1", "connection-1"))
      .rejects.toMatchObject({ code: "provider_disabled", retryable: false });
    expect(fetchGoogle).not.toHaveBeenCalled();
  });

  it("keeps live Google invitation declines behind their dedicated explicit gate", () => {
    const fake = loadConfig(FAKE_MODE_WITH_GOOGLE_CREDENTIALS);
    expect(invitationDeclineProviderWritesEnabled(fake)).toBe(true);
    expect(invitationDeclineProviderWritesEnabled({
      ...fake,
      providerMode: "google",
      experimentalGoogleInvitationDecline: false
    })).toBe(false);
    expect(invitationDeclineProviderWritesEnabled({
      ...fake,
      providerMode: "google",
      experimentalGoogleInvitationDecline: true
    })).toBe(true);
  });
});

function connectionDatabase(provider: "google" | "fake"): Kysely<DatabaseSchema> {
  const builder: Record<string, unknown> = {};
  builder["select"] = () => builder;
  builder["where"] = () => builder;
  builder["executeTakeFirst"] = async () => ({ provider, status: "active" });
  return {
    selectFrom: () => builder
  } as unknown as Kysely<DatabaseSchema>;
}
