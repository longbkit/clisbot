// Fusion-owned WhatsApp half of `sync.progress` (D-WA-034): "typing…" for the
// whole turn. The Hub owns the processing lease (`plane/processing.ts`): it
// calls `start` once when it accepts the inbound and `stop` once when the turn
// ends. Keeping the indicator alive in between is the vertical's job, as in the
// Telegram and Zalo Personal verticals' `typing.ts`.
//
// WhatsApp's "composing" presence lapses on the other phone after roughly 25 s,
// and it is cleared the moment this account sends a message. OpenClaw keeps it
// up with its reply dispatcher's typing loop (`onReplyStart` → `sendComposing`,
// re-sent on core's typing interval), which the Hub replaces. Without a refresh
// the indicator showed only at the start and right before each post, so a long
// turn went quiet and its final answer arrived with no warning.
//
// So: `start` sends "composing" now and again every `WHATSAPP_TYPING_REFRESH_MS`
// — which also brings it back after a progress message cleared it — and `stop`
// cancels the timer and sends "paused", so the indicator does not linger after
// the answer. A failed refresh stops its own timer: a chat that refuses the
// update is not called every few seconds.
import { getWhatsAppConnectionController } from "../connection-controller-runtime-context.js";
import { toWhatsappJid } from "../text-runtime.js";

/** Well inside the time WhatsApp shows "composing", with room for the round trip. */
export const WHATSAPP_TYPING_REFRESH_MS = 6_000;

export interface WhatsAppTypingArgs {
  accountId: string;
  /** The chat JID or number the turn answers in. */
  to: string;
  action: "start" | "stop";
  /** `sync.progress.typingIndicator`; off = nothing to show. */
  indicator: boolean;
  /** Sends "composing" through the account's listener (`send.ts` `sendTypingWhatsApp`). */
  compose(): Promise<void>;
  /** Test seam: replaces the "paused" presence update. */
  pause?: () => Promise<void>;
}

/** Timers this process holds open, keyed by account + chat. */
const refreshTimers = new Map<string, ReturnType<typeof setInterval>>();
/**
 * Chats whose indicator is wanted: set by `start` before its first send, cleared
 * by `stop`. The Hub does not order the two (`plane/processing.ts` fires and
 * forgets), so a fast turn's `stop` can land while `start` is still sending; the
 * timer is armed only if the chat is still wanted once that send returns.
 */
const wanted = new Set<string>();

/** Test seam: forget every open timer. */
export function clearWhatsAppTypingTimersForTest(): void {
  for (const timer of refreshTimers.values()) clearInterval(timer);
  refreshTimers.clear();
  wanted.clear();
}

/** Account stop: cancel every timer this account holds (its socket is gone). */
export function stopWhatsAppTypingForAccount(accountId: string): void {
  for (const key of [...refreshTimers.keys(), ...wanted]) {
    if (!key.startsWith(`${accountId}:`)) continue;
    cancelRefresh(key);
    wanted.delete(key);
  }
}

function cancelRefresh(key: string): boolean {
  const timer = refreshTimers.get(key);
  if (timer === undefined) return false;
  clearInterval(timer);
  refreshTimers.delete(key);
  return true;
}

function armRefresh(args: WhatsAppTypingArgs, key: string): void {
  cancelRefresh(key);
  const timer = setInterval(() => {
    void args.compose().catch(() => cancelRefresh(key));
  }, WHATSAPP_TYPING_REFRESH_MS);
  timer.unref?.();
  refreshTimers.set(key, timer);
}

/** "paused" on the live socket; best effort, the presence lapses on its own anyway. */
async function sendPaused(accountId: string, to: string): Promise<void> {
  const sock = getWhatsAppConnectionController(accountId)?.getCurrentSock();
  await sock?.sendPresenceUpdate("paused", toWhatsappJid(to));
}

/** `plugin.outbound.typing` — `start` shows "typing…" and keeps it shown; `stop` clears it. */
export async function whatsappTyping(args: WhatsAppTypingArgs): Promise<void> {
  if (!args.indicator) return;
  const key = `${args.accountId}:${args.to}`;
  if (args.action === "stop") {
    const shown = wanted.delete(key);
    cancelRefresh(key);
    if (!shown) return;
    await (args.pause ?? (() => sendPaused(args.accountId, args.to)))().catch(() => undefined);
    return;
  }
  wanted.add(key);
  try {
    await args.compose();
  } catch (error) {
    wanted.delete(key);
    throw error;
  }
  if (wanted.has(key)) armRefresh(args, key);
}
