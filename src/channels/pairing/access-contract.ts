import type { ChannelId } from "../integration/channel-surface-contract.ts";

export type DirectMessagePolicy = "open" | "pairing" | "allowlist" | "disabled";

export type PairingAccessSubject = {
  userId?: string;
  username?: string;
};

export type ChannelPairingAccessContract = {
  channel: ChannelId;
  normalizeAllowEntry(entry: string): string;
  isSenderAllowed(params: {
    allowFrom: string[];
    subject: PairingAccessSubject;
  }): boolean;
};

export function normalizePrefixedEntry(entry: string, prefixes: readonly string[]) {
  const trimmed = entry.trim();
  for (const prefix of prefixes) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return trimmed;
}

export function normalizeLowercaseHandle(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }
  return `@${trimmed.replace(/^@+/, "").toLowerCase()}`;
}
