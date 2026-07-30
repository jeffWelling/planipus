export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface PlanipusApi {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  delete(path: string): Promise<unknown>;
}

export interface PlanipusApiClientOptions {
  readonly baseUrl: URL;
  readonly token: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly fetch?: FetchImplementation;
}

interface SafeApiErrorDocument {
  readonly code: string;
  readonly status: number | null;
  readonly request_id: string | null;
  readonly retry_after_seconds: number | null;
}

export class PlanipusApiError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number | null = null,
    public readonly requestId: string | null = null,
    public readonly retryAfterSeconds: number | null = null
  ) {
    super(safeApiErrorMessage(code, status, requestId));
    this.name = "PlanipusApiError";
  }

  public toSafeDocument(): SafeApiErrorDocument {
    return {
      code: this.code,
      status: this.status,
      request_id: this.requestId,
      retry_after_seconds: this.retryAfterSeconds
    };
  }
}

export class PlanipusApiClient implements PlanipusApi {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImplementation: FetchImplementation;

  public constructor(options: PlanipusApiClientOptions) {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 600_000) {
      throw new RangeError("timeoutMs must be an integer from 1 through 600000");
    }
    if (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1 || options.maxResponseBytes > 10_485_760) {
      throw new RangeError("maxResponseBytes must be an integer from 1 through 10485760");
    }
    if (!options.token || options.token.length > 200 || !/^pln_api_[A-Za-z0-9_-]+$/u.test(options.token)) {
      throw new TypeError("token must be a valid Planipus bearer token");
    }
    if (options.baseUrl.pathname !== "/" || options.baseUrl.search || options.baseUrl.hash) {
      throw new TypeError("baseUrl must be an origin URL");
    }

    this.baseUrl = new URL(options.baseUrl.href);
    this.token = options.token;
    this.timeoutMs = options.timeoutMs;
    this.maxResponseBytes = options.maxResponseBytes;
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  public post(path: string, body?: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  public delete(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  private async request(method: "DELETE" | "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const url = this.apiUrl(path);
    const signal = AbortSignal.timeout(this.timeoutMs);
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${this.token}`,
      "user-agent": "planipus-mcp/0.1.0"
    });
    let serializedBody: string | undefined;
    if (body !== undefined) {
      headers.set("content-type", "application/json");
      try {
        serializedBody = JSON.stringify(body);
      } catch {
        throw new PlanipusApiError("invalid_tool_payload");
      }
      if (serializedBody === undefined) {
        throw new PlanipusApiError("invalid_tool_payload");
      }
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method,
        headers,
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
        redirect: "error",
        signal
      });
    } catch {
      throw new PlanipusApiError(signal.aborted
        ? timeoutCode(method)
        : "api_unavailable");
    }

    const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
    let text: string;
    try {
      text = await readBoundedResponse(response, this.maxResponseBytes, signal);
    } catch (error) {
      if (error instanceof PlanipusApiError) {
        if (error.code === "api_timeout" && method !== "GET") {
          throw new PlanipusApiError(timeoutCode(method), response.status);
        }
        throw error;
      }
      throw new PlanipusApiError(
        signal.aborted ? timeoutCode(method) : "invalid_api_response",
        response.status
      );
    }
    if (response.status === 204) {
      if (!response.ok) {
        throw new PlanipusApiError(`http_${response.status}`, response.status, null, retryAfterSeconds);
      }
      return null;
    }

    const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("+json")) {
      throw new PlanipusApiError(response.ok ? "invalid_api_response" : `http_${response.status}`, response.status);
    }

    let document: unknown;
    try {
      document = JSON.parse(text) as unknown;
    } catch {
      throw new PlanipusApiError(response.ok ? "invalid_api_response" : `http_${response.status}`, response.status);
    }

    if (!response.ok) {
      const error = safeRemoteError(document, response.status, this.token);
      throw new PlanipusApiError(error.code, response.status, error.requestId, retryAfterSeconds);
    }
    if (!isJsonContainer(document)) {
      throw new PlanipusApiError("invalid_api_response", response.status);
    }
    return document;
  }

  private apiUrl(path: string): URL {
    if (!path.startsWith("/api/v1/") || path.includes("#")) {
      throw new PlanipusApiError("invalid_api_path");
    }
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new PlanipusApiError("invalid_api_path");
    }
    return url;
  }
}

function timeoutCode(method: "DELETE" | "GET" | "POST"): string {
  // Aborting the client request cannot prove that the API aborted its work.
  // Reads are safe to repeat; mutation callers must inspect current state
  // before retrying an activation or another control operation.
  return method === "GET" ? "api_timeout" : "api_timeout_outcome_unknown";
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new PlanipusApiError("api_response_too_large", response.status);
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await readWithAbort(reader, signal);
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PlanipusApiError("api_response_too_large", response.status);
    }
    chunks.push(next.value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    throw new PlanipusApiError("invalid_api_response", response.status);
  }
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new PlanipusApiError("api_timeout"));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      void reader.cancel().catch(() => undefined);
      reject(new PlanipusApiError("api_timeout"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function safeRemoteError(
  document: unknown,
  status: number,
  configuredToken: string
): { readonly code: string; readonly requestId: string | null } {
  if (!isRecord(document)) {
    return { code: `http_${status}`, requestId: null };
  }
  const code = typeof document["code"] === "string" && SAFE_REMOTE_ERROR_CODES.has(document["code"])
    ? document["code"]
    : `http_${status}`;
  const requestId = typeof document["request_id"] === "string"
    && /^[A-Za-z0-9._:-]{1,120}$/u.test(document["request_id"])
    && !document["request_id"].includes(configuredToken)
    ? document["request_id"]
    : null;
  return { code, requestId };
}

const SAFE_REMOTE_ERROR_CODES = new Set([
  "authentication_required",
  "automatic_decline_budget_exceeded",
  "availability_copy_feedback",
  "availability_not_ready",
  "api_rate_limited",
  "availability_scope_missing",
  "conflict_response_unavailable",
  "connection_role_changed",
  "copy_policy_conflict",
  "csrf_invalid",
  "decline_comment_not_retained",
  "insufficient_scope",
  "invalid_conflict_response",
  "invalid_conflict_response_rule",
  "availability_calendar_unavailable",
  "calendar_not_found",
  "freebusy_incomplete",
  "freebusy_bounds_invalid",
  "freebusy_invalid",
  "freebusy_too_large",
  "invalid_hours_profile",
  "invalid_policy",
  "invalid_request",
  "invitation_writes_disabled",
  "not_found",
  "no_copy_rule_conflict",
  "origin_rejected",
  "planning_unavailable",
  "preview_incomplete",
  "preview_rate_limited",
  "preview_stale",
  "request_rejected",
  "response_calendar_unavailable",
  "response_rule_conflict",
  "response_sync_incomplete",
  "rule_paused",
  "same_calendar",
  "same_provider_calendar",
  "source_sync_incomplete",
  "suggestion_stale",
  "token_expired",
  "token_revoked"
]);

function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/u.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return isRecord(value) || Array.isArray(value);
}

function safeApiErrorMessage(code: string, status: number | null, requestId: string | null): string {
  const statusText = status === null ? "" : ` (HTTP ${status})`;
  const requestText = requestId === null ? "" : `, request ${requestId}`;
  return `Planipus API request failed: ${code}${statusText}${requestText}.`;
}
