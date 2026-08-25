import type { Message } from "discord.js";
import type {
  DiscordBotClient,
  DiscordConversationReplyInput,
  DiscordGuildDeleteHandler,
  DiscordPostInput,
  DiscordRawMessageHandler,
  DiscordReactionInput,
} from "./bot.js";
import type { NormalizedDiscordMessageEvent } from "./events.js";
import type { NormalizedDiscordContextMessage } from "./events.js";

export interface MemoryDiscordBotOptions {
  selfUserId: string;
  threadMessages?: NormalizedDiscordContextMessage[];
  messages?: NormalizedDiscordContextMessage[];
  threadContextFetchError?: Error;
}

export class MemoryDiscordBotClient implements DiscordBotClient {
  readonly reactions: DiscordReactionInput[] = [];
  readonly deletedOwnReactions: DiscordReactionInput[] = [];
  readonly messages: DiscordPostInput[] = [];
  readonly threadReads: Array<{ channelId: string; beforeMessageId: string }> = [];
  readonly messageReads: Array<{ channelId: string; messageId: string }> = [];
  private readonly handlers = new Set<DiscordRawMessageHandler>();
  private readonly guildDeleteHandlers = new Set<DiscordGuildDeleteHandler>();
  private readonly normalizedHandlers = new Set<(event: NormalizedDiscordMessageEvent) => void>();
  private started = false;

  constructor(private readonly options: MemoryDiscordBotOptions) {}

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
  }

  getSelfUserId(): string {
    return this.options.selfUserId;
  }

  async createReaction(input: DiscordReactionInput): Promise<void> {
    this.reactions.push(input);
  }

  async deleteOwnReaction(input: DiscordReactionInput): Promise<void> {
    this.deletedOwnReactions.push(input);
  }

  async sendChannelMessage(input: DiscordPostInput): Promise<void> {
    this.messages.push(input);
  }

  async sendConversationReply(input: DiscordConversationReplyInput): Promise<void> {
    this.messages.push(input);
  }

  async readMessage(input: {
    channelId: string;
    messageId: string;
  }): Promise<NormalizedDiscordContextMessage> {
    this.messageReads.push(input);
    const message = this.options.messages?.find(
      (candidate) => candidate.channelId === input.channelId && candidate.id === input.messageId,
    );
    if (message === undefined) throw new Error(`discord message unavailable: ${input.messageId}`);
    return message;
  }

  async readThreadMessages(input: {
    channelId: string;
    beforeMessageId: string;
  }): Promise<NormalizedDiscordContextMessage[]> {
    this.threadReads.push(input);
    if (this.options.threadContextFetchError !== undefined) {
      throw this.options.threadContextFetchError;
    }
    return this.options.threadMessages ?? [];
  }

  onMessageCreate(handler: DiscordRawMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onGuildDelete(handler: DiscordGuildDeleteHandler): () => void {
    this.guildDeleteHandlers.add(handler);
    return () => this.guildDeleteHandlers.delete(handler);
  }

  async emitGuildDelete(guild: { id: string; unavailable: boolean }): Promise<void> {
    for (const handler of this.guildDeleteHandlers) await handler(guild);
  }

  async emitMessage(message: Message): Promise<void> {
    for (const handler of this.handlers) {
      await handler(message);
    }
  }

  onNormalizedMessage(handler: (event: NormalizedDiscordMessageEvent) => void): () => void {
    this.normalizedHandlers.add(handler);
    return () => {
      this.normalizedHandlers.delete(handler);
    };
  }

  async emitNormalized(event: NormalizedDiscordMessageEvent): Promise<void> {
    for (const handler of this.normalizedHandlers) {
      handler(event);
    }
  }
}
