// L1 rich-message leaf — text chunking + thread params for the send path
// (SYNC.md). Port of the pinned chunk's plain-text chunker + thread-param
// builder; the HTML renderers stay minimal (rich-HTML is behind the
// account's `richMessages` opt-in, off by default — D-003).

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

/** The `message_thread_id` + reply params for a send into a forum topic. */
export function buildTelegramThreadParams(params: {
  messageThreadId?: number;
  replyToMessageId?: number;
  silent?: boolean;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (params.messageThreadId !== undefined) out["message_thread_id"] = params.messageThreadId;
  if (params.replyToMessageId !== undefined) {
    out["reply_parameters"] = { message_id: params.replyToMessageId };
  }
  if (params.silent === true) out["disable_notification"] = true;
  return out;
}

/** Minimal HTML escape (rich-HTML opt-in path; defaults are plain text). */
export function escapeTelegramHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Render the rich-mode text: escape + keep newlines (Telegram HTML
 * collapses whitespace — wrap the payload in a pre block so layout holds). */
export function renderTelegramHtmlText(text: string): string {
  return `<pre>${escapeTelegramHtml(text)}</pre>`;
}

/** The HTML → plain-text fallback for read-backs (strip tags, unescape the
 * three entities we emit). */
export function telegramHtmlToPlainTextFallback(html: string): string {
  return html
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
}
