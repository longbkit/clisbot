import { describe, expect, test } from "vitest";

import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { withRuntimeClisbotMcpServer } from "./runtime-mcp-config.js";

const BASE_CONFIG: AgentSessionConfig = {
  provider: "claude",
  cwd: "/tmp/agent",
};

describe("withRuntimeClisbotMcpServer", () => {
  test("injects the clisbot MCP server with a bearer header when a token is provided", () => {
    const result = withRuntimeClisbotMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6868/mcp/agents",
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers?.clisbot).toEqual({
      type: "http",
      url: "http://127.0.0.1:6868/mcp/agents?callerAgentId=agent-1",
      headers: { Authorization: "Bearer cap-token" },
    });
  });

  test("omits the header when no token is available", () => {
    const result = withRuntimeClisbotMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: "http://127.0.0.1:6868/mcp/agents",
      mcpAuthToken: null,
    });

    expect(result.mcpServers?.clisbot).toEqual({
      type: "http",
      url: "http://127.0.0.1:6868/mcp/agents?callerAgentId=agent-1",
    });
  });

  test("does not inject when no MCP base URL is configured", () => {
    const result = withRuntimeClisbotMcpServer({
      config: BASE_CONFIG,
      agentId: "agent-1",
      mcpBaseUrl: null,
      mcpAuthToken: "cap-token",
    });

    expect(result.mcpServers).toBeUndefined();
  });
});
