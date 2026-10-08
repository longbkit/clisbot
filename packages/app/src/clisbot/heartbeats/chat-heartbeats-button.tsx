import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { BOT_ID_LABEL, CHAT_ID_LABEL } from "@clisbot/protocol/bots/labels";
import type { ChatPayload } from "@clisbot/protocol/chats/types";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { HeartbeatsMenu, type HeartbeatSection } from "./heartbeats-menu";

/**
 * Heartbeats in a Chat's header, after its ⋯: one group per Bot, covering every session that Bot
 * has had in this Chat. After `/new` a heartbeat still points at the earlier session until the
 * fresh one starts (the daemon moves it then), so the group must not lose it in between.
 */
export function ChatHeartbeatsButton({
  serverId,
  chat,
}: {
  serverId: string;
  chat: ChatPayload;
}): ReactElement {
  const { t } = useTranslation();
  const sessionsByBot = useChatBotSessions(serverId, chat.id);
  const sections = useMemo<HeartbeatSection[]>(
    () =>
      chat.participants.map((participant) => {
        const earlier = sessionsByBot[participant.botId] ?? [];
        const agentIds = participant.agentId
          ? [participant.agentId, ...earlier.filter((id) => id !== participant.agentId)]
          : earlier;
        return {
          key: participant.botId,
          title: participant.displayName,
          agentIds,
          current: true,
          // A heartbeat through the Chat reaches the Bot's current session whichever it names.
          createAgentId: agentIds[0] ?? null,
        };
      }),
    [chat.participants, sessionsByBot],
  );
  const openAgent = useCallback(
    (agentId: string) => navigateToAgent({ serverId, agentId }),
    [serverId],
  );
  return (
    <HeartbeatsMenu
      serverId={serverId}
      sections={sections}
      emptyHint={t("heartbeats.emptyChat")}
      onOpenAgent={openAgent}
      testID="chat-heartbeats"
    />
  );
}

/** Every unarchived session each Bot has had in this Chat, newest first, by Bot id. */
function useChatBotSessions(serverId: string, chatId: string): Record<string, string[]> {
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  return useMemo(() => {
    const byBot: Record<string, { id: string; at: number }[]> = {};
    for (const agent of agents?.values() ?? []) {
      const botId = agent.labels[BOT_ID_LABEL];
      if (!botId || agent.labels[CHAT_ID_LABEL] !== chatId || agent.archivedAt) continue;
      (byBot[botId] ??= []).push({ id: agent.id, at: agent.createdAt.getTime() });
    }
    return Object.fromEntries(
      Object.entries(byBot).map(([botId, list]) => [
        botId,
        list.sort((a, b) => b.at - a.at).map((entry) => entry.id),
      ]),
    );
  }, [agents, chatId]);
}
