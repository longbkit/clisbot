import { useEffect, useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
export function useChatVisibility(
  serverId: string,
  chatId: string,
  chat: ChatPayload | null,
  focused: boolean,
) {
  const sync = useSessionStore((state) => state.sessions[serverId]?.viewedTimelineSync);
  const agentIds = useMemo(
    () => chat?.participants.flatMap((p) => (p.agentId ? [p.agentId] : [])) ?? [],
    [chat],
  );
  useEffect(() => {
    const source = `chat:${chatId}`;
    sync?.replaceVisibleAgentIds(source, focused ? agentIds : []);
    return () => sync?.replaceVisibleAgentIds(source, []);
  }, [agentIds, chatId, sync, focused]);
}
