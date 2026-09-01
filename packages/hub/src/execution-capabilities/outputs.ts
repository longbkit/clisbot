import type { JsonValue } from "../config/compiler.js";
import { compileFinishExecutionArguments } from "../workflows/json-schema.js";

export interface AllowedOutput {
  type: string;
  /** Absent for the event-native reply capability exposed by single-run triggers. */
  max?: number | undefined;
  required?: boolean;
}

export interface OutputToolSchemaNode {
  readonly [key: string]: JsonValue;
}

export interface OutputToolSchema extends OutputToolSchemaNode {
  readonly type: "object";
  readonly properties?: Record<string, OutputToolSchemaNode>;
  readonly required?: string[];
}

export interface OutputToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: OutputToolSchema;
}

export interface OutputExecutionInput {
  agentExecutionId: string;
  attemptId?: string;
  toolType: string;
  args: Record<string, unknown>;
  outputContext: unknown;
}

export type OutputExecutor = (input: OutputExecutionInput) => Promise<void>;

export interface OutputCapability {
  readonly type: string;
  readonly tool: OutputToolDefinition;
  readonly available?: (outputContext: unknown) => boolean;
  readonly execute: OutputExecutor;
}

export interface MaterializedOutputCapability {
  readonly declaration: AllowedOutput;
  readonly capability: OutputCapability;
}

export const finishExecutionToolName = "finish_execution" as const;

function finishExecutionToolDescription(outputSchema: JsonValue | undefined): string {
  return outputSchema === undefined
    ? "Completes this execution and records its optional structured output."
    : "Completes this execution and records the configured structured output.";
}

export const replyOutputTool: OutputToolDefinition = {
  name: "reply",
  description: "Sends a reply to the conversation that triggered this execution.",
  inputSchema: {
    type: "object",
    properties: { content: { type: "string", minLength: 1 } },
    required: ["content"],
    additionalProperties: false,
  },
};

export function outputContextProvider(provider: string): (outputContext: unknown) => boolean {
  return (outputContext) =>
    typeof outputContext === "object" &&
    outputContext !== null &&
    Reflect.get(outputContext, "provider") === provider;
}

export class OutputCapabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputCapabilityValidationError";
  }
}

export class OutputExecutorRegistry {
  private readonly capabilities = new Map<string, OutputCapability>();

  register(capability: OutputCapability): void {
    if (capability.type.length === 0) throw new Error("output capability type is required");
    if (capability.tool.name.length === 0) {
      throw new Error(`output capability tool name is required: ${capability.type}`);
    }
    if (this.capabilities.has(capability.type)) {
      throw new Error(`output capability is already registered: ${capability.type}`);
    }
    this.capabilities.set(capability.type, capability);
  }

  validateRequiredOutputs(allowedOutputs: readonly AllowedOutput[], outputContext: unknown): void {
    const unavailable = allowedOutputs
      .filter((output) => output.required === true)
      .filter((output) => !this.isAvailable(output.type, outputContext))
      .map((output) => output.type);
    if (unavailable.length > 0) {
      throw new OutputCapabilityValidationError(
        `required output capability unavailable: ${unavailable.join(", ")}; register a Hub output tool for each type or remove required: true`,
      );
    }
  }

  materialize(
    allowedOutputs: readonly AllowedOutput[],
    outputContext: unknown,
  ): readonly MaterializedOutputCapability[] {
    this.validateRequiredOutputs(allowedOutputs, outputContext);
    const materialized = this.availableOutputs(allowedOutputs, outputContext);
    const byToolName = new Map<string, MaterializedOutputCapability>();
    for (const output of materialized) {
      const previous = byToolName.get(output.capability.tool.name);
      if (previous !== undefined && previous.declaration.type !== output.declaration.type) {
        throw new OutputCapabilityValidationError(
          `output capabilities ${previous.declaration.type} and ${output.declaration.type} both expose Hub tool ${output.capability.tool.name}; register unique tool names`,
        );
      }
      byToolName.set(output.capability.tool.name, output);
    }
    return materialized;
  }

  private availableOutputs(
    allowedOutputs: readonly AllowedOutput[],
    outputContext: unknown,
  ): readonly MaterializedOutputCapability[] {
    return allowedOutputs.flatMap((declaration) => {
      const capability = this.capabilities.get(declaration.type);
      return capability !== undefined && this.isAvailable(declaration.type, outputContext)
        ? [{ declaration, capability }]
        : [];
    });
  }

  private isAvailable(type: string, outputContext: unknown): boolean {
    const capability = this.capabilities.get(type);
    return capability !== undefined && (capability.available?.(outputContext) ?? true);
  }

  async execute(input: OutputExecutionInput): Promise<void> {
    const capability = this.capabilities.get(input.toolType);
    if (capability === undefined) {
      throw new Error(`no output executor registered for ${input.toolType}`);
    }
    await capability.execute(input);
  }
}

export function executionToolDefinitions(
  outputSchema: JsonValue | undefined,
  materializedOutputs: readonly MaterializedOutputCapability[],
): readonly OutputToolDefinition[] {
  return [
    {
      name: finishExecutionToolName,
      description: finishExecutionToolDescription(outputSchema),
      inputSchema: toolSchema(compileFinishExecutionArguments(outputSchema).schema),
    },
    ...materializedOutputs.map(({ declaration, capability }) => ({
      name: capability.tool.name,
      description:
        declaration.max === undefined
          ? capability.tool.description
          : `${capability.tool.description} (up to ${String(declaration.max)} times).`,
      inputSchema: capability.tool.inputSchema,
    })),
  ];
}

function toolSchema(value: JsonValue): OutputToolSchema {
  if (!isToolSchema(value)) throw new Error("JSON Schema tool arguments must be an object");
  return value;
}

function isToolSchema(value: JsonValue): value is OutputToolSchema {
  if (!isSchemaNode(value) || value["type"] !== "object") return false;
  const properties = value["properties"];
  const required = value["required"];
  return (
    (properties === undefined ||
      (isRecord(properties) && Object.values(properties).every(isSchemaNode))) &&
    (required === undefined ||
      (Array.isArray(required) && required.every((item) => typeof item === "string")))
  );
}

function isSchemaNode(value: JsonValue): value is OutputToolSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
