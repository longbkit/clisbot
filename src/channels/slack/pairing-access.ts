import type { ChannelPairingAccessContract } from "../pairing/access-contract.ts";
import { normalizePrefixedEntry } from "../pairing/access-contract.ts";

function normalizeSlackAllowEntry(entry: string) {
  const trimmed = entry.trim();
  if (!trimmed) {
    return "";
  }
  return normalizePrefixedEntry(trimmed, ["slack:", "user:"]).toUpperCase();
}

export const slackPairingAccessContract = {
  channel: "slack",
  normalizeAllowEntry: normalizeSlackAllowEntry,
  normalizeApprovedPairingId: normalizeSlackAllowEntry,
  isSenderAllowed: ({ allowFrom, subject }) => {
    const normalizedUserId = subject.userId?.trim().toUpperCase() ?? "";
    if (!normalizedUserId) {
      return false;
    }
    return allowFrom.map(normalizeSlackAllowEntry).includes(normalizedUserId);
  },
} satisfies ChannelPairingAccessContract;

export default slackPairingAccessContract;
