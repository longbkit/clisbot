import type { ChannelPairingAccessContract } from "../pairing/access-contract.ts";
import {
  normalizeLowercaseHandle,
  normalizePrefixedEntry,
} from "../pairing/access-contract.ts";

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
    return stripped.toLowerCase();
  }
  if (/^-?\d+$/.test(stripped)) {
    return stripped;
  }
  return `@${stripped.toLowerCase()}`;
}

export const zaloBotPairingAccessContract = {
  channel: "zalo-bot",
  normalizeAllowEntry: normalizeZaloBotAllowEntry,
  isSenderAllowed: ({ allowFrom, subject }) => {
    const normalizedUserId = subject.userId?.trim() ?? "";
    const normalizedUsername = normalizeLowercaseHandle(subject.username);
    const normalizedAllowFrom = allowFrom
      .map(normalizeZaloBotAllowEntry)
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

export default zaloBotPairingAccessContract;
