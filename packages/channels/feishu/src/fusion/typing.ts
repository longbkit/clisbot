// The Feishu / Lark half of `sync.progress` — `plugin.outbound.typing` (the Hub
// owns the processing-lease lifecycle in channels/plane/processing.ts; this file
// owns the wire). Lark has no typing status for bots, so upstream's `typing.ts`
// shows one the way the Lark client does: a "Typing" reaction on the sender's
// message for the length of the turn. A `start` adds it, a `stop` removes it.
//
// Unlike Telegram's chat action it does not lapse, so nothing is refreshed; the
// one thing to remember between the two calls is the reaction id the add
// returned. The Route's `messageReaction` emoji, when set, rides the same
// message the same way, best effort. A fault THROWS into the Hub's lease bookkeeping, which
// logs it and drops the lease; the reply path never sees it.

import { addReactionFeishu, removeReactionFeishu } from "../reactions.js";
import type { ClawdbotConfig } from "./runtime-api.js";

/** Lark's own typing emoji (upstream `typing.ts` `TYPING_EMOJI`). */
export const FEISHU_TYPING_EMOJI = "Typing";

/** The args the Hub's `outbound.typing` drive carries (plane/types.ts). */
export interface FeishuTypingArgs {
  cfg: Record<string, unknown>;
  accountId: string;
  action: "start" | "stop";
  indicator: boolean;
  /** The sender's message: the reaction target. Absent = nothing to react on. */
  messageId?: string | undefined;
  reactionEmoji?: string | undefined;
  /** Test seam: replaces the two reaction calls. */
  reactions?: FeishuTypingReactions;
}

export interface FeishuTypingReactions {
  add(messageId: string, emojiType: string): Promise<string>;
  remove(messageId: string, reactionId: string): Promise<void>;
}

/** Reactions this process added and has yet to remove, keyed by account + message. */
const shown = new Map<string, string[]>();

/** Test seam: forget every reaction still held. */
export function clearFeishuTypingForTest(): void {
  shown.clear();
}

function wireReactions(args: FeishuTypingArgs): FeishuTypingReactions {
  const cfg = args.cfg as unknown as ClawdbotConfig;
  return {
    add: async (messageId, emojiType) =>
      (await addReactionFeishu({ cfg, messageId, emojiType, accountId: args.accountId }))
        .reactionId,
    remove: (messageId, reactionId) =>
      removeReactionFeishu({ cfg, messageId, reactionId, accountId: args.accountId }),
  };
}

/** The Route's emoji in Lark's spelling: the Hub stores Slack-style lowercase
 * names (`eyes`), Lark's `emoji_type` is upper case (`EYES`). */
function routeEmoji(args: FeishuTypingArgs): string | undefined {
  const name = args.reactionEmoji?.trim();
  return name === undefined || name === "" ? undefined : name.toUpperCase();
}

/**
 * `plugin.outbound.typing` — one liveness drive. A `start` reacts on the
 * sender's message; a `stop` takes back what that start added.
 */
export async function feishuTyping(args: FeishuTypingArgs): Promise<void> {
  const messageId = args.messageId;
  if (messageId === undefined || messageId === "") return;
  const key = `${args.accountId}:${messageId}`;
  const reactions = args.reactions ?? wireReactions(args);
  if (args.action === "stop") {
    const ids = shown.get(key) ?? [];
    shown.delete(key);
    await Promise.all(ids.map((id) => reactions.remove(messageId, id)));
    return;
  }
  const ids = shown.get(key) ?? [];
  shown.set(key, ids);
  if (args.indicator) ids.push(await reactions.add(messageId, FEISHU_TYPING_EMOJI));
  const extra = routeEmoji(args);
  if (extra === undefined || extra === FEISHU_TYPING_EMOJI) return;
  // Best effort: a name Lark has no emoji for is skipped, not a failed lease
  // that would leave the Typing reaction behind.
  const id = await reactions.add(messageId, extra).catch(() => undefined);
  if (id !== undefined) ids.push(id);
}
