import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanipusApiError, type PlanipusApi } from "../src/api-client.js";
import { createPlanipusMcpServer } from "../src/server.js";

interface Harness {
  readonly server: McpServer;
  readonly client: Client;
  readonly api: PlanipusApi;
  readonly get: ReturnType<typeof vi.fn<PlanipusApi["get"]>>;
  readonly post: ReturnType<typeof vi.fn<PlanipusApi["post"]>>;
  readonly deleteRequest: ReturnType<typeof vi.fn<PlanipusApi["delete"]>>;
}

const harnesses: Harness[] = [];
const WORK_CALENDAR_ID = "00000000-0000-7000-8000-000000000401";
const PERSONAL_CALENDAR_ID = "00000000-0000-7000-8000-000000000402";
const RULE_ID = "00000000-0000-7000-8000-000000000403";
const POLICY_PREVIEW_ID = "00000000-0000-7000-8000-000000000404";

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(async ({ client, server }) => {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }));
});

describe("Planipus MCP server", () => {
  it("advertises a static read/propose surface and no apply tools by default", async () => {
    const harness = await createHarness(false);
    const tools = await harness.client.listTools();
    const names = tools.tools.map((tool) => tool.name);

    expect(names).toEqual([
      "list_connections",
      "list_calendars",
      "get_sync_health",
      "list_policies",
      "get_policy",
      "list_conflict_response_rules",
      "preview_sync_policy",
      "preview_conflict_response_rule"
    ]);
    expect(names).not.toContain("pause_policy");
    expect(tools.tools.find((tool) => tool.name === "list_calendars")?.annotations)
      .toMatchObject({ readOnlyHint: true, idempotentHint: true });
    expect(tools.tools.find((tool) => tool.name === "preview_conflict_response_rule")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
  });

  it("returns API data as structured content with a concise text result", async () => {
    const harness = await createHarness(false);
    harness.get.mockResolvedValueOnce([{ id: "calendar-1", name: "Personal" }]);

    const result = await harness.client.callTool({ name: "list_calendars", arguments: {} });

    expect(harness.get).toHaveBeenCalledWith("/api/v1/calendars");
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      ok: true,
      data: [{ id: "calendar-1", name: "Personal" }]
    });
    expect(result.content).toContainEqual({ type: "text", text: "Calendars returned." });
  });

  it("applies conflict-preview defaults before calling the API", async () => {
    const harness = await createHarness(false);
    harness.post.mockResolvedValueOnce({ preview_token: POLICY_PREVIEW_ID, affected_invitation_count: 2 });

    const result = await harness.client.callTool({
      name: "preview_conflict_response_rule",
      arguments: {
        name: "Protect personal commitments",
        response_calendar_id: WORK_CALENDAR_ID,
        availability_calendar_ids: [PERSONAL_CALENDAR_ID]
      }
    });

    expect(result.isError).not.toBe(true);
    expect(harness.post).toHaveBeenCalledWith("/api/v1/conflict-response/preview", {
      name: "Protect personal commitments",
      response_calendar_id: WORK_CALENDAR_ID,
      availability_calendar_ids: [PERSONAL_CALENDAR_ID],
      decline_message: "I have a private conflict at that time. Please choose another time.",
      horizon_days: 60
    });
  });

  it("rejects unknown or duplicated conflict-preview inputs before the API", async () => {
    const harness = await createHarness(false);

    const result = await harness.client.callTool({
      name: "preview_conflict_response_rule",
      arguments: {
        name: "Protect personal commitments",
        response_calendar_id: WORK_CALENDAR_ID,
        availability_calendar_ids: [PERSONAL_CALENDAR_ID, PERSONAL_CALENDAR_ID],
        organization_id: "must-not-be-caller-controlled"
      }
    });

    expect(result.isError).toBe(true);
    expect(harness.post).not.toHaveBeenCalled();
  });

  it("maps API errors to isError without exposing arbitrary error text", async () => {
    const harness = await createHarness(false);
    harness.get.mockRejectedValueOnce(new PlanipusApiError(
      "insufficient_scope",
      403,
      "request-123"
    ));

    const result = await harness.client.callTool({ name: "list_policies", arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: "insufficient_scope",
        status: 403,
        request_id: "request-123",
        retry_after_seconds: null
      }
    });
    expect(result.content).toContainEqual({
      type: "text",
      text: "Planipus API request failed: insufficient_scope (HTTP 403), request request-123."
    });
  });

  it("registers opt-in apply tools and maps them only to API commands", async () => {
    const harness = await createHarness(true);
    const tools = await harness.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "activate_sync_policy",
      "pause_policy",
      "resume_policy",
      "reconcile_policy",
      "activate_conflict_response_rule",
      "pause_conflict_response_rule",
      "resume_conflict_response_rule",
      "reconcile_conflict_response_rule",
      "retire_conflict_response_rule"
    ]));
    harness.post.mockResolvedValueOnce(null);

    await harness.client.callTool({
      name: "pause_conflict_response_rule",
      arguments: { rule_id: RULE_ID }
    });

    expect(harness.post).toHaveBeenCalledWith(`/api/v1/conflict-response/rules/${RULE_ID}/pause`);
    expect(tools.tools.find((tool) => tool.name === "pause_conflict_response_rule")?.annotations)
      .toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: false
      });

    harness.post.mockResolvedValueOnce({ id: "policy-1", revision: 1 });
    await harness.client.callTool({
      name: "activate_sync_policy",
      arguments: { preview_token: POLICY_PREVIEW_ID }
    });
    expect(harness.post).toHaveBeenLastCalledWith("/api/v1/policies", {
      preview_token: POLICY_PREVIEW_ID
    });

    harness.deleteRequest.mockResolvedValueOnce(null);
    await harness.client.callTool({
      name: "retire_conflict_response_rule",
      arguments: { rule_id: RULE_ID }
    });
    expect(harness.deleteRequest).toHaveBeenCalledWith(
      `/api/v1/conflict-response/rules/${RULE_ID}`
    );
    expect(tools.tools.find((tool) => tool.name === "retire_conflict_response_rule")?.annotations)
      .toMatchObject({ destructiveHint: true, idempotentHint: true });
  });

  it("publishes fixed API-backed resources without subscriptions or templates", async () => {
    const harness = await createHarness(false);
    const resources = await harness.client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toEqual([
      "planipus://capabilities",
      "planipus://overview",
      "planipus://connections",
      "planipus://calendars",
      "planipus://policies",
      "planipus://conflict-response-rules"
    ]);
    harness.get.mockResolvedValueOnce({ status: "current", pending_effect_count: 0 });

    const result = await harness.client.readResource({ uri: "planipus://overview" });

    expect(harness.get).toHaveBeenCalledWith("/api/v1/overview");
    expect(result.contents).toEqual([{
      uri: "planipus://overview",
      mimeType: "application/json",
      text: JSON.stringify({ status: "current", pending_effect_count: 0 })
    }]);
    expect(harness.client.getServerCapabilities()?.resources?.subscribe).not.toBe(true);
  });
});

async function createHarness(applyEnabled: boolean): Promise<Harness> {
  const get = vi.fn<PlanipusApi["get"]>(async () => []);
  const post = vi.fn<PlanipusApi["post"]>(async () => ({}));
  const deleteRequest = vi.fn<PlanipusApi["delete"]>(async () => null);
  const api: PlanipusApi = { get, post, delete: deleteRequest };
  const server = createPlanipusMcpServer({ api, applyEnabled });
  const client = new Client({ name: "planipus-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const harness = { server, client, api, get, post, deleteRequest };
  harnesses.push(harness);
  return harness;
}
