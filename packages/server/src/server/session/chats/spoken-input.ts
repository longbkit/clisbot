import { CHAT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { AgentStorage } from "../../agent/agent-storage.js";
import type { ChatSession } from "./chat-session.js";

/** Bound agents must never fall through to the ordinary direct-agent prompt path. */
export async function routeChatSpokenInput(
  storage: Pick<AgentStorage, "get">,
  session: Pick<ChatSession, "sendSpokenInput"> | null,
  agentId: string,
  text: string,
): Promise<boolean> {
  const agent = await storage.get(agentId);
  const chatId = agent?.labels?.[CHAT_ID_LABEL];
  if (!chatId) return false;
  if (!session) throw new Error("Chat voice input is unavailable");
  await session.sendSpokenInput(chatId, agentId, text);
  return true;
}
