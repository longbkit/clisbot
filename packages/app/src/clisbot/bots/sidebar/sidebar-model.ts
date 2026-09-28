import type { BotPayload, ChatPayload } from "../data/contracts";
import type { HostTagged } from "../data/aggregate";

/** Older hosts lack kind; new hosts persist it so a reduced group stays a group. */
export function isDirectChat(chat: Pick<ChatPayload, "kind" | "participants">): boolean {
  return chat.kind ? chat.kind === "direct" : chat.participants.length === 1;
}
export function directChatForBot(
  chats: readonly HostTagged<ChatPayload>[],
  serverId: string,
  botId: string,
) {
  return chats
    .filter(
      (chat) =>
        chat.serverId === serverId && isDirectChat(chat) && chat.participants[0]?.botId === botId,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
export function projectBotSidebar(
  bots: readonly HostTagged<BotPayload>[],
  chats: readonly HostTagged<ChatPayload>[],
  multipleHosts: boolean,
) {
  return bots.map((bot) => {
    const direct = directChatForBot(chats, bot.serverId, bot.id);
    return {
      key: `${bot.serverId}:${bot.id}`,
      serverId: bot.serverId,
      botId: bot.id,
      name: bot.name,
      avatar: bot.avatar,
      hostLabel: multipleHosts ? bot.serverName : null,
      hostName: bot.serverName,
      description: bot.description,
      canConfigure: bot.canConfigure === true,
      isOwner: bot.isOwner,
      updatedAt: direct?.updatedAt,
      chatId: direct?.id,
      agentId: direct?.participants[0]?.agentId,
    };
  });
}

export function selectedDirectBotKey(
  chats: readonly HostTagged<ChatPayload>[],
  current: { serverId: string; chatId: string } | null,
): string | null {
  const chat = chats.find(
    (row) => row.serverId === current?.serverId && row.id === current?.chatId,
  );
  return chat && isDirectChat(chat) && chat.participants[0]
    ? `${chat.serverId}:${chat.participants[0].botId}`
    : null;
}

export function projectGroupSidebar(
  chats: readonly HostTagged<ChatPayload>[],
  multipleHosts: boolean,
) {
  return chats
    .filter((chat) => !isDirectChat(chat))
    .map((chat) => ({
      key: `${chat.serverId}:${chat.id}`,
      serverId: chat.serverId,
      chatId: chat.id,
      agentIds: chat.participants.flatMap((p) => (p.agentId ? [p.agentId] : [])),
      title: chat.title,
      updatedAt: chat.updatedAt,
      hostLabel: multipleHosts ? chat.serverName : null,
    }));
}

/** Chat metadata drives recency; streaming timeline deltas do not enter this projection. */
export function recentSidebarBots<T extends { key: string; updatedAt?: string }>(
  bots: readonly T[],
  selectedKey: string | null,
  limit = 5,
): T[] {
  const sorted = [...bots].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const recent = sorted.slice(0, limit);
  const selected = sorted.find((bot) => bot.key === selectedKey);
  if (selected && !recent.includes(selected)) return [...recent.slice(0, limit - 1), selected];
  return recent;
}
