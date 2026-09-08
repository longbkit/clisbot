// Fusion-owned seam for the provider-observed thread binding that
// `../message-topic-binding.ts` needs (D-TG-031).
//
// Upstream answers this from its Telegram message cache: every inbound message
// is stored with the forum topic it was observed in, and a delegated mutation of
// an earlier message is authorized only when that stored observation names the
// same topic. Slice 20 ports that cache (`../message-cache.ts`, over the Hub
// keyed store through `../runtime.ts`) and records every admitted inbound
// message into it (`./admission.ts`), so this seam is now the read upstream
// performs: `createTelegramMessageCache().get()` + the upstream predicate
// `hasProviderObservedTelegramThreadBinding()`.
//
// The deny branch survives: a message nobody observed — a chat id typed by the
// agent, or an inbound message from before this account started — still answers
// "not observed", and `message-topic-binding.ts` refuses the mutation.

import {
  createTelegramMessageCache,
  hasProviderObservedTelegramThreadBinding as hasUpstreamProviderObservedThreadBinding,
} from "../message-cache.js";

export type TelegramThreadObservationQuery = {
  accountId: string;
  chatId: string;
  messageId: string;
  threadId: number;
};

/** Whether the provider observed `messageId` in `threadId` of `chatId`. */
export async function hasProviderObservedTelegramThreadBinding(
  query: TelegramThreadObservationQuery,
): Promise<boolean> {
  try {
    const node = await createTelegramMessageCache({ scope: query.accountId }).get({
      accountId: query.accountId,
      chatId: query.chatId,
      messageId: query.messageId,
    });
    return hasUpstreamProviderObservedThreadBinding(node, query.threadId);
  } catch {
    // No runtime installed (a unit fixture, or an account that never started).
    // Fail closed, which is upstream's own deny branch.
    return false;
  }
}
