import type { CalendarProvider } from "./types.js";
import { ProviderError } from "./types.js";
import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/types.js";

export interface AccessTokenBroker {
  accessToken(organizationId: string, connectionId: string): Promise<string>;
}

export class ProviderRouter {
  public constructor(
    private readonly google: CalendarProvider | undefined,
    private readonly fake: CalendarProvider
  ) {}

  public resolve(provider: "google" | "fake"): CalendarProvider {
    if (provider === "fake") {
      return this.fake;
    }
    if (!this.google) {
      throw providerDisabled();
    }
    return this.google;
  }
}

export class FakeAccessTokenBroker implements AccessTokenBroker {
  public async accessToken(_organizationId: string, _connectionId: string): Promise<string> {
    return "fake-access-token";
  }
}

export class DatabaseAccessTokenBroker implements AccessTokenBroker {
  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly google: AccessTokenBroker | undefined,
    private readonly fake: AccessTokenBroker
  ) {}

  public async accessToken(organizationId: string, connectionId: string): Promise<string> {
    const connection = await this.db
      .selectFrom("provider_connections")
      .select(["provider", "status"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();
    if (!connection || connection.status !== "active") {
      throw new Error("connection_unavailable");
    }
    if (connection.provider === "fake") {
      return this.fake.accessToken(organizationId, connectionId);
    }
    if (!this.google) {
      throw providerDisabled();
    }
    return this.google.accessToken(organizationId, connectionId);
  }
}

function providerDisabled(): ProviderError {
  return new ProviderError(
    "provider_disabled",
    "Google Calendar access is disabled by the configured provider mode",
    false
  );
}
