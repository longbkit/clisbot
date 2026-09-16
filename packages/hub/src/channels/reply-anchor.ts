// `reply.anchor: thread` for a message sent at the conversation root. Slack has
// no create-thread API, so the reply opens a thread by answering the message
// itself (`thread_ts` = its `ts`, OpenClaw `replyToMode: all`). Agent replies
// (`relay/index.ts`) and command replies (`commands-context.ts`) share this one
// rule, so a route answers in the same place whichever of the two replies.

import { SLACK_THREAD_TS_PATTERN } from "./plane/types.js";

/**
 * The thread a root message's reply opens, or undefined when the reply stays at
 * the root: another anchor, a message already in a thread, a DM (no thread
 * level), a non-Slack channel, or a message id not in Slack `ts` shape (a
 * restart re-attach carries none).
 */
export function anchoredReplyThreadId(input: {
  channel: string;
  /** Only `dm` matters: a DM has no thread level to open. */
  rootKind: string;
  replyAnchor: "default" | "thread";
  threadId: string | null;
  messageId: string | undefined;
}): string | undefined {
  if (input.threadId !== null) return input.threadId;
  if (
    input.replyAnchor !== "thread" ||
    input.channel !== "slack" ||
    input.rootKind === "dm" ||
    input.messageId === undefined ||
    !SLACK_THREAD_TS_PATTERN.test(input.messageId)
  ) {
    return undefined;
  }
  return input.messageId;
}
