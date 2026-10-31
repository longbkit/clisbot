import { useRef } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";

interface SeenTail {
  serverId: string;
  agentId: string | undefined;
  tail: StreamItem[] | undefined;
}

// A hidden chat keeps the tail it last selected. The stable value stops incoming
// chunks from scheduling React work, and the list keeps its rows: an emptied list
// loses its scroll range, so the reading position was gone on return.
// Revealing the panel reads the current tail directly from the model.
export function useAgentStreamTail(serverId: string, agentId: string | undefined) {
  const active = useRetainedPanelActive();
  const seen = useRef<SeenTail | null>(null);
  return useSessionStore((state) => {
    const held = seen.current;
    if (!active && held?.serverId === serverId && held.agentId === agentId) return held.tail;
    const tail = agentId ? state.sessions[serverId]?.agentStreamTail.get(agentId) : undefined;
    seen.current = { serverId, agentId, tail };
    return tail;
  });
}
