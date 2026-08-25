import { z } from "zod";
import type { JsonPrimitive } from "../config/schema.js";

export type InvocationInputType = "string" | "number" | "boolean";

export interface InvocationInputDefinition {
  type: InvocationInputType;
  required?: boolean | undefined;
  default?: JsonPrimitive | undefined;
  choices?: readonly JsonPrimitive[] | undefined;
}

export type InvocationInputDefinitions = Readonly<Record<string, InvocationInputDefinition>>;
export type InvocationInputs = Readonly<Record<string, JsonPrimitive>>;

export type InvocationRejection =
  | {
      code: "invalid_choice";
      inputName: string;
      value: JsonPrimitive;
      choices: readonly JsonPrimitive[];
    }
  | { code: "invalid_type"; inputName: string; expectedType: InvocationInputType }
  | { code: "duplicate_input"; inputName: string }
  | { code: "missing_required"; inputName: string }
  | { code: "invalid_default_type"; inputName: string; expectedType: InvocationInputType }
  | { code: "invalid_default_choice"; inputName: string };

const JsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const InvocationRejectionSchema = z.discriminatedUnion("code", [
  z
    .object({
      code: z.literal("invalid_choice"),
      inputName: z.string(),
      value: JsonPrimitiveSchema,
      choices: z.array(JsonPrimitiveSchema),
    })
    .strict(),
  z
    .object({
      code: z.literal("invalid_type"),
      inputName: z.string(),
      expectedType: z.enum(["string", "number", "boolean"]),
    })
    .strict(),
  z.object({ code: z.literal("duplicate_input"), inputName: z.string() }).strict(),
  z.object({ code: z.literal("missing_required"), inputName: z.string() }).strict(),
  z
    .object({
      code: z.literal("invalid_default_type"),
      inputName: z.string(),
      expectedType: z.enum(["string", "number", "boolean"]),
    })
    .strict(),
  z.object({ code: z.literal("invalid_default_choice"), inputName: z.string() }).strict(),
]);

export function parseInvocationRejection(value: unknown): InvocationRejection {
  return InvocationRejectionSchema.parse(value);
}

export function parseInvocationInputs(value: unknown): InvocationInputs {
  const parsed = z.record(z.string(), JsonPrimitiveSchema).parse(value);
  return Object.freeze(parsed);
}

export function formatInvocationRejection(rejection: InvocationRejection): string {
  switch (rejection.code) {
    case "invalid_choice":
      return `input ${rejection.inputName} must be one of the declared choices`;
    case "invalid_type":
      return `input ${rejection.inputName} must be a ${rejection.expectedType}`;
    case "duplicate_input":
      return `duplicate input ${rejection.inputName}`;
    case "missing_required":
      return `required input ${rejection.inputName} is missing`;
    case "invalid_default_type":
      return `input ${rejection.inputName} default does not match type ${rejection.expectedType}`;
    case "invalid_default_choice":
      return `input ${rejection.inputName} default is not one of the declared choices`;
  }
  throw new Error("unknown invocation rejection");
}

export type InvocationParseResult =
  | {
      status: "accepted";
      prompt: string;
      inputs: InvocationInputs;
    }
  | {
      status: "rejected";
      prompt: string;
      inputs: InvocationInputs;
      reason: string;
      rejection: InvocationRejection;
    };

export function parseInvocation(
  prompt: string,
  definitions: InvocationInputDefinitions,
  mention?: string,
  parserMessage = prompt,
): InvocationParseResult {
  const promptAfterMention = removeMention(parserMessage, mention);
  const inputs: Record<string, JsonPrimitive> = {};
  const consumed = consumeDeclaredHeaders(promptAfterMention, definitions, inputs);

  if (consumed.reason !== undefined) {
    return rejected(prompt, inputs, consumed.reason.message, consumed.reason.rejection);
  }

  const defaults = applyDefaults(definitions, inputs);
  if (defaults !== undefined) {
    return rejected(prompt, inputs, defaults.message, defaults.rejection);
  }

  const required = findMissingRequiredInput(definitions, inputs);
  if (required !== undefined) {
    return rejected(prompt, inputs, `required input ${required} is missing`, {
      code: "missing_required",
      inputName: required,
    });
  }

  return {
    status: "accepted",
    prompt,
    inputs: freezeInputs(inputs),
  };
}

export function matchesInputFilters(
  inputs: InvocationInputs,
  filters: Readonly<Record<string, JsonPrimitive>> | undefined,
): boolean {
  if (filters === undefined) return true;
  return Object.entries(filters).every(([name, value]) => inputs[name] === value);
}

function consumeDeclaredHeaders(
  message: string,
  definitions: InvocationInputDefinitions,
  inputs: Record<string, JsonPrimitive>,
): { reason?: { message: string; rejection: InvocationRejection } } {
  let offset = 0;
  while (offset < message.length) {
    const token = readNextToken(message, offset);
    if (token === undefined) break;
    const definition = definitions[token.name];
    if (definition === undefined) break;
    if (Object.hasOwn(inputs, token.name)) {
      return {
        reason: {
          message: `duplicate input ${token.name}`,
          rejection: { code: "duplicate_input", inputName: token.name },
        },
      };
    }
    const value = parseInputValue(token.name, token.value, definition);
    offset = token.end;
    if (!value.ok) {
      return {
        reason: { message: value.reason, rejection: value.rejection },
      };
    }
    inputs[token.name] = value.value;
  }

  return {};
}

function applyDefaults(
  definitions: InvocationInputDefinitions,
  inputs: Record<string, JsonPrimitive>,
): { message: string; rejection: InvocationRejection } | undefined {
  for (const [name, definition] of Object.entries(definitions)) {
    if (Object.hasOwn(inputs, name) || definition.default === undefined) continue;
    const parsed = parseDefaultValue(name, definition.default, definition);
    if (parsed !== undefined) return parsed;
    inputs[name] = definition.default;
  }
  return undefined;
}

function parseDefaultValue(
  name: string,
  value: JsonPrimitive,
  definition: InvocationInputDefinition,
): { message: string; rejection: InvocationRejection } | undefined {
  if (!isValueForType(value, definition.type)) {
    return {
      message: `input ${name} default does not match type ${definition.type}`,
      rejection: { code: "invalid_default_type", inputName: name, expectedType: definition.type },
    };
  }
  if (definition.choices !== undefined && !definition.choices.some((choice) => choice === value)) {
    return {
      message: `input ${name} default is not one of the declared choices`,
      rejection: { code: "invalid_default_choice", inputName: name },
    };
  }
  return undefined;
}

function findMissingRequiredInput(
  definitions: InvocationInputDefinitions,
  inputs: Record<string, JsonPrimitive>,
): string | undefined {
  return Object.entries(definitions).find(
    ([name, definition]) => definition.required === true && !Object.hasOwn(inputs, name),
  )?.[0];
}

function parseInputValue(
  name: string,
  rawValue: string,
  definition: InvocationInputDefinition,
):
  | { ok: true; value: JsonPrimitive }
  | { ok: false; reason: string; rejection: InvocationRejection } {
  let value: JsonPrimitive;
  if (definition.type === "string") {
    value = rawValue;
  } else if (definition.type === "number") {
    if (rawValue.length === 0 || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(rawValue)) {
      return {
        ok: false,
        reason: `input ${name} must be a number`,
        rejection: { code: "invalid_type", inputName: name, expectedType: definition.type },
      };
    }
    const number = Number(rawValue);
    if (!Number.isFinite(number))
      return {
        ok: false,
        reason: `input ${name} must be a number`,
        rejection: { code: "invalid_type", inputName: name, expectedType: definition.type },
      };
    value = number;
  } else {
    if (rawValue === "true") value = true;
    else if (rawValue === "false") value = false;
    else
      return {
        ok: false,
        reason: `input ${name} must be a boolean`,
        rejection: { code: "invalid_type", inputName: name, expectedType: definition.type },
      };
  }

  if (definition.choices !== undefined && !definition.choices.some((choice) => choice === value)) {
    return {
      ok: false,
      reason: `input ${name} must be one of the declared choices`,
      rejection: { code: "invalid_choice", inputName: name, value, choices: definition.choices },
    };
  }
  return { ok: true, value };
}

function readNextToken(
  message: string,
  offset: number,
): { name: string; value: string; end: number } | undefined {
  const start = offset;
  const match = /^([a-z][a-z0-9_-]*)=([^\s]*)(?:\s+|$)/u.exec(message.slice(start));
  if (match === null) return undefined;
  return {
    name: match[1]!,
    value: match[2]!,
    end: start + match[0].length,
  };
}

function removeMention(parserMessage: string, mention: string | undefined): string {
  const message = parserMessage.trimStart();
  if (mention === undefined || !message.startsWith(mention)) return message;
  const boundary = message.at(mention.length);
  if (boundary !== undefined && !/\s/u.test(boundary)) return message;
  return message.slice(mention.length).trimStart();
}

function isValueForType(value: JsonPrimitive, type: InvocationInputType): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "boolean";
}

function freezeInputs(inputs: Record<string, JsonPrimitive>): InvocationInputs {
  return Object.freeze({ ...inputs });
}

function rejected(
  prompt: string,
  inputs: Record<string, JsonPrimitive>,
  reason: string,
  rejection: InvocationRejection,
): InvocationParseResult {
  return {
    status: "rejected",
    prompt,
    inputs: freezeInputs(inputs),
    reason,
    rejection: Object.freeze(rejection),
  };
}
