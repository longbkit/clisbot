// Outbound: `plugin.outbound.sendText` (blueprint §6.5 hard rule 2, B3):
// resolve the account + token from `cfg`, resolve the target chat id (numeric
// pass-through or getChat lookup), send through the L1 text path, and record
// each delivered chunk in the plane's keyed-store seam (D-001 — the pinned
// `sent-message-cache` config-file write is re-targeted at the seam).

import { statSync } from "node:fs";
import { extname } from "node:path";
import type { HostRuntime, SendMediaFn, SendTextFn } from "@getpaseo/channels-shared";
import { evaluateOutboundMedia, mediaFileName, mimeFromExtension } from "@getpaseo/channels-shared";
import { getHostRuntime } from "./runtime-store.js";
import { sendTelegramMedia } from "./outbound-media.js";
import {
  buildTelegramClientOptions,
  createTelegramApi,
  editTelegramMessageText,
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
function runtimeOf(args: Record<string, unknown>): HostRuntime {
  return (args["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime();
}

function openSeamStores(runtime: HostRuntime): TelegramSeamStores {
  let stores = SEAM_STORES.get(runtime);
  if (stores === undefined) {
    stores = openTelegramSeamStores(runtime);
    SEAM_STORES.set(runtime, stores);
  }
  return stores;
}

/** The `reply_markup` value the send args carry (the Hub's card builder
 * mints it; the vertical posts it verbatim on chunk 0). */
function replyMarkupOf(args: Parameters<SendTextFn>[0]): Record<string, unknown> | undefined {
  const markup = args["replyMarkup"];
  if (typeof markup === "object" && markup !== null && !Array.isArray(markup)) {
    return markup as Record<string, unknown>;
  }
  return undefined;
}

/** COMPAT(clisbot-control-plane): `plugin.outbound.sendText` — the Hub relay
 * posts text answers through this. Media is posted only through the Hub's
 * explicit `send_file` MCP tool, which routes into this vertical's
 * `sendMedia`; G7–G11 semantics remain unchanged. `to` is a chat id or
 * `@username`, optional `:topic:<id>`; `threadId`
 * is the topic's numeric id as a string when `to` carried none. The optional
 * `replyMarkup` arg (COMPAT(clisbot-control-plane)) carries the native
 * approval card's inline keyboard, posted on chunk 0 alongside the text. */
export const sendText: SendTextFn = async (args) => {
  const { cfg, accountId, to, threadId, text, replyTo } = args;
  const runtime = runtimeOf(args);
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
  const stores = openSeamStores(runtime);
  const replyMarkup = replyMarkupOf(args);
  const result = await sendTelegramText({
    api,
    chatId,
    text: String(text),
    // The account's `richMessages` (D-003, default on): markdown → Bot API
    // HTML (`parse_mode: HTML`); an explicit `richMessages: false` opts out
    // to plain text. `messageThreadId` rides on EVERY chunk,
    // `replyToMessageId` on chunk 0 only (the shared thread-param builders
    // inside `sendTelegramText` — F-07).
    rich: account.config.richMessages,
    ...(messageThreadId !== undefined ? { messageThreadId } : {}),
    ...(typeof replyTo === "number" ? { replyToMessageId: replyTo } : {}),
    ...(replyMarkup !== undefined ? { replyMarkup, cardPosted: true } : {}),
    log: (message) => runtime.logging.getChildLogger().debug?.(message),
    recordSent: async (sentChatId, messageId) => {
      await recordSentMessage(stores.sentMessages, sentChatId, messageId);
    },
  });
  return result;
};

/**
 * COMPAT(clisbot-control-plane): the in-place update (`plugin.outbound
 * .updateText` → `editMessageText`). The approval card's decided state lands
 * here; `clearCard` (on unless the caller opts out) strips the inline
 * keyboard so a stale button click has no live markup. The Hub's approval
 * engine decides against it. Args mirror the plane's `OutboundUpdateParams`.
 */
export async function updateText(args: {
  cfg: Record<string, unknown>;
  accountId: string;
  to: string;
  threadId?: string;
  text: string;
  externalMessageId: string;
  clearCard?: boolean;
  [key: string]: unknown;
}): Promise<{ ok: boolean }> {
  const runtime = runtimeOf(args);
  const account = resolveTelegramAccount(args.cfg as unknown as TelegramCfg, args.accountId);
  const target = parseOutboundTarget(String(args.to));
  const api = await createTelegramApi(account.token, buildTelegramClientOptions(account));
  const chatId = await resolveChatId(target.chatId, api);
  const messageId = Number(args.externalMessageId);
  if (!Number.isSafeInteger(messageId) || messageId === 0) {
    throw new Error(`invalid Telegram message id "${String(args.externalMessageId)}"`);
  }
  await editTelegramMessageText({
    api,
    chatId,
    messageId,
    text: String(args.text),
    clearCard: args.clearCard !== false,
    rich: account.config.richMessages,
    log: (message) => runtime.logging.getChildLogger().debug?.(message),
  });
  return { ok: true };
}

/**
 * COMPAT(clisbot-control-plane): the native-media post
 * (`plugin.outbound.sendMedia`, G7–G11). One call posts ONE local media file
 * through the mime-routed Bot API method (any file type: a mapped mime routes
 * to its native method, everything else — including an unknown extension —
 * to `sendDocument` as `application/octet-stream`). The G11 gate runs FIRST
 * and is size-only (the Bot API's 50 MB upload cap): an oversized file is
 * not dropped — the in-channel notice is posted through the plain text path
 * and `mediaPosted` reports false. A transport fault (missing file, Bot API
 * failure) throws (the Hub's failDelivery owns it).
 */
export const sendMedia: SendMediaFn = async (args) => {
  const { cfg, accountId, to, threadId, filePath } = args;
  const runtime = runtimeOf(args);
  const account = resolveTelegramAccount(cfg as unknown as TelegramCfg, accountId);
  const target = parseOutboundTarget(String(to));
  const messageThreadId =
    target.messageThreadId ??
    (threadId !== undefined && threadId !== "" ? Number(threadId) : undefined);
  const api = await createTelegramApi(account.token, buildTelegramClientOptions(account));
  const chatId = await resolveChatId(target.chatId, api);
  const stores = openSeamStores(runtime);
  const log = (message: string) => runtime.logging.getChildLogger().debug?.(message);
  const postText = (text: string): Promise<{ messageId: string }> =>
    sendText({
      cfg,
      hostRuntime: runtime,
      accountId,
      to: String(to),
      ...(threadId !== undefined && threadId !== "" ? { threadId } : {}),
      text,
    });
  const fileName = mediaFileName(filePath);
  const mime = mimeFromExtension(extname(filePath));
  let sizeBytes: number;
  try {
    sizeBytes = statSync(filePath).size;
  } catch {
    throw new Error(`Telegram sendMedia: local media file not found: ${filePath}`);
  }
  const decision = evaluateOutboundMedia({
    sizeBytes,
    channel: "telegram",
    fileName,
  });
  if (!decision.ok) {
    // G11: the file is not posted natively — post the notice instead.
    const notice = await postText(decision.notice);
    return { messageId: notice.messageId, mediaPosted: false };
  }
  const result = await sendTelegramMedia({
    api,
    chatId,
    filePath,
    fileName,
    mime: mime ?? "application/octet-stream",
    ...(messageThreadId !== undefined ? { messageThreadId } : {}),
    log,
  });
  await recordSentMessage(stores.sentMessages, Number(result.chatId), result.messageId);
  return { messageId: result.messageId, mediaPosted: true };
};
