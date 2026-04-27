export type ChannelIdentity = {
  platform: "slack" | "telegram";
  botId?: string;
  accountId?: string;
  conversationKind: "dm" | "channel" | "group" | "topic";
  senderId?: string;
  senderName?: string;
  senderHandle?: string;
  channelId?: string;
  channelName?: string;
  chatId?: string;
  chatName?: string;
  threadTs?: string;
  topicId?: string;
  topicName?: string;
};

export function resolveChannelIdentityBotId(identity: Pick<ChannelIdentity, "botId" | "accountId">) {
  return identity.botId ?? identity.accountId;
}
