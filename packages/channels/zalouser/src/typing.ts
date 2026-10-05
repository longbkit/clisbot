// The Zalo Personal half of `sync.progress` — `plugin.outbound.typing` (the Hub
// owns the processing-lease lifecycle in channels/plane/processing.ts; this
// file owns the wire). Mirrors the Telegram vertical's `typing.ts`.
//
// Zalo's typing event (`api.sendTypingEvent`, the ported `sendTypingZalouser`)
// lapses on the other side after a few seconds, so the refresh is this file's
// job: a `start` sends now and re-sends every `ZALOUSER_TYPING_REFRESH_MS`, a
// `stop` cancels the timer and sends nothing — the indicator lapses on its own.
// A fault THROWS into the Hub's lease bookkeeping, which drops the lease, and a
// failing refresh stops its own timer: a chat that refuses the event is not
// called every few seconds.
//
// No threads and no reaction surface here (`outbound.ts`): `threadId`,
// `messageId` and `reactionEmoji` are ignored.

import { resolveZalouserAccountSync } from "./accounts.js";
import { mergeAccountCarrier } from "./fusion/account-config.js";
import type { OpenClawConfig } from "./runtime-api.js";
import { sendTypingZalouser } from "./send.js";
import { parseZalouserOutboundTarget } from "./session-route.js";

/** Inside the few seconds Zalo shows the event, with room for the round trip. */
export const ZALOUSER_TYPING_REFRESH_MS = 4_000;

/** The args the Hub's `outbound.typing` drive carries (plane/types.ts). */
export interface ZalouserTypingArgs {
  cfg: Record<string, unknown>;
  accountId: string;
  /** The conversation: a user id, or `group:<id>` for a group. */
  to: string;
  action: "start" | "stop";
  indicator: boolean;
  account?: Record<string, unknown> | undefined;
  /** Test seam: replaces the wire send. */
  send?: typeof sendTypingZalouser;
}

/** Timers this process holds open, keyed by account + conversation. */
const refreshTimers = new Map<string, ReturnType<typeof setInterval>>();

/** Test seam: forget every open timer. */
export function clearZalouserTypingTimersForTest(): void {
  for (const timer of refreshTimers.values()) clearInterval(timer);
  refreshTimers.clear();
}

async function sendTyping(args: ZalouserTypingArgs): Promise<void> {
  const cfg = mergeAccountCarrier(args.cfg as OpenClawConfig, args.accountId, args.account);
  const account = resolveZalouserAccountSync({ cfg, accountId: args.accountId });
  const target = parseZalouserOutboundTarget(args.to);
  await (args.send ?? sendTypingZalouser)(target.threadId, {
    profile: account.profile,
    isGroup: target.isGroup,
  });
}

function cancelRefresh(key: string): void {
  const timer = refreshTimers.get(key);
  if (timer === undefined) return;
  clearInterval(timer);
  refreshTimers.delete(key);
}

function armRefresh(args: ZalouserTypingArgs, key: string): void {
  cancelRefresh(key);
  const timer = setInterval(() => {
    void sendTyping(args).catch(() => cancelRefresh(key));
  }, ZALOUSER_TYPING_REFRESH_MS);
  timer.unref?.();
  refreshTimers.set(key, timer);
}

/**
 * `plugin.outbound.typing` — one liveness drive. A `start` shows the event now
 * and keeps it shown; a `stop` lets it lapse.
 */
export async function zalouserTyping(args: ZalouserTypingArgs): Promise<void> {
  if (!args.indicator) return;
  const key = `${args.accountId}:${args.to}`;
  if (args.action === "stop") {
    cancelRefresh(key);
    return;
  }
  await sendTyping(args);
  armRefresh(args, key);
}
