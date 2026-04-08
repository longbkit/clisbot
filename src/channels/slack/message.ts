export type SlackFile = {
  name?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
};

export type SlackInboundMessage = {
  eventId: string;
  channelId: string;
  threadTs: string;
  text: string;
  userId: string;
  isDirectMessage: boolean;
  requiresMention: boolean;
};

export type SlackEventLike = {
  type?: string;
  channel?: string;
  channel_type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  parent_user_id?: string;
  thread_ts?: string;
  text?: string;
  ts?: string;
  event_ts?: string;
  files?: SlackFile[];
  message?: SlackEventLike;
};

export type SlackThreadParticipant = {
  user?: string;
  bot_id?: string;
};

export type SlackImplicitFollowUpConversationKind = "dm" | "group" | "channel";

export function normalizeSlackMessageEvent(event: SlackEventLike): SlackEventLike {
  if (event.subtype !== "message_replied" || !event.message) {
    return event;
  }

  return {
    ...event,
    ...event.message,
    type: event.message.type ?? event.type,
    channel: event.message.channel ?? event.channel,
    channel_type: event.message.channel_type ?? event.channel_type,
    parent_user_id: event.message.parent_user_id ?? event.parent_user_id,
    thread_ts: event.message.thread_ts ?? event.thread_ts,
    subtype: event.message.subtype,
  };
}

export function getSlackEventSkipReason(event: SlackEventLike): "missing-user" | "subtype" | null {
  if (!event.user && !event.bot_id) {
    return "missing-user";
  }

  if (
    typeof event.subtype === "string" &&
    event.subtype.length > 0 &&
    event.subtype !== "bot_message"
  ) {
    return "subtype";
  }

  return null;
}

export function isBotOriginatedSlackEvent(event: SlackEventLike) {
  return event.subtype === "bot_message" || (!event.user && Boolean(event.bot_id));
}

export function hasBotUserParticipant(
  messages: SlackThreadParticipant[] | undefined,
  botUserId?: string,
) {
  if (!botUserId || !Array.isArray(messages)) {
    return false;
  }

  return messages.some((message) => message.user === botUserId);
}

export function isImplicitBotThreadReply(event: SlackEventLike, botUserId?: string) {
  return Boolean(botUserId && event.thread_ts && event.parent_user_id === botUserId);
}

export function canUseImplicitSlackFollowUp(params: {
  conversationKind: SlackImplicitFollowUpConversationKind;
  event: SlackEventLike;
}) {
  return (
    params.conversationKind !== "dm" &&
    typeof params.event.thread_ts === "string" &&
    params.event.thread_ts.length > 0
  );
}

export function hasBotMention(text: string, botUserId?: string) {
  if (!text) {
    return false;
  }

  if (botUserId) {
    return text.includes(`<@${botUserId}>`);
  }

  return /<@[^>]+>/.test(text);
}

export function stripBotMention(text: string, botUserId?: string) {
  if (!botUserId) {
    return text.replaceAll(/<@[^>]+>/g, "").trim();
  }

  return text.replaceAll(`<@${botUserId}>`, "").replaceAll(/<@[^>]+>/g, "").trim();
}
