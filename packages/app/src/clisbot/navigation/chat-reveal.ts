import { useCallback } from "react";
import type { HostTagged } from "@/clisbot/bots/data/aggregate";
import type { BotPayload, ChatPayload } from "@/clisbot/bots/data/contracts";
import { directChatForBot } from "@/clisbot/bots/sidebar/sidebar-model";
import { setOutsideFilterReveal } from "@/clisbot/search-scope/work-navigation";
import { chatReveal } from "./outside-filter";
import { resolveDirectChatOwnership, resolveOwnership } from "./ownership";
import { useReaderAccounts } from "./reader";
import { useNavigationStore } from "./store";

function chatsFilter() {
  const state = useNavigationStore.getState();
  return { serverIds: state.chatsHosts, scope: state.scopes.chats };
}

/**
 * What opening a Bot or group chat from search tells Chats (R3): nothing when Chats shows it, else
 * the reveal its notice renders. Read at the moment of opening, so it always matches the filter
 * the reader is looking at.
 */
export function useRevealChatOpen(chats: readonly HostTagged<ChatPayload>[]) {
  const accounts = useReaderAccounts();
  const revealBot = useCallback(
    (bot: HostTagged<BotPayload>) => {
      const direct = directChatForBot(chats, bot.serverId, bot.id);
      const ownership = resolveDirectChatOwnership(
        { directChatCreatedBy: direct?.record?.createdBy, bot },
        accounts,
      );
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
    [accounts, chats],
  );
  const revealGroup = useCallback(
    (chat: HostTagged<ChatPayload>) => {
      setOutsideFilterReveal(
        chatReveal(
          {
            serverId: chat.serverId,
            hostLabel: chat.serverName,
            ownership: resolveOwnership({ createdBy: chat.record?.createdBy, accounts }),
            target: { kind: "chat", serverId: chat.serverId, id: chat.id },
          },
          chatsFilter(),
        ),
      );
    },
    [accounts],
  );
  return { revealBot, revealGroup };
}
