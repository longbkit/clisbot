import { expect } from "@playwright/test";

export interface FailureRecord {
  message: string;
  operation?: string;
  component?: string;
  provider?: string;
  failureKind?: string;
  requestId?: string;
  diagnostic?: Record<string, unknown>;
  /** The record's own text, for the parts that were never machine-readable (stack frames). */
  raw: string;
}

const HEADLINE = /^\[[^\]]+\]\s+(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL):\s*(.*)$/u;
const ENTRY = /^ {4}(\w+):\s*(.*)$/u;

/**
 * The records a built Hub wrote, as fields rather than as text.
 *
 * A Hub attached to a terminal pretty-prints (`operation: "x"` over several lines) and one
 * writing to a machine emits a JSON object per line (`"operation":"x"`). Both are read here, so
 * a test asserts what the boundary reported and never how the runtime chose to print it — the
 * key quoting is a logging-library detail and pinning it down catches nothing worth catching.
 */
export function failureRecords(logs: string): readonly FailureRecord[] {
  const lines = stripAnsi(logs).split("\n");
  const records: FailureRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const json = parseObject(line);
    if (json !== undefined) {
      records.push(fromFields(json, String(json["msg"] ?? ""), line));
      continue;
    }
    const headline = HEADLINE.exec(line);
    if (headline === null) continue;
    const block: string[] = [];
    while (index + 1 < lines.length && lines[index + 1]!.startsWith("    ")) {
      index += 1;
      block.push(lines[index]!);
    }
    records.push(fromFields(prettyFields(block), headline[1]!, [line, ...block].join("\n")));
  }
  return records;
}

export function recordsFor(logs: string, operation: string): readonly FailureRecord[] {
  return failureRecords(logs).filter((record) => record.operation === operation);
}

export function stripAnsi(logs: string): string {
  return logs.replace(/\[[0-9;]*m/gu, "");
}

/**
 * Asserts a boundary reported exactly one failure and returns it, so the test can go on to make
 * claims about its fields rather than about the string they were printed in.
 */
export function expectOneFailure(
  logs: string,
  expected: { operation: string; failureKind: string; provider?: string },
): FailureRecord {
  const matches = recordsFor(logs, expected.operation);
  expect(matches, `expected exactly one ${expected.operation} record`).toHaveLength(1);
  const record = matches[0]!;
  expect(record.failureKind).toBe(expected.failureKind);
  expect(record.component).toBe("provider_applications");
  if (expected.provider !== undefined) expect(record.provider).toBe(expected.provider);
  expect(record.requestId, "a failure without a correlation ID cannot be reported").toBeTruthy();
  // The original Error is the diagnostic, whichever way it was serialized.
  expect(record.raw, "the record carries no Error type").toMatch(/["']?type["']?:\s*"\w*Error"/u);
  return record;
}

function fromFields(
  fields: Readonly<Record<string, unknown>>,
  message: string,
  raw: string,
): FailureRecord {
  const diagnostic = fields["diagnostic"];
  return {
    message,
    raw,
    ...text(fields, "operation"),
    ...text(fields, "component"),
    ...text(fields, "provider"),
    ...text(fields, "failureKind"),
    ...text(fields, "requestId"),
    ...(typeof diagnostic === "object" && diagnostic !== null
      ? { diagnostic: diagnostic as Record<string, unknown> }
      : {}),
  };
}

function text(
  fields: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, string> | Record<string, never> {
  const value = fields[key];
  return typeof value === "string" ? { [key]: value } : {};
}

/** One pretty-printed record's `key: value` entries, with nested objects gathered whole. */
function prettyFields(block: readonly string[]): Readonly<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  for (let index = 0; index < block.length; index += 1) {
    const entry = ENTRY.exec(block[index]!);
    if (entry === null) continue;
    const [, key, head] = entry;
    if (!head!.startsWith("{") && !head!.startsWith("[")) {
      fields[key!] = parseScalar(head!);
      continue;
    }
    // Gather to the closing brace at the entry's own indentation, which is where the library
    // puts it. Anything in between belongs to this value, JSON or not.
    const nested = [head!];
    while (index + 1 < block.length) {
      index += 1;
      nested.push(block[index]!);
      if (/^ {4}[}\]],?$/u.test(block[index]!)) break;
    }
    // A nested block may hold raw stack frames, which are not JSON. Those fields stay absent
    // rather than becoming a lie about what was logged.
    fields[key!] = parseObject(nested.join("\n")) ?? undefined;
  }
  return fields;
}

function parseScalar(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function parseObject(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
