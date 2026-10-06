// Fusion-owned implicit quoting (D-WA-031).
//
// Upstream's `channels.whatsapp.replyToMode` decides whether an answer visibly
// quotes the inbound message it answers (`auto-reply/monitor/process-message.ts`
// reads it, default `off`). The Hub's post carries no reply-to, so the vertical
// keeps the one fact that needs: per chat, the latest admitted message. The next
// text post into that chat takes it once; `outbound.ts` applies the mode.
//
// Conversation lanes serialize a chat (lane = binding), so the latest admitted
// message is the one being answered. A pending quote older than the window is
// dropped rather than attached to an unrelated later post.
const PENDING_QUOTE_TTL_MS = 30 * 60 * 1000;

type PendingQuote = { messageId: string; at: number };

const pending = new Map<string, PendingQuote>();

function key(accountId: string, chatJid: string): string {
  return `${accountId}\u0000${chatJid}`;
}

/** Records the chat's latest admitted message, the one an answer would quote. */
export function noteWhatsAppInboundForQuote(params: {
  accountId: string;
  chatJid: string;
  messageId: string;
  now?: number;
}): void {
  pending.set(key(params.accountId, params.chatJid), {
    messageId: params.messageId,
    at: params.now ?? Date.now(),
  });
}

/** The message id the next post into this chat should quote, consumed. */
export function takeWhatsAppQuote(accountId: string, chatJid: string, now = Date.now()): string | undefined {
  const k = key(accountId, chatJid);
  const quote = pending.get(k);
  pending.delete(k);
  if (!quote || now - quote.at > PENDING_QUOTE_TTL_MS) return undefined;
  return quote.messageId;
}

/** Drops every pending quote of an account (the account stopped). */
export function clearWhatsAppQuotes(accountId: string): void {
  for (const k of pending.keys()) {
    if (k.startsWith(`${accountId}\u0000`)) pending.delete(k);
  }
}
