export type TeamsConversationType = "personal" | "channel" | "groupChat";

export type TeamsActivity = {
  type: string;
  id: string;
  timestamp?: string;
  serviceUrl: string;
  channelId: string;
  from: { id: string; name?: string; aadObjectId?: string };
  conversation: {
    id: string;
    isGroup?: boolean;
    conversationType: TeamsConversationType;
    tenantId?: string;
    name?: string;
  };
  recipient: { id: string; name?: string };
  text?: string;
  entities?: Array<{ type: string; mentioned?: { id: string; name?: string } }>;
  channelData?: {
    teamsChannelId?: string;
    team?: { id: string; name?: string };
    channel?: { id: string; name?: string };
    tenant?: { id: string };
  };
  replyToId?: string;
  attachments?: Array<{ contentType: string; content?: unknown }>;
};

export function isTeamsBotMentioned(activity: TeamsActivity, botId: string): boolean {
  if (!activity.entities) {
    return false;
  }
  const normalizedBotId = botId.trim().toLowerCase();
  return activity.entities.some(
    (entity) =>
      entity.type === "mention" &&
      entity.mentioned?.id?.trim().toLowerCase() === normalizedBotId,
  );
}

export function stripTeamsBotMention(text: string, botName?: string): string {
  if (!text) {
    return text;
  }
  let result = text;
  if (botName) {
    const escaped = botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`<at>${escaped}</at>`, "gi"), "");
  }
  return result.trim();
}

export function isTeamsBotOriginatedMessage(activity: TeamsActivity, botId: string): boolean {
  return activity.from.id.trim().toLowerCase() === botId.trim().toLowerCase();
}

export function resolveTeamsConversationName(activity: TeamsActivity): string | undefined {
  return activity.conversation.name?.trim() || activity.channelData?.channel?.name?.trim() || undefined;
}
