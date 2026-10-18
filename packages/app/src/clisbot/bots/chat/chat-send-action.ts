import { useSessionStore, selectAgentTurnPresentation } from "@/stores/session-store";
import type { ChatPayload } from "@clisbot/protocol/chats/types";

interface ChatSendActionInput {
  serverId?: string;
  chat: ChatPayload;
  behavior?: "steer" | "interrupt";
}
export function resolveChatSendAction({ serverId, chat, behavior }: ChatSendActionInput) {
  const session = serverId ? useSessionStore.getState().sessions[serverId] : undefined;
  const active = chat.participants.flatMap((participant) => {
    if (!participant.agentId || !session) return [];
    const turn = selectAgentTurnPresentation(session, participant.agentId);
    return turn.isActive && turn.turnId
      ? [{ agentId: participant.agentId, turnId: turn.turnId }]
      : [];
  });
  if (behavior === "steer" && active.length > 1)
    throw new Error("Choose Queue: more than one Bot has an active turn");
  const supported = session?.serverInfo?.features?.hostInputQueue === true;
  if (behavior && active.length > 0 && !supported)
    throw new Error("Update this Host to use the shared send action for Bots");
  return {
    activeTurnBehavior: supported ? behavior : undefined,
    steerTarget: behavior === "steer" && active.length === 1 ? active[0] : undefined,
  };
}
