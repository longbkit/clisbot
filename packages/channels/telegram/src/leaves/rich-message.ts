// COMPAT(clisbot-control-plane): L1 rich-message leaf — the shared send-param
// builders for the `sendTelegramText` chunk loop. Fusion-owned: upstream builds
// these inline in `send-message-text.ts` / `reply-parameters.ts`, which are not
// ported yet (slice 9). The markdown → Bot API HTML front-end and the plain-text
// chunker are upstream source now (`format.ts`, `rich-plain-fallback.ts`);
// the two builders below are the single place the `message_thread_id` /
// reply / silent send params are built, and BOTH the plain-text and
// rich-HTML send paths (and the media post) derive their request params
// from them (so a topic send can never drop `message_thread_id` on one
// path only — the F-07 regression). (`parse_mode` is a per-message Bot
// API param, applied to every chunk by the send loop, not built here.)

/** The request params that ride on EVERY chunk of a topic send:
 * `message_thread_id` (topic placement) + silent. These belong to the whole
 * reply, so every continuation chunk must keep them — dropping them on
 * chunk 1+ scatters the tail of a long reply into the forum's General
 * (root) instead of the topic. See the module header: this is the ONE
 * thread-param builder both send paths (and the media post) use. */
export function buildTelegramThreadParams(params: {
  // `| undefined` (not just optional): the send path forwards the caller's
  // possibly-undefined fields straight through (exactOptionalPropertyTypes).
  messageThreadId?: number | undefined;
  silent?: boolean | undefined;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (params.messageThreadId !== undefined) out["message_thread_id"] = params.messageThreadId;
  if (params.silent === true) out["disable_notification"] = true;
  return out;
}

/** The request param that rides on chunk 0 ONLY of a topic send: the
 * reply-to quote. The Bot API's `reply_parameters` is a single reply
 * target, so only the first chunk quotes the message being answered;
 * continuations are plain follow-ups in the same topic. (The approval
 * card's `reply_markup` also rides chunk 0 only — the send loop merges it
 * in next to this one.) */
export function buildTelegramReplyParams(params: {
  replyToMessageId?: number | undefined;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (params.replyToMessageId !== undefined) {
    out["reply_parameters"] = { message_id: params.replyToMessageId };
  }
  return out;
}
