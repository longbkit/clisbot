import type { PairingChannel } from "./store.ts";

export type DirectMessagePolicy = "open" | "pairing" | "allowlist" | "disabled";

function normalizePrefixedEntry(entry: string, prefixes: string[]) {
  const trimmed = entry.trim();
  for (const prefix of prefixes) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
}

export function normalizeAllowEntry(channel: PairingChannel, entry: string) {
  const trimmed = entry.trim();
  if (!trimmed) {
    return "";
  }

  if (channel === "slack") {
    return normalizePrefixedEntry(trimmed, ["slack:", "user:"]).toUpperCase();
  }

  const stripped = normalizePrefixedEntry(trimmed, ["telegram:", "tg:", "user:"]);
  if (!stripped) {
    return "";
  }
  if (stripped.startsWith("@")) {
    return stripped.toLowerCase();
  }
  if (/^-?\d+$/.test(stripped)) {
    return stripped;
  }
  return `@${stripped.toLowerCase()}`;
}

export function isSlackSenderAllowed(params: {
  allowFrom: string[];
  userId: string;
}) {
  const normalizedUserId = params.userId.trim().toUpperCase();
  if (!normalizedUserId) {
    return false;
  }

  return params.allowFrom
    .map((entry) => normalizeAllowEntry("slack", entry))
    .includes(normalizedUserId);
}

export function isSlackSenderBlocked(params: {
  blockFrom: string[];
  userId: string;
}) {
  return isSlackSenderAllowed({
    allowFrom: params.blockFrom,
    userId: params.userId,
  });
}

export function isTelegramSenderAllowed(params: {
  allowFrom: string[];
  userId?: string;
  username?: string;
}) {
  const userId = params.userId?.trim() ?? "";
  const username = params.username?.trim() ? `@${params.username.trim().replace(/^@+/, "").toLowerCase()}` : "";
  const normalizedAllowFrom = params.allowFrom
    .map((entry) => normalizeAllowEntry("telegram", entry))
    .filter(Boolean);

  if (userId && normalizedAllowFrom.includes(userId)) {
    return true;
  }

  if (username && normalizedAllowFrom.includes(username)) {
    return true;
  }

  return false;
}

export function isTelegramSenderBlocked(params: {
  blockFrom: string[];
  userId?: string;
  username?: string;
}) {
  return isTelegramSenderAllowed({
    allowFrom: params.blockFrom,
    userId: params.userId,
    username: params.username,
  });
}
