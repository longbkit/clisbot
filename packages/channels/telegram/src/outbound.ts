// Fusion drive-surface bridge onto the ported OpenClaw send path.
//
// `plugin.outbound.*` is the Hub's contract (`@getpaseo/channels-shared`), so
// this file is the only place that translates between it and upstream's
// `send.ts` entry points. Every wire decision — chunking, rich/HTML rendering,
// topic and reply params, retries, receipts, media routing, the sent-message
// cache — now lives in the ported source, not here.
import { readFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type { HostRuntime, SendMediaFn, SendTextFn } from "@getpaseo/channels-shared";
import { evaluateOutboundMedia, mediaFileName } from "@getpaseo/channels-shared";
import type { OpenClawConfig } from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import type { MessagePresentationBlockNote } from "@getpaseo/channels-core/plugin-sdk/interactive-runtime";
import {
  accountRendersRichMessages,
  resolveTelegramOutboundPresentation,
} from "./presentation-outbound.js";
import { getHostRuntime } from "./runtime-store.js";
import { installTelegramRuntime } from "./fusion/runtime.js";
import { withTelegramAccount } from "./runtime.js";
import { editMessageTelegram } from "./send-edit.js";
import { sendMessageTelegram } from "./send-message.js";
import type { TelegramSendOpts } from "./send-message-types.js";
import { normalizeTelegramOutboundTarget } from "./targets.js";

/**
 * Runs one send under its own account's ported plugin runtime.
 *
 * The Hub drives every account of every organization from one process, so the
 * install is keyed by account: it resolves the account's HostRuntime (the drive
 * args carry it; `getHostRuntime()` is the single-account fallback), installs
 * the ported runtime for that account if it is not already installed against
 * that host, and makes the account current for the call. Everything the send
 * awaits — the ported sent-message cache, the topic-name cache, the poll
 * registry — then resolves that account's keyed stores through the upstream
 * zero-arg `getTelegramRuntime()`.
 */
async function withAccountRuntime<T>(
  args: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const host = (args["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime();
  const accountId = String(args["accountId"] ?? "");
  installTelegramRuntime(host, accountId);
  return await withTelegramAccount(accountId, run);
}

/** Numeric topic id from the Hub's `threadId` string, or undefined. */
function resolveMessageThreadId(threadId: unknown): number | undefined {
  if (threadId === undefined || threadId === null || threadId === "") {
    return undefined;
  }
  const parsed = Number(threadId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid Telegram topic id "${String(threadId)}"`);
  }
  return parsed;
}

/** Base send options shared by the text and media paths. */
function baseSendOpts(args: Record<string, unknown>): TelegramSendOpts {
  const messageThreadId = resolveMessageThreadId(args["threadId"]);
  const replyTo = args["replyTo"];
  return {
    cfg: args["cfg"] as OpenClawConfig,
    accountId: String(args["accountId"] ?? ""),
    ...(messageThreadId !== undefined ? { messageThreadId } : {}),
    ...(typeof replyTo === "number" ? { replyToMessageId: replyTo } : {}),
    // Test seam: upstream's own Bot API override, forwarded from the drive args.
    ...(args["api"] ? { api: args["api"] as TelegramSendOpts["api"] } : {}),
  };
}

/**
 * `plugin.outbound.sendText` — the Hub's final-answer post. `to` is a chat id,
 * `@username`, or the `<chat>:topic:<id>` form upstream's `targets.ts` parses.
 * The optional `replyMarkup` arg (COMPAT(clisbot-control-plane)) carries the
 * native approval card's inline keyboard.
 */
export const sendText: SendTextFn = async (args) =>
  await withAccountRuntime(args, async () => {
    const to = normalizeTelegramOutboundTarget(String(args.to));
    const opts = baseSendOpts(args);
    const replyMarkup = args["replyMarkup"];
    // A portable `presentation` renders through the vertical (D-TG-057): a
    // table posts as a native Bot API 10.3 `table` block on a rich account and
    // as the portable fallback text everywhere else. Without this the Hub's
    // send reached Telegram as core's flattened text and a table was a bullet
    // list (D-W6-01).
    const presented = resolveTelegramOutboundPresentation({
      text: String(args.text),
      presentation: args["presentation"],
      richMessages: accountRendersRichMessages({
        cfg: opts.cfg,
        accountId: opts.accountId ?? "",
      }),
    });
    logPresentationAdmission({ args, notes: presented.notes });
    const result = await sendMessageTelegram(to, presented.text ?? String(args.text), {
      ...opts,
      ...(replyMarkup && typeof replyMarkup === "object"
        ? { buttons: (replyMarkup as { inline_keyboard?: unknown }).inline_keyboard as never }
        : presented.buttons === undefined
          ? {}
          : { buttons: presented.buttons as never }),
    });
    return { messageId: result.messageId, chatId: result.chatId, ...result.receipt };
  });

/** D-W6-02: what admission repaired or refused is an operator fact — the tool
 * result the model reads is the Hub's to write, but the account's log must not
 * be the one place a dropped block is invisible. */
function logPresentationAdmission(params: {
  args: Record<string, unknown>;
  notes: readonly MessagePresentationBlockNote[];
}): void {
  if (params.notes.length === 0) return;
  const accountId = String(params.args["accountId"] ?? "");
  const runtime = (params.args["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime();
  runtime?.logging
    .getChildLogger({ channel: "telegram", accountId })
    .warn("telegram presentation admission", { notes: params.notes });
}

/**
 * COMPAT(clisbot-control-plane): the in-place update (`editMessageText`). The
 * approval card's decided state lands here; `clearCard` (on unless the caller
 * opts out) strips the inline keyboard so a stale button click has no live markup.
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
  return await withAccountRuntime(args, async () => {
    const to = normalizeTelegramOutboundTarget(String(args.to));
    const messageId = Number(args.externalMessageId);
    if (!Number.isSafeInteger(messageId) || messageId === 0) {
      throw new Error(`invalid Telegram message id "${String(args.externalMessageId)}"`);
    }
    await editMessageTelegram(to, messageId, String(args.text), {
      ...baseSendOpts(args),
      ...(args.clearCard === false ? {} : { buttons: [] }),
    });
    return { ok: true };
  });
}

/**
 * COMPAT(clisbot-control-plane): the native-media post (`plugin.outbound.sendMedia`,
 * G7–G11). The G11 gate runs FIRST and is size-only (the Bot API's 50 MB upload
 * cap): an oversized file is not dropped — the in-channel notice is posted
 * through the text path and `mediaPosted` reports false. Mime→method routing,
 * caption splitting and the HTML fallback are upstream's (`outbound-media.ts`).
 */
export const sendMedia: SendMediaFn = async (args) =>
  await withAccountRuntime(args, async () => {
    const to = normalizeTelegramOutboundTarget(String(args.to));
    const fileName = mediaFileName(args.filePath);
    const { statSync } = await import("node:fs");
    let sizeBytes: number;
    try {
      sizeBytes = statSync(args.filePath).size;
    } catch {
      throw new Error(`Telegram sendMedia: local media file not found: ${args.filePath}`);
    }
    const decision = evaluateOutboundMedia({ sizeBytes, channel: "telegram", fileName });
    if (!decision.ok) {
      const notice = await sendText({ ...args, text: decision.notice });
      return { messageId: notice.messageId, mediaPosted: false };
    }
    const caption = typeof args["caption"] === "string" ? (args["caption"] as string) : "";
    const result = await sendMessageTelegram(to, caption, {
      ...baseSendOpts(args),
      mediaUrl: args.filePath,
      // The Hub authorizes the file before it reaches the vertical; the root is
      // scoped to the authorized file's own directory so upstream's local-read
      // guard still has a boundary to check.
      mediaAccess: {
        localRoots: [dirname(args.filePath)],
        readFile: async (filePath: string) => await readFile(filePath),
      },
      ...(extname(args.filePath) === ".ogg" && args["asVoice"] === true ? { asVoice: true } : {}),
    });
    return { messageId: result.messageId, chatId: result.chatId, mediaPosted: true };
  });
