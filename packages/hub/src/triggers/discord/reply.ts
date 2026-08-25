import { z } from "zod";
import { DiscordSnowflakeSchema } from "../../discord/snowflake.js";
import type { OutputExecutor } from "../../execution-capabilities/outputs.js";
import type { DiscordBotClient } from "./bot.js";

const DiscordReplyArgsSchema = z.object({
  content: z.string().min(1),
});

const DiscordReplyOutputContextSchema = z.object({
  channelId: DiscordSnowflakeSchema,
  threadId: DiscordSnowflakeSchema.nullable().optional(),
  messageId: DiscordSnowflakeSchema,
});

export interface CreateDiscordReplyExecutorOptions {
  bot: DiscordBotClient;
}

export function createDiscordReplyExecutor(
  options: CreateDiscordReplyExecutorOptions,
): OutputExecutor {
  return async function executeDiscordReply(input) {
    const args = DiscordReplyArgsSchema.parse(input.args);
    const context = DiscordReplyOutputContextSchema.parse(input.outputContext);

    await options.bot.sendConversationReply({
      channelId: context.channelId,
      threadId: context.threadId ?? null,
      messageId: context.messageId,
      content: args.content,
    });
  };
}
