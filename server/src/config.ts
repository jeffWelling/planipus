import { readFileSync } from "node:fs";

export type ProviderMode = "fake" | "google";

export interface ServerConfig {
  readonly environment: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly publicUrl: URL;
  readonly databaseUrl: string;
  readonly masterKey: Buffer;
  readonly masterKeyId: string;
  readonly bootstrapToken: string;
  readonly cookieSecure: boolean;
  readonly sessionTtlSeconds: number;
  readonly providerMode: ProviderMode;
  readonly googleClientId: string | null;
  readonly googleClientSecret: string | null;
  readonly experimentalGooglePlanning?: boolean;
  readonly experimentalGoogleInvitationDecline?: boolean;
  readonly migrationsDirectory: string;
  readonly migrationAttempts: number;
  readonly schedulerIntervalMs: number;
  readonly workerIntervalMs: number;
  readonly jobLeaseSeconds: number;
}

export class ConfigurationError extends Error {
  public constructor(public readonly problems: readonly string[]) {
    super(`Invalid Planipus Server configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigurationError";
  }
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  problems: string[]
): number {
  const raw = env[name];
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    problems.push(`${name} must be an integer from ${minimum} through ${maximum}`);
    return fallback;
  }
  return parsed;
}

function required(env: NodeJS.ProcessEnv, name: string, problems: string[]): string {
  const value = env[name]?.trim();
  if (!value) {
    problems.push(`${name} is required`);
    return "";
  }
  return value;
}

function parseMasterKey(env: NodeJS.ProcessEnv, problems: string[]): Buffer {
  const file = env["PLANIPUS_MASTER_KEY_FILE"]?.trim();
  const encoded = file ? readFileSync(file, "utf8").trim() : env["PLANIPUS_MASTER_KEY"]?.trim();
  if (!encoded) {
    problems.push("PLANIPUS_MASTER_KEY_FILE or PLANIPUS_MASTER_KEY is required");
    return Buffer.alloc(32);
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "")) {
    problems.push("the master key must be exactly 32 random bytes encoded as base64");
    return Buffer.alloc(32);
  }
  return key;
}

function parseEnvironment(value: string | undefined, problems: string[]): ServerConfig["environment"] {
  const environment = value ?? "development";
  if (environment !== "development" && environment !== "test" && environment !== "production") {
    problems.push("NODE_ENV must be development, test, or production");
    return "development";
  }
  return environment;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const problems: string[] = [];
  const environment = parseEnvironment(env["NODE_ENV"], problems);
  const publicUrlText = required(env, "PLANIPUS_PUBLIC_URL", problems);
  let publicUrl: URL;
  try {
    publicUrl = new URL(publicUrlText || "http://127.0.0.1:8080");
  } catch {
    problems.push("PLANIPUS_PUBLIC_URL must be an absolute URL");
    publicUrl = new URL("http://127.0.0.1:8080");
  }
  if (publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) {
    problems.push("PLANIPUS_PUBLIC_URL must contain only scheme, host, and optional port");
  }
  const isLoopback = publicUrl.hostname === "localhost" || publicUrl.hostname === "127.0.0.1" || publicUrl.hostname === "::1";
  if (environment === "production" && publicUrl.protocol !== "https:") {
    problems.push("PLANIPUS_PUBLIC_URL must use HTTPS in production");
  }
  if (publicUrl.protocol !== "https:" && !isLoopback) {
    problems.push("plain HTTP is allowed only for a loopback development URL");
  }

  const bootstrapToken = required(env, "PLANIPUS_BOOTSTRAP_TOKEN", problems);
  if (bootstrapToken.length < 32) {
    problems.push("PLANIPUS_BOOTSTRAP_TOKEN must contain at least 32 characters");
  }

  const providerModeText = env["PLANIPUS_PROVIDER_MODE"] ?? "fake";
  const providerMode: ProviderMode = providerModeText === "google" ? "google" : "fake";
  if (providerModeText !== "fake" && providerModeText !== "google") {
    problems.push("PLANIPUS_PROVIDER_MODE must be fake or google");
  }
  const googleClientId = env["GOOGLE_CLIENT_ID"]?.trim() || null;
  const googleClientSecret = env["GOOGLE_CLIENT_SECRET"]?.trim() || null;
  if (providerMode === "google" && (!googleClientId || !googleClientSecret)) {
    problems.push("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in google provider mode");
  }
  const experimentalGooglePlanningText = env["PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING"];
  if (experimentalGooglePlanningText !== undefined
    && experimentalGooglePlanningText !== "true"
    && experimentalGooglePlanningText !== "false") {
    problems.push("PLANIPUS_EXPERIMENTAL_GOOGLE_PLANNING must be true or false");
  }
  const experimentalGooglePlanning = experimentalGooglePlanningText === "true";
  const experimentalGoogleInvitationDeclineText = env["PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE"];
  if (experimentalGoogleInvitationDeclineText !== undefined
    && experimentalGoogleInvitationDeclineText !== "true"
    && experimentalGoogleInvitationDeclineText !== "false") {
    problems.push("PLANIPUS_EXPERIMENTAL_GOOGLE_INVITATION_DECLINE must be true or false");
  }
  const experimentalGoogleInvitationDecline = experimentalGoogleInvitationDeclineText === "true";

  const cookieSecureDefault = publicUrl.protocol === "https:";
  const cookieSecure = env["PLANIPUS_COOKIE_SECURE"] === undefined
    ? cookieSecureDefault
    : env["PLANIPUS_COOKIE_SECURE"] === "true";
  if (environment === "production" && !cookieSecure) {
    problems.push("PLANIPUS_COOKIE_SECURE cannot be false in production");
  }

  const config: ServerConfig = {
    environment,
    host: env["PLANIPUS_HOST"]?.trim() || "0.0.0.0",
    port: integer(env, "PLANIPUS_PORT", 8080, 1, 65_535, problems),
    publicUrl,
    databaseUrl: required(env, "DATABASE_URL", problems),
    masterKey: parseMasterKey(env, problems),
    masterKeyId: env["PLANIPUS_MASTER_KEY_ID"]?.trim() || "local-v1",
    bootstrapToken,
    cookieSecure,
    sessionTtlSeconds: integer(env, "PLANIPUS_SESSION_TTL_SECONDS", 43_200, 300, 604_800, problems),
    providerMode,
    googleClientId,
    googleClientSecret,
    experimentalGooglePlanning,
    experimentalGoogleInvitationDecline,
    migrationsDirectory: env["PLANIPUS_MIGRATIONS_DIR"]?.trim() || "migrations",
    migrationAttempts: integer(env, "PLANIPUS_MIGRATION_ATTEMPTS", 30, 1, 300, problems),
    schedulerIntervalMs: integer(env, "PLANIPUS_SCHEDULER_INTERVAL_MS", 15_000, 1_000, 300_000, problems),
    workerIntervalMs: integer(env, "PLANIPUS_WORKER_INTERVAL_MS", 1_000, 100, 60_000, problems),
    jobLeaseSeconds: integer(env, "PLANIPUS_JOB_LEASE_SECONDS", 60, 10, 3_600, problems)
  };

  if (problems.length > 0) {
    throw new ConfigurationError(problems);
  }
  return config;
}
