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
  const regex = new RegExp(pattern, "i");
  const match = snapshot.match(regex);
  if (!match) {
    return null;
  }

  return (match[1] ?? match[0] ?? "").trim() || null;
}
