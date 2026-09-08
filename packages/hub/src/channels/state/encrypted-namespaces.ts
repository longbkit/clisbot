// COMPAT(clisbot-channels): which keyed-store namespaces hold CREDENTIAL
// material rather than protocol bookkeeping.
//
// A channel vertical persists two very different things through the same
// `HostRuntime.state.openKeyedStore` seam. Most of it is protocol state —
// Telegram's long-poll offset, the send-dedupe caches — which is hot, cheap to
// lose (a replay) and stays a plain JSON file under the account's state dir. A
// QR-login session is the opposite: those bytes ARE the account, and the
// runtime-strategy rule for that family (§0.1 note 7 / §3) is native storage
// semantics with encrypted-at-rest storage, on the Hub's existing credential
// key custody rather than a channel-specific loosening of it.
//
// Naming a namespace here is what routes it to the encrypted database backing
// (`state/secret-backend.ts`). The vertical opens the same namespace either way
// and cannot tell which backing it got, so a channel that later needs one is a
// one-line addition rather than a new table.

import type { SupportedChannelName } from "../catalog.js";

/**
 * Encrypted namespaces per channel, by the namespace name the vertical opens.
 *
 * `zalouser` → `credentials`: upstream's own namespace name
 * (`session-state.ts` `ZALOUSER_SESSION_NAMESPACE`), holding
 * `{ imei, cookie, userAgent, language }` — a complete, replayable credential
 * for a human's personal Zalo account.
 */
const ENCRYPTED_STATE_NAMESPACES: Partial<Record<SupportedChannelName, readonly string[]>> = {
  zalouser: ["credentials"],
};

/** The namespaces this channel stores encrypted; empty for every channel whose
 * keyed-store use is protocol state only. */
export function encryptedStateNamespaces(channel: string): readonly string[] {
  return ENCRYPTED_STATE_NAMESPACES[channel as SupportedChannelName] ?? [];
}

/** True when the channel keeps any credential material in its keyed store —
 * the gate for opening a database-backed root instead of a file-backed one. */
export function hasEncryptedState(channel: string): boolean {
  return encryptedStateNamespaces(channel).length > 0;
}
