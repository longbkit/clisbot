// Bots and group chats in the Command Center (global search). Pure: the registration hook
// supplies the catalog and the actions. Both sections appear only for a query, like Workspaces
// and Agents; a contribution section ranks above those by match quality.
import type { CommandCenterContribution, CommandCenterIcon } from "@/command-center/contributions";
import type { HostTagged } from "../data/aggregate";
import type { BotPayload, ChatPayload } from "../data/contracts";
import { isDirectChat } from "../sidebar/sidebar-model";

export interface BotSearchSource {
  bots: readonly HostTagged<BotPayload>[];
  chats: readonly HostTagged<ChatPayload>[];
  /** Name the Host on each row only when there is more than one. */
  multipleHosts: boolean;
  /** Offer New bot: a Host lets this identity create bots and the sidebar can open the sheet. */
  canCreateBot: boolean;
  /** Offer New group chat: there is a bot to add and the sidebar can open the sheet. */
  canCreateGroup: boolean;
  labels: { actions: string };
  icons: { bot?: CommandCenterIcon; group?: CommandCenterIcon; create?: CommandCenterIcon };
  openBot(serverId: string, botId: string): void;
  openChat(serverId: string, chatId: string): void;
  createBot(): void;
  createGroup(): void;
}

export function buildBotSearchContributions(source: BotSearchSource): CommandCenterContribution[] {
  return [
    ...source.bots.map((bot, index) => botContribution(source, bot, index)),
    ...groupChats(source.chats).map((chat, index) => groupContribution(source, chat, index)),
    ...creationContributions(source),
  ];
}

function botContribution(
  source: BotSearchSource,
  bot: HostTagged<BotPayload>,
  rank: number,
): CommandCenterContribution {
  return {
    id: `bot:${bot.serverId}:${bot.id}`,
    group: "clisbot-bots",
    groupRank: 1,
    rank,
    keywords: ["bot", bot.slug, `@${bot.slug}`, bot.serverName],
    visibility: "query",
    run: () => source.openBot(bot.serverId, bot.id),
    presentation: {
      kind: "action",
      title: bot.name,
      subtitle: subtitleOf(source, bot.serverName, bot.description?.trim() || "No role yet"),
      sectionTitle: "Bots",
      icon: source.icons.bot,
    },
  };
}

function groupContribution(
  source: BotSearchSource,
  chat: HostTagged<ChatPayload>,
  rank: number,
): CommandCenterContribution {
  const members = memberNames(source.bots, chat);
  return {
    id: `chat:${chat.serverId}:${chat.id}`,
    group: "clisbot-group-chats",
    groupRank: 2,
    rank,
    keywords: ["group", "chat", chat.serverName],
    visibility: "query",
    run: () => source.openChat(chat.serverId, chat.id),
    presentation: {
      kind: "action",
      title: chat.title,
      subtitle: subtitleOf(source, chat.serverName, members.join(", ")),
      sectionTitle: "Group chats",
      icon: source.icons.group,
    },
  };
}

function creationContributions(source: BotSearchSource): CommandCenterContribution[] {
  const action = (id: string, title: string, rank: number, run: () => void, words: string[]) =>
    ({
      id,
      group: "actions",
      groupRank: 0,
      rank,
      keywords: ["new", "create", ...words],
      visibility: "query",
      run,
      presentation: {
        kind: "action",
        title,
        sectionTitle: source.labels.actions,
        icon: source.icons.create,
      },
    }) satisfies CommandCenterContribution;
  return [
    ...(source.canCreateBot
      ? [action("new-bot", "New bot", 20, source.createBot, ["bot", "assistant"])]
      : []),
    ...(source.canCreateGroup
      ? [action("new-group-chat", "New group chat", 21, source.createGroup, ["group", "room"])]
      : []),
  ];
}

/** Group chats, most recent first; a direct chat is found through its bot. */
function groupChats(chats: readonly HostTagged<ChatPayload>[]): HostTagged<ChatPayload>[] {
  return chats
    .filter((chat) => !isDirectChat(chat))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function memberNames(bots: readonly HostTagged<BotPayload>[], chat: HostTagged<ChatPayload>) {
  return chat.participants.flatMap((participant) => {
    const bot = bots.find((row) => row.serverId === chat.serverId && row.id === participant.botId);
    return bot ? [bot.name] : [];
  });
}

function subtitleOf(source: BotSearchSource, host: string, detail: string): string {
  return source.multipleHosts && detail ? `${host} · ${detail}` : detail || host;
}
