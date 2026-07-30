#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { PlanipusApiClient } from "./api-client.js";
import { loadMcpConfig } from "./config.js";
import { createPlanipusMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadMcpConfig();
  const api = new PlanipusApiClient({
    baseUrl: config.apiBaseUrl,
    token: config.apiToken,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes
  });
  const server = createPlanipusMcpServer({ api, applyEnabled: config.applyEnabled });
  const transport = new StdioServerTransport();

  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    void server.close().catch(() => undefined);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  await server.connect(transport);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  process.stderr.write(`Planipus MCP failed: ${message}\n`);
  process.exitCode = 1;
});
