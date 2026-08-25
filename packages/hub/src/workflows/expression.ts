import type { JsonPrimitive, JsonValue } from "../config/compiler.js";

export type ExpressionPath =
  | {
      namespace: "paseo";
      path: "prompt" | "context" | ["inputs", string] | ["execution", "id"];
    }
  | { namespace: "steps"; stepId: string; path: readonly string[] }
  | { namespace: "values"; name: string };

export type Expression =
  | { kind: "literal"; value: JsonValue }
  | { kind: "path"; value: ExpressionPath }
  | { kind: "not"; value: Expression }
  | {
      kind: "binary";
      operator: "==" | "!=" | "&&" | "||" | "??";
      left: Expression;
      right: Expression;
    };

export interface ExpressionContext {
  prompt: string;
  context: JsonValue;
  inputs: Readonly<Record<string, JsonPrimitive>>;
  steps: Readonly<Record<string, { status: string; output: unknown }>>;
  values: Readonly<Record<string, Expression>>;
  executionId?: string;
}

export class ExpressionSyntaxError extends Error {
  constructor(message: string) {
    super(`invalid workflow expression: ${message}`);
    this.name = "ExpressionSyntaxError";
  }
}

export class ExpressionEvaluationError extends Error {
  constructor(message: string) {
    super(`workflow expression could not be evaluated: ${message}`);
    this.name = "ExpressionEvaluationError";
  }
}

type Token =
  | { kind: "literal"; value: JsonValue }
  | { kind: "identifier"; value: string }
  | { kind: "operator"; value: "!" | "==" | "!=" | "&&" | "||" | "??" }
  | { kind: "dot" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "array-left" }
  | { kind: "array-right" }
  | { kind: "object-left" }
  | { kind: "object-right" }
  | { kind: "comma" }
  | { kind: "colon" }
  | { kind: "end" };

type BinaryOperator = "==" | "!=" | "&&" | "||" | "??";
type Operator = "!" | BinaryOperator;

const TOKEN =
  /\s*(?:(true|false|null)|(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([a-z][a-z0-9_-]*)|(!=|==|&&|\|\||\?\?|!)|(\.)|(\()|(\))|(\[)|(\])|(\{)|(\})|(,)|(:)|(.))/gy;

export function parseExpression(source: string): Expression {
  const text = unwrapExpression(source);
  const tokens = tokenize(text);
  let index = 0;
  const parse = (minimumPrecedence = 0): Expression => {
    let left = parsePrefix();
    while (true) {
      const token = tokens[index];
      if (token?.kind !== "operator") break;
      if (token.value === "!") break;
      const operator = token.value as BinaryOperator;
      const precedence = operatorPrecedence(operator);
      if (precedence < minimumPrecedence) break;
      index += 1;
      const right = parse(precedence + 1);
      left = { kind: "binary", operator, left, right };
    }
    return left;
  };

  const parsePrefix = (): Expression => {
    const token = tokens[index++];
    if (token === undefined) throw new ExpressionSyntaxError("expression ended unexpectedly");
    if (token.kind === "literal") return { kind: "literal", value: token.value };
    if (token.kind === "operator" && token.value === "!") {
      return { kind: "not", value: parsePrefix() };
    }
    if (token.kind === "left") {
      const value = parse();
      if (tokens[index]?.kind !== "right") throw new ExpressionSyntaxError("missing ')'");
      index += 1;
      return value;
    }
    if (token.kind === "array-left") return parseArrayLiteral();
    if (token.kind === "object-left") return parseObjectLiteral();
    if (token.kind !== "identifier") throw new ExpressionSyntaxError("expected a value");
    return parsePath(token.value);
  };

  const result = parse();
  if (tokens[index]?.kind !== "end") throw new ExpressionSyntaxError("unexpected token");
  return result;

  function parsePath(first: string): Expression {
    const parts = [first];
    while (tokens[index]?.kind === "dot") {
      index += 1;
      const next = tokens[index++];
      if (next?.kind !== "identifier") throw new ExpressionSyntaxError("expected path segment");
      parts.push(next.value);
    }
    if (parts[0] === "paseo") return parsePaseoPath(parts);
    if (parts[0] === "steps" && parts.length >= 4 && parts[2] === "outputs") {
      return {
        kind: "path",
        value: { namespace: "steps", stepId: parts[1]!, path: parts.slice(3) },
      };
    }
    if (parts[0] === "values" && parts.length === 2) {
      return { kind: "path", value: { namespace: "values", name: parts[1]! } };
    }
    throw new ExpressionSyntaxError(`unsupported path ${parts.join(".")}`);
  }

  function parseArrayLiteral(): Expression {
    const values: JsonValue[] = [];
    if (tokens[index]?.kind === "array-right") {
      index += 1;
      return { kind: "literal", value: values };
    }
    while (true) {
      values.push(readJsonLiteral());
      const separator = tokens[index++];
      if (separator?.kind === "array-right") break;
      if (separator?.kind !== "comma") throw new ExpressionSyntaxError("expected ',' or ']'");
      if (tokens[index]?.kind === "array-right") throw new ExpressionSyntaxError("trailing comma");
    }
    return { kind: "literal", value: values };
  }

  function parseObjectLiteral(): Expression {
    const value: Record<string, JsonValue> = {};
    if (tokens[index]?.kind === "object-right") {
      index += 1;
      return { kind: "literal", value };
    }
    while (true) {
      const key = tokens[index++];
      if (key?.kind !== "literal" || typeof key.value !== "string") {
        throw new ExpressionSyntaxError("object keys must be strings");
      }
      if (tokens[index++]?.kind !== "colon") throw new ExpressionSyntaxError("expected ':'");
      value[key.value] = readJsonLiteral();
      const separator = tokens[index++];
      if (separator?.kind === "object-right") break;
      if (separator?.kind !== "comma") throw new ExpressionSyntaxError("expected ',' or '}'");
      if (tokens[index]?.kind === "object-right") throw new ExpressionSyntaxError("trailing comma");
    }
    return { kind: "literal", value };
  }

  function readJsonLiteral(): JsonValue {
    const expression = parsePrefix();
    if (expression.kind !== "literal") {
      throw new ExpressionSyntaxError("JSON literals cannot contain paths or operators");
    }
    return expression.value;
  }
}

function parsePaseoPath(parts: readonly string[]): Expression {
  if (parts[1] === "prompt" && parts.length === 2) {
    return { kind: "path", value: { namespace: "paseo", path: "prompt" } };
  }
  if (parts[1] === "context" && parts.length === 2) {
    return { kind: "path", value: { namespace: "paseo", path: "context" } };
  }
  if (parts[1] === "inputs" && parts.length === 3) {
    return { kind: "path", value: { namespace: "paseo", path: ["inputs", parts[2]!] } };
  }
  if (parts[1] === "execution" && parts[2] === "id" && parts.length === 3) {
    return { kind: "path", value: { namespace: "paseo", path: ["execution", "id"] } };
  }
  throw new ExpressionSyntaxError(`unsupported path ${parts.join(".")}`);
}

export function expressionPaths(expression: Expression): ExpressionPath[] {
  switch (expression.kind) {
    case "literal":
      return [];
    case "path":
      return [expression.value];
    case "not":
      return expressionPaths(expression.value);
    case "binary":
      return [...expressionPaths(expression.left), ...expressionPaths(expression.right)];
  }
  throw new Error("unreachable expression node");
}

export function evaluateExpression(expression: Expression, context: ExpressionContext): JsonValue {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "path":
      return readPath(expression.value, context);
    case "not":
      return !truthy(evaluateExpression(expression.value, context));
    case "binary": {
      const left = evaluateExpression(expression.left, context);
      if (expression.operator === "&&")
        return truthy(left) ? evaluateExpression(expression.right, context) : left;
      if (expression.operator === "||")
        return truthy(left) ? left : evaluateExpression(expression.right, context);
      if (expression.operator === "??")
        return left === null ? evaluateExpression(expression.right, context) : left;
      const right = evaluateExpression(expression.right, context);
      if (expression.operator === "==") return sameJsonValue(left, right);
      return !sameJsonValue(left, right);
    }
  }
  throw new Error("unreachable expression node");
}

export function renderExpressionTemplate(template: string, context: ExpressionContext): string {
  let cursor = 0;
  let result = "";
  while (cursor < template.length) {
    const start = template.indexOf("${{", cursor);
    if (start < 0) {
      result += template.slice(cursor);
      break;
    }
    result += template.slice(cursor, start);
    const end = template.indexOf("}}", start + 3);
    if (end < 0) throw new ExpressionSyntaxError("unterminated interpolation");
    result += formatInterpolatedValue(
      evaluateExpression(parseExpression(template.slice(start + 3, end)), context),
    );
    cursor = end + 2;
  }
  return result;
}

export function renderExecutionTemplate(template: string, executionId: string): string {
  validateExecutionTemplate(template);
  return renderExpressionTemplate(template, {
    prompt: "",
    context: null,
    inputs: {},
    steps: {},
    values: {},
    executionId,
  });
}

export function validateExecutionTemplate(template: string): void {
  for (const path of expressionPathsInTemplate(template)) {
    if (
      path.namespace !== "paseo" ||
      !Array.isArray(path.path) ||
      path.path[0] !== "execution" ||
      path.path[1] !== "id"
    ) {
      throw new ExpressionSyntaxError("execution templates support only paseo.execution.id paths");
    }
  }
}

export function expressionPathsInTemplate(template: string): ExpressionPath[] {
  const paths: ExpressionPath[] = [];
  let cursor = 0;
  while (cursor < template.length) {
    const start = template.indexOf("${{", cursor);
    if (start < 0) break;
    const end = template.indexOf("}}", start + 3);
    if (end < 0) throw new ExpressionSyntaxError("unterminated interpolation");
    paths.push(...expressionPaths(parseExpression(template.slice(start + 3, end))));
    cursor = end + 2;
  }
  return paths;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const match = TOKEN.exec(source);
    if (match === null) throw new ExpressionSyntaxError("unexpected character");
    const token = tokenFromMatch(match);
    if (token !== undefined) tokens.push(token);
  }
  tokens.push({ kind: "end" });
  return tokens;
}

function tokenFromMatch(match: RegExpExecArray): Token | undefined {
  const [
    raw,
    word,
    number,
    string,
    identifier,
    operator,
    dot,
    left,
    right,
    arrayLeft,
    arrayRight,
    objectLeft,
    objectRight,
    comma,
    colon,
    other,
  ] = match;
  if (other !== undefined) throw new ExpressionSyntaxError(`unexpected token ${other}`);
  if (word !== undefined) {
    let value: JsonValue = null;
    if (word === "true") value = true;
    else if (word === "false") value = false;
    return { kind: "literal", value };
  }
  if (number !== undefined) return { kind: "literal", value: Number(number) };
  if (string !== undefined) return { kind: "literal", value: parseStringLiteral(string) };
  if (identifier !== undefined) return { kind: "identifier", value: identifier };
  if (operator !== undefined && isOperator(operator)) return { kind: "operator", value: operator };
  if (dot !== undefined) return { kind: "dot" };
  if (left !== undefined) return { kind: "left" };
  if (right !== undefined) return { kind: "right" };
  if (arrayLeft !== undefined) return { kind: "array-left" };
  if (arrayRight !== undefined) return { kind: "array-right" };
  if (objectLeft !== undefined) return { kind: "object-left" };
  if (objectRight !== undefined) return { kind: "object-right" };
  if (comma !== undefined) return { kind: "comma" };
  if (colon !== undefined) return { kind: "colon" };
  if (raw.trim() === "") return undefined;
  throw new ExpressionSyntaxError("unexpected token");
}

function parseStringLiteral(value: string): string {
  if (value.startsWith('"')) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new ExpressionSyntaxError("invalid string literal");
    return parsed;
  }
  return value.slice(1, -1).replace(/\\([\\'])/gu, "$1");
}

function isOperator(value: string): value is Operator {
  return (
    value === "!" ||
    value === "==" ||
    value === "!=" ||
    value === "&&" ||
    value === "||" ||
    value === "??"
  );
}

function unwrapExpression(source: string): string {
  const trimmed = source.trim();
  if (!trimmed.startsWith("${{")) return trimmed;
  if (!trimmed.endsWith("}}")) throw new ExpressionSyntaxError("unterminated expression");
  return trimmed.slice(3, -2).trim();
}

function operatorPrecedence(operator: BinaryOperator): number {
  if (operator === "??") return 1;
  if (operator === "||") return 2;
  if (operator === "&&") return 3;
  return 4;
}

function readPath(path: ExpressionPath, context: ExpressionContext): JsonValue {
  if (path.namespace === "paseo") {
    if (path.path === "prompt") return context.prompt;
    if (path.path === "context") return context.context;
    if (path.path[0] === "execution") {
      if (context.executionId === undefined) {
        throw new ExpressionEvaluationError("execution ID is unavailable");
      }
      return context.executionId;
    }
    return context.inputs[path.path[1]] ?? null;
  }
  if (path.namespace === "values") {
    const expression = context.values[path.name];
    if (expression === undefined)
      throw new ExpressionEvaluationError(`value ${path.name} is unavailable`);
    return evaluateExpression(expression, context);
  }
  const step = context.steps[path.stepId];
  if (step === undefined || step.status !== "succeeded") {
    throw new ExpressionEvaluationError(`output from step ${path.stepId} is unavailable`);
  }
  let value: unknown = step.output;
  for (const segment of path.path) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, segment)) {
      throw new ExpressionEvaluationError(
        `output path steps.${path.stepId}.outputs.${path.path.join(".")} is missing`,
      );
    }
    value = Reflect.get(value, segment);
  }
  if (!isJsonValue(value)) throw new ExpressionEvaluationError("output contains a non-JSON value");
  return value;
}

function truthy(value: JsonValue): boolean {
  return value !== false && value !== null && value !== 0 && value !== "";
}

function sameJsonValue(left: JsonValue, right: JsonValue): boolean {
  if (typeof left !== typeof right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatInterpolatedValue(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value).every(isJsonValue);
}
