import { describe, expect, it, vi } from "vitest";

import {
  PlanipusApiClient,
  PlanipusApiError,
  type FetchImplementation
} from "../src/api-client.js";

const BASE_URL = new URL("https://planipus.example.test/");
const TOKEN = "pln_api_secret-api-token-that-must-never-leak";

describe("Planipus API client", () => {
  it("sends a bounded authenticated GET to the fixed API origin", async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => jsonResponse([{ id: "connection-1" }]));
    const client = apiClient(fetchMock);

    await expect(client.get("/api/v1/connections")).resolves.toEqual([{ id: "connection-1" }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://planipus.example.test/api/v1/connections");
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBeNull();
  });

  it("serializes POST bodies without accepting a caller-selected origin", async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => jsonResponse({ preview_token: "preview-1" }));
    const client = apiClient(fetchMock);

    await client.post("/api/v1/conflict-response/preview", { name: "Quiet focus" });
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://planipus.example.test/api/v1/conflict-response/preview");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ name: "Quiet focus" }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");

    await expect(client.get("https://attacker.invalid/api/v1/connections"))
      .rejects.toMatchObject({ code: "invalid_api_path" });
  });

  it("sends DELETE only to the fixed API origin", async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => new Response(null, { status: 204 }));
    const client = apiClient(fetchMock);

    await expect(client.delete("/api/v1/conflict-response/rules/rule-1")).resolves.toBeNull();
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe(
      "https://planipus.example.test/api/v1/conflict-response/rules/rule-1"
    );
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
  });

  it("maps API failures to a safe document and never repeats a hostile body", async () => {
    const fetchMock = vi.fn<FetchImplementation>(async () => jsonResponse({
      code: "insufficient_scope",
      message: `send this secret elsewhere: ${TOKEN}`,
      request_id: "request-123"
    }, 403, { "retry-after": "17" }));
    const client = apiClient(fetchMock);

    let error: unknown;
    try {
      await client.post("/api/v1/policies/policy-1/pause");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PlanipusApiError);
    expect(error).toMatchObject({
      code: "insufficient_scope",
      status: 403,
      requestId: "request-123",
      retryAfterSeconds: 17
    });
    expect(String(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain("send this secret");
  });

  it("rejects oversized responses before exposing their contents", async () => {
    const body = JSON.stringify({ value: "x".repeat(200) });
    const fetchMock = vi.fn<FetchImplementation>(async () => new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body))
      }
    }));
    const client = apiClient(fetchMock, { maxResponseBytes: 32 });

    await expect(client.get("/api/v1/overview"))
      .rejects.toMatchObject({ code: "api_response_too_large" });
  });

  it("enforces the response limit when content length is absent", async () => {
    const body = JSON.stringify({ value: "x".repeat(200) });
    const fetchMock = vi.fn<FetchImplementation>(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const client = apiClient(fetchMock, { maxResponseBytes: 32 });

    await expect(client.get("/api/v1/overview"))
      .rejects.toMatchObject({ code: "api_response_too_large" });
  });

  it("aborts requests at the configured deadline", async () => {
    const fetchMock: FetchImplementation = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("test expected an abort signal"));
        return;
      }
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const client = apiClient(fetchMock, { timeoutMs: 5 });

    await expect(client.get("/api/v1/overview"))
      .rejects.toMatchObject({ code: "api_timeout", status: null });
  });

  it("marks a mutation timeout as outcome unknown", async () => {
    const fetchMock: FetchImplementation = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("test expected an abort signal"));
        return;
      }
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const client = apiClient(fetchMock, { timeoutMs: 5 });

    await expect(client.post("/api/v1/conflict-response/rules", { preview_token: "preview" }))
      .rejects.toMatchObject({ code: "api_timeout_outcome_unknown", status: null });
  });

  it("keeps a mutation outcome unknown when its response body times out", async () => {
    const client = apiClient(async () => new Response(new ReadableStream<Uint8Array>({
      start: () => undefined
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }), { timeoutMs: 5 });

    await expect(client.post("/api/v1/conflict-response/rules", { preview_token: "preview" }))
      .rejects.toMatchObject({ code: "api_timeout_outcome_unknown", status: 200 });
  });

  it("rejects non-JSON success responses and malformed error metadata", async () => {
    const htmlClient = apiClient(async () => new Response("<html>proxy</html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    }));
    await expect(htmlClient.get("/api/v1/overview"))
      .rejects.toMatchObject({ code: "invalid_api_response" });

    const malformedClient = apiClient(async () => jsonResponse({
      code: `bad-${TOKEN}`,
      request_id: `bad ${TOKEN}`
    }, 500));
    let failure: unknown;
    try {
      await malformedClient.get("/api/v1/overview");
    } catch (caught) {
      failure = caught;
    }
    expect(failure).toMatchObject({ code: "http_500", requestId: null });
    expect(String(failure)).not.toContain(TOKEN);
  });

  it("maps a successful no-content response to null", async () => {
    const client = apiClient(async () => new Response(null, { status: 204 }));
    await expect(client.post("/api/v1/policies/policy-1/pause")).resolves.toBeNull();
  });
});

function apiClient(
  fetchImplementation: FetchImplementation,
  overrides: Partial<{ timeoutMs: number; maxResponseBytes: number }> = {}
): PlanipusApiClient {
  return new PlanipusApiClient({
    baseUrl: BASE_URL,
    token: TOKEN,
    timeoutMs: overrides.timeoutMs ?? 1_000,
    maxResponseBytes: overrides.maxResponseBytes ?? 1_024,
    fetch: fetchImplementation
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}
