import { useCallback } from "react";
import type { HostTagged } from "@/clisbot/bots/data/aggregate";
import type { BotPayload, ChatPayload } from "@/clisbot/bots/data/contracts";
import { directChatForBot } from "@/clisbot/bots/sidebar/sidebar-model";
import { setOutsideFilterReveal } from "@/clisbot/search-scope/work-navigation";
import { chatReveal } from "./outside-filter";
import { useChatOwnership } from "./use-chat-ownership";
import { useNavigationStore } from "./store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

function chatsFilter() {
  return {
    serverIds: useSidebarViewStore.getState().hostFilters,
    scope: useNavigationStore.getState().scopes.chats,
  };
}

/**
 * What opening a Bot or group chat from search tells Chats (R3): nothing when Chats shows it, else
 * the reveal its notice renders. Read at the moment of opening, so it always matches the filter
 * the reader is looking at.
 */
export function useRevealChatOpen(chats: readonly HostTagged<ChatPayload>[]) {
  const { chatOwnership, botOwnership } = useChatOwnership(chats);
  const revealBot = useCallback(
    (bot: HostTagged<BotPayload>) => {
      const direct = directChatForBot(chats, bot.serverId, bot.id);
      const ownership = botOwnership(bot, direct ?? undefined);
      const botTarget = { kind: "bot", serverId: bot.serverId, id: bot.id } as const;
      const chatTarget = direct
        ? ({ kind: "chat", serverId: bot.serverId, id: direct.id } as const)
        : null;
      setOutsideFilterReveal(
        chatReveal(
          {
            serverId: bot.serverId,
            hostLabel: bot.serverName,
            ownership,
            target: chatTarget ?? botTarget,
            alsoTargets: chatTarget ? [botTarget] : [],
          },
          chatsFilter(),
        ),
      );
    },
    [botOwnership, chats],
  );
  const revealGroup = useCallback(
    (chat: HostTagged<ChatPayload>) => {
      setOutsideFilterReveal(
        chatReveal(
          {
            serverId: chat.serverId,
            hostLabel: chat.serverName,
            ownership: chatOwnership(chat),
            target: { kind: "chat", serverId: chat.serverId, id: chat.id },
          },
          chatsFilter(),
        ),
      );
    },
    [chatOwnership],
  );
  return { revealBot, revealGroup };
}
