import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";
import swagger from "@fastify/swagger";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import { sql, type Kysely } from "kysely";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

import {
  SESSION_COOKIE,
  SessionService,
  type AuthenticatedSession
} from "../auth/session.js";
import {
  ApiTokenInputError,
  ApiTokenService,
  hasApiScope,
  type ApiTokenScope,
  type AuthenticatedApiToken
} from "../auth/api-token.js";
import type { ServerConfig } from "../config.js";
import type { DatabaseSchema } from "../database/types.js";
import { isUuid, safeErrorCode } from "../foundation.js";
import { PostgresJobQueue } from "../jobs/queue.js";
import { PolicyInputError, PolicyService, type PolicyDraft } from "../policy/service.js";
import {
  GoogleOAuthError,
  GoogleOAuthService
} from "../providers/google/oauth.js";
import {
  PlanningInputError,
  PlanningService
} from "../planning/service.js";
import {
  ConflictResponseService
} from "../conflict-response/service.js";
import {
  ConflictResponseInputError,
  parseConflictResponseDraft
} from "../conflict-response/validation.js";

export interface ApiDependencies {
  readonly config: ServerConfig;
  readonly db: Kysely<DatabaseSchema>;
  readonly sessions: Pick<SessionService, "exchangeBootstrapToken" | "authenticate" | "revoke">;
  readonly apiTokens?: Pick<ApiTokenService, "authenticate" | "issue" | "list" | "revoke">;
  readonly policies: Pick<PolicyService, "preview" | "activate" | "list" | "setPaused" | "retryBlocked" | "requestReconcile">;
  readonly googleOAuth?: Pick<GoogleOAuthService, "begin" | "complete">;
  readonly planning?: Pick<PlanningService,
    | "preview"
    | "activate"
    | "list"
    | "listSuggestions"
    | "resolveSuggestion"
    | "setPaused"
    | "requestReplan"
    | "remove"
  >;
  readonly conflictResponses?: Pick<ConflictResponseService,
    | "preview"
    | "activate"
    | "list"
    | "setPaused"
    | "requestReconcile"
    | "remove"
  >;
  readonly webRoot?: string;
}

export async function buildApi(dependencies: ApiDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: dependencies.config.environment === "test" ? false : {
      level: dependencies.config.environment === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.url",
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
          "body.token",
          "body.code",
          "query.code",
          "query.state"
        ],
        censor: "[redacted]"
      },
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: safeRequestLogUrl(request.url),
            remoteAddress: request.ip
          };
        }
      }
    },
    bodyLimit: 1_048_576,
    trustProxy: false,
    requestTimeout: 30_000
  });
  await app.register(cookie);
  await app.register(csrfProtection, {
    cookieOpts: {
      httpOnly: true,
      sameSite: "strict",
      secure: dependencies.config.cookieSecure,
      path: "/"
    }
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Planipus Server API", version: "0.1.0" },
      servers: [{ url: dependencies.config.publicUrl.origin }]
    }
  });

  const metrics = createMetrics();
  const metricStarts = new WeakMap<FastifyRequest, bigint>();
  app.addHook("onRequest", async (request) => {
    metricStarts.set(request, process.hrtime.bigint());
  });
  app.addHook("onResponse", async (request, reply) => {
    metrics.requests.inc({
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      status: String(reply.statusCode)
    });
    const started = metricStarts.get(request);
    if (started !== undefined) {
      metrics.duration.observe(
        { method: request.method, route: request.routeOptions.url ?? "unmatched" },
        Number(process.hrtime.bigint() - started) / 1_000_000_000
      );
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const apiResponse = request.url === "/api" || request.url.startsWith("/api/");
    if (apiResponse) {
      reply.header("cache-control", "no-store");
      reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    } else {
      reply.header(
        "content-security-policy",
        "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'"
      );
    }
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    return payload;
  });

  type AuthenticatedActor =
    | {
      readonly kind: "browser_session";
      readonly principalId: string;
      readonly organizationId: string;
      readonly session: AuthenticatedSession;
    }
    | {
      readonly kind: "api_token";
      readonly principalId: string;
      readonly organizationId: string;
      readonly token: AuthenticatedApiToken;
    };
  const authenticatedSessions = new WeakMap<FastifyRequest, AuthenticatedSession>();
  const authenticatedActors = new WeakMap<FastifyRequest, AuthenticatedActor>();
  const bootstrapAttempts = new Map<string, { count: number; resetAt: number }>();
  const actorRequests = new Map<string, { count: number; resetAt: number }>();
  const requireSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.headers.authorization !== undefined) {
      const mixed = request.cookies[SESSION_COOKIE] !== undefined;
      await reply.code(mixed ? 400 : 401).send(errorDocument(
        mixed ? "ambiguous_credentials" : "browser_session_required",
        request.id
      ));
      return;
    }
    const session = await dependencies.sessions.authenticate(request.cookies[SESSION_COOKIE]);
    if (!session) {
      await reply.code(401).send(errorDocument("authentication_required", request.id));
      return;
    }
    authenticatedSessions.set(request, session);
    authenticatedActors.set(request, {
      kind: "browser_session",
      principalId: session.principalId,
      organizationId: session.organizationId,
      session
    });
  };
  const requireOrigin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.headers.origin !== dependencies.config.publicUrl.origin) {
      await reply.code(403).send(errorDocument("origin_rejected", request.id));
    }
  };
  const sessionFor = (request: FastifyRequest): AuthenticatedSession => {
    const session = authenticatedSessions.get(request);
    if (!session) {
      throw new Error("authenticated session was not installed");
    }
    return session;
  };
  const actorFor = (request: FastifyRequest): AuthenticatedActor => {
    const actor = authenticatedActors.get(request);
    if (!actor) throw new Error("authenticated actor was not installed");
    return actor;
  };
  const actorTokenId = (actor: AuthenticatedActor): string | null =>
    actor.kind === "api_token" ? actor.token.tokenId : null;
  const requireActor = (scope: ApiTokenScope) => async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      if (request.cookies[SESSION_COOKIE] !== undefined) {
        await reply.code(400).send(errorDocument("ambiguous_credentials", request.id));
        return;
      }
      const candidate = bearerCredential(authorization);
      const token = candidate ? await dependencies.apiTokens?.authenticate(candidate) : null;
      if (!token) {
        reply.header("www-authenticate", "Bearer");
        await reply.code(401).send(errorDocument("authentication_required", request.id));
        return;
      }
      if (!hasApiScope(token.scopes, scope)) {
        await reply.code(403).send(errorDocument("insufficient_scope", request.id));
        return;
      }
      authenticatedActors.set(request, {
        kind: "api_token",
        principalId: token.principalId,
        organizationId: token.organizationId,
        token
      });
      await enforceActorRateLimit(request, reply, scope);
      return;
    }
    await requireSession(request, reply);
    if (!reply.sent) await enforceActorRateLimit(request, reply, scope);
  };
  const enforceActorRateLimit = async (
    request: FastifyRequest,
    reply: FastifyReply,
    scope: ApiTokenScope
  ): Promise<void> => {
    const actor = actorFor(request);
    const identity = actor.kind === "api_token" ? actor.token.tokenId : actor.session.sessionId;
    const rule = scope === "propose"
      ? { maximum: 30, windowMilliseconds: 10 * 60_000 }
      : scope === "apply"
        ? { maximum: 120, windowMilliseconds: 60_000 }
        : { maximum: 600, windowMilliseconds: 60_000 };
    const key = `${scope}:${actor.organizationId}:${actor.kind}:${identity}`;
    const now = Date.now();
    const current = actorRequests.get(key);
    const next = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + rule.windowMilliseconds }
      : { count: current.count + 1, resetAt: current.resetAt };
    actorRequests.set(key, next);
    if (actorRequests.size > 10_000) {
      for (const [candidate, value] of actorRequests) {
        if (value.resetAt <= now) actorRequests.delete(candidate);
      }
    }
    if (next.count > rule.maximum) {
      reply.header("retry-after", String(Math.max(1, Math.ceil((next.resetAt - now) / 1_000))));
      await reply.code(429).send(errorDocument("api_rate_limited", request.id));
    }
  };
  const mutationOriginAndCsrf = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    if (request.headers.authorization !== undefined) return;
    await requireOrigin(request, reply);
    if (!reply.sent) app.csrfProtection(request, reply, () => undefined);
  };
  const protectedProposal = {
    onRequest: mutationOriginAndCsrf,
    preHandler: requireActor("propose")
  };
  const protectedApply = {
    onRequest: mutationOriginAndCsrf,
    preHandler: requireActor("apply")
  };
  const protectedRead = { preHandler: requireActor("read") };
  const protectedMutation = {
    onRequest: [requireOrigin, app.csrfProtection],
    preHandler: requireSession
  };

  app.get("/api/health/live", async () => ({ status: "ok" }));
  app.get("/api/health/startup", async () => ({ status: "ok" }));
  app.get("/api/health/ready", async (_request, reply) => {
    try {
      await dependencies.db.selectFrom("organizations").select("id").limit(1).execute();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  app.get("/api/metrics", { preHandler: requireSession }, async (_request, reply) => {
    reply.type(metrics.registry.contentType);
    return metrics.registry.metrics();
  });
  app.get("/api/openapi.json", async () => app.swagger());

  app.post<{ Body: { token?: unknown } }>(
    "/api/v1/session/bootstrap",
    { onRequest: requireOrigin },
    async (request, reply) => {
      const attempt = bootstrapAttempts.get(request.ip);
      if (attempt && attempt.resetAt > Date.now() && attempt.count >= 5) {
        reply.header("retry-after", String(Math.ceil((attempt.resetAt - Date.now()) / 1_000)));
        return reply.code(429).send(errorDocument("bootstrap_rate_limited", request.id));
      }
      if (typeof request.body?.token !== "string") {
        return reply.code(400).send(errorDocument("invalid_request", request.id));
      }
      const session = await dependencies.sessions.exchangeBootstrapToken(request.body.token);
      if (!session) {
        const now = Date.now();
        const current = bootstrapAttempts.get(request.ip);
        bootstrapAttempts.set(request.ip, current && current.resetAt > now
          ? { count: current.count + 1, resetAt: current.resetAt }
          : { count: 1, resetAt: now + 15 * 60_000 });
        return reply.code(401).send(errorDocument("bootstrap_rejected", request.id));
      }
      bootstrapAttempts.delete(request.ip);
      reply.setCookie(SESSION_COOKIE, session.token, {
        path: "/",
        httpOnly: true,
        secure: dependencies.config.cookieSecure,
        sameSite: "strict",
        expires: session.expiresAt
      });
      return reply.code(201).send({ expires_at: session.expiresAt.toISOString() });
    }
  );
  app.get("/api/v1/session", { preHandler: requireSession }, async (request, reply) => {
    const session = sessionFor(request);
    return {
      principal_id: session.principalId,
      organization_id: session.organizationId,
      expires_at: session.expiresAt.toISOString(),
      csrf_token: await reply.generateCsrf()
    };
  });
  app.delete("/api/v1/session", protectedMutation, async (request, reply) => {
    await dependencies.sessions.revoke(sessionFor(request).sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/api/v1/auth/context", protectedRead, async (request) => {
    const actor = actorFor(request);
    return {
      actor_kind: actor.kind,
      principal_id: actor.principalId,
      organization_id: actor.organizationId,
      scopes: actor.kind === "api_token" ? actor.token.scopes : ["read", "propose", "apply"]
    };
  });
  app.get("/api/v1/api-tokens", { preHandler: requireSession }, async (request, reply) => {
    if (!dependencies.apiTokens) {
      return reply.code(503).send(errorDocument("api_tokens_unavailable", request.id));
    }
    const session = sessionFor(request);
    return dependencies.apiTokens.list(session.organizationId, session.principalId);
  });
  app.post<{ Body: unknown }>("/api/v1/api-tokens", protectedMutation, async (request, reply) => {
    if (!dependencies.apiTokens) {
      return reply.code(503).send(errorDocument("api_tokens_unavailable", request.id));
    }
    if (!hasOnlyKeys(request.body, ["label", "scopes", "expires_in_days"])) {
      return reply.code(400).send(errorDocument("invalid_api_token", request.id));
    }
    const session = sessionFor(request);
    const issued = await dependencies.apiTokens.issue(session.organizationId, session.principalId, {
      label: request.body["label"],
      scopes: request.body["scopes"],
      expires_in_days: request.body["expires_in_days"]
    });
    return reply.code(201).send({
      id: issued.tokenId,
      label: issued.label,
      token: issued.token,
      scopes: issued.scopes,
      expires_at: issued.expiresAt.toISOString()
    });
  });
  app.delete<{ Params: { id: string } }>(
    "/api/v1/api-tokens/:id",
    protectedMutation,
    async (request, reply) => {
      if (!dependencies.apiTokens) {
        return reply.code(503).send(errorDocument("api_tokens_unavailable", request.id));
      }
      if (!isUuid(request.params.id)) {
        return reply.code(400).send(errorDocument("invalid_api_token", request.id));
      }
      const session = sessionFor(request);
      await dependencies.apiTokens.revoke(session.organizationId, session.principalId, request.params.id);
      return reply.code(204).send();
    }
  );

  app.get("/api/v1/connections", protectedRead, async (request) => {
    const actor = actorFor(request);
    return dependencies.db
      .selectFrom("provider_connections")
      .select([
        "id",
        "provider",
        "display_label",
        "intended_role",
        "email_masked",
        "status",
        "last_success_at",
        "safe_error_code",
        "updated_at"
      ])
      .where("organization_id", "=", actor.organizationId)
      .orderBy("created_at", "asc")
      .execute();
  });
  app.post<{ Body: { label?: unknown; role?: unknown } }>(
    "/api/v1/connections/google/authorize",
    protectedMutation,
    async (request, reply) => {
      if (!dependencies.googleOAuth) {
        return reply.code(503).send(errorDocument("google_not_configured", request.id));
      }
      if (
        typeof request.body?.label !== "string"
        || (
          request.body.role !== "availability"
          && request.body.role !== "source"
          && request.body.role !== "destination"
          && request.body.role !== "both"
        )
      ) {
        return reply.code(400).send(errorDocument("invalid_connection_intent", request.id));
      }
      const session = sessionFor(request);
      const authorization = await dependencies.googleOAuth.begin(
        session.organizationId,
        session.principalId,
        { label: request.body.label, role: request.body.role }
      );
      return {
        authorization_url: authorization.authorizationUrl,
        expires_at: authorization.expiresAt.toISOString()
      };
    }
  );
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/v1/connections/google/callback",
    async (request, reply) => {
      if (!dependencies.googleOAuth) {
        return reply.code(503).send(errorDocument("google_not_configured", request.id));
      }
      if (request.query.error) {
        return reply.code(400).send(errorDocument("oauth_denied", request.id));
      }
      if (!request.query.code || !request.query.state) {
        return reply.code(400).send(errorDocument("oauth_callback_invalid", request.id));
      }
      const completed = await dependencies.googleOAuth.complete(request.query.code, request.query.state);
      request.log.info({ connection_id: completed.connectionId }, "Google connection completed");
      return reply.code(303).header("location", "/").send();
    }
  );
  app.get("/api/v1/calendars", protectedRead, async (request) => {
    const actor = actorFor(request);
    return dependencies.db
      .selectFrom("calendar_endpoints")
      .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
      .select([
        "calendar_endpoints.id",
        "calendar_endpoints.connection_id",
        "calendar_endpoints.name",
        "calendar_endpoints.timezone",
        "calendar_endpoints.readable",
        "calendar_endpoints.writable",
        "calendar_endpoints.capabilities",
        "calendar_endpoints.primary_calendar",
        "provider_connections.provider",
        "provider_connections.intended_role",
        "provider_connections.email_masked as account"
      ])
      .where("calendar_endpoints.organization_id", "=", actor.organizationId)
      .orderBy("provider_connections.created_at", "asc")
      .orderBy("calendar_endpoints.name", "asc")
      .execute();
  });
  app.get("/api/v1/overview", protectedRead, async (request) => {
    return buildOverviewDocument(dependencies.db, actorFor(request).organizationId);
  });

  app.get("/api/v1/capabilities", protectedRead, async () => ({
    calendar_bridges: "alpha",
    availability_protection: dependencies.planning ? "alpha" : "unavailable",
    smart_meetings: dependencies.planning ? "alpha" : "unavailable",
    conflict_auto_decline: dependencies.conflictResponses ? "alpha" : "unavailable",
    conflict_auto_decline_provider_writes: dependencies.conflictResponses
      ? dependencies.config.providerMode === "fake"
        || dependencies.config.experimentalGoogleInvitationDecline === true
      : false,
    conflict_decline_message_delivery: dependencies.config.providerMode === "fake"
      ? "simulated"
      : "unverified_google",
    api_server: "alpha",
    mcp_server: "alpha"
  }));

  app.post<{ Body: unknown }>("/api/v1/planning/preview", protectedMutation, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    const session = sessionFor(request);
    return dependencies.planning.preview(session.organizationId, session.principalId, request.body);
  });
  app.post<{ Body: { preview_token?: unknown } }>("/api/v1/planning/rules", protectedMutation, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    if (typeof request.body?.preview_token !== "string") {
      return reply.code(400).send(errorDocument("invalid_request", request.id));
    }
    const session = sessionFor(request);
    const rule = await dependencies.planning.activate(
      session.organizationId,
      session.principalId,
      request.body.preview_token
    );
    return reply.code(201).send(rule);
  });
  app.get("/api/v1/planning/rules", { preHandler: requireSession }, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    return dependencies.planning.list(sessionFor(request).organizationId);
  });
  app.post<{ Params: { id: string } }>("/api/v1/planning/rules/:id/pause", protectedMutation, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    const session = sessionFor(request);
    await dependencies.planning.setPaused(session.organizationId, session.principalId, request.params.id, true);
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>("/api/v1/planning/rules/:id/resume", protectedMutation, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    const session = sessionFor(request);
    await dependencies.planning.setPaused(session.organizationId, session.principalId, request.params.id, false);
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>("/api/v1/planning/rules/:id/replan", protectedMutation, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    const job = await dependencies.planning.requestReplan(sessionFor(request).organizationId, request.params.id);
    return reply.code(202).send({ enqueued: job !== null, job_id: job });
  });
  app.delete<{ Params: { id: string } }>("/api/v1/planning/rules/:id", protectedMutation, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    const session = sessionFor(request);
    await dependencies.planning.remove(session.organizationId, session.principalId, request.params.id);
    return reply.code(204).send();
  });
  app.get("/api/v1/planning/suggestions", { preHandler: requireSession }, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    return dependencies.planning.listSuggestions(sessionFor(request).organizationId);
  });
  app.post<{ Params: { id: string } }>("/api/v1/planning/suggestions/:id/accept", protectedMutation, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    const session = sessionFor(request);
    await dependencies.planning.resolveSuggestion(session.organizationId, session.principalId, request.params.id, "accept");
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>("/api/v1/planning/suggestions/:id/dismiss", protectedMutation, async (request, reply) => {
    if (!dependencies.planning) return reply.code(503).send(errorDocument("planning_unavailable", request.id));
    const session = sessionFor(request);
    await dependencies.planning.resolveSuggestion(session.organizationId, session.principalId, request.params.id, "dismiss");
    return reply.code(204).send();
  });

  app.get("/api/v1/conflict-response/rules", protectedRead, async (request, reply) => {
    if (!dependencies.conflictResponses) {
      return reply.code(503).send(errorDocument("conflict_response_unavailable", request.id));
    }
    return dependencies.conflictResponses.list(actorFor(request).organizationId);
  });
  app.post<{ Body: unknown }>(
    "/api/v1/conflict-response/preview",
    protectedProposal,
    async (request, reply) => {
      if (!dependencies.conflictResponses) {
        return reply.code(503).send(errorDocument("conflict_response_unavailable", request.id));
      }
      const actor = actorFor(request);
      const draft = parseConflictResponseDraft(request.body);
      return dependencies.conflictResponses.preview(
        actor.organizationId,
        actor.principalId,
        draft
      );
    }
  );
  app.post<{ Body: { preview_token?: unknown } }>(
    "/api/v1/conflict-response/rules",
    protectedApply,
    async (request, reply) => {
      if (!dependencies.conflictResponses) {
        return reply.code(503).send(errorDocument("conflict_response_unavailable", request.id));
      }
      if (!isUuid(request.body?.preview_token)) {
        return reply.code(400).send(errorDocument("invalid_request", request.id));
      }
      const actor = actorFor(request);
      const rule = await dependencies.conflictResponses.activate(
        actor.organizationId,
        actor.principalId,
        request.body.preview_token,
        new Date(),
        actor.kind === "api_token" ? "api_token" : "user",
        actorTokenId(actor)
      );
      return reply.code(201).send(rule);
    }
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/conflict-response/rules/:id/pause",
    protectedApply,
    async (request, reply) => {
      if (!dependencies.conflictResponses) {
        return reply.code(503).send(errorDocument("conflict_response_unavailable", request.id));
      }
      if (!isUuid(request.params.id)) {
        return reply.code(400).send(errorDocument("invalid_request", request.id));
      }
      const actor = actorFor(request);
      await dependencies.conflictResponses.setPaused(
        actor.organizationId,
        actor.principalId,
        request.params.id,
        true,
        new Date(),
        actor.kind === "api_token" ? "api_token" : "user",
        actorTokenId(actor)
      );
      return reply.code(204).send();
    }
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/conflict-response/rules/:id/resume",
    protectedApply,
    async (request, reply) => {
      if (!dependencies.conflictResponses) {
        return reply.code(503).send(errorDocument("conflict_response_unavailable", request.id));
      }
      if (!isUuid(request.params.id)) {
        return reply.code(400).send(errorDocument("invalid_request", request.id));
      }
      const actor = actorFor(request);
      await dependencies.conflictResponses.setPaused(
        actor.organizationId,
        actor.principalId,
        request.params.id,
        false,
        new Date(),
        actor.kind === "api_token" ? "api_token" : "user",
        actorTokenId(actor)
      );
      return reply.code(204).send();
    }
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/conflict-response/rules/:id/reconcile",
    protectedApply,
    async (request, reply) => {
      if (!dependencies.conflictResponses) {
        return reply.code(503).send(errorDocument("conflict_response_unavailable", request.id));
      }
      if (!isUuid(request.params.id)) {
        return reply.code(400).send(errorDocument("invalid_request", request.id));
      }
      const actor = actorFor(request);
      const job = await dependencies.conflictResponses.requestReconcile(
        actor.organizationId,
        request.params.id,
        actor.principalId,
        new Date(),
        actor.kind === "api_token" ? "api_token" : "user",
        actorTokenId(actor)
      );
      return reply.code(202).send({ enqueued: job !== null, job_id: job });
    }
  );
  app.delete<{ Params: { id: string } }>(
    "/api/v1/conflict-response/rules/:id",
    protectedApply,
    async (request, reply) => {
      if (!dependencies.conflictResponses) {
        return reply.code(503).send(errorDocument("conflict_response_unavailable", request.id));
      }
      if (!isUuid(request.params.id)) {
        return reply.code(400).send(errorDocument("invalid_request", request.id));
      }
      const actor = actorFor(request);
      await dependencies.conflictResponses.remove(
        actor.organizationId,
        actor.principalId,
        request.params.id,
        new Date(),
        actor.kind === "api_token" ? "api_token" : "user",
        actorTokenId(actor)
      );
      return reply.code(204).send();
    }
  );

  app.post<{ Body: unknown }>("/api/v1/policies/preview", protectedProposal, async (request, reply) => {
    const draft = parsePolicyDraft(request.body);
    if (!draft) {
      return reply.code(400).send(errorDocument("invalid_policy", request.id));
    }
    const actor = actorFor(request);
    return dependencies.policies.preview(actor.organizationId, actor.principalId, draft);
  });
  app.post<{ Body: { preview_token?: unknown } }>("/api/v1/policies", protectedApply, async (request, reply) => {
    if (!isUuid(request.body?.preview_token)) {
      return reply.code(400).send(errorDocument("invalid_request", request.id));
    }
    const actor = actorFor(request);
    const policy = await dependencies.policies.activate(
      actor.organizationId,
      actor.principalId,
      request.body.preview_token,
      actor.kind === "api_token" ? "api_token" : "user",
      actorTokenId(actor)
    );
    return reply.code(201).send(policy);
  });
  app.get("/api/v1/policies", protectedRead, async (request) => {
    return dependencies.policies.list(actorFor(request).organizationId);
  });
  app.post<{ Params: { id: string } }>("/api/v1/policies/:id/pause", protectedApply, async (request, reply) => {
    if (!isUuid(request.params.id)) {
      return reply.code(400).send(errorDocument("invalid_request", request.id));
    }
    const actor = actorFor(request);
    await dependencies.policies.setPaused(
      actor.organizationId,
      actor.principalId,
      request.params.id,
      true,
      actor.kind === "api_token" ? "api_token" : "user",
      actorTokenId(actor)
    );
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>("/api/v1/policies/:id/resume", protectedApply, async (request, reply) => {
    if (!isUuid(request.params.id)) {
      return reply.code(400).send(errorDocument("invalid_request", request.id));
    }
    const actor = actorFor(request);
    await dependencies.policies.setPaused(
      actor.organizationId,
      actor.principalId,
      request.params.id,
      false,
      actor.kind === "api_token" ? "api_token" : "user",
      actorTokenId(actor)
    );
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>("/api/v1/policies/:id/recover", protectedApply, async (request, reply) => {
    if (!isUuid(request.params.id)) {
      return reply.code(400).send(errorDocument("invalid_request", request.id));
    }
    const actor = actorFor(request);
    const retried = await dependencies.policies.retryBlocked(
      actor.organizationId,
      actor.principalId,
      request.params.id,
      actor.kind === "api_token" ? "api_token" : "user",
      actorTokenId(actor)
    );
    return reply.code(202).send({ retried });
  });
  app.post<{ Params: { id: string } }>("/api/v1/policies/:id/reconcile", protectedApply, async (request, reply) => {
    if (!isUuid(request.params.id)) {
      return reply.code(400).send(errorDocument("invalid_request", request.id));
    }
    const actor = actorFor(request);
    const job = await dependencies.policies.requestReconcile(
      actor.organizationId,
      request.params.id,
      actor.principalId,
      actor.kind === "api_token" ? "api_token" : "user",
      actorTokenId(actor)
    );
    return reply.code(202).send({ enqueued: job !== null, job_id: job });
  });
  app.post("/api/v1/sync", protectedMutation, async (request, reply) => {
    const organizationId = sessionFor(request).organizationId;
    const queue = new PostgresJobQueue(dependencies.db);
    const result = await dependencies.db.transaction().execute(async (transaction) => {
      const policies = await transaction
        .selectFrom("sync_policies")
        .select(["id", "revision", "source_calendar_id"])
        .where("organization_id", "=", organizationId)
        .where("status", "=", "active")
        .execute();
      const conflictResponseRules = await transaction
        .selectFrom("conflict_response_rules")
        .select(["id", "revision", "response_calendar_id"])
        .where("organization_id", "=", organizationId)
        .where("status", "=", "active")
        .execute();
      const sourceCalendarIds = [...new Set([
        ...policies.map((policy) => policy.source_calendar_id),
        ...conflictResponseRules.map((rule) => rule.response_calendar_id)
      ])];
      const planningRules = await transaction
        .selectFrom("planning_rules")
        .select(["id", "revision"])
        .where("organization_id", "=", organizationId)
        .where("status", "=", "active")
        .execute();
      let enqueued = 0;
      for (const calendarId of sourceCalendarIds) {
        const job = await queue.enqueue(
          organizationId,
          "sync_calendar",
          `calendar:${calendarId}`,
          { calendar_id: calendarId },
          new Date(),
          transaction
        );
        enqueued += job ? 1 : 0;
      }
      for (const policy of policies) {
        const job = await queue.enqueue(
          organizationId,
          "reconcile_policy",
          `policy:${policy.id}:revision:${policy.revision}`,
          { policy_id: policy.id },
          new Date(),
          transaction
        );
        enqueued += job ? 1 : 0;
      }
      for (const rule of planningRules) {
        const job = await queue.enqueue(
          organizationId,
          "reconcile_planning_rule",
          `planning-rule:${rule.id}:revision:${rule.revision}:manual-sync:${Date.now()}`,
          { rule_id: rule.id },
          new Date(),
          transaction
        );
        enqueued += job ? 1 : 0;
      }
      for (const rule of conflictResponseRules) {
        const job = await queue.enqueue(
          organizationId,
          "reconcile_conflict_response_rule",
          `conflict-response-rule:${rule.id}:revision:${rule.revision}:manual-sync:${Date.now()}`,
          { rule_id: rule.id },
          new Date(),
          transaction
        );
        enqueued += job ? 1 : 0;
      }
      return {
        enqueued,
        policies: policies.length,
        calendars: sourceCalendarIds.length,
        planning_rules: planningRules.length,
        conflict_response_rules: conflictResponseRules.length
      };
    });
    return reply.code(202).send(result);
  });
  app.get("/api/v1/health/detail", protectedRead, async (request) => {
    const organizationId = actorFor(request).organizationId;
    const [connections, policies, conflictResponseRules, heldInvitationResponses, deadEffects, deadJobs] = await Promise.all([
      dependencies.db.selectFrom("provider_connections").select(["id", "provider", "email_masked", "status", "safe_error_code", "last_success_at"]).where("organization_id", "=", organizationId).execute(),
      dependencies.db.selectFrom("sync_policies").select(["id", "name", "status", "safe_error_code", "last_success_at"]).where("organization_id", "=", organizationId).where("status", "!=", "deleted").execute(),
      dependencies.db.selectFrom("conflict_response_rules").select(["id", "name", "status", "safe_error_code", "last_success_at"]).where("organization_id", "=", organizationId).where("status", "!=", "deleted").execute(),
      dependencies.db.selectFrom("invitation_response_actions").select(({ fn }) => fn.countAll<number>().as("count")).where("organization_id", "=", organizationId).where("status", "=", "held").executeTakeFirstOrThrow(),
      dependencies.db.selectFrom("outbox_effects").select(({ fn }) => fn.countAll<number>().as("count")).where("organization_id", "=", organizationId).where("state", "=", "dead").executeTakeFirstOrThrow(),
      dependencies.db.selectFrom("scheduled_jobs").select(({ fn }) => fn.countAll<number>().as("count")).where("organization_id", "=", organizationId).where("state", "=", "dead").executeTakeFirstOrThrow()
    ]);
    return {
      connections,
      policies,
      conflict_response_rules: conflictResponseRules,
      queues: {
        held_invitation_responses: Number(heldInvitationResponses.count),
        dead_effects: Number(deadEffects.count),
        dead_jobs: Number(deadJobs.count)
      }
    };
  });

  const webRoot = resolve(dependencies.webRoot ?? resolve(process.cwd(), "web", "dist"));
  app.get("/", async (request, reply) => serveWebIndex(webRoot, request, reply));
  app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    return serveWebAsset(webRoot, request.params["*"], request, reply);
  });
  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (
      (request.method === "GET" || request.method === "HEAD")
      && !path.startsWith("/api/")
      && !path.includes(".")
      && request.headers.accept?.includes("text/html")
    ) {
      return serveWebIndex(webRoot, request, reply);
    }
    return reply.code(404).send(errorDocument("not_found", request.id));
  });

  app.setErrorHandler(async (error, request, reply) => {
    const code = safeErrorCode(error);
    if (error instanceof ApiTokenInputError) {
      const status = error.code === "not_found"
        ? 404
        : error.code === "authorization_required"
          ? 403
          : 400;
      return reply.code(status).send(errorDocument(error.code, request.id));
    }
    if (error instanceof ConflictResponseInputError) {
      if (error.code === "preview_rate_limited") {
        reply.header("retry-after", "60");
        return reply.code(429).send(errorDocument(error.code, request.id));
      }
      const status = error.code === "not_found"
        ? 404
        : error.code === "preview_stale"
          || error.code === "rule_paused"
          || error.code === "copy_policy_conflict"
          || error.code === "response_sync_incomplete"
          || error.code === "invitation_writes_disabled"
          || error.code === "response_rule_conflict"
          || error.code === "availability_copy_feedback"
            ? 409
            : error.retryable
              ? 503
              : 400;
      return reply.code(status).send(errorDocument(error.code, request.id));
    }
    if (error instanceof PolicyInputError) {
      const status = error.code === "not_found"
        ? 404
        : error.code === "preview_stale" || error.code === "no_copy_rule_conflict"
          ? 409
          : 400;
      return reply.code(status).send(errorDocument(error.code, request.id));
    }
    if (error instanceof PlanningInputError) {
      const status = error.code === "not_found" ? 404 : error.code === "preview_stale" ? 409 : 400;
      return reply.code(status).send(errorDocument(error.code, request.id));
    }
    if (error instanceof GoogleOAuthError) {
      const status = error.code === "google_not_configured" ? 503 : 400;
      return reply.code(status).send(errorDocument(error.code, request.id));
    }
    if (error !== null && typeof error === "object" && "statusCode" in error) {
      const statusCode = error.statusCode;
      if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
        const rawCode = "code" in error ? error.code : undefined;
        const clientCode = typeof rawCode === "string" && rawCode.startsWith("FST_CSRF_")
          ? "csrf_invalid"
          : "request_rejected";
        return reply.code(statusCode).send(errorDocument(clientCode, request.id));
      }
    }
    request.log.error({ safe_error_code: code }, "request failed");
    return reply.code(500).send(errorDocument("internal_error", request.id));
  });
  return app;
}

async function buildOverviewDocument(db: Kysely<DatabaseSchema>, organizationId: string): Promise<unknown> {
  const [
    organization,
    connections,
    calendars,
    policies,
    projectionCounts,
    pendingEffects,
    deadEffects,
    deadJobs,
    recentActivity
  ] = await Promise.all([
    db.selectFrom("organizations")
      .select(["name"])
      .where("id", "=", organizationId)
      .executeTakeFirstOrThrow(),
    db.selectFrom("provider_connections")
      .select([
        "id",
        "provider",
        "display_label",
        "intended_role",
        "email_masked",
        "status",
        "last_success_at",
        "safe_error_code",
        "updated_at"
      ])
      .where("organization_id", "=", organizationId)
      .orderBy("created_at", "asc")
      .execute(),
    db.selectFrom("calendar_endpoints")
      .select([
        "id",
        "connection_id",
        "name",
        "timezone",
        "readable",
        "writable",
        "capabilities",
        "primary_calendar"
      ])
      .where("organization_id", "=", organizationId)
      .orderBy("created_at", "asc")
      .execute(),
    db.selectFrom("sync_policies")
      .innerJoin("calendar_endpoints as source", "source.id", "sync_policies.source_calendar_id")
      .innerJoin("provider_connections as source_connection", "source_connection.id", "source.connection_id")
      .innerJoin("calendar_endpoints as destination", "destination.id", "sync_policies.destination_calendar_id")
      .innerJoin("provider_connections as destination_connection", "destination_connection.id", "destination.connection_id")
      .leftJoin("hours_profiles", "hours_profiles.id", "sync_policies.hours_profile_id")
      .select([
        "sync_policies.id",
        "sync_policies.status",
        "sync_policies.safe_error_code",
        "sync_policies.last_success_at",
        "sync_policies.policy_document",
        "source.name as source_calendar",
        "source_connection.display_label as source_label",
        "destination.name as destination_calendar",
        "destination_connection.display_label as destination_label",
        "hours_profiles.name as hours_name"
      ])
      .where("sync_policies.organization_id", "=", organizationId)
      .where("sync_policies.status", "!=", "deleted")
      .orderBy("sync_policies.created_at", "asc")
      .execute(),
    db.selectFrom("projections")
      .select(["policy_id"])
      .select([
        sql<number>`count(*) filter (where destination_event_id is not null)`.as("managed_copy_count"),
        sql<number>`count(*) filter (
          where status in ('held', 'failed') or ownership = 'ambiguous'
        )`.as("attention_count")
      ])
      .where("organization_id", "=", organizationId)
      .groupBy("policy_id")
      .execute(),
    db.selectFrom("outbox_effects")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("organization_id", "=", organizationId)
      .where("state", "in", ["pending", "leased", "retry"])
      .executeTakeFirstOrThrow(),
    db.selectFrom("outbox_effects")
      .select(["policy_id"])
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("organization_id", "=", organizationId)
      .where("state", "=", "dead")
      .groupBy("policy_id")
      .execute(),
    db.selectFrom("scheduled_jobs")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("organization_id", "=", organizationId)
      .where("state", "=", "dead")
      .executeTakeFirstOrThrow(),
    db.selectFrom("audit_facts")
      .select(["id", "action", "reason_code", "created_at"])
      .where("organization_id", "=", organizationId)
      .orderBy("created_at", "desc")
      .limit(12)
      .execute()
  ]);

  const pendingEffectCount = Number(pendingEffects.count);
  const deadEffectCount = deadEffects.reduce((count, row) => count + Number(row.count), 0);
  const deadCount = deadEffectCount + Number(deadJobs.count);
  const managedCopies = new Map(
    projectionCounts.map((row) => [row.policy_id, Number(row.managed_copy_count)])
  );
  const projectionAttention = new Set(
    projectionCounts
      .filter((row) => Number(row.attention_count) > 0)
      .map((row) => row.policy_id)
  );
  const deadEffectPolicies = new Set(deadEffects.map((row) => row.policy_id));
  const connectionProblem = connections.some((connection) => connection.status !== "active" || connection.safe_error_code);
  const policyProblem = policies.some((policy) => policy.safe_error_code
    || projectionAttention.has(policy.id)
    || deadEffectPolicies.has(policy.id));
  const allPaused = policies.length > 0 && policies.every((policy) => policy.status === "paused");
  const status = connectionProblem || policyProblem || deadCount > 0
    ? "attention"
    : pendingEffectCount > 0
      ? "syncing"
      : allPaused
        ? "paused"
        : "current";

  return {
    installation_name: organization.name,
    status,
    last_success_at: latestTimestamp([
      ...connections.map((connection) => connection.last_success_at),
      ...policies.map((policy) => policy.last_success_at)
    ]),
    pending_effect_count: pendingEffectCount,
    connections: connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      display_label: connection.display_label,
      intended_role: connection.intended_role,
      email_masked: connection.email_masked,
      status: connection.status,
      last_success_at: connection.last_success_at ? new Date(connection.last_success_at).toISOString() : null,
      safe_error_code: connection.safe_error_code,
      updated_at: new Date(connection.updated_at).toISOString(),
      calendars: calendars
        .filter((calendar) => calendar.connection_id === connection.id)
        .map((calendar) => ({
          id: calendar.id,
          connection_id: calendar.connection_id,
          name: calendar.name,
          timezone: calendar.timezone,
          readable: calendar.readable,
          writable: calendar.writable,
          capabilities: calendar.capabilities,
          primary_calendar: calendar.primary_calendar
        }))
    })),
    bridges: policies.map((policy) => ({
      id: policy.id,
      source_label: policy.source_label,
      source_calendar: policy.source_calendar,
      destination_label: policy.destination_label,
      destination_calendar: policy.destination_calendar,
      hours_label: policy.hours_name ?? "All times",
      privacy_label: privacyLabel(policy.policy_document),
      status: policy.safe_error_code
        || projectionAttention.has(policy.id)
        || deadEffectPolicies.has(policy.id)
        ? "attention"
        : policy.status === "paused"
          ? "paused"
          : "current",
      managed_copy_count: managedCopies.get(policy.id) ?? 0,
      last_success_at: policy.last_success_at ? new Date(policy.last_success_at).toISOString() : null
    })),
    recent_activity: recentActivity.map((activity) => ({
      id: activity.id,
      message: activityMessage(activity.action),
      reason: activity.reason_code,
      occurred_at: new Date(activity.created_at).toISOString()
    }))
  };
}

async function serveWebIndex(
  webRoot: string,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  try {
    const document = await readFile(resolve(webRoot, "index.html"));
    reply.header("cache-control", "no-cache");
    reply.type("text/html; charset=utf-8");
    return reply.send(request.method === "HEAD" ? "" : document);
  } catch (error) {
    if (isMissingFile(error)) {
      reply.header("cache-control", "no-store");
      return reply.code(404).send(errorDocument("web_not_built", request.id));
    }
    throw error;
  }
}

async function serveWebAsset(
  webRoot: string,
  assetPath: string,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<FastifyReply> {
  const segments = assetPath.split("/");
  if (
    segments.length === 0
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))
  ) {
    return reply.code(404).send(errorDocument("not_found", request.id));
  }
  const assetsRoot = resolve(webRoot, "assets");
  const filePath = resolve(assetsRoot, ...segments);
  if (!filePath.startsWith(`${assetsRoot}${sep}`)) {
    return reply.code(404).send(errorDocument("not_found", request.id));
  }
  try {
    const content = await readFile(filePath);
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.type(staticMimeType(filePath));
    return reply.send(request.method === "HEAD" ? "" : content);
  } catch (error) {
    if (isMissingFile(error)) {
      return reply.code(404).send(errorDocument("not_found", request.id));
    }
    throw error;
  }
}

function staticMimeType(path: string): string {
  const values: Readonly<Record<string, string>> = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };
  return values[extname(path).toLocaleLowerCase("en-US")] ?? "application/octet-stream";
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ((error as Error & { code?: string }).code === "ENOENT"
      || (error as Error & { code?: string }).code === "ENOTDIR");
}

function privacyLabel(document: object): string {
  if (!isRecord(document)) {
    return "Privacy preset";
  }
  const privacy = document["privacy"];
  if (!isRecord(privacy) || typeof privacy["preset"] !== "string") {
    return "Privacy preset";
  }
  const labels: Readonly<Record<string, string>> = {
    busy_only: "Busy only",
    commitment: "Private commitment",
    private_details: "Private details",
    shared_details: "Shared details"
  };
  return labels[privacy["preset"]] ?? "Privacy preset";
}

function activityMessage(action: string): string {
  const messages: Readonly<Record<string, string>> = {
    "policy.activated": "Calendar bridge activated",
    "policy.paused": "Calendar bridge paused",
    "policy.resumed": "Calendar bridge resumed"
  };
  return messages[action] ?? action.split(".").join(" ");
}

function latestTimestamp(values: readonly (Date | string | null)[]): string | null {
  const timestamps = values
    .filter((value): value is Date | string => value !== null)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function bearerCredential(authorization: string): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

function parsePolicyDraft(value: unknown): PolicyDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const draft = value as Record<string, unknown>;
  const hours = draft["hours"];
  const hoursProfileId = draft["hours_profile_id"];
  const inlineHoursProfile = draft["hours_profile"];
  const horizon = draft["horizon"];
  if (
    typeof draft["name"] !== "string"
    || draft["name"].normalize("NFC").trim().length < 1
    || draft["name"].normalize("NFC").trim().length > 120
    || !isUuid(draft["source_calendar_id"])
    || !isUuid(draft["destination_calendar_id"])
    || !isPrivacyPolicy(draft["privacy"])
    || !isSelectionPolicy(draft["selection"])
    || (hours !== undefined && (
      !isRecord(hours)
      || (hours["mode"] !== "all_times"
        && hours["mode"] !== "overlaps_profile"
        && hours["mode"] !== "contained_in_profile")
    ))
    || (hoursProfileId !== undefined && hoursProfileId !== null && !isUuid(hoursProfileId))
    || (inlineHoursProfile !== undefined && !isRecord(inlineHoursProfile))
    || (horizon !== undefined && (
      !isRecord(horizon)
      || !isBoundedDayCount(horizon["past_days"])
      || !isBoundedDayCount(horizon["future_days"])
    ))
  ) {
    return null;
  }
  return value as PolicyDraft;
}

function isPrivacyPolicy(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value["preset"] === "busy_only"
      || value["preset"] === "commitment"
      || value["preset"] === "private_details"
      || value["preset"] === "shared_details")
    && value["preset_version"] === 1
    && typeof value["generic_summary"] === "string"
    && value["generic_summary"].normalize("NFC").trim().length > 0
    && [
      "copy_summary",
      "copy_description",
      "copy_location",
      "copy_conference",
      "copy_attendees",
      "copy_organizer"
    ].every((key) => typeof value[key] === "boolean");
}

function isSelectionPolicy(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value["timed"] === "include" || value["timed"] === "skip")
    && (value["all_day"] === "skip" || value["all_day"] === "busy_only" || value["all_day"] === "all")
    && (value["free_events"] === "skip_when_redacted" || value["free_events"] === "preserve_free" || value["free_events"] === "force_busy")
    && (value["tentative"] === "busy" || value["tentative"] === "free" || value["tentative"] === "omit")
    && (value["unanswered"] === "busy" || value["unanswered"] === "free" || value["unanswered"] === "omit")
    && typeof value["skip_when_destination_identity_invited"] === "boolean"
    && typeof value["source_exclusion_marker"] === "string"
    && Array.isArray(value["manual_exclusions"])
    && value["manual_exclusions"].every((item) => typeof item === "string");
}

function isBoundedDayCount(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 3_650;
}

/** Pino's default request serializer includes the raw URL. OAuth callback
 * secrets live in its query string, so request logs retain only the path. */
export function safeRequestLogUrl(rawUrl: string): string {
  const separators = [rawUrl.indexOf("?"), rawUrl.indexOf("#")].filter((value) => value >= 0);
  const end = separators.length > 0 ? Math.min(...separators) : rawUrl.length;
  return rawUrl.slice(0, end) || "/";
}

function errorDocument(
  code: string,
  requestId: string
): { readonly code: string; readonly message: string; readonly request_id: string } {
  return { code, message: safeMessage(code), request_id: requestId };
}

function safeMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    authentication_required: "Sign in to continue.",
    browser_session_required: "Use the Planipus browser session for this action.",
    ambiguous_credentials: "Use either a browser session or an API token, not both.",
    insufficient_scope: "This API token does not allow that action.",
    api_tokens_unavailable: "API tokens are not available in this installation.",
    invalid_api_token: "The API token settings are invalid.",
    authorization_required: "You are not allowed to perform that action.",
    conflict_response_unavailable: "Private conflict responses are not available in this installation.",
    invalid_conflict_response_rule: "The private conflict response settings are invalid.",
    response_sync_incomplete: "Let the work calendar finish syncing, then preview again.",
    response_calendar_unavailable: "Choose an active work calendar connected for reading and writing.",
    availability_calendar_unavailable: "Choose an active readable availability calendar.",
    availability_scope_missing: "Reconnect this account so Planipus can request Google's free/busy-only permission.",
    same_provider_calendar: "Choose different provider calendars for work responses and private availability.",
    calendar_not_found: "One of the selected calendars is no longer available.",
    copy_policy_conflict: "Pause every active bridge that copies from the selected private calendar before enabling no-copy responses.",
    no_copy_rule_conflict: "A calendar protected for private availability cannot participate in a calendar bridge.",
    connection_role_changed: "Reconnect the calendar with the role required by this bridge, then reconcile it.",
    invitation_writes_disabled: "Enable experimental Google invitation declines before activating this rule.",
    automatic_decline_budget_exceeded: "Planipus held additional declines after reaching the 24-hour safety budget.",
    response_rule_conflict: "This work calendar already has a private conflict response rule.",
    availability_copy_feedback: "Remove inbound bridge copies from this availability calendar before using it for automatic declines.",
    rule_paused: "Resume this private conflict response before reconciling it.",
    freebusy_incomplete: "The calendar provider returned incomplete availability.",
    freebusy_invalid: "The calendar provider returned invalid availability.",
    freebusy_bounds_invalid: "The calendar provider returned availability for the wrong time window.",
    preview_rate_limited: "Too many private conflict previews are still active. Wait for one to expire or activate it.",
    freebusy_too_large: "The calendar provider returned too many availability intervals to evaluate safely.",
    origin_rejected: "The request origin was rejected.",
    bootstrap_rate_limited: "Too many sign-in attempts. Try again later.",
    api_rate_limited: "Too many API requests. Wait briefly and try again.",
    bootstrap_rejected: "The bootstrap token was not accepted.",
    invalid_request: "The request is invalid.",
    invalid_policy: "The sync policy is invalid.",
    invalid_hours_profile: "The work-hours profile is invalid.",
    source_sync_incomplete: "Wait for the source calendar to finish its first sync, then preview again.",
    preview_incomplete: "This preview is too large to confirm safely.",
    invalid_connection_intent: "Choose a label and how this account will be used.",
    csrf_invalid: "The form token is missing or expired.",
    google_not_configured: "Google Calendar is not configured for this installation.",
    oauth_denied: "Google authorization was cancelled.",
    oauth_callback_invalid: "The Google authorization response is invalid.",
    oauth_scope_incomplete: "Google did not grant every requested calendar capability.",
    oauth_scope_overbroad: "Google retained broader calendar access. Revoke the prior grant, then reconnect as availability-only.",
    oauth_scope_unverified: "Google did not report the availability grant. Revoke Planipus access, then reconnect as availability-only.",
    availability_role_change_blocked: "Remove bridges, planning rules, or reply rules that still need this account's event access, then reconnect it as availability-only.",
    preview_stale: "The preview is no longer current.",
    not_found: "The requested item was not found.",
    web_not_built: "The Planipus web app has not been built yet.",
    internal_error: "Planipus could not complete the request."
  };
  return messages[code] ?? "Planipus could not accept the request.";
}

function createMetrics(): {
  readonly registry: Registry;
  readonly requests: Counter<"method" | "route" | "status">;
  readonly duration: Histogram<"method" | "route">;
} {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "planipus_" });
  const requests = new Counter({
    name: "planipus_http_requests_total",
    help: "HTTP requests handled by the Planipus API",
    labelNames: ["method", "route", "status"],
    registers: [registry]
  });
  const duration = new Histogram({
    name: "planipus_http_request_duration_seconds",
    help: "Planipus API request duration",
    labelNames: ["method", "route"],
    registers: [registry],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
  });
  return { registry, requests, duration };
}
