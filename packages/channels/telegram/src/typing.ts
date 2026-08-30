// The Telegram half of `sync.progress` — `plugin.outbound.typing` (the Hub
// owns the processing-lease lifecycle in channels/plane/processing.ts; this
// file owns the wire). Sync reference: openclaw@2026.7.1-2
// dist/telegram-ingress-spool-Dd3cDhXe.js (the `sendChatAction("typing")` cue).
//
// Telegram has ONE liveness surface: `sendChatAction(chat_id, "typing")`, and
// it expires after ~5s. The expiry is the vendor's, so the refresh is THIS
// file's job, not the Hub's: a `start` sends immediately and re-arms a
// `TELEGRAM_TYPING_REFRESH_MS` timer, a `stop` cancels it and sends nothing
// (the indicator lapses; a "clear" call would be a call for nothing). A
// provider-agnostic Hub heartbeat would have to guess one interval for every
// wire, and this one is not Slack's.
//
// A tick that faults cancels its own timer and rejects into the Hub's lease
// bookkeeping, which drops the lease and logs — the same breaker shape as a
// failing first send, and no repeat of a chat that refuses the action.
//
// There is no reaction surface on the Bot API, so `reactionEmoji` is ignored
// here: the Hub folds the config, the vertical answers for its own wire.
//
// Topics: `message_thread_id` rides on the typing action INCLUDING the forum's
// General topic (`1`). That is the opposite of a SEND, where the Bot API
// rejects `sendMessage` with `thread_id=1` ("thread not found") — the pinned
// vendor records the asymmetry as empirical (telegram.md: "typing actions still
// include message_thread_id"). Dropping it for General would silently type into
// the wrong place.

import {
  buildTelegramClientOptions,
  createTelegramApi,
  parseOutboundTarget,
  resolveChatId,
  resolveTelegramAccount,
  type TelegramCfg,
} from "./client/bot-api.js";

/** The Bot API action this surface uses. */
export const TELEGRAM_TYPING_ACTION = "typing";

/** How often this file re-sends the action while a lease is open — inside the
 * Bot API's ~5s expiry, with room for round-trip latency. */
export const TELEGRAM_TYPING_REFRESH_MS = 4_500;

/** The args the Hub's `outbound.typing` drive carries (plane/types.ts). */
export interface TelegramTypingArgs {
  cfg: Record<string, unknown>;
  accountId: string;
  /** The conversation target (`chatId`, or the `chatId:threadId` form). */
  to: string;
  action: "start" | "stop";
  indicator: boolean;
  /** The topic the reply lands in; absent = the chat root. */
  threadId?: string | undefined;
  messageId?: string | undefined;
  reactionEmoji?: string | undefined;
}

/**
 * The topic params for a typing action. `1` (the forum's General topic) is
 * passed through — see the header note on why typing and sends disagree here.
 */
export function typingThreadParams(messageThreadId: number | undefined): Record<string, unknown> {
  return messageThreadId === undefined ? {} : { message_thread_id: messageThreadId };
}

/** Resolve the topic id from the target form or the Hub's `threadId`. */
export function resolveTypingThreadId(
  target: { chatId: string; messageThreadId?: number },
  threadId: string | undefined,
): number | undefined {
  if (target.messageThreadId !== undefined) return target.messageThreadId;
  if (threadId === undefined || threadId === "") return undefined;
  return Number(threadId);
}

/** Timers this process holds open, keyed by chat + topic. */
const refreshTimers = new Map<string, ReturnType<typeof setInterval>>();

/** Test seam: forget every open timer. */
export function clearTelegramTypingTimersForTest(): void {
  for (const timer of refreshTimers.values()) clearInterval(timer);
  refreshTimers.clear();
}

async function sendTyping(args: TelegramTypingArgs): Promise<void> {
  const account = resolveTelegramAccount(args.cfg as unknown as TelegramCfg, args.accountId);
  const target = parseOutboundTarget(String(args.to));
  const messageThreadId = resolveTypingThreadId(target, args.threadId);
  if (
    messageThreadId !== undefined &&
    (!Number.isSafeInteger(messageThreadId) || messageThreadId <= 0)
  ) {
    throw new Error(`invalid Telegram topic id "${String(args.threadId)}"`);
  }
  const api = await createTelegramApi(account.token, buildTelegramClientOptions(account));
  const chatId = await resolveChatId(target.chatId, api);
  const params = typingThreadParams(messageThreadId);
  if (Object.keys(params).length > 0) {
    await api.sendChatAction(chatId, TELEGRAM_TYPING_ACTION, params);
    return;
  }
  await api.sendChatAction(chatId, TELEGRAM_TYPING_ACTION);
}

function timerKey(args: TelegramTypingArgs): string {
  const target = parseOutboundTarget(String(args.to));
  const threadId = resolveTypingThreadId(target, args.threadId);
  return `${args.accountId}:${target.chatId}:${threadId ?? ""}`;
}

function cancelRefresh(key: string): void {
  const timer = refreshTimers.get(key);
  if (timer === undefined) return;
  clearInterval(timer);
  refreshTimers.delete(key);
}

function armRefresh(args: TelegramTypingArgs, key: string): void {
  cancelRefresh(key);
  const timer = setInterval(() => {
    void sendTyping(args).catch(() => {
      // The Hub drops the lease on the rejection; stop spending calls either way.
      cancelRefresh(key);
    });
  }, TELEGRAM_TYPING_REFRESH_MS);
  timer.unref?.();
  refreshTimers.set(key, timer);
}

/**
 * `plugin.outbound.typing` — one liveness drive. A `start` sends the action
 * now and keeps it live on this file's own timer; a `stop` cancels the timer
 * and sends nothing. A Bot API fault THROWS: the Hub's controller drops the
 * lease, so a chat that cannot carry the indicator is not called every few
 * seconds.
 */
export async function telegramTyping(args: TelegramTypingArgs): Promise<void> {
  if (!args.indicator) return;
  if (args.action === "stop") {
    cancelRefresh(timerKey(args));
    return;
  }
  await sendTyping(args);
  armRefresh(args, timerKey(args));
}
