export interface GroupChatDraft {
  serverId: string;
  botIds: string[];
  title: string;
  requireMention: boolean;
}

export function openGroupChatDraft(hostIds: readonly string[]): GroupChatDraft {
  return {
    serverId: hostIds.length === 1 ? hostIds[0]! : "",
    botIds: [],
    title: "",
    requireMention: false,
  };
}

export function selectGroupHost(draft: GroupChatDraft, serverId: string): GroupChatDraft {
  return draft.serverId === serverId ? draft : { ...draft, serverId, botIds: [] };
}

export function toggleGroupBot(draft: GroupChatDraft, botId: string): GroupChatDraft {
  return {
    ...draft,
    botIds: draft.botIds.includes(botId)
      ? draft.botIds.filter((id) => id !== botId)
      : [...draft.botIds, botId],
  };
}

export function groupChatRequest(draft: GroupChatDraft, availableBotIds: readonly string[]) {
  const botIds = draft.botIds.filter((id) => availableBotIds.includes(id));
  // One bot is a group too: several group chats with the same bot keep separate topics apart.
  if (!draft.serverId || botIds.length < 1) throw new Error("Choose at least one bot on one Host");
  return {
    kind: "group" as const,
    botIds,
    title: draft.title.trim() || undefined,
    rules: { interaction: { requireMention: draft.requireMention } },
  };
}
