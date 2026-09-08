// Fusion drive-surface bridge onto the ported Zalo send path (D-ZL-016).
//
// `plugin.outbound.*` is the Hub's contract (`@getpaseo/channels-shared`), so
// this file is the only place that translates between it and upstream's
// `send.ts`. Every wire decision — the target-prefix stripping, the 2000-char
// UTF-16-safe truncation, the receipt shape, the photo-vs-text branch — lives in
// the ported source, not here. Mirrors the Discord and Google Chat verticals'
// `outbound.ts`.
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { createChannelPartialDeliveryError } from "@getpaseo/channels-core/plugin-sdk/channel-inbound";
import { chunkTextForOutbound } from "@getpaseo/channels-core/plugin-sdk/text-chunking";
import type { SendMediaFn, SendTextFn } from "@getpaseo/channels-shared";
import { mergeAccountCarrier } from "./fusion/account-config.js";
import { sendMessageZalo } from "./send.js";

/** Upstream `channel.ts`: `zaloTextChunkLimit`. The Bot API refuses more. */
export const ZALO_TEXT_CHUNK_LIMIT = 2000;

function driveCfg(args: Record<string, unknown>): OpenClawConfig {
  return mergeAccountCarrier(
    args["cfg"] as OpenClawConfig,
    String(args["accountId"] ?? ""),
    args["account"] as Record<string, unknown> | undefined,
  );
}

/**
 * `plugin.outbound.sendText` — the Hub's final-answer post. `to` is the Zalo
 * chat id, optionally in any of the `zalo:` / `zl:` / `group:` / `user:` forms
 * the ported `send.ts` normalizes.
 *
 * Long answers are chunked by upstream's outbound chunker and posted as
 * separate messages; the returned `messageId` is the FIRST chunk's id, so the
 * ledger confirms with the message a reader sees first. Zalo has no thread
 * primitive, so `threadId` is ignored (`channel.ts` sets `replyToMode: "off"`).
 */
export const sendText: SendTextFn = async (args) => {
  const cfg = driveCfg(args);
  const accountId = String(args.accountId ?? "");
  const chunks = chunkTextForOutbound(String(args.text), ZALO_TEXT_CHUNK_LIMIT);
  const messageIds: string[] = [];
  let sent = 0;
  for (const chunk of chunks) {
    if (chunk.trim() === "") continue;
    try {
      const result = await sendMessageZalo(String(args.to), chunk, { cfg, accountId });
      if (!result.ok) {
        throw new Error(result.error ?? "Failed to send Zalo message");
      }
      sent += 1;
      if (result.messageId !== undefined) messageIds.push(result.messageId);
    } catch (error) {
      // Chunk N failed with 1..N-1 already posted. A plain throw reads as "the
      // send failed", and the Hub's retry reposts the chunks the reader already
      // has. `sentBeforeError` is upstream's partial-delivery shape
      // (`createChannelPartialDeliveryError`), which the Hub reports as
      // `partial_failed` instead of retrying.
      if (sent === 0) throw error;
      throw createChannelPartialDeliveryError(error, {
        visibleReplySent: true,
        ...(messageIds.length > 0 ? { messageIds } : {}),
      });
    }
  }
  const firstMessageId = messageIds[0];
  if (firstMessageId === undefined) {
    throw new Error("Zalo sendText produced no message");
  }
  return { messageId: firstMessageId, to: String(args.to), chunks: sent };
};

/**
 * `plugin.outbound.sendMedia` — REFUSED, loudly, and never silently.
 *
 * The Zalo Bot API has no upload endpoint: `sendPhoto` takes a URL its servers
 * fetch, and nothing else. Upstream works around that by hosting the file on
 * the account's own webhook origin (`outbound-media.ts`), which needs the
 * public HTTPS endpoint the Hub does not have — that module is omitted (see
 * `upstream-sync.json`). So a local file posts the in-channel notice through
 * the text path and reports `mediaPosted: false`, the Hub's G11 shape, instead
 * of a transport error or a dropped file.
 *
 * An image the agent references by URL is a different path and it works: the
 * `message` tool's `send` action takes `media` and reaches upstream's
 * `sendPhoto` through `actions.ts` / `send.ts`.
 */
export const sendMedia: SendMediaFn = async (args) => {
  const notice =
    "[Zalo has no file upload API; only images already published at an HTTPS URL can be posted, so the file was not uploaded]";
  const posted = await sendText({ ...args, text: notice });
  return { messageId: posted.messageId, mediaPosted: false };
};
