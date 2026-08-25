import type { ProjectConfigurationStore } from "../../configuration/store.js";
import type {
  AttachmentCapabilityRegistry,
  AttachmentDescriptor,
} from "../../attachments/capabilities.js";
import { reportFailure } from "../../failures/index.js";
import {
  type TriggerProvider,
  type TriggerProviderMatch,
  type TriggerProviderReactionState,
} from "../index.js";
import type { DiscordBotClient } from "./bot.js";
import {
  matchDiscordTriggers,
  readDiscordInvocationParserMessage,
  readDiscordPromptBody,
} from "./match.js";
import { matchesInputFilters, parseInvocation } from "../invocation.js";
import { NormalizedDiscordMessageEventSchema } from "./events.js";
import type { NormalizedDiscordContextMessage, NormalizedDiscordMessageEvent } from "./events.js";

export interface DiscordAttachmentLocator {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
}

export interface DiscordMergeMessage {
  id: string;
  content: string;
  author: { id: string; username: string; bot?: boolean };
  channel: { id: string };
  created_at: string;
  attachments: DiscordAttachmentLocator[];
  referenced_message: { id: string; channel_id: string; guild_id: string | null } | null;
}

export interface DiscordMaterializedMessage {
  id: string;
  content: string;
  author: { id: string; username: string; bot?: boolean };
  channel: { id: string };
  created_at: string;
  attachments: AttachmentDescriptor[];
  referenced_message: { id: string; channel_id: string; guild_id: string | null } | null;
}

export interface DiscordMaterializedContext {
  discord: {
    referenced_message: DiscordMaterializedMessage | null;
    thread: {
      id: string;
      parent_channel_id: string | null;
      context_url: string;
      messages: DiscordMaterializedMessage[];
    } | null;
  };
}

export interface DiscordMergeData {
  discord: {
    event_type: "mention";
    connection_id: string | null;
    guild: { id: string };
    trigger_message: DiscordMergeMessage & {
      body: string;
      url: string;
      thread: { id: string; parent_channel_id: string | null; context_url: string } | null;
    };
    trigger_thread_context: { status: "deferred" | "not_applicable" };
  };
}

export interface DiscordTriggerContext {
  provider: "discord";
  target: DiscordOutputContext;
  event: DiscordMergeData;
}

export interface DiscordOutputContext {
  provider: "discord";
  guildId: string;
  channelId: string;
  threadId: string | null;
  messageId: string;
}

type DiscordReactionPhase = "accepted" | "started";

export function createDiscordTriggerProvider(options: {
  configurationStoreForProject: (projectId: string) => ProjectConfigurationStore;
  bot: DiscordBotClient;
  attachments?: AttachmentCapabilityRegistry;
}): TriggerProvider<
  "discord",
  DiscordTriggerContext,
  DiscordOutputContext,
  DiscordMaterializedContext
> {
  return {
    name: "discord",
    eventNames: ["discord.mention"],
    async match(externalTrigger) {
      const event = NormalizedDiscordMessageEventSchema.parse(externalTrigger.payload);
      const stored = await options
        .configurationStoreForProject(externalTrigger.projectId)
        .getRevision(externalTrigger.configurationRevisionId);
      if (stored === undefined) return "configuration_unavailable";
      if (
        !stored.configuration.triggers.some((candidate) => candidate.on === externalTrigger.source)
      )
        return "no_trigger_for_source";
      const botClientId = options.bot.getSelfUserId();
      const matches: TriggerProviderMatch<DiscordTriggerContext, DiscordOutputContext>[] = [];

      for (const match of matchDiscordTriggers(
        stored.configuration,
        event,
        botClientId,
        externalTrigger.connectionId,
      )) {
        const compiledTrigger = stored.configuration.triggers.find(
          (candidate) => candidate.name === match.trigger.name,
        );
        if (compiledTrigger === undefined)
          throw new Error(`compiled trigger not found: ${match.trigger.name}`);
        const outputContext: DiscordOutputContext = {
          provider: "discord",
          guildId: event.guildId,
          channelId: event.channelId,
          threadId: event.threadId,
          messageId: event.messageId,
        };
        const triggerContext: DiscordTriggerContext = {
          provider: "discord",
          target: outputContext,
          event: buildDiscordMergeData(event, botClientId, externalTrigger.connectionId),
        };
        const invocation = parseInvocation(
          event.content,
          compiledTrigger.inputs,
          undefined,
          readDiscordInvocationParserMessage(event, botClientId, compiledTrigger.filters),
        );
        if (invocation.status === "accepted") {
          if (!matchesInputFilters(invocation.inputs, compiledTrigger.filters?.inputs)) continue;
        }
        if (invocation.status === "rejected") {
          matches.push({
            triggerName: match.trigger.name,
            triggerContext,
            outputContext,
            configurationRevisionId: stored.revision.id,
            hubConfig: stored.configuration,
            invocation,
          });
          continue;
        }
        matches.push({
          triggerName: match.trigger.name,
          triggerContext,
          outputContext,
          configurationRevisionId: stored.revision.id,
          hubConfig: stored.configuration,
          invocation,
        });
      }

      return matches.length === 0 ? "trigger_filters_rejected" : matches;
    },
    async materializeContext(launch) {
      const event = launch.triggerContext.event.discord;
      const messages =
        event.trigger_message.thread === null
          ? []
          : await options.bot.readThreadMessages({
              channelId: event.trigger_message.thread.id,
              beforeMessageId: event.trigger_message.id,
            });
      const contextMessages = await Promise.all(
        messages.map((message) =>
          materializeDiscordMessage(
            message,
            launch.providerEventReceiptId,
            launch.organizationId,
            launch.triggerContext.event.discord.connection_id,
            launch.executionId,
            options.attachments,
          ),
        ),
      );
      const referencedMessage = await materializeReferencedMessage(
        event.trigger_message.referenced_message,
        messages,
        contextMessages,
        launch,
        options.bot,
        options.attachments,
        event.connection_id,
      );
      return {
        discord: {
          referenced_message: referencedMessage,
          thread:
            event.trigger_message.thread === null
              ? null
              : { ...event.trigger_message.thread, messages: contextMessages },
        },
      };
    },
    async onDispatchAccepted(triggerContext, _outputContext, reactionState) {
      if (discordReactionPhase(reactionState) !== undefined) return reactionState;
      await reactSafely(options.bot, triggerContext.target, "eyes");
      return { phase: "accepted" };
    },
    async onAgentExecutionStarted(triggerContext, _outputContext, reactionState) {
      if (discordReactionPhase(reactionState) === "started") return reactionState;
      await deleteReactionSafely(options.bot, triggerContext.target, "eyes");
      await reactSafely(options.bot, triggerContext.target, "hourglass");
      return { phase: "started" };
    },
    async onAgentExecutionCompleted(triggerContext, _outputContext, _result, reactionState) {
      await deleteReactionForPhase(options.bot, triggerContext.target, reactionState, "started");
      await react(options.bot, triggerContext.target, "white_check_mark");
      return null;
    },
    async onAgentExecutionFailed(triggerContext, _outputContext, reason, reactionState) {
      await deleteReactionForPhase(options.bot, triggerContext.target, reactionState);
      await react(options.bot, triggerContext.target, "x");
      await postThreadNotice(options.bot, triggerContext.target, `Paseo agent failed: ${reason}`);
      return null;
    },
    async onMachineTerminated(triggerContext, reason, reactionState) {
      if (reason === "launch_failed" || reason === "daemon_disconnected") {
        await deleteReactionForPhase(options.bot, triggerContext.target, reactionState);
        await react(options.bot, triggerContext.target, "x");
        await postThreadNotice(
          options.bot,
          triggerContext.target,
          `Paseo machine terminated before the agent could complete: ${reason}`,
        );
        return null;
      }
      return reactionState;
    },
  };
}

async function materializeReferencedMessage(
  reference: DiscordMergeMessage["referenced_message"],
  sourceMessages: NormalizedDiscordContextMessage[],
  materializedMessages: DiscordMaterializedMessage[],
  launch: {
    executionId: string;
    organizationId: string;
    providerEventReceiptId: string;
  },
  bot: DiscordBotClient,
  attachments: AttachmentCapabilityRegistry | undefined,
  connectionId: string | null,
): Promise<DiscordMaterializedMessage | null> {
  if (reference === null) return null;
  const existingIndex = sourceMessages.findIndex(
    (message) => message.id === reference.id && message.channelId === reference.channel_id,
  );
  if (existingIndex !== -1) return materializedMessages[existingIndex]!;

  const message = await bot.readMessage({
    channelId: reference.channel_id,
    messageId: reference.id,
  });
  return materializeDiscordMessage(
    message,
    launch.providerEventReceiptId,
    launch.organizationId,
    connectionId,
    launch.executionId,
    attachments,
  );
}

async function deleteReactionForPhase(
  bot: DiscordBotClient,
  target: DiscordOutputContext,
  reactionState: TriggerProviderReactionState | undefined,
  fallbackPhase?: DiscordReactionPhase,
): Promise<void> {
  const phase = discordReactionPhase(reactionState) ?? fallbackPhase;
  if (phase === "accepted") {
    await deleteReactionSafely(bot, target, "eyes");
    return;
  }
  if (phase === "started") {
    await deleteReactionSafely(bot, target, "hourglass");
    return;
  }
  await deleteReactionSafely(bot, target, "eyes");
  await deleteReactionSafely(bot, target, "hourglass");
}

function discordReactionPhase(
  reactionState: TriggerProviderReactionState | undefined,
): DiscordReactionPhase | undefined {
  if (typeof reactionState !== "object" || reactionState === null || Array.isArray(reactionState)) {
    return undefined;
  }
  const phase = reactionState["phase"];
  return phase === "accepted" || phase === "started" ? phase : undefined;
}

function buildDiscordMergeData(
  event: NormalizedDiscordMessageEvent,
  botClientId: string,
  connectionId: string | null | undefined,
): DiscordMergeData {
  return {
    discord: {
      event_type: event.type,
      connection_id: connectionId ?? null,
      guild: { id: event.guildId },
      trigger_message: {
        ...buildDiscordMergeMessage(event),
        attachments: event.attachments.map(toAttachmentLocator),
        body: readDiscordPromptBody(event, botClientId),
        url: buildDiscordMessageUrl(event),
        thread:
          event.threadId === null
            ? null
            : {
                id: event.threadId,
                parent_channel_id: event.parentChannelId,
                context_url: buildDiscordContextUrl(event),
              },
      },
      trigger_thread_context: { status: event.threadId === null ? "not_applicable" : "deferred" },
    },
  };
}

function buildDiscordMergeMessage(
  message:
    | (Pick<
        NormalizedDiscordMessageEvent,
        "id" | "content" | "author" | "createdAt" | "referencedMessage"
      > & {
        channelId: string;
      })
    | NormalizedDiscordContextMessage,
): Omit<DiscordMergeMessage, "attachments"> {
  return {
    id: message.id,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      ...(message.author.bot === undefined ? {} : { bot: message.author.bot }),
    },
    channel: { id: message.channelId },
    created_at: message.createdAt,
    referenced_message:
      message.referencedMessage === null
        ? null
        : {
            id: message.referencedMessage.id,
            channel_id: message.referencedMessage.channelId,
            guild_id: message.referencedMessage.guildId,
          },
  };
}

async function registerAttachments(
  source: NormalizedDiscordContextMessage["attachments"],
  providerEventReceiptId: string,
  organizationId: string,
  connectionId: string | null,
  executionId: string,
  attachments: AttachmentCapabilityRegistry | undefined,
): Promise<AttachmentDescriptor[]> {
  if (source.length === 0) return [];
  if (attachments === undefined) throw new Error("attachment capability unavailable");
  if (connectionId === null) {
    throw new Error("attachment ownership unavailable");
  }
  const references = await Promise.all(
    source.map((file) =>
      attachments.register({
        providerEventReceiptId,
        organizationId,
        connectionId,
        provider: "discord",
        sourceId: file.id,
        locator: { url: file.url },
        filename: file.filename,
        contentType: file.contentType,
        byteSize: file.size,
      }),
    ),
  );
  return references.map((reference) => attachments.materialize(reference, executionId));
}

async function materializeDiscordMessage(
  message: NormalizedDiscordContextMessage,
  providerEventReceiptId: string,
  organizationId: string,
  connectionId: string | null,
  executionId: string,
  attachments: AttachmentCapabilityRegistry | undefined,
): Promise<DiscordMaterializedMessage> {
  const materializedAttachments = await registerAttachments(
    message.attachments,
    providerEventReceiptId,
    organizationId,
    connectionId,
    executionId,
    attachments,
  );
  return Object.assign(buildDiscordMergeMessage(message), {
    attachments: materializedAttachments,
  });
}

function toAttachmentLocator(
  attachment: NormalizedDiscordMessageEvent["attachments"][number],
): DiscordAttachmentLocator {
  return {
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

function buildDiscordMessageUrl(event: NormalizedDiscordMessageEvent): string {
  return `https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}`;
}

function buildDiscordContextUrl(event: NormalizedDiscordMessageEvent): string {
  return `https://discord.com/channels/${event.guildId}/${event.threadId ?? event.channelId}`;
}

async function reactSafely(
  bot: DiscordBotClient,
  event: DiscordOutputContext,
  emoji: string,
): Promise<void> {
  const discordEmoji = toDiscordReactionEmoji(emoji);
  try {
    await bot.createReaction({
      channelId: event.channelId,
      messageId: event.messageId,
      emoji: discordEmoji,
    });
  } catch (error) {
    reportFailure(
      error,
      { operation: "discord.reaction.add", component: "triggers", provider: "discord" },
      {
        diagnostic: { channelId: event.channelId, messageId: event.messageId, emoji: discordEmoji },
      },
    );
  }
}

async function react(
  bot: DiscordBotClient,
  event: DiscordOutputContext,
  emoji: string,
): Promise<void> {
  await bot.createReaction({
    channelId: event.channelId,
    messageId: event.messageId,
    emoji: toDiscordReactionEmoji(emoji),
  });
}

async function deleteReactionSafely(
  bot: DiscordBotClient,
  event: DiscordOutputContext,
  emoji: string,
): Promise<void> {
  const discordEmoji = toDiscordReactionEmoji(emoji);

  try {
    await bot.deleteOwnReaction({
      channelId: event.channelId,
      messageId: event.messageId,
      emoji: discordEmoji,
    });
  } catch (error) {
    reportFailure(
      error,
      { operation: "discord.reaction.cleanup", component: "triggers", provider: "discord" },
      {
        diagnostic: { channelId: event.channelId, messageId: event.messageId, emoji: discordEmoji },
      },
    );
  }
}

function toDiscordReactionEmoji(emoji: string): string {
  switch (emoji) {
    case "eyes":
      return "👀";
    case "hourglass":
      return "⏳";
    case "check":
    case "white_check_mark":
      return "✅";
    case "cross":
    case "x":
      return "❌";
    default:
      return emoji;
  }
}

async function postThreadNotice(
  bot: DiscordBotClient,
  event: DiscordOutputContext,
  content: string,
): Promise<void> {
  await bot.sendChannelMessage({
    channelId: event.channelId,
    threadId: event.threadId,
    content,
  });
}
