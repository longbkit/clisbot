import {
  Client,
  GatewayIntentBits,
  type GuildBasedChannel,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import { Routes } from "discord-api-types/v10";
import { reportFailure } from "../../failures/index.js";
import { DiscordSnowflakeSchema } from "../../discord/snowflake.js";
import { NormalizedDiscordContextMessageSchema } from "./events.js";
import type { NormalizedDiscordContextMessage } from "./events.js";

type DiscordGatewayFailure =
  | "authenticationFailed"
  | "invalidShard"
  | "shardingRequired"
  | "invalidApiVersion"
  | "invalidIntents"
  | "disallowedIntents";

type DiscordGatewayFailureCode = "credentialsRejected" | "permissionMissing" | "internal";

const UNRECOVERABLE_GATEWAY_FAILURES = new Map<
  number,
  { failure: DiscordGatewayFailure; code: DiscordGatewayFailureCode }
>([
  [4004, { failure: "authenticationFailed", code: "credentialsRejected" }],
  [4010, { failure: "invalidShard", code: "internal" }],
  [4011, { failure: "shardingRequired", code: "internal" }],
  [4012, { failure: "invalidApiVersion", code: "internal" }],
  [4013, { failure: "invalidIntents", code: "internal" }],
  [4014, { failure: "disallowedIntents", code: "permissionMissing" }],
]);

class DiscordGatewayError extends Error {
  override readonly name = "DiscordGatewayError";

  constructor(
    readonly gatewayCloseCode: number,
    readonly gatewayFailure: DiscordGatewayFailure,
    readonly code: DiscordGatewayFailureCode,
    options?: ErrorOptions,
  ) {
    super("Discord gateway rejected the connection", options);
  }
}

function discordGatewayError(closeCode: number, cause: unknown): DiscordGatewayError | undefined {
  const classification = UNRECOVERABLE_GATEWAY_FAILURES.get(closeCode);
  if (classification === undefined) return undefined;
  return new DiscordGatewayError(closeCode, classification.failure, classification.code, {
    cause,
  });
}

export interface DiscordReactionInput {
  channelId: string;
  messageId: string;
  emoji: string;
}

export interface DiscordPostInput {
  channelId: string;
  threadId?: string | null;
  content: string;
}

export interface DiscordConversationReplyInput extends DiscordPostInput {
  messageId: string;
}

export interface DiscordBotClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  getSelfUserId(): string;
  createReaction(input: DiscordReactionInput): Promise<void>;
  deleteOwnReaction(input: DiscordReactionInput): Promise<void>;
  sendChannelMessage(input: DiscordPostInput): Promise<void>;
  sendConversationReply(input: DiscordConversationReplyInput): Promise<void>;
  readMessage(input: {
    channelId: string;
    messageId: string;
  }): Promise<NormalizedDiscordContextMessage>;
  readThreadMessages(input: {
    channelId: string;
    beforeMessageId: string;
  }): Promise<NormalizedDiscordContextMessage[]>;
  onMessageCreate(handler: DiscordRawMessageHandler): () => void;
  onGuildDelete(handler: DiscordGuildDeleteHandler): () => void;
}

export type DiscordRawMessageHandler = (message: Message) => Promise<void>;
export type DiscordGuildDeleteHandler = (guild: {
  id: string;
  unavailable: boolean;
}) => Promise<void>;

type DiscordSendableChannel = TextBasedChannel & {
  send: (...args: unknown[]) => Promise<unknown>;
};

export interface CreateDiscordBotClientOptions {
  token: string;
  clientId?: string;
  client?: Client;
}

export function createDiscordBotClient(options: CreateDiscordBotClientOptions): DiscordBotClient {
  const client =
    options.client ??
    new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  const handlers = new Set<DiscordRawMessageHandler>();
  const guildDeleteHandlers = new Set<DiscordGuildDeleteHandler>();
  const pendingReplyDestinations = new Map<string, Promise<DiscordSendableChannel>>();
  let started = false;

  client.on("messageCreate", (message: Message) => {
    void Promise.all(Array.from(handlers, (handler) => handler(message))).catch(
      (error: unknown) => {
        reportFailure(
          error,
          { operation: "discord.event.handoff", component: "triggers", provider: "discord" },
          {
            scrubValues: [options.token],
            diagnostic: {
              deliveryId: `discord-${message.id}`,
              guildId: message.guildId,
              channelId: message.channelId,
            },
          },
        );
      },
    );
  });
  client.on("guildDelete", (guild) => {
    const guildId = DiscordSnowflakeSchema.parse(guild.id);
    void Promise.all(
      Array.from(guildDeleteHandlers, (handler) =>
        handler({ id: guildId, unavailable: !guild.available }),
      ),
    ).catch((error: unknown) =>
      reportFailure(
        error,
        { operation: "discord.guild-delete.handoff", component: "triggers", provider: "discord" },
        { scrubValues: [options.token], diagnostic: { guildId } },
      ),
    );
  });

  return {
    async start() {
      if (started) {
        return;
      }
      let gatewayCloseCode: number | undefined;
      const observeGatewayClose = (event: { code: number }) => {
        gatewayCloseCode = event.code;
      };
      client.on("shardDisconnect", observeGatewayClose);
      try {
        await client.login(options.token);
        started = true;
      } catch (error) {
        const classified =
          gatewayCloseCode === undefined ? undefined : discordGatewayError(gatewayCloseCode, error);
        throw classified ?? error;
      } finally {
        client.off("shardDisconnect", observeGatewayClose);
      }
    },
    async stop() {
      if (!started) {
        return;
      }
      await client.destroy();
      started = false;
    },
    getSelfUserId() {
      const id = options.clientId ?? client.user?.id;
      if (id === undefined) {
        throw new Error("discord bot client has not received a self user yet");
      }
      return DiscordSnowflakeSchema.parse(id);
    },
    async createReaction(input) {
      const message = await fetchMessage(
        client,
        DiscordSnowflakeSchema.parse(input.channelId),
        DiscordSnowflakeSchema.parse(input.messageId),
      );
      await message.react(input.emoji);
    },
    async deleteOwnReaction(input) {
      const channelId = DiscordSnowflakeSchema.parse(input.channelId);
      const messageId = DiscordSnowflakeSchema.parse(input.messageId);
      await client.rest.delete(Routes.channelMessageOwnReaction(channelId, messageId, input.emoji));
    },
    async sendChannelMessage(input) {
      const channelId = DiscordSnowflakeSchema.parse(input.threadId ?? input.channelId);
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !isSendableChannel(channel)) {
        throw new Error(`discord channel not sendable: ${channelId}`);
      }
      await channel.send({ content: input.content, allowedMentions: { parse: [] } });
    },
    async sendConversationReply(input) {
      const channel =
        input.threadId === undefined || input.threadId === null
          ? await resolveReplyDestination(client, input, pendingReplyDestinations)
          : await fetchSendableChannel(client, input.threadId);
      await channel.send({ content: input.content, allowedMentions: { parse: [] } });
    },
    async readMessage(input) {
      const message = await fetchMessage(
        client,
        DiscordSnowflakeSchema.parse(input.channelId),
        DiscordSnowflakeSchema.parse(input.messageId),
      );
      return normalizeContextMessage(message);
    },
    async readThreadMessages(input) {
      const channelId = DiscordSnowflakeSchema.parse(input.channelId);
      const beforeMessageId = DiscordSnowflakeSchema.parse(input.beforeMessageId);
      const channel = await client.channels.fetch(channelId);
      if (channel === null || !isThreadChannel(channel)) {
        throw new Error(`discord channel is not a readable thread: ${input.channelId}`);
      }
      const page = await channel.messages.fetch({ before: beforeMessageId, limit: 50 });
      return Array.from(page.values())
        .filter((message) => message.id !== beforeMessageId)
        .map(normalizeContextMessage)
        .sort(compareThreadMessages);
    },
    onMessageCreate(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    onGuildDelete(handler) {
      guildDeleteHandlers.add(handler);
      return () => guildDeleteHandlers.delete(handler);
    },
  };
}

async function resolveReplyDestination(
  client: Client,
  input: DiscordConversationReplyInput,
  pending: Map<string, Promise<DiscordSendableChannel>>,
): Promise<DiscordSendableChannel> {
  const channelId = DiscordSnowflakeSchema.parse(input.channelId);
  const messageId = DiscordSnowflakeSchema.parse(input.messageId);
  const key = `${channelId}:${messageId}`;
  const existing = pending.get(key);
  if (existing !== undefined) return existing;

  const resolution = (async () => {
    const message = await fetchMessage(client, channelId, messageId);
    const thread = message.hasThread
      ? await fetchSendableChannel(client, messageId)
      : await message.startThread({ name: createThreadName(message.content) });
    if (!isSendableChannel(thread)) throw new Error(`discord channel not sendable: ${thread.id}`);
    return thread;
  })();
  pending.set(key, resolution);
  try {
    return await resolution;
  } finally {
    pending.delete(key);
  }
}

async function fetchSendableChannel(
  client: Client,
  channelId: string,
): Promise<DiscordSendableChannel> {
  const parsedChannelId = DiscordSnowflakeSchema.parse(channelId);
  const channel = await client.channels.fetch(parsedChannelId);
  if (channel === null || !isSendableChannel(channel)) {
    throw new Error(`discord channel not sendable: ${parsedChannelId}`);
  }
  return channel;
}

async function fetchMessage(
  client: Client,
  channelId: string,
  messageId: string,
): Promise<Message> {
  const channel = await client.channels.fetch(channelId);
  if (channel === null || !isTextChannel(channel)) {
    throw new Error(`discord channel not readable: ${channelId}`);
  }
  return channel.messages.fetch(messageId);
}

function isTextChannel(channel: GuildBasedChannel | TextBasedChannel): channel is TextBasedChannel {
  return "messages" in channel;
}

function isThreadChannel(
  channel: GuildBasedChannel | TextBasedChannel,
): channel is TextBasedChannel & { isThread(): boolean } {
  return isTextChannel(channel) && typeof channel.isThread === "function" && channel.isThread();
}

function isSendableChannel(
  channel: GuildBasedChannel | TextBasedChannel,
): channel is DiscordSendableChannel {
  return "send" in channel && typeof Reflect.get(channel, "send") === "function";
}

function createThreadName(content: string): string {
  const name = content
    .replaceAll(/<@!?\d+>/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, 50)
    .trim();

  return name.length === 0 ? "paseo response" : name;
}

function normalizeContextMessage(message: Message): NormalizedDiscordContextMessage {
  return NormalizedDiscordContextMessageSchema.parse({
    id: message.id,
    channelId: message.channelId,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot,
    },
    createdAt: message.createdAt.toISOString(),
    attachments: Array.from(message.attachments.values(), (attachment) => ({
      id: attachment.id,
      filename: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
    referencedMessage:
      message.reference === null || message.reference.messageId === undefined
        ? null
        : {
            id: message.reference.messageId,
            channelId: message.reference.channelId,
            guildId: message.reference.guildId ?? null,
          },
  });
}

function compareThreadMessages(
  left: NormalizedDiscordContextMessage,
  right: NormalizedDiscordContextMessage,
): number {
  const createdAtDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return createdAtDifference === 0
    ? left.id.localeCompare(right.id, undefined, { numeric: true })
    : createdAtDifference;
}
