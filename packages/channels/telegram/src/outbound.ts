// Outbound: `plugin.outbound.sendText` (blueprint §6.5 hard rule 2, B3):
// resolve the account + token from `cfg`, resolve the target chat id (numeric
// pass-through or getChat lookup), send through the L1 text path, and record
// each delivered chunk in the plane's keyed-store seam (D-001 — the pinned
// `sent-message-cache` config-file write is re-targeted at the seam).

import type { SendTextFn } from "@getpaseo/channels-shared";
import { getHostRuntime } from "./runtime-store.js";
import {
  buildTelegramClientOptions,
  createTelegramApi,
  openTelegramSeamStores,
  parseOutboundTarget,
  resolveChatId,
  resolveTelegramAccount,
  sendTelegramText,
  type TelegramCfg,
  type TelegramSeamStores,
} from "./client/bot-api.js";
import { recordSentMessage } from "./client/sent-messages.js";

const SEAM_STORES: WeakMap<object, TelegramSeamStores> = new WeakMap();

/** The per-host-runtime seam stores (one set per runtime object). */
function openSeamStores(): TelegramSeamStores {
  const runtime = getHostRuntime();
  let stores = SEAM_STORES.get(runtime);
  if (stores === undefined) {
    stores = openTelegramSeamStores(runtime);
    SEAM_STORES.set(runtime, stores);
  }
  return stores;
}

/** `plugin.outbound.sendText` — the Hub relay posts final answers through
 * this. `to` is a chat id or `@username`, optional `:topic:<id>`; `threadId`
 * is the topic's numeric id as a string when `to` carried none. */
export const sendText: SendTextFn = async ({ cfg, accountId, to, threadId, text, replyTo }) => {
  // The token comes from `cfg.channels.telegram.accounts.<id>.botToken`
  // (start-account.md: the outbound path reads tokens from cfg, not the
  // flat drive-time account).
  const account = resolveTelegramAccount(cfg as unknown as TelegramCfg, accountId);
  const target = parseOutboundTarget(String(to));
  const messageThreadId =
    target.messageThreadId ??
    (threadId !== undefined && threadId !== "" ? Number(threadId) : undefined);
  if (
    messageThreadId !== undefined &&
    (!Number.isSafeInteger(messageThreadId) || messageThreadId <= 0)
  ) {
    throw new Error(`invalid Telegram topic id "${String(threadId)}"`);
  }
  const api = await createTelegramApi(account.token, buildTelegramClientOptions(account));
  const chatId = await resolveChatId(target.chatId, api);
  const stores = await openSeamStores();
  const result = await sendTelegramText({
    api,
    chatId,
    text: String(text),
    ...(messageThreadId !== undefined ? { messageThreadId } : {}),
    ...(typeof replyTo === "number" ? { replyToMessageId: replyTo } : {}),
    log: (message) => getHostRuntime().logging.getChildLogger().debug?.(message),
    recordSent: async (sentChatId, messageId) => {
      await recordSentMessage(stores.sentMessages, sentChatId, messageId);
    },
  });
  return result;
};
