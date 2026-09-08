// Fusion drive-surface bridge onto the ported Zalo Personal send path (D-ZU-018).
//
// `plugin.outbound.*` is the Hub's contract (`@getpaseo/channels-shared`), so
// this file is the only place that translates between it and the carried
// `channel.adapters.ts` send helpers. Every wire decision — the markdown text
// mode and its style ranges, the 2000-char chunking with per-chunk style
// slicing, the media upload branch and the receipt shape — lives in the ported
// source (`send.ts`, `zalo-js.ts`, `text-styles.ts`), not here. Mirrors the
// Discord, Google Chat and Zalo verticals' `outbound.ts`.
//
// Zalo Personal has NO thread primitive (upstream pins `replyToMode: "off"`),
// so `threadId` is ignored. A reply is expressed the way the platform expresses
// it — as a quote on the target conversation — which is inbound-only metadata
// today (`zalo-quote-metadata`); the outbound quote payload is not carried
// (see `upstream-sync.json` omitted: `monitor.ts`).
import type { SendMediaFn, SendTextFn } from "@getpaseo/channels-shared";
import {
  sendZalouserMediaFromContext,
  sendZalouserTextFromContext,
} from "./channel.adapters.js";
import { mergeAccountCarrier } from "./fusion/account-config.js";
import type { OpenClawConfig } from "./runtime-api.js";

/** Upstream `channel.ts`: `zalouserTextChunkLimit`. Zalo refuses more. */
export const ZALOUSER_TEXT_CHUNK_LIMIT = 2000;

function driveCfg(args: Record<string, unknown>): OpenClawConfig {
  return mergeAccountCarrier(
    args["cfg"] as OpenClawConfig,
    String(args["accountId"] ?? ""),
    args["account"] as Record<string, unknown> | undefined,
  );
}

/**
 * `plugin.outbound.sendText` — the Hub's final-answer post. `to` is any of the
 * `zalouser:` / `zlu:` / `group:` / `user:` / bare-id forms the ported
 * `session-route.ts` normalizes.
 *
 * Long answers are chunked by the ported `send.ts` at the 2000-char limit and
 * posted as separate messages; the returned `messageId` is the LAST chunk's id,
 * which is what upstream's `sendMessageZalouser` returns.
 */
export const sendText: SendTextFn = async (args) => {
  const result = await sendZalouserTextFromContext({
    cfg: driveCfg(args),
    accountId: String(args.accountId ?? ""),
    to: String(args.to),
    text: String(args.text),
  });
  if (result.messageId === undefined) {
    throw new Error("Zalouser sendText produced no message");
  }
  return {
    messageId: result.messageId,
    to: String(args.to),
    receipt: result.receipt,
  };
};

/**
 * `plugin.outbound.sendMedia` — a native upload. Unlike the Zalo Official Bot
 * API, the personal-account client HAS an upload endpoint
 * (`api.uploadAttachment` / `sendMessage` with `attachments`), so an ordinary
 * file posts natively; an audio file becomes a voice message, which is
 * upstream's own branch in `sendZaloTextMessage`.
 *
 * The local file is read through the ported media loader, which is why
 * `mediaLocalRoots` is pinned to the file's own directory: the loader refuses a
 * path outside the roots it was given, so the Hub's agent-home path is the
 * root and nothing else on the box is reachable.
 */
export const sendMedia: SendMediaFn = async (args) => {
  const filePath = String(args.filePath);
  const { dirname } = await import("node:path");
  const result = await sendZalouserMediaFromContext({
    cfg: driveCfg(args),
    accountId: String(args.accountId ?? ""),
    to: String(args.to),
    text: typeof args.text === "string" ? args.text : "",
    mediaUrl: filePath,
    mediaLocalRoots: [dirname(filePath)],
  });
  if (result.messageId === undefined) {
    throw new Error("Zalouser sendMedia produced no message");
  }
  return { messageId: result.messageId, mediaPosted: true, receipt: result.receipt };
};
