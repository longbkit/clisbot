import { useCallback, useRef } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { headerToolActivities, type BotToolActivity } from "./tool-activity";
import type { ChatParticipantPayload } from "@clisbot/protocol/chats/types";
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
      head.streamingItems !== other.streamingItems ||
      head.permissions.length !== other.permissions.length
    )
      return false;
    if (head.permissions.some((permission, i) => permission !== other.permissions[i])) return false;
  }
  return true;
}
const EMPTY_ITEMS: ChatLiveHead["items"] = [];
const NO_ACTIVITIES: BotToolActivity[] = [];
type SessionStoreState = ReturnType<typeof useSessionStore.getState>;

function selectChatLiveHeads(
  state: SessionStoreState,
  serverId: string,
  participants: readonly ChatParticipantPayload[],
): Map<string, ChatLiveHead> {
  const session = state.sessions[serverId];
  const heads = new Map<string, ChatLiveHead>();
  for (const participant of participants) {
    if (!participant.agentId) continue;
    const turn = selectAgentTurnPresentation(session, participant.agentId);
    heads.set(participant.botId, {
      agentId: participant.agentId,
      items: session?.agentStreamTail?.get(participant.agentId) ?? EMPTY_ITEMS,
      streamingItems: session?.agentStreamHead?.get(participant.agentId) ?? EMPTY_ITEMS,
      turnActive: turn.isActive,
      startedAt: turn.startedAt,
      permissions: [...(session?.pendingPermissions?.values() ?? [])].filter(
        (permission) => permission.agentId === participant.agentId,
      ),
    });
  }
  return heads;
}

/**
 * Other chats' tokens must not redraw this conversation. Every text chunk changes the heads, so
 * only the component that draws the streaming rows subscribes here; the route and its header
 * use the narrower hooks below.
 */
export function useChatLiveHeads(
  serverId: string,
  participants: readonly ChatParticipantPayload[],
) {
  const select = useCallback(
    (state: SessionStoreState) => selectChatLiveHeads(state, serverId, participants),
    [participants, serverId],
  );
  return useStoreWithEqualityFn(useSessionStore, select, sameHeads);
}

/** A participant's turn is running; changes when a turn starts or ends, not per chunk. */
export function useChatTurnActive(
  serverId: string,
  participants: readonly ChatParticipantPayload[],
): boolean {
  return useSessionStore((state) =>
    participants.some(
      (participant) =>
        participant.agentId !== null &&
        participant.agentId !== undefined &&
        selectAgentTurnPresentation(state.sessions[serverId], participant.agentId).isActive,
    ),
  );
}

/**
 * The header's tool activity. Recomputed only when a head changes, and kept by value, so a text
 * chunk that leaves the tool calls as they were does not redraw the header.
 */
export function useChatHeaderToolActivities(
  serverId: string,
  participants: readonly ChatParticipantPayload[],
  enabled: boolean,
): BotToolActivity[] {
  const cache = useRef<{ heads: Map<string, ChatLiveHead>; activities: BotToolActivity[] }>(null);
  const select = useCallback(
    (state: SessionStoreState) => {
      if (!enabled) return NO_ACTIVITIES;
      const heads = selectChatLiveHeads(state, serverId, participants);
      const previous = cache.current;
      if (previous && sameHeads(previous.heads, heads)) return previous.activities;
      const computed = headerToolActivities(heads);
      const activities =
        previous && equal(previous.activities, computed) ? previous.activities : computed;
      cache.current = { heads, activities };
      return activities;
    },
    [enabled, participants, serverId],
  );
  return useSessionStore(select);
}
