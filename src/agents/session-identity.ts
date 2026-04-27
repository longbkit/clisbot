import { randomUUID } from "node:crypto";

const DEFAULT_UUID_PATTERN =
  "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b";

export function getDefaultSessionIdPattern() {
  return DEFAULT_UUID_PATTERN;
}

export function createSessionId() {
  return randomUUID();
}

export function extractSessionId(snapshot: string, pattern: string) {
  const regex = new RegExp(pattern, "ig");
  let lastMatch: RegExpExecArray | null = null;

  for (;;) {
    const match = regex.exec(snapshot);
    if (!match) {
      break;
    }
    if (!match[0]) {
      break;
    }
    lastMatch = match;
  }

  return (lastMatch?.[1] ?? lastMatch?.[0] ?? "").trim() || null;
}
