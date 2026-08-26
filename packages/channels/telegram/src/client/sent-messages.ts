// The durable sent-message record (the pinned `sent-message-cache` chunk's
// store half, re-targeted at the plane's keyed-store seam — D-001). The Hub
// reads these rows for read-back matching and transcript context; the native
// OpenClaw config-file write is gone.

import type { HostKeyedStore } from "@getpaseo/channels-shared";

export interface TelegramSentMessagesStore extends HostKeyedStore<{
  chatId: string;
  messageId: string;
  timestamp: number;
}> {}

/** Record one delivered message. Idempotent: re-recording a
 * (chat, message) pair overwrites in place (the store's TTL caps growth;
 * the namespace `maxEntries` evicts the oldest on overflow). */
export async function recordSentMessage(
  store: TelegramSentMessagesStore,
  chatId: number | string,
  messageId: number | string,
  now?: number,
): Promise<void> {
  const key = `${String(chatId)}:${String(messageId)}`;
  await store.register(key, {
    chatId: String(chatId),
    messageId: String(messageId),
    timestamp: now ?? Date.now(),
  });
}

/** Lookup a previously recorded message id (read-back matching). */
export async function lookupSentMessage(
  store: TelegramSentMessagesStore,
  chatId: number | string,
  messageId: number | string,
): Promise<{ chatId: string; messageId: string; timestamp: number } | undefined> {
  return store.lookup(`${String(chatId)}:${String(messageId)}`);
}
