import type { Message } from "discord.js";
import type { ProviderEventAcceptance } from "../../db/types.js";
import type { TriggerHandler, TriggerSource } from "../index.js";
import type { ProviderEventDropReasonCode } from "../drop-reason.js";
import { logProviderEventIntake } from "../audit.js";
import type { DiscordBotClient } from "./bot.js";
import { NormalizedDiscordMessageEventSchema } from "./events.js";
import type { NormalizedDiscordMessageEvent } from "./events.js";

export interface CreateDiscordGatewaySourceOptions {
  bot: DiscordBotClient;
  accept(input: {
    guildId: string;
    deliveryId: string;
    source: string;
    payload: unknown;
    receivedAt: Date;
    dropReason?: ProviderEventDropReasonCode;
  }): Promise<ProviderEventAcceptance>;
  applyGuildDelete(guildId: string, unavailable: boolean): Promise<void>;
}

export function createDiscordGatewaySource(
  options: CreateDiscordGatewaySourceOptions,
): TriggerSource {
  const handlers = new Set<TriggerHandler>();
  let unsubscribe: (() => void) | undefined;
  let unsubscribeGuildDelete: (() => void) | undefined;

  return {
    async start(handler) {
      handlers.add(handler);
      if (unsubscribe !== undefined) {
        return;
      }
      await options.bot.start();
      unsubscribe = options.bot.onMessageCreate(async (message) => {
        await dispatchMessage(message, handlers, options.bot.getSelfUserId(), options);
      });
      unsubscribeGuildDelete = options.bot.onGuildDelete(async (guild) => {
        await options.applyGuildDelete(guild.id, guild.unavailable);
      });
    },
    async stop() {
      handlers.clear();
      if (unsubscribe !== undefined) {
        unsubscribe();
        unsubscribe = undefined;
      }
      unsubscribeGuildDelete?.();
      unsubscribeGuildDelete = undefined;
      await options.bot.stop();
    },
  };
}

export function normalizeMessage(
  message: Message,
  botUserId?: string,
): NormalizedDiscordMessageEvent | undefined {
  if (message.guildId === null) {
    return undefined;
  }
  const channel = message.channel;
  if (channel === null) {
    return undefined;
  }

  const isThread = typeof channel.isThread === "function" && channel.isThread();
  const parentChannelId = isThread ? (channel.parentId ?? null) : null;
  const mentionedBotRoleIds =
    botUserId === undefined
      ? []
      : message.mentions.roles
          .filter((role) => role.tags?.botId === botUserId)
          .map((role) => role.id);

  return NormalizedDiscordMessageEventSchema.parse({
    type: "mention",
    id: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    threadId: isThread ? message.channelId : null,
    parentChannelId,
    messageId: message.id,
    content: message.content,
    mentionedUserIds: message.mentions.users.map((user) => user.id),
    mentionedBotRoleIds,
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot,
    },
    createdAt: message.createdAt.toISOString(),
    attachments: normalizeAttachments(message),
    referencedMessage: normalizeReferencedMessage(message),
  });
}

async function dispatchMessage(
  message: Message,
  handlers: Set<TriggerHandler>,
  botUserId: string,
  options: CreateDiscordGatewaySourceOptions,
): Promise<void> {
  const normalized = normalizeMessage(message, botUserId);

  if (normalized === undefined) {
    return;
  }
  if (!isTriggerCandidate(normalized, botUserId)) {
    return;
  }

  const normalizedEvent = NormalizedDiscordMessageEventSchema.parse(normalized);

  const acceptance = await options.accept({
    guildId: normalizedEvent.guildId,
    source: "discord.mention",
    deliveryId: `discord-${normalizedEvent.messageId}`,
    receivedAt: new Date(normalizedEvent.createdAt),
    payload: normalizedEvent,
    ...(handlers.size === 0 ? { dropReason: "configuration_unavailable" } : {}),
  });
  logProviderEventIntake({
    provider: "discord",
    source: "discord.mention",
    deliveryId: `discord-${normalizedEvent.messageId}`,
    resourceId: normalizedEvent.guildId,
    acceptance,
  });
  if (acceptance.status !== "accepted") return;

  for (const acceptedEvent of acceptance.events) {
    for (const handler of handlers) await handler(acceptedEvent);
  }
}

function isTriggerCandidate(event: NormalizedDiscordMessageEvent, botUserId: string): boolean {
  return (
    !event.author.bot &&
    (event.mentionedUserIds.includes(botUserId) || (event.mentionedBotRoleIds?.length ?? 0) > 0)
  );
}

function normalizeAttachments(message: Message) {
  return Array.from(message.attachments.values(), (attachment) => ({
    id: attachment.id,
    filename: attachment.name,
    url: attachment.url,
    contentType: attachment.contentType,
    size: attachment.size,
  }));
}

function normalizeReferencedMessage(message: Message) {
  const reference = message.reference;
  if (reference === null || reference.messageId === undefined) return null;
  return {
    id: reference.messageId,
    channelId: reference.channelId,
    guildId: reference.guildId ?? null,
  };
}
