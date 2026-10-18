import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { resolveChatSendAction } from "@/clisbot/bots/chat/chat-send-action";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";

/** The same exact-turn resolver used for ordinary Chat sends; never choose a participant heuristically. */
export async function resolveQueueSteerTarget(
  client: DaemonClient | null,
  serverId: string,
  agentId: string,
  chatId?: string,
) {
  if (!client) throw new Error("Host is disconnected");
  if (chatId) {
    const result = await client.listChats();
    const chat = result.chats.find((value) => value.id === chatId);
    if (!chat) throw new Error("Chat is unavailable");
    const target = resolveChatSendAction({ serverId, chat, behavior: "steer" }).steerTarget;
    if (!target) throw new Error("No exact active Bot turn to steer; item remains queued");
    return target;
  }
  const turn = selectAgentTurnPresentation(useSessionStore.getState().sessions[serverId], agentId);
  if (!turn.isActive || !turn.turnId)
    throw new Error("No exact active turn to steer; item remains queued");
  return { agentId, turnId: turn.turnId };
}
