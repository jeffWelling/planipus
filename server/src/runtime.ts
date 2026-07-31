import { SessionService } from "./auth/session.js";
import { ApiTokenService } from "./auth/api-token.js";
import type { Kysely } from "kysely";
import type { SourceObservation } from "@planipus/calendar-sync";

import { loadConfig, type ServerConfig } from "./config.js";
import { createDatabase, type DatabaseHandle } from "./database/client.js";
import { runMigrations } from "./database/migrate.js";
import { runMigrationsWithRetry } from "./database/startup.js";
import type { DatabaseSchema } from "./database/types.js";
import { PolicyService } from "./policy/service.js";
import { sharedPolicyRuntime } from "./policy/runtime.js";
import { FakeCalendarProvider } from "./providers/fake.js";
import { fakeAccessTokenForConnection } from "./providers/fake-token.js";
import { GoogleCalendarProvider } from "./providers/google/calendar.js";
import { GoogleOAuthService, GoogleTokenBroker } from "./providers/google/oauth.js";
import {
  type AccessTokenBroker,
  DatabaseAccessTokenBroker,
  FakeAccessTokenBroker,
  ProviderRouter
} from "./providers/router.js";
import type { CalendarProvider } from "./providers/types.js";
import { CalendarSyncCoordinator } from "./sync/coordinator.js";
import { EffectExecutor } from "./sync/effects.js";
import { NoticeService } from "./sync/notices.js";
import { PlanningCoordinator } from "./planning/coordinator.js";
import { PlanningService } from "./planning/service.js";
import { ConflictResponseService } from "./conflict-response/service.js";
import { ConflictResponseCoordinator } from "./conflict-response/coordinator.js";
import { ConflictPrivacyHasher } from "./conflict-response/privacy-hash.js";

export interface ServerRuntime {
  readonly config: ServerConfig;
  readonly database: DatabaseHandle;
  readonly sessions: SessionService;
  readonly apiTokens: ApiTokenService;
  readonly policies: PolicyService;
  readonly notices: NoticeService;
  readonly googleOAuth?: GoogleOAuthService;
  readonly fakeProvider: FakeCalendarProvider;
  readonly coordinator: CalendarSyncCoordinator;
  readonly effects: EffectExecutor;
  readonly planning: PlanningService;
  readonly planningCoordinator: PlanningCoordinator;
  readonly conflictResponses: ConflictResponseService;
  readonly conflictResponseCoordinator: ConflictResponseCoordinator;
  close(): Promise<void>;
}

export interface ProviderServices {
  readonly providers: ProviderRouter;
  readonly tokens: DatabaseAccessTokenBroker;
  readonly googleOAuth?: GoogleOAuthService;
}

export interface GoogleServiceFactories {
  createCalendarProvider(): CalendarProvider;
  createTokenBroker(db: Kysely<DatabaseSchema>, config: ServerConfig): AccessTokenBroker;
  createOAuthService(db: Kysely<DatabaseSchema>, config: ServerConfig): GoogleOAuthService;
}

export function planningProviderWritesEnabled(config: ServerConfig): boolean {
  return config.providerMode === "fake" || config.experimentalGooglePlanning === true;
}

export function invitationDeclineProviderWritesEnabled(config: ServerConfig): boolean {
  return config.providerMode === "fake"
    || config.experimentalGoogleInvitationDecline === true;
}

const defaultGoogleServiceFactories: GoogleServiceFactories = {
  createCalendarProvider: () => new GoogleCalendarProvider(),
  createTokenBroker: (db, config) => new GoogleTokenBroker(db, config),
  createOAuthService: (db, config) => new GoogleOAuthService(db, config)
};

/**
 * Assemble the provider boundary with PLANIPUS_PROVIDER_MODE as a fail-closed
 * capability switch. In fake mode no Google client is constructed, and stale
 * Google rows in the database cannot recover a network-capable route.
 */
export function createProviderServices(
  config: ServerConfig,
  db: Kysely<DatabaseSchema>,
  fakeProvider: FakeCalendarProvider,
  googleFactories: GoogleServiceFactories = defaultGoogleServiceFactories
): ProviderServices {
  if (config.providerMode === "fake") {
    return {
      providers: new ProviderRouter(undefined, fakeProvider),
      tokens: new DatabaseAccessTokenBroker(db, undefined, new FakeAccessTokenBroker())
    };
  }

  const googleProvider = googleFactories.createCalendarProvider();
  const googleTokens = googleFactories.createTokenBroker(db, config);
  return {
    providers: new ProviderRouter(googleProvider, fakeProvider),
    tokens: new DatabaseAccessTokenBroker(db, googleTokens, new FakeAccessTokenBroker()),
    googleOAuth: googleFactories.createOAuthService(db, config)
  };
}

export async function createRuntime(
  env: NodeJS.ProcessEnv = process.env,
  migrate = true
): Promise<ServerRuntime> {
  const config = loadConfig(env);
  const database = createDatabase(config.databaseUrl);
  try {
    if (migrate) {
      await runMigrationsWithRetry(
        async () => runMigrations(database.pool, config.migrationsDirectory),
        { attempts: config.migrationAttempts }
      );
    }
    const fakeProvider = new FakeCalendarProvider();
    await hydrateFakeProvider(database.db, fakeProvider);
    const providerServices = createProviderServices(config, database.db, fakeProvider);
    const sessions = new SessionService(database.db, config);
    const apiTokens = new ApiTokenService(database.db);
    const policies = new PolicyService(database.db, sharedPolicyRuntime);
    const notices = new NoticeService(database.db, sharedPolicyRuntime);
    const coordinator = new CalendarSyncCoordinator(
      database.db,
      sharedPolicyRuntime,
      providerServices.providers,
      providerServices.tokens
    );
    const effects = new EffectExecutor(
      database.db,
      providerServices.providers,
      providerServices.tokens
    );
    const planning = new PlanningService(database.db, sharedPolicyRuntime);
    const conflictPrivacyHasher = new ConflictPrivacyHasher(config.masterKey);
    const planningCoordinator = new PlanningCoordinator(
      database.db,
      sharedPolicyRuntime,
      providerServices.providers,
      providerServices.tokens,
      planningProviderWritesEnabled(config)
    );
    const conflictResponses = new ConflictResponseService(
      database.db,
      sharedPolicyRuntime,
      conflictPrivacyHasher,
      providerServices.providers,
      providerServices.tokens,
      {
        providerWritesEnabled: invitationDeclineProviderWritesEnabled(config),
        messageDelivery: config.providerMode === "fake" ? "simulated" : "unverified_google"
      }
    );
    const conflictResponseCoordinator = new ConflictResponseCoordinator(
      database.db,
      sharedPolicyRuntime,
      conflictPrivacyHasher,
      providerServices.providers,
      providerServices.tokens,
      invitationDeclineProviderWritesEnabled(config)
    );
    return {
      config,
      database,
      sessions,
      apiTokens,
      policies,
      notices,
      ...(providerServices.googleOAuth ? { googleOAuth: providerServices.googleOAuth } : {}),
      fakeProvider,
      coordinator,
      effects,
      planning,
      planningCoordinator,
      conflictResponses,
      conflictResponseCoordinator,
      async close(): Promise<void> {
        conflictPrivacyHasher.destroy();
        config.masterKey.fill(0);
        await database.close();
      }
    };
  } catch (error) {
    config.masterKey.fill(0);
    await database.close();
    throw error;
  }
}

async function hydrateFakeProvider(
  db: Kysely<DatabaseSchema>,
  provider: FakeCalendarProvider
): Promise<void> {
  const calendars = await db.selectFrom("calendar_endpoints")
    .innerJoin("provider_connections", "provider_connections.id", "calendar_endpoints.connection_id")
    .select([
      "calendar_endpoints.id",
      "calendar_endpoints.connection_id",
      "calendar_endpoints.remote_id",
      "calendar_endpoints.name",
      "calendar_endpoints.timezone",
      "calendar_endpoints.access_role",
      "calendar_endpoints.readable",
      "calendar_endpoints.writable",
      "calendar_endpoints.primary_calendar"
    ])
    .where("provider_connections.provider", "=", "fake")
    .execute();
  for (const calendar of calendars) {
    const accessToken = fakeAccessTokenForConnection(calendar.connection_id);
    provider.addCalendar({
      remoteId: calendar.remote_id,
      name: calendar.name,
      timezone: calendar.timezone,
      accessRole: calendar.access_role,
      readable: calendar.readable,
      writable: calendar.writable,
      primary: calendar.primary_calendar
    }, accessToken);
    const observations = await db.selectFrom("source_observations")
      .select("normalized_event")
      .where("calendar_endpoint_id", "=", calendar.id)
      .where("tombstone", "=", false)
      .orderBy("remote_event_id", "asc")
      .orderBy("recurrence_identity", "asc")
      .execute();
    const normalized = observations
      .map((row) => row.normalized_event as unknown as SourceObservation);
    provider.setObservations(calendar.remote_id, normalized, accessToken);
    provider.setFreeBusy(
      calendar.remote_id,
      normalized.flatMap((observation) => fakeBusyInterval(observation)),
      accessToken
    );
    for (const observation of normalized) {
      if (
        observation.relationship.role !== "attendee"
        || observation.relationship.response === "not_applicable"
      ) continue;
      const revision = Number(observation.remote_revision);
      provider.setInvitation(calendar.remote_id, observation.source_event_ref, {
        organizerSelf: false,
        selfAttendeeEmail: "self@example.invalid",
        cancelled: observation.lifecycle !== "confirmed",
        responseStatus: observation.relationship.response,
        comment: observation.relationship.response_note ?? "",
        revision: Number.isSafeInteger(revision) && revision > 0 ? revision : 1
      }, accessToken);
    }
  }
}

function fakeBusyInterval(
  observation: SourceObservation
): readonly { readonly start: string; readonly end: string }[] {
  if (
    observation.lifecycle !== "confirmed"
    || observation.availability === "free"
    || observation.timing?.kind !== "timed"
  ) return [];
  return [{
    start: observation.timing.start_instant,
    end: observation.timing.end_instant
  }];
}
