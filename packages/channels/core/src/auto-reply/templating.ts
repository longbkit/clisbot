// upstream: src/auto-reply/templating.ts@5d8067a4483
// D-CORE-502: upstream's `templating.ts` declares the whole inbound prompt
// context (`MsgContext`, ~300 declared members) plus the renderers around it; it
// pulls media-understanding, plugin hook contexts, session provenance and the
// command-turn contract. Fusion's Hub owns prompt shaping, so this file carries
// the `ReplyChain` member the ported Telegram message cache derives its node
// type from, verbatim from upstream.

/** Raw inbound message context accepted from channels before finalization. */
export type MsgContext = {
  ReplyChain?: Array<{
    messageId?: string;
    threadId?: string;
    sender?: string;
    senderId?: string;
    senderUsername?: string;
    timestamp?: number;
    body?: string;
    isQuote?: boolean;
    mediaType?: string;
    mediaPath?: string;
    mediaRef?: string;
    replyToId?: string;
    forwardedFrom?: string;
    forwardedFromId?: string;
    forwardedFromUsername?: string;
    forwardedDate?: number;
  }>;
};
