// Fusion-owned host adapter for `src/agents/tools/common.ts` (D-CORE-029).
//
// Upstream's module is the shared agent-tool helper library: the param readers
// below plus image sanitization, local-file reading through OpenClaw's fs-safe
// root, MIME detection and the agent-runtime tool types. The ported
// message-action layer uses only the param readers and the result builders, so
// those are carried with upstream's function bodies; the file/sanitization
// surface stops at this boundary.
import {
  asPositiveSafeInteger,
  asSafeIntegerInRange,
  parseStrictFiniteNumber,
} from "../../normalization-core/number-coercion.js";
import { asNonArrayRecord } from "../../normalization-core/record-coerce.js";
import { normalizeStringEntries } from "../../normalization-core/string-normalization.js";
import { readSnakeCaseParamRaw } from "../../param-key.js";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ToolResultContentSource,
} from "../runtime/index.host-adapter.js";
import { ToolInputError } from "../tool-input-error.js";

export { jsonResult, textResult } from "./tool-results.js";

/**
 * Loosely typed agent tool. Upstream builds this on agent-core's `AgentTool`;
 * only the name, the erased executor and the two before-tool-call hooks the
 * ported explicit-target guard implements are declared here (hook signatures are
 * upstream's `AgentToolWithMeta` text).
 */
export type AnyAgentTool = {
  name: string;
  /** Human-readable label for UI display. */
  label?: string;
  description?: string;
  /** TypeBox schema for the tool parameters. */
  parameters?: unknown;
  /** Optional schema for the structured `AgentToolResult.details` value. */
  outputSchema?: unknown;
  /** Tool results contain externally controlled network content. */
  resultContentSource?: ToolResultContentSource;
  /** Upstream's erased executor (`ErasedAgentToolExecute`), so a ported tool
   * factory's `execute(toolCallId, params)` is contextually typed. */
  execute?(
    this: void,
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback,
  ): Promise<AgentToolResult<unknown>>;
  prepareBeforeToolCallParams?: (
    params: unknown,
    ctx: { toolCallId?: string; hookContext?: unknown; signal?: AbortSignal },
  ) => unknown;
  finalizeBeforeToolCallParams?: (params: unknown, preparedParams: unknown) => unknown;
  [key: string]: unknown;
};

type StringParamOptions = {
  required?: boolean;
  trim?: boolean;
  label?: string;
  allowEmpty?: boolean;
};

function isBlankParamValue(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim() === "";
}

export function asToolParamsRecord(params: unknown): Record<string, unknown> {
  return asNonArrayRecord(params);
}

export function readToolStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string;
export function readToolStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string | undefined;
export function readToolStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
) {
  const { required = false, trim = true, label = key, allowEmpty = false } = options;
  const raw = readSnakeCaseParamRaw(params, key);
  if (typeof raw !== "string") {
    if (required) {
      throw new ToolInputError(`${label} required`);
    }
    return undefined;
  }
  const value = trim ? raw.trim() : raw;
  if (!value && !allowEmpty) {
    if (required) {
      throw new ToolInputError(`${label} required`);
    }
    return undefined;
  }
  return value;
}

/**
 * Upstream's string-or-number reader (`src/agents/tools/common.ts`). Message
 * actions accept a numeric chat id as either a JSON number or its string form.
 */
export function readStringOrNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string } = {},
): string | undefined {
  const { required = false, label = key } = options;
  const raw = readSnakeCaseParamRaw(params, key);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value) {
      return value;
    }
  }
  if (required) {
    throw new ToolInputError(`${label} required`);
  }
  return undefined;
}

export function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: {
    required?: boolean;
    label?: string;
    integer?: boolean;
    strict?: boolean;
    positiveInteger?: boolean;
    nonNegativeInteger?: boolean;
  } = {},
): number | undefined {
  const {
    required = false,
    label = key,
    integer = false,
    strict = false,
    positiveInteger = false,
    nonNegativeInteger = false,
  } = options;
  const raw = readSnakeCaseParamRaw(params, key);
  let value: number | undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    value = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      const parsed = strict ? parseStrictFiniteNumber(trimmed) : Number.parseFloat(trimmed);
      if (parsed !== undefined && Number.isFinite(parsed)) {
        value = parsed;
      }
    }
  }
  if (value === undefined) {
    if (required) {
      throw new ToolInputError(`${label} required`);
    }
    return undefined;
  }
  if (positiveInteger) {
    return asPositiveSafeInteger(value);
  }
  if (nonNegativeInteger) {
    return asSafeIntegerInRange(value, { min: 0 });
  }
  return integer ? Math.trunc(value) : value;
}

export function readPositiveIntegerParam(
  params: Record<string, unknown>,
  key: string,
  options: {
    message?: string;
    max?: number;
  } = {},
): number | undefined {
  const value = readNumberParam(params, key, {
    positiveInteger: true,
    strict: true,
  });
  if (value === undefined) {
    const raw = readSnakeCaseParamRaw(params, key);
    if (raw != null && !isBlankParamValue(raw)) {
      throw new ToolInputError(options.message ?? `${key} must be a positive integer`);
    }
  }
  if (value !== undefined && options.max !== undefined && value > options.max) {
    throw new ToolInputError(options.message ?? `${key} must be a positive integer`);
  }
  return value;
}

// Slice 13 (Discord port): upstream's sibling of `readPositiveIntegerParam`
// from the same module, carried unchanged.
export function readNonNegativeIntegerParam(
  params: Record<string, unknown>,
  key: string,
  options: {
    message?: string;
    max?: number;
  } = {},
): number | undefined {
  const value = readNumberParam(params, key, {
    nonNegativeInteger: true,
    strict: true,
  });
  if (value === undefined) {
    const raw = readSnakeCaseParamRaw(params, key);
    if (raw != null && !isBlankParamValue(raw)) {
      throw new ToolInputError(options.message ?? `${key} must be a non-negative integer`);
    }
  }
  if (value !== undefined && options.max !== undefined && value > options.max) {
    throw new ToolInputError(options.message ?? `${key} must be a non-negative integer`);
  }
  return value;
}

export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string[];
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string[] | undefined;
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
) {
  const { required = false, label = key } = options;
  const raw = readSnakeCaseParamRaw(params, key);
  if (Array.isArray(raw)) {
    const values = normalizeStringEntries(raw.filter((entry) => typeof entry === "string"));
    if (values.length === 0) {
      if (required) {
        throw new ToolInputError(`${label} required`);
      }
      return undefined;
    }
    return values;
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) {
      if (required) {
        throw new ToolInputError(`${label} required`);
      }
      return undefined;
    }
    return [value];
  }
  if (required) {
    throw new ToolInputError(`${label} required`);
  }
  return undefined;
}

// Slice 10b additions (Slack actions port): the action gate and the reaction
// param reader, carried with upstream's bodies from the same source module.

export type ActionGate<T extends Record<string, boolean | undefined>> = (
  key: keyof T,
  defaultValue?: boolean,
) => boolean;

export function createActionGate<T extends Record<string, boolean | undefined>>(
  actions: T | undefined,
): ActionGate<T> {
  return (key, defaultValue = true) => {
    const value = actions?.[key];
    if (value === undefined) {
      return defaultValue;
    }
    return value !== false;
  };
}

type ReactionParams = {
  emoji: string;
  remove: boolean;
  isEmpty: boolean;
};

export function readReactionParams(
  params: Record<string, unknown>,
  options: {
    emojiKey?: string;
    removeKey?: string;
    removeErrorMessage: string;
  },
): ReactionParams {
  const emojiKey = options.emojiKey ?? "emoji";
  const removeKey = options.removeKey ?? "remove";
  const remove = typeof params[removeKey] === "boolean" ? params[removeKey] : false;
  const emoji = readToolStringParam(params, emojiKey, {
    required: true,
    allowEmpty: true,
  });
  if (remove && !emoji) {
    throw new ToolInputError(options.removeErrorMessage);
  }
  return { emoji, remove, isEmpty: !emoji };
}

// Slice 13 (Discord port): upstream's forum-tag reader from the same module,
// carried unchanged with its `AvailableTag` shape exported for the ported
// Discord thread/forum actions.
export type AvailableTag = {
  id?: string;
  name: string;
  moderated?: boolean;
  emoji_id?: string | null;
  emoji_name?: string | null;
};

/**
 * Validate and parse an `availableTags` parameter from untrusted input.
 * Returns `undefined` when the value is missing or not an array.
 * Entries that lack a string `name` are silently dropped.
 */
export function parseAvailableTags(raw: unknown): AvailableTag[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const result = raw
    .filter(
      (t): t is Record<string, unknown> =>
        typeof t === "object" && t !== null && typeof t.name === "string",
    )
    .map((t) =>
      Object.assign(
        {},
        t.id !== undefined && typeof t.id === `string` ? { id: t.id } : {},
        { name: t.name as string },
        typeof t.moderated === `boolean` ? { moderated: t.moderated } : {},
        t.emoji_id === null || typeof t.emoji_id === `string` ? { emoji_id: t.emoji_id } : {},
        t.emoji_name === null || typeof t.emoji_name === `string`
          ? { emoji_name: t.emoji_name }
          : {},
      ),
    );
  // Return undefined instead of empty array to avoid accidentally clearing all tags
  return result.length ? result : undefined;
}
