import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";

const CLISBOT_MCP_SERVER_NAME = "clisbot";
const CLISBOT_MCP_PATHNAME = "/mcp/agents";

/** Connector entries are added per launch (connectors/connector-runtime.ts) and never stored. */
const CONNECTORS_MCP_PREFIX = "connectors_";

/** Removes the daemon's own `clisbot` entry, which a provider with native Clisbot tools replaces. */
export function stripInternalClisbotMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const clisbotServer = config.mcpServers?.[CLISBOT_MCP_SERVER_NAME];
  if (!clisbotServer || !isInternalClisbotMcpServer(clisbotServer)) return config;
  return withoutMcpServers(config, [CLISBOT_MCP_SERVER_NAME]);
}

/**
 * Removes every entry the daemon adds per launch: the `clisbot` entry and the Connectors. A stored
 * config never keeps them; the next launch adds them again for what holds then.
 */
export function stripRuntimeMcpServers(config: AgentSessionConfig): AgentSessionConfig {
  const stripped = stripInternalClisbotMcpServer(config);
  const connectors = Object.keys(stripped.mcpServers ?? {}).filter((name) =>
    name.startsWith(CONNECTORS_MCP_PREFIX),
  );
  return connectors.length > 0 ? withoutMcpServers(stripped, connectors) : stripped;
}

function withoutMcpServers(config: AgentSessionConfig, names: string[]): AgentSessionConfig {
  const nextMcpServers = { ...config.mcpServers };
  for (const name of names) delete nextMcpServers[name];
  const next = { ...config };
  if (Object.keys(nextMcpServers).length > 0) {
    next.mcpServers = nextMcpServers;
  } else {
    delete next.mcpServers;
  }
  return next;
}

export function withRuntimeClisbotMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  mcpBaseUrl: string | null;
  /**
   * Capability token authenticating the injected connection to the daemon's
   * Agent MCP endpoint. The daemon password is gated off this route, so without
   * this header the agent's MCP requests are rejected when a password is set.
   */
  mcpAuthToken: string | null;
}): AgentSessionConfig {
  const storedConfig = stripInternalClisbotMcpServer(params.config);
  if (!params.mcpBaseUrl || storedConfig.mcpServers?.[CLISBOT_MCP_SERVER_NAME]) {
    return storedConfig;
  }

  return {
    ...storedConfig,
    mcpServers: {
      [CLISBOT_MCP_SERVER_NAME]: {
        type: "http",
        url: `${params.mcpBaseUrl}?callerAgentId=${params.agentId}`,
        ...(params.mcpAuthToken
          ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } }
          : {}),
      },
      ...storedConfig.mcpServers,
    },
  };
}

function isInternalClisbotMcpServer(config: McpServerConfig): boolean {
  if (config.type !== "http" && config.type !== "sse") {
    return false;
  }

  try {
    return new URL(config.url).pathname === CLISBOT_MCP_PATHNAME;
  } catch {
    return false;
  }
}
