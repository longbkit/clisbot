// COMPAT(clisbot-control-plane): Telegram OUTBOUND native media (G7–G10) —
// post a local media file through the Bot API's typed send methods
// (sendPhoto / sendDocument / sendAudio / sendVoice / sendVideo /
// sendAnimation), one post per file. The mime→method routing mirrors OpenClaw
// `extensions/telegram/src/outbound-media.ts` (`resolveTelegramOutboundMediaSenders`),
// trimmed to the P0 surface (no force-document/video-note/dimension-validation:
// those ride on the Hub's failDelivery + the pinned retry policy, not here; the
// size-trimmed photo fallback — an image over the Bot API's 10 MB photo limit
// goes out as a document, mirroring OpenClaw's "…Sending as document instead.").
//
// The G11 size/format gate + the in-channel "could not post" notice are NOT
// here — they live in the shared policy (`@getpaseo/channels-shared`
// `evaluateOutboundMedia`), applied by `outbound.sendMedia` before this runs.
// A transport fault (missing file, Bot API failure) THROWS from here; the Hub
// owns retry accounting.

import { readFileSync } from "node:fs";
import { InputFile } from "grammy";
import type { TelegramApi } from "./client/bot-api.js";
import { withTelegramSendRetry } from "./client/bot-api.js";
import { buildTelegramReplyParams, buildTelegramThreadParams } from "./leaves/rich-message.js";

/** The Bot API media-send method label the mime routes to. */
export type TelegramMediaMethod =
  | "sendPhoto"
  | "sendDocument"
  | "sendAudio"
  | "sendVoice"
  | "sendVideo"
  | "sendAnimation";

/** The Bot API result every media send returns: the new message id (+ chat). */
export interface TelegramMediaResult {
  message_id: number;
  chat?: { id: number };
}

/** The Bot API's `sendPhoto` upload cap (bytes). An image over it goes out
 * as a `sendDocument` — OpenClaw's photo fallback, trimmed to the size check. */
export const TELEGRAM_MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** The media method label for one mime (OpenClaw routing, trimmed):
 * gif → animation; image → photo; video → video; ogg/opus audio → voice;
 * other audio → audio; anything else (pdf, …) → document. */
export function telegramMediaMethod(mime: string | undefined): TelegramMediaMethod {
  const m = (mime ?? "").trim().toLowerCase();
  if (m === "image/gif") return "sendAnimation";
  if (m.startsWith("image/")) return "sendPhoto";
  if (m.startsWith("video/")) return "sendVideo";
  if (m === "audio/ogg" || m === "audio/opus") return "sendVoice";
  if (m.startsWith("audio/")) return "sendAudio";
  return "sendDocument";
}

/** The thread/reply/silent/caption params that ride on the media post
 * (the SAME `buildTelegramThreadParams` + `buildTelegramReplyParams`
 * builders the text path uses — F-07; a single media post carries both,
 * the way the text path's chunk 0 does). */
function mediaThreadParams(params: {
  messageThreadId?: number | undefined;
  replyToMessageId?: number | undefined;
  silent?: boolean | undefined;
  caption?: string | undefined;
}): Record<string, unknown> {
  const out = {
    ...buildTelegramThreadParams({
      messageThreadId: params.messageThreadId,
      silent: params.silent,
    }),
    ...buildTelegramReplyParams({
      replyToMessageId: params.replyToMessageId,
    }),
  };
  if (params.caption !== undefined && params.caption !== "") out["caption"] = params.caption;
  return out;
}

/** Post one local media file to `chatId` through the mime-routed Bot API
 * method, with the pinned outbound retry policy. `params` carries the thread /
 * reply / silent / caption facts. Returns the new message id. THROWS on a
 * missing file or a non-retryable Bot API fault. */
export async function sendTelegramMedia(params: {
  api: TelegramApi;
  chatId: number;
  filePath: string;
  fileName: string;
  mime: string;
  log?: (message: string) => void;
  messageThreadId?: number;
  replyToMessageId?: number;
  silent?: boolean;
  caption?: string;
}): Promise<{ messageId: string; chatId: string }> {
  const { api, chatId, filePath, fileName, mime } = params;
  const log = params.log ?? (() => {});
  // The Bot API upload: read the file into a grammy InputFile (filename = the
  // native name, so the post carries the real extension, not a guessed one).
  const buffer = readFileSync(filePath);
  const file = new InputFile(buffer, fileName);
  let method = telegramMediaMethod(mime);
  // OpenClaw's photo fallback (size-trimmed): the Bot API caps `sendPhoto` at
  // 10 MB — an oversized image goes out as a document instead of failing the
  // post (OpenClaw logs "…Sending as document instead." when photo validation
  // fails).
  if (method === "sendPhoto" && buffer.length > TELEGRAM_MAX_PHOTO_BYTES) {
    log("Photo exceeds the Bot API's 10 MB photo limit. Sending as document instead.");
    method = "sendDocument";
  }
  const requestParams = mediaThreadParams({
    messageThreadId: params.messageThreadId,
    replyToMessageId: params.replyToMessageId,
    silent: params.silent,
    caption: params.caption,
  });
  const sendFn = api[method] as unknown as (
    chatId: number,
    file: InputFile,
    params?: Record<string, unknown>,
  ) => Promise<TelegramMediaResult>;
  const result = await withTelegramSendRetry(
    () =>
      Object.keys(requestParams).length > 0
        ? sendFn.call(api, chatId, file, requestParams)
        : sendFn.call(api, chatId, file),
    `telegram ${method}`,
    log,
  );
  if (!Number.isFinite(result.message_id)) {
    throw new Error(`Telegram ${method} returned no message_id`);
  }
  const lastChatId = String(result.chat?.id ?? chatId);
  log(`telegram outbound media ok (${method}) chatId=${lastChatId} messageId=${result.message_id}`);
  return { messageId: String(result.message_id), chatId: lastChatId };
}
