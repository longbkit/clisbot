// The Zalo Official Bot half of `sync.progress` — `plugin.outbound.typing` (the
// Hub owns the processing-lease lifecycle in channels/plane/processing.ts; this
// file owns the wire). Mirrors the Telegram vertical's `typing.ts`: the Zalo Bot
// API is Telegram-shaped, and its `sendChatAction("typing")` lapses after a few
// seconds the same way, so a `start` sends now and re-sends every
// `ZALO_TYPING_REFRESH_MS`, and a `stop` cancels the timer and sends nothing.
// A fault THROWS into the Hub's lease bookkeeping, which drops the lease, and a
// failing refresh stops its own timer.
//
// The Bot API has one `chat_id` for a DM and a group alike, and no threads or
// reaction surface (`outbound.ts`): `threadId`, `messageId` and `reactionEmoji`
// are ignored.

import type { OpenClawConfig } from "@clisbot/channels-core/plugin-sdk/config-contracts";
import { resolveZaloAccount } from "./accounts.js";
import { sendChatAction } from "./api.js";
import { mergeAccountCarrier } from "./fusion/account-config.js";
import { resolveZaloProxyFetch } from "./proxy.js";

/** Inside the few seconds the Bot API shows the action, with room for latency. */
export const ZALO_TYPING_REFRESH_MS = 4_500;

/** The args the Hub's `outbound.typing` drive carries (plane/types.ts). */
export interface ZaloTypingArgs {
  cfg: Record<string, unknown>;
  accountId: string;
  /** The chat id. */
  to: string;
  action: "start" | "stop";
  indicator: boolean;
  account?: Record<string, unknown> | undefined;
  /** Test seam: replaces the Bot API call. */
  send?: (token: string, chatId: string) => Promise<unknown>;
}

/** Timers this process holds open, keyed by account + chat. */
const refreshTimers = new Map<string, ReturnType<typeof setInterval>>();

/** Test seam: forget every open timer. */
export function clearZaloTypingTimersForTest(): void {
  for (const timer of refreshTimers.values()) clearInterval(timer);
  refreshTimers.clear();
}

async function sendTyping(args: ZaloTypingArgs): Promise<void> {
  const cfg = mergeAccountCarrier(args.cfg as OpenClawConfig, args.accountId, args.account);
  const account = resolveZaloAccount({ cfg, accountId: args.accountId });
  if (!account.token) throw new Error("No Zalo bot token configured");
  if (args.send !== undefined) {
    await args.send(account.token, args.to);
    return;
  }
  const fetcher = resolveZaloProxyFetch(account.config.proxy);
  await sendChatAction(account.token, { chat_id: args.to, action: "typing" }, fetcher);
}

function cancelRefresh(key: string): void {
  const timer = refreshTimers.get(key);
  if (timer === undefined) return;
  clearInterval(timer);
  refreshTimers.delete(key);
}

function armRefresh(args: ZaloTypingArgs, key: string): void {
  cancelRefresh(key);
  const timer = setInterval(() => {
    void sendTyping(args).catch(() => cancelRefresh(key));
  }, ZALO_TYPING_REFRESH_MS);
  timer.unref?.();
  refreshTimers.set(key, timer);
}

/**
 * `plugin.outbound.typing` — one liveness drive. A `start` shows the action now
 * and keeps it shown; a `stop` lets it lapse.
 */
export async function zaloTyping(args: ZaloTypingArgs): Promise<void> {
  if (!args.indicator) return;
  const key = `${args.accountId}:${args.to}`;
  if (args.action === "stop") {
    cancelRefresh(key);
    return;
  }
  await sendTyping(args);
  armRefresh(args, key);
}
