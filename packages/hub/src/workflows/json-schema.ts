import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import type { JsonValue } from "../config/compiler.js";

export interface CompiledJsonSchema {
  readonly validate: ValidateFunction;
  readonly schema: JsonValue;
}

const FINISH_EXECUTION_OUTPUT_ID = "urn:paseo:hub:finish-execution-output";

export function compileJsonSchema(schema: JsonValue): CompiledJsonSchema {
  if (!isRecord(schema)) throw new Error("JSON Schema must be an object");
  const cloned = structuredClone(schema);
  return {
    schema: cloned,
    validate: new Ajv({ allErrors: true, strict: true }).compile(cloned),
  };
}

export function compileFinishExecutionArguments(
  outputSchema: JsonValue | undefined,
): CompiledJsonSchema {
  return compileJsonSchema(
    outputSchema === undefined
      ? { type: "object", properties: {}, additionalProperties: false }
      : finishExecutionArgumentsSchema(outputSchema),
  );
}

function finishExecutionArgumentsSchema(outputSchema: JsonValue): JsonValue {
  if (!isRecord(outputSchema)) throw new Error("JSON Schema must be an object");
  const embeddedOutput = { ...outputSchema };
  if (embeddedOutput["$id"] === undefined) {
    embeddedOutput["$id"] = FINISH_EXECUTION_OUTPUT_ID;
  }
  return {
    type: "object",
    required: ["output"],
    properties: { output: embeddedOutput },
    additionalProperties: false,
  };
}

export function formatJsonSchemaErrors(
  errors: readonly ErrorObject[] | null | undefined,
  prefix = "output",
): string[] {
  return (errors ?? []).map((error) => {
    const path = error.instancePath === "" ? prefix : `${prefix}${error.instancePath}`;
    return `${path} ${error.message ?? "is invalid"}`;
  });
}

export function finiteSchemaChoices(
  schema: JsonValue,
  path: readonly string[],
): readonly JsonValue[] | undefined {
  const node = resolveSchemaAtPath(schema, path, schema, new Set());
  if (node === undefined) return undefined;
  return finiteChoices(node, schema, new Set());
}

function resolveSchemaAtPath(
  schema: unknown,
  path: readonly string[],
  root: unknown,
  seen: Set<unknown>,
): unknown {
  const resolved = resolveSchema(schema, root, seen);
  if (resolved === undefined) return undefined;
  if (path.length === 0) return resolved;
  if (!isRecord(resolved)) return undefined;

  const properties = resolved["properties"];
  if (!isRecord(properties)) return undefined;
  return resolveSchemaAtPath(properties[path[0]!], path.slice(1), root, seen);
}

function finiteChoices(
  schema: unknown,
  root: unknown,
  seen: Set<unknown>,
): readonly JsonValue[] | undefined {
  const resolved = resolveSchema(schema, root, seen);
  if (!isRecord(resolved)) return undefined;
  if (Array.isArray(resolved["enum"]) && resolved["enum"].length > 0) {
    return resolved["enum"].filter(isJsonValue);
  }
  if (isJsonValue(resolved["const"])) return [resolved["const"]];
  return undefined;
}

function resolveSchema(schema: unknown, root: unknown, seen: Set<unknown>): unknown {
  if (!isRecord(schema)) return undefined;
  if (typeof schema["$ref"] !== "string") return schema;
  if (seen.has(schema)) return undefined;
  seen.add(schema);
  const target = resolveLocalReference(root, schema["$ref"]);
  return target === undefined ? undefined : resolveSchema(target, root, seen);
}

function resolveLocalReference(root: unknown, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const segment of reference.slice(2).split("/")) {
    if (!isRecord(current)) return undefined;
    current = current[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
