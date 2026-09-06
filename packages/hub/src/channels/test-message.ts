import { createHash } from "node:crypto";
/** One owner for the management test preview and the actual text post. */
export const CHANNEL_TEST_MESSAGE = "Paseo Channel test — the Connection can send messages.";

export function channelTestMessage(input: {
  channel: "slack" | "telegram";
  accountId: string;
  conversationId: string;
  threadId?: string | undefined;
}) {
  // Telegram sends into General without message_thread_id (the Bot API rejects 1).
  const threadId =
    input.channel === "telegram" && input.threadId === "1" ? null : (input.threadId ?? null);
  return {
    channel: input.channel,
    accountId: input.accountId,
    conversationId: input.conversationId,
    threadId,
    requestedThreadId: input.threadId ?? null,
    text: CHANNEL_TEST_MESSAGE,
    replyToMessageId: null,
    attachments: [],
  };
}

export function channelTestPreview(
  input: Parameters<typeof channelTestMessage>[0] & {
    revisionId: string | null;
    connectionId: string;
  },
) {
  const message = channelTestMessage(input);
  const previewId = createHash("sha256")
    .update(JSON.stringify([input.revisionId, input.connectionId, message]))
    .digest("base64url");
  return { ...message, revisionId: input.revisionId, previewId };
}
