import type { SessionOutboundMessage } from "@clisbot/protocol/messages";
import { normalizeChatSender } from "@clisbot/protocol/chats/sender";
import type { ChatMessagePayload } from "@clisbot/protocol/chats/types";

/** Normalize both transcript pages and live pushes before notifying client consumers. */
export function normalizeChatSenders(message: SessionOutboundMessage): SessionOutboundMessage {
  if (message.type === "chat.transcript.appended") {
    return {
      ...message,
      payload: { ...message.payload, line: normalizeLine(message.payload.line) },
    };
  }
  if (message.type === "chat.transcript.fetch.response") {
    return {
      ...message,
      payload: { ...message.payload, lines: message.payload.lines.map(normalizeLine) },
    };
  }
  return message;
}

function normalizeLine(line: ChatMessagePayload): ChatMessagePayload {
  const sender = normalizeChatSender(line.sender);
  return sender === line.sender ? line : { ...line, sender };
}
