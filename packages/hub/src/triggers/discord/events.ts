import { z } from "zod";
import { DiscordSnowflakeSchema } from "../../discord/snowflake.js";

export const DiscordMessageAuthorSchema = z.object({
  id: DiscordSnowflakeSchema,
  username: z.string(),
  bot: z.boolean().optional(),
});

export const DiscordMessageAttachmentSchema = z.object({
  id: DiscordSnowflakeSchema,
  filename: z.string(),
  url: z.url(),
  contentType: z.string().nullable(),
  size: z.number().int().nonnegative(),
});

export const DiscordReferencedMessageSchema = z.object({
  id: DiscordSnowflakeSchema,
  channelId: DiscordSnowflakeSchema,
  guildId: DiscordSnowflakeSchema.nullable(),
});

export const NormalizedDiscordContextMessageSchema = z.object({
  id: DiscordSnowflakeSchema,
  channelId: DiscordSnowflakeSchema,
  content: z.string(),
  author: DiscordMessageAuthorSchema,
  createdAt: z.string(),
  attachments: z.array(DiscordMessageAttachmentSchema),
  referencedMessage: DiscordReferencedMessageSchema.nullable(),
});

export const NormalizedDiscordMessageEventSchema = z.object({
  type: z.literal("mention"),
  id: DiscordSnowflakeSchema,
  guildId: DiscordSnowflakeSchema,
  channelId: DiscordSnowflakeSchema,
  threadId: DiscordSnowflakeSchema.nullable(),
  parentChannelId: DiscordSnowflakeSchema.nullable(),
  messageId: DiscordSnowflakeSchema,
  content: z.string(),
  mentionedUserIds: z.array(DiscordSnowflakeSchema),
  mentionedBotRoleIds: z.array(DiscordSnowflakeSchema).optional(),
  author: DiscordMessageAuthorSchema,
  createdAt: z.string(),
  attachments: z.array(DiscordMessageAttachmentSchema),
  referencedMessage: DiscordReferencedMessageSchema.nullable(),
});

export type DiscordMessageAuthor = z.infer<typeof DiscordMessageAuthorSchema>;
export type NormalizedDiscordContextMessage = z.infer<typeof NormalizedDiscordContextMessageSchema>;
export type NormalizedDiscordMessageEvent = z.infer<typeof NormalizedDiscordMessageEventSchema>;
