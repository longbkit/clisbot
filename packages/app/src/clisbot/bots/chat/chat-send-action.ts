import { useSessionStore, selectAgentTurnPresentation } from "@/stores/session-store";
import type { ChatPayload } from "@clisbot/protocol/chats/types";

interface ChatSendActionInput {
  serverId?: string;
  chat: ChatPayload;
  behavior?: "steer" | "interrupt";
}
export function resolveChatSendAction({ serverId, chat, behavior }: ChatSendActionInput) {
  const session = serverId ? useSessionStore.getState().sessions[serverId] : undefined;
  const supported = session?.serverInfo?.features?.hostInputQueue === true;
  const active = chat.participants.flatMap((participant) => {
    if (!participant.agentId || !session) return [];
    const turn = selectAgentTurnPresentation(session, participant.agentId);
    return turn.isActive && turn.turnId
      ? [{ agentId: participant.agentId, turnId: turn.turnId }]
      : [];
  });
  // COMPAT(hostInputQueue): old Chat sends stay on Chat rules, never a participant queue.
  if (!supported) {
    if (
      behavior === "steer" &&
      active.length > 0 &&
      (chat.rules.interaction?.whenBusy ?? "steer") !== "steer"
    )
      throw new Error("This Host uses Chat busy rules; Steer is unavailable for this Chat");
    return { activeTurnBehavior: undefined, steerTarget: undefined };
  }
  if (behavior === "steer" && active.length > 1)
    throw new Error("Choose Queue: more than one Bot has an active turn");
  return {
    activeTurnBehavior: supported ? behavior : undefined,
    steerTarget: behavior === "steer" && active.length === 1 ? active[0] : undefined,
  };
}
