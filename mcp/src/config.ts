// A conflict preview can query 32 separately authorized availability
// calendars in four concurrent lanes. Each provider request is bounded at 20
// seconds, so the MCP deadline must cover the API's bounded worst case rather
// than timing out while the authoritative server can still commit.
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

export interface McpConfig {
  readonly apiBaseUrl: URL;
  readonly apiToken: string;
  readonly applyEnabled: boolean;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
}

export class McpConfigurationError extends Error {
  public constructor(public readonly problems: readonly string[]) {
    super(`Invalid Planipus MCP configuration:\n- ${problems.join("\n- ")}`);
    this.name = "McpConfigurationError";
  }
}

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const problems: string[] = [];
  const apiBaseUrl = parseApiBaseUrl(env["PLANIPUS_API_URL"], problems);
  const apiToken = parseApiToken(env["PLANIPUS_API_TOKEN"], problems);
  const applyEnabled = parseApplyEnabled(env["PLANIPUS_MCP_ENABLE_APPLY"], problems);

  if (problems.length > 0) {
    throw new McpConfigurationError(problems);
  }

  return {
    apiBaseUrl,
    apiToken,
    applyEnabled,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES
  };
}

function parseApiBaseUrl(raw: string | undefined, problems: string[]): URL {
  if (!raw || raw.trim() !== raw) {
    problems.push("PLANIPUS_API_URL is required and must not contain surrounding whitespace");
    return new URL("http://127.0.0.1/");
  }

  let value: URL;
  try {
    value = new URL(raw);
  } catch {
    problems.push("PLANIPUS_API_URL must be an absolute URL");
    return new URL("http://127.0.0.1/");
  }

  if (value.username || value.password) {
    problems.push("PLANIPUS_API_URL must not contain credentials");
  }
  if (value.pathname !== "/" || value.search || value.hash) {
    problems.push("PLANIPUS_API_URL must contain only scheme, host, and optional port");
  }
  const loopback = isLoopbackHostname(value.hostname);
  if (value.protocol !== "https:" && !(value.protocol === "http:" && loopback)) {
    problems.push("PLANIPUS_API_URL must use HTTPS unless it targets loopback");
  }

  return new URL(`${value.origin}/`);
}

function parseApiToken(raw: string | undefined, problems: string[]): string {
  if (!raw) {
    problems.push("PLANIPUS_API_TOKEN is required");
    return "invalid";
  }
  if (raw.length > 200 || !/^pln_api_[A-Za-z0-9_-]+$/u.test(raw)) {
    problems.push("PLANIPUS_API_TOKEN must be a valid Planipus bearer token");
    return "invalid";
  }
  return raw;
}

function parseApplyEnabled(raw: string | undefined, problems: string[]): boolean {
  if (raw === undefined || raw === "false") return false;
  if (raw === "true") return true;
  problems.push("PLANIPUS_MCP_ENABLE_APPLY must be true or false");
  return false;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase("en-US");
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "[::1]"
    || normalized === "::1";
}
