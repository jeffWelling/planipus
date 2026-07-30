import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { isUuid, newId, randomToken, sha256 } from "../foundation.js";

export type ApiTokenScope = "read" | "propose" | "apply";

export interface AuthenticatedApiToken {
  readonly tokenId: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly scopes: readonly ApiTokenScope[];
  readonly expiresAt: Date;
}

export interface IssuedApiToken extends AuthenticatedApiToken {
  readonly label: string;
  readonly token: string;
}

export class ApiTokenInputError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ApiTokenInputError";
  }
}

export class ApiTokenService {
  public constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async issue(
    organizationId: string,
    principalId: string,
    input: { readonly label: unknown; readonly scopes: unknown; readonly expires_in_days: unknown }
  ): Promise<IssuedApiToken> {
    const label = normalizedText(input.label, 80, "token label");
    const scopes = normalizeScopes(input.scopes);
    const days = input.expires_in_days === undefined ? 30 : input.expires_in_days;
    if (!Number.isSafeInteger(days) || Number(days) < 1 || Number(days) > 365) {
      throw new ApiTokenInputError("invalid_api_token", "token expiry must be from 1 through 365 days");
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Number(days) * 86_400_000);
    const id = newId();
    const token = `pln_api_${randomToken(32)}`;
    await this.db.transaction().execute(async (transaction) => {
      const membership = await transaction.selectFrom("memberships")
        .innerJoin("principals", "principals.id", "memberships.principal_id")
        .select(["memberships.role", "principals.status"])
        .where("memberships.organization_id", "=", organizationId)
        .where("memberships.principal_id", "=", principalId)
        .executeTakeFirst();
      if (!membership || membership.role !== "owner" || membership.status !== "active") {
        throw new ApiTokenInputError("authorization_required", "only an active owner may create API tokens");
      }
      await transaction.insertInto("api_tokens").values({
        id,
        organization_id: organizationId,
        principal_id: principalId,
        label,
        token_hash: sha256(token),
        scopes: JSON.stringify(scopes),
        expires_at: expiresAt,
        last_used_at: null,
        revoked_at: null
      }).executeTakeFirstOrThrow();
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: "user",
        action: "api_token.created",
        target_type: "api_token",
        target_id: id,
        reason_code: "owner_created",
        before_hash: null,
        after_hash: `sha256:${sha256(JSON.stringify({ id, label, scopes, expires_at: expiresAt.toISOString() }))}`,
        detail: { label, scopes, expires_at: expiresAt.toISOString() }
      }).executeTakeFirstOrThrow();
    });
    return { tokenId: id, principalId, organizationId, scopes, expiresAt, label, token };
  }

  public async authenticate(token: string | undefined): Promise<AuthenticatedApiToken | null> {
    if (!token || !token.startsWith("pln_api_") || token.length > 200) return null;
    const now = new Date();
    const row = await this.db.selectFrom("api_tokens")
      .innerJoin("principals", "principals.id", "api_tokens.principal_id")
      .innerJoin("memberships", (join) => join
        .onRef("memberships.organization_id", "=", "api_tokens.organization_id")
        .onRef("memberships.principal_id", "=", "api_tokens.principal_id"))
      .select([
        "api_tokens.id",
        "api_tokens.organization_id",
        "api_tokens.principal_id",
        "api_tokens.scopes",
        "api_tokens.expires_at"
      ])
      .where("api_tokens.token_hash", "=", sha256(token))
      .where("api_tokens.revoked_at", "is", null)
      .where("api_tokens.expires_at", ">", now)
      .where("principals.status", "=", "active")
      .where("memberships.role", "=", "owner")
      .executeTakeFirst();
    if (!row) return null;
    const scopes = storedScopes(row.scopes);
    if (scopes.length === 0) return null;
    await this.db.updateTable("api_tokens")
      .set({ last_used_at: now })
      .where("id", "=", row.id)
      .executeTakeFirst();
    return {
      tokenId: row.id,
      principalId: row.principal_id,
      organizationId: row.organization_id,
      scopes,
      expiresAt: new Date(row.expires_at)
    };
  }

  public async list(organizationId: string, principalId: string): Promise<readonly object[]> {
    return this.db.selectFrom("api_tokens")
      .select(["id", "label", "scopes", "expires_at", "last_used_at", "revoked_at", "created_at"])
      .where("organization_id", "=", organizationId)
      .where("principal_id", "=", principalId)
      .orderBy("created_at", "desc")
      .execute();
  }

  public async revoke(organizationId: string, principalId: string, tokenId: string): Promise<void> {
    if (!isUuid(tokenId)) {
      throw new ApiTokenInputError("invalid_api_token", "API token identifier is invalid");
    }
    await this.db.transaction().execute(async (transaction) => {
      const revoked = await transaction.updateTable("api_tokens")
        .set({ revoked_at: new Date() })
        .where("organization_id", "=", organizationId)
        .where("principal_id", "=", principalId)
        .where("id", "=", tokenId)
        .where("revoked_at", "is", null)
        .returning("id")
        .executeTakeFirst();
      if (!revoked) throw new ApiTokenInputError("not_found", "API token was not found");
      await transaction.insertInto("audit_facts").values({
        id: newId(),
        organization_id: organizationId,
        principal_id: principalId,
        actor_kind: "user",
        action: "api_token.revoked",
        target_type: "api_token",
        target_id: tokenId,
        reason_code: "owner_revoked",
        before_hash: null,
        after_hash: null,
        detail: {}
      }).executeTakeFirstOrThrow();
    });
  }
}

export function hasApiScope(scopes: readonly ApiTokenScope[], required: ApiTokenScope): boolean {
  return scopes.includes(required);
}

function normalizeScopes(value: unknown): readonly ApiTokenScope[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
    throw new ApiTokenInputError("invalid_api_token", "one or more API token scopes are required");
  }
  const requested = new Set<ApiTokenScope>();
  for (const scope of value) {
    if (scope !== "read" && scope !== "propose" && scope !== "apply") {
      throw new ApiTokenInputError("invalid_api_token", "API token scope is invalid");
    }
    requested.add(scope);
  }
  if (requested.has("apply")) requested.add("propose");
  if (requested.has("propose")) requested.add("read");
  return (["read", "propose", "apply"] as const).filter((scope) => requested.has(scope));
}

function storedScopes(value: object): readonly ApiTokenScope[] {
  if (!Array.isArray(value)) return [];
  const scopes = value.filter((scope): scope is ApiTokenScope =>
    scope === "read" || scope === "propose" || scope === "apply");
  return [...new Set(scopes)];
}

function normalizedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") throw new ApiTokenInputError("invalid_api_token", `${label} is required`);
  const text = value.normalize("NFC").trim();
  if (text.length < 1 || [...text].length > maximum) {
    throw new ApiTokenInputError("invalid_api_token", `${label} is invalid`);
  }
  return text;
}
