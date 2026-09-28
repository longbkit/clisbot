import { useCallback } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { ChatParticipantPayload } from "@getpaseo/protocol/chats/types";
import { useSessionStore, selectAgentTurnPresentation } from "@/stores/session-store";
import type { ChatLiveHead } from "./render-model";

function sameHeads(
  left: ReadonlyMap<string, ChatLiveHead>,
  right: ReadonlyMap<string, ChatLiveHead>,
) {
  if (left.size !== right.size) return false;
  for (const [botId, head] of left) {
    const other = right.get(botId);
    if (
      !other ||
      head.agentId !== other.agentId ||
      head.turnActive !== other.turnActive ||
      head.startedAt?.getTime() !== other.startedAt?.getTime() ||
      head.items !== other.items ||
      head.permissions.length !== other.permissions.length
    )
      return false;
    if (head.permissions.some((permission, i) => permission !== other.permissions[i])) return false;
  }
  return true;
}
const EMPTY_ITEMS: ChatLiveHead["items"] = [];
/** Other chats' tokens must not redraw this conversation. */
export function useChatLiveHeads(
  serverId: string,
  participants: readonly ChatParticipantPayload[],
) {
  const select = useCallback(
    (state: ReturnType<typeof useSessionStore.getState>) => {
      const session = state.sessions[serverId];
      const heads = new Map<string, ChatLiveHead>();
      for (const participant of participants) {
        if (!participant.agentId) continue;
        const turn = selectAgentTurnPresentation(session, participant.agentId);
        heads.set(participant.botId, {
          agentId: participant.agentId,
          items: session?.agentStreamTail?.get(participant.agentId) ?? EMPTY_ITEMS,
          turnActive: turn.isActive,
          startedAt: turn.startedAt,
          permissions: [...(session?.pendingPermissions?.values() ?? [])].filter(
            (permission) => permission.agentId === participant.agentId,
          ),
        });
      }
      return heads;
    },
    [participants, serverId],
  );
  return useStoreWithEqualityFn(useSessionStore, select, sameHeads);
}
