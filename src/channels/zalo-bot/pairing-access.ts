import type { ChannelPairingAccessContract } from "../pairing/access-contract.ts";
import { normalizePrefixedEntry } from "../pairing/access-contract.ts";

function normalizeZaloBotAllowEntry(entry: string) {
  const trimmed = entry.trim();
  if (!trimmed) {
    return "";
  }
  const stripped = normalizePrefixedEntry(trimmed, ["zalo-bot:"]);
  if (!stripped) {
    return "";
  }
  if (stripped.startsWith("@")) {
    return "";
  }
  return stripped;
}

export const zaloBotPairingAccessContract = {
  channel: "zalo-bot",
  normalizeAllowEntry: normalizeZaloBotAllowEntry,
  normalizeApprovedPairingId: normalizeZaloBotAllowEntry,
  isSenderAllowed: ({ allowFrom, subject }) => {
    const normalizedUserId = subject.userId?.trim() ?? "";
    const normalizedAllowFrom = allowFrom
      .map(normalizeZaloBotAllowEntry)
      .filter(Boolean);

    if (normalizedUserId && normalizedAllowFrom.includes(normalizedUserId)) {
      return true;
    }
    return false;
  },
} satisfies ChannelPairingAccessContract;

export default zaloBotPairingAccessContract;
