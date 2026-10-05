// `reply.anchor: thread` (group chats) and `reply.dmAnchor: thread` (direct
// messages) for a message sent at the conversation root. Slack has no
// create-thread API, so the reply opens a thread by answering the message
// itself (`thread_ts` = its `ts`, OpenClaw `replyToMode: all`). Agent replies
// (`relay/index.ts`), command replies (`commands-context.ts`) and the binding
// key (`bindings/stored-route.ts`) share these rules, so a route answers in the
// same place whichever of them replies.

import type { EffectiveDefaults } from "./config/inheritance.js";
import { SLACK_THREAD_TS_PATTERN } from "./plane/types.js";

type ReplyAnchor = EffectiveDefaults["replyAnchor"];

/** The anchor for this kind of conversation: a DM has its own, default inline. */
export function replyAnchorFor(
  defaults: Pick<EffectiveDefaults, "replyAnchor" | "dmReplyAnchor"> | undefined,
  rootKind: string,
): ReplyAnchor {
  if (defaults === undefined) return "default";
  return rootKind === "dm" ? (defaults.dmReplyAnchor ?? "default") : defaults.replyAnchor;
}

/**
 * The thread a root message's reply opens, or undefined when the reply stays at
 * the root: another anchor, a message already in a thread, a non-Slack channel,
 * or a message id not in Slack `ts` shape (a restart re-attach carries none).
 * `replyAnchor` is already the one for this conversation (`replyAnchorFor`).
 */
export function anchoredReplyThreadId(input: {
  channel: string;
  replyAnchor: ReplyAnchor;
  threadId: string | null;
  messageId: string | undefined;
}): string | undefined {
  if (input.threadId !== null) return input.threadId;
  if (
    input.replyAnchor !== "thread" ||
    input.channel !== "slack" ||
    input.messageId === undefined ||
    !SLACK_THREAD_TS_PATTERN.test(input.messageId)
  ) {
    return undefined;
  }
  return input.messageId;
}
