import { describe, expect, it } from "vitest";

import { loadMcpConfig, McpConfigurationError } from "../src/config.js";

describe("MCP configuration", () => {
  it("accepts HTTPS and keeps apply tools disabled by default", () => {
    const config = loadMcpConfig({
      PLANIPUS_API_URL: "https://planipus.example.test",
      PLANIPUS_API_TOKEN: "pln_api_abcdefghijklmnopqrstuvwxyz"
    });

    expect(config.apiBaseUrl.href).toBe("https://planipus.example.test/");
    expect(config.applyEnabled).toBe(false);
    expect(config.requestTimeoutMs).toBe(300_000);
    expect(config.maxResponseBytes).toBe(1_048_576);
  });

  it.each([
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://[::1]:8080"
  ])("allows HTTP only for exact loopback target %s", (url) => {
    const config = loadMcpConfig({
      PLANIPUS_API_URL: url,
      PLANIPUS_API_TOKEN: "pln_api_local-token",
      PLANIPUS_MCP_ENABLE_APPLY: "true"
    });

    expect(config.apiBaseUrl.href).toBe(`${url}/`);
    expect(config.applyEnabled).toBe(true);
  });

  it.each([
    "http://planipus.example.test",
    "ftp://127.0.0.1",
    "https://user:password@planipus.example.test",
    "https://planipus.example.test/prefix",
    "https://planipus.example.test/?query=yes",
    "https://planipus.example.test/#fragment"
  ])("rejects unsafe or mutable API URL %s", (url) => {
    expect(() => loadMcpConfig({
      PLANIPUS_API_URL: url,
      PLANIPUS_API_TOKEN: "pln_api_local-token"
    })).toThrow(McpConfigurationError);
  });

  it("requires a bearer token without leaking it into diagnostics", () => {
    const secret = "secret token that must not appear";
    let error: unknown;
    try {
      loadMcpConfig({
        PLANIPUS_API_URL: "https://planipus.example.test",
        PLANIPUS_API_TOKEN: secret
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(McpConfigurationError);
    expect(String(error)).not.toContain(secret);
  });

  it("rejects missing values and non-boolean apply configuration together", () => {
    expect(() => loadMcpConfig({ PLANIPUS_MCP_ENABLE_APPLY: "yes" }))
      .toThrow(/PLANIPUS_API_URL[\s\S]*PLANIPUS_API_TOKEN[\s\S]*PLANIPUS_MCP_ENABLE_APPLY/u);
  });
});
