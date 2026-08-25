import type { JsonValue } from "../config/compiler.js";
import type { ToolPolicy } from "../daemons/protocol.js";
import {
  executionToolDefinitions,
  type AllowedOutput,
  type OutputExecutorRegistry,
} from "./outputs.js";

const HUB_MCP_SERVER = "hub";

export function executionToolPolicy(input: {
  allowOutputs: readonly AllowedOutput[];
  outputContext: unknown;
  outputSchema?: JsonValue;
  capabilities: OutputExecutorRegistry;
}): ToolPolicy {
  const materializedOutputs = input.capabilities.materialize(
    input.allowOutputs,
    input.outputContext,
  );
  return {
    preapproved: executionToolDefinitions(input.outputSchema, materializedOutputs).map((tool) => ({
      kind: "mcp" as const,
      server: HUB_MCP_SERVER,
      tool: tool.name,
    })),
  };
}
