import { createHash } from "node:crypto";

import type { Kysely } from "kysely";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { v5 as uuidv5 } from "uuid";

import type { ServerConfig } from "../../config.js";
import {
  decryptJson,
  encryptJson,
  type EncryptedEnvelope,
  type EnvelopeKey
} from "../../crypto/envelope.js";
import type { DatabaseSchema } from "../../database/types.js";
import { newId, randomToken, sha256 } from "../../foundation.js";
import { PostgresJobQueue } from "../../jobs/queue.js";
import { ProviderError } from "../types.js";

const GOOGLE_IDENTITY_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
] as const;
const GOOGLE_SOURCE_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const GOOGLE_DESTINATION_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CONNECTION_ID_NAMESPACE = "7ec3e253-c15c-5ffc-a389-20f7fbb88c36";

export type ConnectionRole = "source" | "destination" | "both";

export interface GoogleConnectionIntent {
  readonly label: string;
  readonly role: ConnectionRole;
}

interface StoredGoogleIntent extends GoogleConnectionIntent {
  readonly version: 1;
}

interface StoredGoogleCredential {
  readonly refresh_token: string;
  readonly token_type: string | null;
  readonly granted_scope: string | null;
}

export interface GoogleAuthorization {
  readonly authorizationUrl: string;
  readonly expiresAt: Date;
}

export interface CompletedGoogleConnection {
  readonly connectionId: string;
  readonly remoteSubject: string;
  readonly maskedEmail: string;
}

export class GoogleOAuthService {
  private readonly key: EnvelopeKey;
  private readonly jobs: PostgresJobQueue;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly config: ServerConfig
  ) {
    this.key = { id: config.masterKeyId, bytes: config.masterKey };
    this.jobs = new PostgresJobQueue(db);
  }

  public async begin(
    organizationId: string,
    principalId: string,
    requestedIntent: GoogleConnectionIntent
  ): Promise<GoogleAuthorization> {
    const intent = normalizeConnectionIntent(requestedIntent);
    const client = this.client();
    const transactionId = newId();
    const state = randomToken(32);
    const verifier = randomToken(64);
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const redirectUri = this.redirectUri();
    await this.db
      .insertInto("oauth_transactions")
      .values({
        id: transactionId,
        principal_id: principalId,
        organization_id: organizationId,
        state_hash: sha256(state),
        verifier_envelope: encryptJson(
          { verifier },
          this.key,
          `oauth_transaction:${transactionId}:verifier`
        ),
        intent_envelope: encryptJson(
          { version: 1, ...intent } satisfies StoredGoogleIntent,
          this.key,
          `oauth_transaction:${transactionId}:intent`
        ),
        redirect_uri: redirectUri,
        expires_at: expiresAt,
        consumed_at: null
      })
      .executeTakeFirstOrThrow();
    const authorizationUrl = client.generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: false,
      prompt: "consent",
      scope: googleScopesForRole(intent.role),
      state,
      code_challenge: challenge,
      code_challenge_method: CodeChallengeMethod.S256
    });
    return { authorizationUrl, expiresAt };
  }

  public async complete(code: string, state: string): Promise<CompletedGoogleConnection> {
    const stateHash = sha256(state);
    const transaction = await this.db.transaction().execute(async (database) => {
      const row = await database
        .selectFrom("oauth_transactions")
        .selectAll()
        .where("state_hash", "=", stateHash)
        .where("consumed_at", "is", null)
        .where("expires_at", ">", new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!row) {
        throw new GoogleOAuthError("oauth_state_invalid", "OAuth state is invalid, expired, or already used");
      }
      await database
        .updateTable("oauth_transactions")
        .set({ consumed_at: new Date() })
        .where("id", "=", row.id)
        .executeTakeFirstOrThrow();
      return row;
    });
    const { verifier } = decryptJson<{ verifier: string }>(
      transaction.verifier_envelope as EncryptedEnvelope,
      this.key,
      `oauth_transaction:${transaction.id}:verifier`
    );
    const storedIntent = decryptJson<StoredGoogleIntent>(
      transaction.intent_envelope as EncryptedEnvelope,
      this.key,
      `oauth_transaction:${transaction.id}:intent`
    );
    if (storedIntent.version !== 1) {
      throw new GoogleOAuthError("oauth_intent_invalid", "OAuth transaction intent version is unsupported");
    }
    const intent = normalizeConnectionIntent(storedIntent);
    const client = this.client();
    const tokenResponse = await client.getToken({ code, codeVerifier: verifier });
    const tokens = tokenResponse.tokens;
    if (!tokens.refresh_token || !tokens.id_token) {
      throw new GoogleOAuthError("oauth_tokens_incomplete", "Google did not return the required offline identity grant");
    }
    const requestedScopes = googleScopesForRole(intent.role);
    const grantedScopes = tokens.scope?.split(" ").filter(Boolean) ?? requestedScopes;
    if (tokens.scope && requestedScopes.some((scope) => !grantedScopes.includes(scope))) {
      throw new GoogleOAuthError("oauth_scope_incomplete", "Google did not grant every requested calendar capability");
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.requiredClientId()
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new GoogleOAuthError("oauth_identity_invalid", "Google identity response did not contain a verified subject and email");
    }
    const remoteSubject = payload.sub;
    const verifiedEmail = payload.email;
    // The connection id is part of the envelope AAD. Reuse it during reauthorization;
    // encrypting with a throwaway insert id would make the refreshed credential
    // impossible to decrypt after the unique-key upsert selected the existing row.
    const existing = await this.db
      .selectFrom("provider_connections")
      .select("id")
      .where("organization_id", "=", transaction.organization_id)
      .where("provider", "=", "google")
      .where("remote_subject", "=", remoteSubject)
      .executeTakeFirst();
    const connectionId = existing?.id ?? uuidv5(
      `${transaction.organization_id}:google:${remoteSubject}`,
      CONNECTION_ID_NAMESPACE
    );
    const credential: StoredGoogleCredential = {
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type ?? null,
      granted_scope: tokens.scope ?? null
    };
    const envelope = encryptJson(
      credential,
      this.key,
      `provider_connection:${connectionId}:google`
    );
    const result = await this.db
      .insertInto("provider_connections")
      .values({
        id: connectionId,
        organization_id: transaction.organization_id,
        owner_principal_id: transaction.principal_id,
        provider: "google",
        remote_subject: remoteSubject,
        account_label: verifiedEmail,
        display_label: intent.label,
        intended_role: intent.role,
        email_masked: maskEmail(verifiedEmail),
        credential_envelope: envelope,
        key_version: this.key.id,
        scopes: JSON.stringify(grantedScopes),
        status: "active",
        last_success_at: null,
        safe_error_code: null
      })
      .onConflict((conflict) =>
        conflict
          .columns(["organization_id", "provider", "remote_subject"])
          .doUpdateSet({
            account_label: verifiedEmail,
            display_label: intent.label,
            intended_role: intent.role,
            email_masked: maskEmail(verifiedEmail),
            credential_envelope: envelope,
            key_version: this.key.id,
            scopes: JSON.stringify(grantedScopes),
            status: "active",
            safe_error_code: null,
            updated_at: new Date()
          })
      )
      .returning("id")
      .executeTakeFirstOrThrow();
    await this.jobs.enqueue(
      transaction.organization_id,
      "discover_calendars",
      `connection:${result.id}`,
      { connection_id: result.id }
    );
    return {
      connectionId: result.id,
      remoteSubject,
      maskedEmail: maskEmail(verifiedEmail)
    };
  }

  private client(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.requiredClientId(),
      clientSecret: this.requiredClientSecret(),
      redirectUri: this.redirectUri()
    });
  }

  private redirectUri(): string {
    return new URL("/api/v1/connections/google/callback", this.config.publicUrl).toString();
  }

  private requiredClientId(): string {
    if (!this.config.googleClientId) {
      throw new GoogleOAuthError("google_not_configured", "Google OAuth is not configured");
    }
    return this.config.googleClientId;
  }

  private requiredClientSecret(): string {
    if (!this.config.googleClientSecret) {
      throw new GoogleOAuthError("google_not_configured", "Google OAuth is not configured");
    }
    return this.config.googleClientSecret;
  }
}

export class GoogleTokenBroker {
  private readonly key: EnvelopeKey;

  public constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly config: ServerConfig
  ) {
    this.key = { id: config.masterKeyId, bytes: config.masterKey };
  }

  public async accessToken(organizationId: string, connectionId: string): Promise<string> {
    const row = await this.db
      .selectFrom("provider_connections")
      .select(["id", "provider", "credential_envelope", "status"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();
    if (!row || row.provider !== "google" || row.status !== "active") {
      throw new GoogleOAuthError("connection_unavailable", "Google connection is unavailable");
    }
    const credential = decryptJson<StoredGoogleCredential>(
      row.credential_envelope as EncryptedEnvelope,
      this.key,
      `provider_connection:${row.id}:google`
    );
    if (!this.config.googleClientId || !this.config.googleClientSecret) {
      throw new GoogleOAuthError("google_not_configured", "Google OAuth is not configured");
    }
    const client = new OAuth2Client({
      clientId: this.config.googleClientId,
      clientSecret: this.config.googleClientSecret
    });
    client.setCredentials({ refresh_token: credential.refresh_token });
    try {
      const response = await client.getAccessToken();
      if (response.token) {
        return response.token;
      }
    } catch {
      // Provider error bodies can contain sensitive account context and are not
      // retained. A failed offline grant requires explicit reauthorization.
    }
    await this.db
      .updateTable("provider_connections")
      .set({ status: "action_required", safe_error_code: "provider_auth", updated_at: new Date() })
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .execute();
    throw new ProviderError("provider_auth", "Google authorization must be renewed", false, false, 401);
  }
}

export class GoogleOAuthError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@", 2);
  const visible = local.slice(0, 1);
  return `${visible}${local.length > 1 ? "***" : ""}@${domain}`;
}

export function googleScopesForRole(role: ConnectionRole): string[] {
  return [
    ...GOOGLE_IDENTITY_SCOPES,
    role === "source" ? GOOGLE_SOURCE_SCOPE : GOOGLE_DESTINATION_SCOPE
  ];
}

export function normalizeConnectionIntent(value: GoogleConnectionIntent): GoogleConnectionIntent {
  const label = value.label.normalize("NFC").trim();
  if (
    [...label].length < 1
    || [...label].length > 80
    || /[\p{Cc}\p{Cf}]/u.test(label)
  ) {
    throw new GoogleOAuthError(
      "invalid_connection_intent",
      "connection label must contain 1 through 80 visible characters"
    );
  }
  if (value.role !== "source" && value.role !== "destination" && value.role !== "both") {
    throw new GoogleOAuthError("invalid_connection_intent", "connection role is invalid");
  }
  return { label, role: value.role };
}
