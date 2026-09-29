import type { z } from "zod";
import type { ProviderClisbotToolsPolicy } from "@clisbot/protocol/provider-config";

export interface ClisbotToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: ClisbotToolResult) => void;
}

export interface ClisbotToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ClisbotToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface ClisbotToolDefinition extends ClisbotToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: ClisbotToolExecutionContext) => Promise<ClisbotToolResult>;
}

export interface ClisbotToolCatalog {
  tools: ReadonlyMap<string, ClisbotToolDefinition>;
  getTool(name: string): ClisbotToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: ClisbotToolExecutionContext,
  ): Promise<ClisbotToolResult>;
}

export interface ClisbotToolRuntimeContext {
  callerAgentId?: string;
  clisbotToolPolicy?: ProviderClisbotToolsPolicy;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type ClisbotToolCatalogFactory = (
  context: ClisbotToolRuntimeContext,
) => ClisbotToolCatalog | Promise<ClisbotToolCatalog>;
