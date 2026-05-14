import type { ChannelPairingAccessContract } from "../pairing/access-contract.ts";
import {
  normalizeLowercaseHandle,
  normalizePrefixedEntry,
} from "../pairing/access-contract.ts";

function normalizeTelegramAllowEntry(entry: string) {
  const trimmed = entry.trim();
  if (!trimmed) {
    return "";
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

export const telegramPairingAccessContract = {
  channel: "telegram",
  normalizeAllowEntry: normalizeTelegramAllowEntry,
  isSenderAllowed: ({ allowFrom, subject }) => {
    const normalizedUserId = subject.userId?.trim() ?? "";
    const normalizedUsername = normalizeLowercaseHandle(subject.username);
    const normalizedAllowFrom = allowFrom
      .map(normalizeTelegramAllowEntry)
      .filter(Boolean);

    if (normalizedUserId && normalizedAllowFrom.includes(normalizedUserId)) {
      return true;
    }
    if (normalizedUsername && normalizedAllowFrom.includes(normalizedUsername)) {
      return true;
    }
    return false;
  },
} satisfies ChannelPairingAccessContract;

export default telegramPairingAccessContract;
