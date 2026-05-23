import type { ChannelPairingAccessContract } from "../pairing/access-contract.ts";
import { normalizePrefixedEntry } from "../pairing/access-contract.ts";

function normalizeZaloPersonalAllowEntry(entry: string) {
  const trimmed = entry.trim();
  if (!trimmed) {
    return "";
  }
  const stripped = normalizePrefixedEntry(trimmed, ["zalo-personal:"]);
  if (!stripped || stripped.startsWith("@")) {
    return "";
  }
  return stripped;
}

export const zaloPersonalPairingAccessContract = {
  channel: "zalo-personal",
  normalizeAllowEntry: normalizeZaloPersonalAllowEntry,
  normalizeApprovedPairingId: normalizeZaloPersonalAllowEntry,
  isSenderAllowed: ({ allowFrom, subject }) => {
    const normalizedUserId = subject.userId?.trim() ?? "";
    return Boolean(
      normalizedUserId &&
        allowFrom.map(normalizeZaloPersonalAllowEntry).includes(normalizedUserId),
    );
  },
} satisfies ChannelPairingAccessContract;

export default zaloPersonalPairingAccessContract;
