// Fusion-owned message-observation store for one Telegram account (D-TG-031).
//
// Upstream answers "did the provider observe this message in this topic?" from
// its Telegram message cache: every message the bot receives and every message
// it sends is stored with the forum topic it was observed in, and a delegated
// mutation of an EARLIER message is authorized only when that stored
// observation names the same topic (`../message-topic-binding.ts`).
//
// Fusion records the same observations — inbound in `./admission.ts`, the bot's
// own sends in `../outbound-message-context.ts` — so this module exists for one
// reason: the writer and the reader must open the SAME cache.
//
// `createTelegramMessageCache()` resolves its persistent store from the
// AMBIENT runtime (`getTelegramRuntime()`, D-TG-046: keyed by account, resolved
// through `withTelegramAccount`). The inbound transport runs inside that scope;
// a `message` tool call does not — the Hub dispatches `handleAction` on its own
// stack — so the read resolved no runtime, fell back to a per-call in-memory
// map, and answered "not observed" for every message ever recorded. Every
// delegated topic `edit`/`react` was refused (wave 6d, live). Opening the store
// by ACCOUNT ID instead of by ambient scope makes both sides the same store on
// every path.
//
// The deny branch survives: a message nobody observed — a chat id typed by the
// agent, or an inbound message from before this account started — still answers
// "not observed", and `message-topic-binding.ts` refuses the mutation.

import { normalizeOptionalAccountId } from "@getpaseo/channels-core/plugin-sdk/account-resolution";
import { logVerbose } from "@getpaseo/channels-core/plugin-sdk/runtime-env";
import {
  type PersistedTelegramMessageCacheValue,
  TELEGRAM_MESSAGE_CACHE_PERSISTENT_MAX_MESSAGES,
  TELEGRAM_MESSAGE_CACHE_PERSISTENT_NAMESPACE,
} from "../message-cache-persistence.js";
import {
  createTelegramMessageCache,
  hasProviderObservedTelegramThreadBinding as hasUpstreamProviderObservedThreadBinding,
} from "../message-cache.js";
import { getOptionalTelegramRuntime } from "../runtime.js";

export type TelegramMessageObservationCache = ReturnType<typeof createTelegramMessageCache>;

export type TelegramThreadObservationQuery = {
  accountId: string;
  chatId: string;
  messageId: string;
  threadId: number;
};

/**
 * The cache scope both sides key by.
 *
 * The writers hold the Hub's account id; the reader holds the id
 * `message-topic-binding.ts` normalized out of the action params, so the scope
 * is normalized here rather than left to whichever caller got there first.
 */
function observationScope(accountId: string): string {
  return normalizeOptionalAccountId(accountId) ?? accountId.trim();
}

/** The account's durable observation store, or an in-memory one when the
 * account has no runtime installed (a unit fixture, or an account that never
 * started) — which reads back as "not observed", upstream's deny branch. */
function openTelegramMessageObservationCache(
  accountId: string,
): TelegramMessageObservationCache {
  const scope = observationScope(accountId);
  // The install key is the Hub's account id (`runtime-store.ts`); the caller may
  // hold either spelling. The zero-arg lookup is the unkeyed single-account slot
  // the ported unit tests install.
  const runtime =
    getOptionalTelegramRuntime(accountId) ??
    getOptionalTelegramRuntime(scope) ??
    getOptionalTelegramRuntime();
  let persistentStore: ReturnType<typeof createStore> | undefined;
  function createStore() {
    return runtime?.state.openKeyedStore<PersistedTelegramMessageCacheValue>({
      namespace: TELEGRAM_MESSAGE_CACHE_PERSISTENT_NAMESPACE,
      maxEntries: TELEGRAM_MESSAGE_CACHE_PERSISTENT_MAX_MESSAGES,
    });
  }
  try {
    persistentStore = createStore();
  } catch (error) {
    logVerbose(`telegram: failed to open message observation store: ${String(error)}`);
  }
  return createTelegramMessageCache({
    scope,
    ...(persistentStore ? { persistentStore } : {}),
  });
}

/**
 * Records one message the provider showed this account.
 *
 * `providerObservedThread` is the topic the PROVIDER put the message in — the
 * inbound update's own `message_thread_id`, or the topic the Bot API echoed
 * back on a successful send. It is what a later delegated mutation is
 * authorized against, so it is never the topic a caller merely intended.
 */
export async function recordTelegramMessageObservation(
  params: Omit<Parameters<TelegramMessageObservationCache["record"]>[0], "accountId"> & {
    accountId: string;
  },
): Promise<void> {
  const { accountId, ...rest } = params;
  await openTelegramMessageObservationCache(accountId).record({
    accountId: observationScope(accountId),
    ...rest,
  });
}

/** Whether the provider observed `messageId` in `threadId` of `chatId`. */
export async function hasProviderObservedTelegramThreadBinding(
  query: TelegramThreadObservationQuery,
): Promise<boolean> {
  try {
    const node = await openTelegramMessageObservationCache(query.accountId).get({
      accountId: observationScope(query.accountId),
      chatId: query.chatId,
      messageId: query.messageId,
    });
    return hasUpstreamProviderObservedThreadBinding(node, query.threadId);
  } catch (error) {
    // Fail closed, which is upstream's own deny branch.
    logVerbose(`telegram: message observation lookup failed: ${String(error)}`);
    return false;
  }
}
