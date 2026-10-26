import { useMemo } from "react";
import { useHubAccounts } from "@/clisbot/hub/account-provider";
import { isUnreadReply } from "@/clisbot/home/activity";
import { useSidebarCatalog } from "@/clisbot/bots/sidebar/sections";
import { projectBotSidebar, projectGroupSidebar } from "@/clisbot/bots/sidebar/sidebar-model";
import { pinKey, useResourcePins } from "@/clisbot/bots/sidebar/pins";
import type { BotsSidebarBot } from "@/clisbot/bots/sidebar/bots-section";
import type { ChatsSidebarChat } from "@/clisbot/bots/sidebar/chats-section";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useHosts } from "@/runtime/host-runtime";
import type { ChatListEntry } from "./chat-list";
import { resolveDirectChatOwnership, resolveOwnership } from "./ownership";
import { useReaderAccounts } from "./reader";

export type ChatsEntry = ChatListEntry<BotsSidebarBot, ChatsSidebarChat>;

/** Hosts reached through a shared (company) Hub; everything else is personal. */
function useCompanyHosts(): ReadonlySet<string> {
  const hosts = useHosts();
  const accounts = useHubAccounts();
  return useMemo(() => {
    const personal = new Set(
      accounts
        .filter((account) => account.connection?.accountAuthentication === "personal")
        .map((account) => account.origin),
    );
    return new Set(
      hosts
        .filter((host) => host.management?.hubOrigin && !personal.has(host.management.hubOrigin))
        .map((host) => host.serverId),
    );
  }, [accounts, hosts]);
}

function useUnreadAgents(): ReadonlySet<string> {
  const { agents } = useAggregatedAgents({ demand: false });
  return useMemo(
    () => new Set(agents.filter(isUnreadReply).map((agent) => `${agent.serverId}:${agent.id}`)),
    [agents],
  );
}

/**
 * Every Chats row (brief C3): each Bot's direct chat and each group chat, with the facts the
 * list orders and filters by. Chats' own Display menu holds the Host filter.
 */
export function useChatEntries() {
  const catalog = useSidebarCatalog();
  const { hosts, botRows, chatRows } = catalog;
  const { isPinned, pins } = useResourcePins(chatRows);
  const accounts = useReaderAccounts();
  const company = useCompanyHosts();
  const unread = useUnreadAgents();
  const entries = useMemo(() => {
    const multiple = hosts.length > 1;
    const order = new Map(pins.map((pin, index) => [pinKey(pin), index]));
    const pinIndex = (kind: "bot" | "chat", serverId: string, id: string) =>
      order.get(pinKey({ kind, serverId, id }));
    const ownersById = new Map(botRows.map((bot) => [`${bot.serverId}:${bot.id}`, bot]));
    const chatById = new Map(chatRows.map((chat) => [`${chat.serverId}:${chat.id}`, chat]));
    const bots = projectBotSidebar(botRows, chatRows, multiple);
    const groups = projectGroupSidebar(chatRows, multiple);
    const botEntries = bots.map((bot): ChatsEntry => {
      const payload = ownersById.get(bot.key);
      const direct = bot.chatId ? chatById.get(`${bot.serverId}:${bot.chatId}`) : undefined;
      return {
        key: `bot:${bot.key}`,
        kind: "bot",
        serverId: bot.serverId,
        title: bot.name,
        updatedAt: bot.updatedAt,
        pinned: isPinned({ kind: "bot", serverId: bot.serverId, id: bot.botId }),
        pinIndex: pinIndex("bot", bot.serverId, bot.botId),
        ownership: resolveDirectChatOwnership(
          { directChatCreatedBy: direct?.record?.createdBy, bot: payload ?? {} },
          accounts,
        ),
        unread: Boolean(bot.agentId && unread.has(`${bot.serverId}:${bot.agentId}`)),
        company: company.has(bot.serverId),
        bot,
      };
    });
    const groupEntries = groups.map(
      (chat): ChatsEntry => ({
        key: `chat:${chat.key}`,
        kind: "group",
        serverId: chat.serverId,
        title: chat.title,
        updatedAt: chat.updatedAt,
        pinned: isPinned({ kind: "chat", serverId: chat.serverId, id: chat.chatId }),
        pinIndex: pinIndex("chat", chat.serverId, chat.chatId),
        ownership: resolveOwnership({
          createdBy: chatById.get(chat.key)?.record?.createdBy,
          accounts,
        }),
        unread: (chat.agentIds ?? []).some((id) => unread.has(`${chat.serverId}:${id}`)),
        company: company.has(chat.serverId),
        group: chat,
      }),
    );
    return [...botEntries, ...groupEntries];
  }, [accounts, botRows, chatRows, company, hosts, isPinned, pins, unread]);
  return { entries, catalog };
}
