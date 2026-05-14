import { randomUUID } from "node:crypto";

const DEFAULT_UUID_PATTERN =
  "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b";

export function getDefaultSessionIdPattern() {
  return DEFAULT_UUID_PATTERN;
}

export function createSessionId() {
  return randomUUID();
}

export function parseRunnerSessionId(snapshot: string, pattern: string) {
  // Parsing is intentionally boundary-local: given candidate text plus a
  // runner-specific pattern, return the last matching runner-side sessionId.
  // Persistence decisions belong in the agents layer, not here.
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
