// Fusion drive-surface bridge onto the ported Feishu send path (D-FS-020).
//
// `plugin.outbound.*` is the Hub's contract (`@getpaseo/channels-shared`), so
// this file is the only place that translates between it and upstream's send
// entry points. Every wire decision — the markdown → Lark post projection, the
// envelope size assertion, the reply-vs-thread rule, the receipt shape — lives
// in the ported `send.ts`, not here. Mirrors the Discord and Google Chat
// verticals' `outbound.ts`.
import type { HostRuntime, SendTextFn } from "@getpaseo/channels-shared";
import { mergeAccountCarrier } from "./fusion/account-config.js";
import { installFeishuRuntime } from "./fusion/runtime.js";
import type { OpenClawConfig } from "./fusion/runtime-api.js";
import { withFeishuAccount } from "./runtime.js";
import { getHostRuntime } from "./runtime-store.js";
import { editMessageFeishu, sendCardFeishu, sendMessageFeishu } from "./send.js";

/** Runs one send under its own account's ported plugin runtime, against the
 * config the Hub compiled for it (connection credentials folded in). */
async function withAccountRuntime<T>(
  args: Record<string, unknown>,
  run: (cfg: OpenClawConfig, accountId: string) => Promise<T>,
): Promise<T> {
  const host = (args["hostRuntime"] as HostRuntime | undefined) ?? getHostRuntime();
  const accountId = String(args["accountId"] ?? "");
  installFeishuRuntime(host, accountId);
  const cfg = mergeAccountCarrier(
    args["cfg"] as OpenClawConfig,
    accountId,
    args["account"] as Record<string, unknown> | undefined,
  );
  return await withFeishuAccount(accountId, () => run(cfg, accountId));
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

/**
 * `plugin.outbound.sendText` — the Hub's final-answer post. `to` is a Lark
 * `oc_…` chat id, an `ou_…` open id, or any of the prefixed forms upstream's
 * `targets.ts` normalizes; `threadId` is the message the answer replies to.
 *
 * Chunking and the markdown → post projection are upstream's; the returned
 * `messageId` is the message the ledger confirms with.
 */
export const sendText: SendTextFn = async (args) =>
  await withAccountRuntime(args, async (cfg, accountId) => {
    const replyToMessageId = optionalString(args["threadId"]);
    const result = await sendMessageFeishu({
      cfg,
      to: String(args.to),
      text: String(args.text),
      accountId,
      ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    });
    return { messageId: result.messageId, chatId: result.chatId, receipt: result.receipt };
  });

/** COMPAT(clisbot-control-plane): the approval/progress card's in-place update.
 * Upstream edits a `post` or an `interactive` message through the same call. */
export async function updateText(args: {
  cfg: Record<string, unknown>;
  accountId: string;
  messageId: string;
  text: string;
  [key: string]: unknown;
}): Promise<{ messageId: string }> {
  return await withAccountRuntime(args, async (cfg, accountId) => {
    const result = await editMessageFeishu({
      cfg,
      messageId: String(args.messageId),
      text: String(args.text),
      accountId,
    });
    return { messageId: result.messageId };
  });
}

/** A native Lark interactive card, for the presentation path. */
export async function sendCard(args: {
  cfg: Record<string, unknown>;
  accountId: string;
  to: string;
  card: Record<string, unknown>;
  threadId?: string;
  [key: string]: unknown;
}): Promise<{ messageId: string; chatId: string }> {
  return await withAccountRuntime(args, async (cfg, accountId) => {
    const replyToMessageId = optionalString(args["threadId"]);
    const result = await sendCardFeishu({
      cfg,
      to: String(args.to),
      card: args.card,
      accountId,
      ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    });
    return { messageId: result.messageId, chatId: result.chatId };
  });
}
