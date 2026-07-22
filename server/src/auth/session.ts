import type { Kysely } from "kysely";

import type { ServerConfig } from "../config.js";
import { equalSecret } from "../crypto/envelope.js";
import {
  newId,
  OWNER_PRINCIPAL_ID,
  PERSONAL_ORGANIZATION_ID,
  randomToken,
  sha256
} from "../foundation.js";
import type { DatabaseSchema } from "../database/types.js";

export const SESSION_COOKIE = "planipus_session";

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly expiresAt: Date;
}

export interface CreatedSession extends AuthenticatedSession {
  readonly token: string;
}

export class SessionService {
  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly config: ServerConfig
  ) {}

  public async exchangeBootstrapToken(candidate: string): Promise<CreatedSession | null> {
    if (!equalSecret(candidate, this.config.bootstrapToken)) {
      return null;
    }
    const token = randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlSeconds * 1_000);
    const sessionId = newId();
    await this.db
      .insertInto("browser_sessions")
      .values({
        id: sessionId,
        principal_id: OWNER_PRINCIPAL_ID,
        organization_id: PERSONAL_ORGANIZATION_ID,
        token_hash: sha256(token),
        expires_at: expiresAt,
        last_seen_at: now,
        revoked_at: null
      })
      .executeTakeFirstOrThrow();
    return {
      token,
      sessionId,
      principalId: OWNER_PRINCIPAL_ID,
      organizationId: PERSONAL_ORGANIZATION_ID,
      expiresAt
    };
  }

  public async authenticate(token: string | undefined): Promise<AuthenticatedSession | null> {
    if (!token) {
      return null;
    }
    const now = new Date();
    const row = await this.db
      .selectFrom("browser_sessions")
      .innerJoin("principals", "principals.id", "browser_sessions.principal_id")
      .select([
        "browser_sessions.id as session_id",
        "browser_sessions.principal_id",
        "browser_sessions.organization_id",
        "browser_sessions.expires_at"
      ])
      .where("browser_sessions.token_hash", "=", sha256(token))
      .where("browser_sessions.revoked_at", "is", null)
      .where("browser_sessions.expires_at", ">", now)
      .where("principals.status", "=", "active")
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    await this.db
      .updateTable("browser_sessions")
      .set({ last_seen_at: now })
      .where("id", "=", row.session_id)
      .execute();
    return {
      sessionId: row.session_id,
      principalId: row.principal_id,
      organizationId: row.organization_id,
      expiresAt: new Date(row.expires_at)
    };
  }

  public async revoke(sessionId: string): Promise<void> {
    await this.db
      .updateTable("browser_sessions")
      .set({ revoked_at: new Date() })
      .where("id", "=", sessionId)
      .execute();
  }
}
