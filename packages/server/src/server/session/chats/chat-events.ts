import type { SessionOutboundMessage } from "../../messages.js";

export function isBotChatEvent(
  type: SessionOutboundMessage["type"],
): type is "bot.updated" | "chat.updated" | "chat.transcript.appended" {
  return type === "bot.updated" || type === "chat.updated" || type === "chat.transcript.appended";
}
