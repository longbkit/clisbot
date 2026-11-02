import { discardAgentSend, retryAgentSend } from "./agent-delivery";
import { discardChatSend, retryChatSend } from "./chat-delivery";
import { getOutboxEntry } from "./store";

/** Retry from the message itself: the same id goes to the same agent or chat. */
export function retryOutboxMessage(clientMessageId: string): void {
  const entry = getOutboxEntry(clientMessageId);
  if (!entry) return;
  if (entry.target.kind === "agent") void retryAgentSend(clientMessageId);
  else void retryChatSend(clientMessageId);
}

export function deleteOutboxMessage(clientMessageId: string): void {
  const entry = getOutboxEntry(clientMessageId);
  if (!entry) return;
  if (entry.target.kind === "agent") discardAgentSend(clientMessageId);
  else discardChatSend(clientMessageId);
}
