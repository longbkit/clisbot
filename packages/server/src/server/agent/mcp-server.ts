import { McpServer } from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  ServerContext,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";

import { AGENT_TOOL_GROUPS } from "@clisbot/protocol/connectors/agent-tools";

import { isClisbotToolEnabled } from "./clisbot-tool-policy.js";
import { addModelVisibleStructuredContent } from "./tools/clisbot-tool-serialization.js";
import {
  createClisbotToolCatalog,
  type ClisbotToolHostDependencies,
} from "./tools/clisbot-tools.js";
import type { ClisbotToolResult } from "./tools/types.js";

export type AgentMcpServerOptions = ClisbotToolHostDependencies;

type McpToolContext = ServerContext;

function toMcpToolResult(result: ClisbotToolResult): CallToolResult {
  const modelVisibleResult = addModelVisibleStructuredContent(result);
  return {
    content: modelVisibleResult.content as CallToolResult["content"],
    ...(modelVisibleResult.structuredContent !== undefined
      ? {
          structuredContent:
            modelVisibleResult.structuredContent as CallToolResult["structuredContent"],
        }
      : {}),
    ...(modelVisibleResult.isError !== undefined ? { isError: modelVisibleResult.isError } : {}),
  };
}

export async function createAgentMcpServer(options: AgentMcpServerOptions): Promise<McpServer> {
  const catalog = await createClisbotToolCatalog(options);
  const server = new McpServer({
    name: "agent-mcp",
    version: "2.0.0",
  });

  for (const tool of catalog.tools.values()) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // Clisbot declares tool schemas through the `zod` root entry; the SDK types
        // its input schema through the `zod/v4` core entry. Both are the same zod
        // runtime, but the two entry points carry distinct type identities, so a
        // single narrowing cast is required at this boundary.
        inputSchema: tool.inputSchema as StandardSchemaWithJSON,
      },
      async (args: unknown, context?: McpToolContext) =>
        toMcpToolResult(
          await catalog.executeTool(tool.name, args, { signal: context?.mcpReq?.signal }),
        ),
    );
  }
  registerTurnedOffTools(server, options);

  return server;
}

/**
 * Tools the Project or the session turned off stay out of the list, but an agent that read the
 * list earlier in its session may still call one: answer "Tool X disabled", not "not found", so it
 * can tell the user the tool was switched off rather than missing.
 */
function registerTurnedOffTools(server: McpServer, options: AgentMcpServerOptions): void {
  for (const group of AGENT_TOOL_GROUPS) {
    for (const tool of group.tools) {
      if (isClisbotToolEnabled(options.clisbotToolPolicy, tool.name)) continue;
      server.registerTool(tool.name, { description: tool.description }, turnedOff).disable();
    }
  }
}

function turnedOff(): CallToolResult {
  return { content: [{ type: "text", text: "This tool is turned off." }], isError: true };
}
