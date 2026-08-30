// COMPAT(clisbot-control-plane): L1 rich-message leaf — the ONE shared
// send-path primitives for the
// `sendTelegramText` chunk loop (SYNC.md): the plain-text chunker and the
// send-param builders. The markdown → Bot API HTML front-end (C5)
// lives in `format.ts` / `format-sanitize.ts` / `telegram-html-chunk.ts`;
// the two builders below are the single place the `message_thread_id` /
// reply / silent send params are built, and BOTH the plain-text and
// rich-HTML send paths (and the media post) derive their request params
// from them (so a topic send can never drop `message_thread_id` on one
// path only — the F-07 regression). (`parse_mode` is a per-message Bot
// API param, applied to every chunk by the send loop, not built here.)

/** Plain-text chunk at `limit` chars, breaking on whitespace first, then
 * hard-splitting mid-word. Telegram's sendMessage text cap is 4096; the
 * pinned vertical chunks at 4000 with headroom for entities. */
export function splitTelegramPlainTextChunks(text: string, limit: number): string[] {
  if (limit <= 0) throw new Error("chunk limit must be positive");
  const trimmed = text;
  if (trimmed.length <= limit) return [trimmed];
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > limit) {
    let breakAt = rest.lastIndexOf(" ", limit);
    if (breakAt < limit * 0.5) breakAt = rest.lastIndexOf("\n", limit);
    if (breakAt < limit * 0.5) breakAt = limit;
    chunks.push(rest.slice(0, breakAt).replace(/[ \t\r\n]+$/, ""));
    rest = rest.slice(breakAt).replace(/^[ \t\r\n]+/, "");
  }
  if (rest !== "") chunks.push(rest);
  return chunks;
}

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
