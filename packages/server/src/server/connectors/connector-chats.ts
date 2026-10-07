import type { AgentManager } from "../agent/agent-manager.js";
import type { ChatService } from "../chats/chat-service.js";
import type { ChatOffLists } from "./connector-off-lists.js";

/**
 * What Connectors need from Chats (docs/features/connectors/README.md, "In a Chat"): a Chat's
 * tools off list for its Bots' sessions, every Chat's list to follow a renamed MCP server, and
 * skills shown or hidden again when a Chat's list changes. Nothing without Chats.
 */
export function connectorChatHooks(
  chats: ChatService | undefined,
  agentManager: Pick<AgentManager, "refreshSkillsOff">,
): { chatToolsOff?(chatId: string): Promise<readonly string[]>; chatOffLists?: ChatOffLists } {
  if (!chats) return {};
  chats.subscribe((message) => {
    if (message.type !== "chat.updated") return;
    for (const participant of message.payload.chat.participants) {
      if (participant.agentId) void agentManager.refreshSkillsOff(participant.agentId);
    }
  });
  return {
    async chatToolsOff(chatId) {
      // The cache answers once Chats are loaded; a call before that reads the record.
      const cached = chats.record(chatId);
      if (cached) return cached.rules.tools?.off ?? [];
      return (await chats.get(chatId))?.rules.tools?.off ?? [];
    },
    chatOffLists: {
      list: async () =>
        (await chats.list()).map((chat) => ({ chatId: chat.id, off: chat.rules.tools?.off ?? [] })),
      set: async (chatId, off) => {
        await chats.update(chatId, { toolsOff: off });
      },
    },
  };
}
