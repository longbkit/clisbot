import type { ApiFilterConfig, ApiMapProjection, ApiMapValue } from "./config.ts";

const MISSING = Symbol("missing");
type Missing = typeof MISSING;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed.startsWith("$") && !trimmed.startsWith("@")) {
    throw new Error(`Invalid path ${path}: expected $ or @`);
  }
  const tokens: Array<string | number> = [];
  let index = 1;
  while (index < trimmed.length) {
    if (trimmed[index] === ".") {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed.slice(index + 1));
      if (!match) {
        throw new Error(`Invalid path ${path}: expected property after dot`);
      }
      tokens.push(match[0]);
      index += match[0].length + 1;
      continue;
    }
    if (trimmed[index] === "[") {
      const close = trimmed.indexOf("]", index);
      if (close < 0) {
        throw new Error(`Invalid path ${path}: missing ]`);
      }
      const raw = trimmed.slice(index + 1, close).trim();
      const quoted = /^["'](.*)["']$/.exec(raw);
      tokens.push(quoted ? quoted[1]! : Number(raw));
      index = close + 1;
      continue;
    }
    throw new Error(`Invalid path ${path}: unexpected token at ${index}`);
  }
  return {
    root: trimmed[0] as "$" | "@",
    tokens,
  };
}

export function readApiPath(path: string, payload: unknown, current?: unknown): unknown | Missing {
  const parsed = parsePath(path);
  let value = parsed.root === "$" ? payload : current;
  for (const token of parsed.tokens) {
    if (typeof token === "number") {
      if (!Array.isArray(value) || !Number.isInteger(token) || token < 0 || token >= value.length) {
        return MISSING;
      }
      value = value[token];
      continue;
    }
    if (!isRecord(value) || !(token in value)) {
      return MISSING;
    }
    value = value[token];
  }
  return value;
}

function isPathExpression(value: string) {
  return /^[$@](?:\.|\[|$)/.test(value.trim());
}

function stringifyTemplateValue(value: unknown) {
  if (value === MISSING || value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function renderTemplate(raw: string, payload: unknown, current?: unknown, extra: Record<string, unknown> = {}) {
  return raw.replaceAll(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression: string) => {
    const expr = expression.trim();
    if (expr.startsWith("$.") || expr.startsWith("$[")) {
      return stringifyTemplateValue(readApiPath(expr, payload, current));
    }
    if (expr.startsWith("@.") || expr.startsWith("@[")) {
      return stringifyTemplateValue(readApiPath(expr, payload, current));
    }
    return stringifyTemplateValue(readDottedExtra(expr, extra));
  });
}

function readDottedExtra(path: string, extra: Record<string, unknown>) {
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  let value: unknown = extra;
  for (const part of parts) {
    if (!isRecord(value) || !(part in value)) {
      return MISSING;
    }
    value = value[part];
  }
  return value;
}

function isProjection(value: unknown): value is ApiMapProjection {
  return isRecord(value) && typeof value.from === "string" && isRecord(value.map);
}

export function evaluateApiMapValue(
  value: ApiMapValue,
  payload: unknown,
  current?: unknown,
  extra: Record<string, unknown> = {},
): unknown {
  if (typeof value === "string") {
    if (isPathExpression(value)) {
      return readApiPath(value, payload, current);
    }
    return renderTemplate(value, payload, current, extra);
  }
  if (Array.isArray(value)) {
    return value.map((item) => evaluateApiMapValue(item, payload, current, extra));
  }
  if (isProjection(value)) {
    const source = readApiPath(value.from, payload, current);
    if (!Array.isArray(source)) {
      return [];
    }
    return source.map((item) => evaluateApiMapObject(value.map, payload, item, extra));
  }
  if (isRecord(value)) {
    return evaluateApiMapObject(value as Record<string, ApiMapValue>, payload, current, extra);
  }
  return value;
}

export function evaluateApiMapObject(
  map: Record<string, ApiMapValue>,
  payload: unknown,
  current?: unknown,
  extra: Record<string, unknown> = {},
) {
  return Object.fromEntries(
    Object.entries(map).map(([key, value]) => [
      key,
      evaluateApiMapValue(value, payload, current, extra),
    ]),
  );
}

function hasOwnOperator(predicate: Record<string, unknown>) {
  return ["equals", "notEquals", "exists", "in", "anyIn"].filter((key) => key in predicate);
}

export function evaluateApiFilter(filter: ApiFilterConfig | undefined, payload: unknown): boolean {
  if (!filter) {
    return true;
  }
  if ("all" in filter) {
    return filter.all.every((child) => evaluateApiFilter(child, payload));
  }
  if ("any" in filter) {
    return filter.any.some((child) => evaluateApiFilter(child, payload));
  }
  if ("not" in filter) {
    return !evaluateApiFilter(filter.not, payload);
  }
  const operators = hasOwnOperator(filter as Record<string, unknown>);
  if (operators.length !== 1) {
    throw new Error(`Filter for ${filter.path} must declare exactly one operator`);
  }
  const value = readApiPath(filter.path, payload);
  if ("exists" in filter) {
    return filter.exists ? value !== MISSING : value === MISSING;
  }
  if (value === MISSING) {
    return false;
  }
  if ("equals" in filter) {
    return Object.is(value, filter.equals);
  }
  if ("notEquals" in filter) {
    return !Object.is(value, filter.notEquals);
  }
  if ("in" in filter) {
    return (filter.in ?? []).some((item) => Object.is(item, value));
  }
  if ("anyIn" in filter) {
    return Array.isArray(value) && value.some((item) => (filter.anyIn ?? []).includes(item));
  }
  return false;
}

export function normalizeMappedString(value: unknown, field: string) {
  if (value === MISSING || value == null || value === "") {
    throw new Error(`Missing required mapped field: ${field}`);
  }
  return String(value);
}
