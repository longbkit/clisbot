import type { ChannelPairingAccessContract } from "../pairing/access-contract.ts";
import { normalizePrefixedEntry } from "../pairing/access-contract.ts";

function normalizeTelegramAllowEntry(entry: string) {
  const trimmed = entry.trim();
  if (!trimmed) {
    return "";
  }
  const stripped = normalizePrefixedEntry(trimmed, ["telegram:", "tg:", "user:"]);
  if (!stripped) {
    return "";
  }
  if (/^-?\d+$/.test(stripped)) {
    return stripped;
  }
  return "";
}

export const telegramPairingAccessContract = {
  channel: "telegram",
  normalizeAllowEntry: normalizeTelegramAllowEntry,
  normalizeApprovedPairingId: normalizeTelegramAllowEntry,
  isSenderAllowed: ({ allowFrom, subject }) => {
    const normalizedUserId = subject.userId?.trim() ?? "";
    const normalizedAllowFrom = allowFrom
      .map(normalizeTelegramAllowEntry)
      .filter(Boolean);

    if (normalizedUserId && normalizedAllowFrom.includes(normalizedUserId)) {
      return true;
    }
    return false;
  },
} satisfies ChannelPairingAccessContract;

export default telegramPairingAccessContract;
