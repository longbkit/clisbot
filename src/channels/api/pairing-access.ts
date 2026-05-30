import type { ChannelPairingAccessContract } from "../pairing/access-contract.ts";
import { normalizePrefixedEntry } from "../pairing/access-contract.ts";

function normalizeApiAllowEntry(entry: string) {
  return normalizePrefixedEntry(entry.trim(), ["api:"]);
}

export const apiPairingAccessContract = {
  channel: "api",
  normalizeAllowEntry: normalizeApiAllowEntry,
  normalizeApprovedPairingId: normalizeApiAllowEntry,
  isSenderAllowed: ({ allowFrom, subject }) => {
    const userId = subject.userId?.trim() ?? "";
    if (!userId) {
      return false;
    }
    return allowFrom.map(normalizeApiAllowEntry).includes(userId);
  },
} satisfies ChannelPairingAccessContract;

export default apiPairingAccessContract;
