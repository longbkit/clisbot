import type { z } from "zod";
import type { ProviderClisbotToolsPolicy } from "@clisbot/protocol/provider-config";

export class ClisbotToolInputError extends Error {
  readonly status = 400;

  constructor(
    message: string,
    readonly issues?: z.ZodError["issues"],
  ) {
    super(message);
    this.name = "ClisbotToolInputError";
  }
}

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

/** HTTP credentials cannot gain operator authority by changing a context selector. */
export type ClisbotToolHostAuthority =
  | "agent-capability"
  | "password-operator"
  | "legacy-anonymous"
  | "trusted-operator";

export interface ClisbotToolRuntimeContext {
  hostAuthority?: ClisbotToolHostAuthority;
  callerAgentId?: string;
  clisbotToolPolicy?: ProviderClisbotToolsPolicy;
  /** Overrides the Host's "Browser tools" for this caller (its Project's choice). */
  browserToolsEnabled?: boolean;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type ClisbotToolCatalogFactory = (
  context: ClisbotToolRuntimeContext,
) => ClisbotToolCatalog | Promise<ClisbotToolCatalog>;
