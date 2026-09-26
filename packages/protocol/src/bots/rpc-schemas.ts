import { z } from "zod";
import { BotKindSchema, BotLaunchDefaultsSchema, BotPayloadSchema } from "./types.js";

/**
 * `bot.*` RPCs (docs/features/bots-and-chats/README.md, "RPC surface"). Gated once on
 * `server_info.features.bots`; a daemon with the flag off answers `rpc_error bots_disabled`.
 */

/** What seeding did to the bot directory; names are file names inside it. */
export const BotTemplateResultSchema = z.object({
  created: z.array(z.string()),
  skipped: z.array(z.string()),
  overwritten: z.array(z.string()).optional(),
  backupDirectory: z.string().optional(),
});
export type BotTemplateResult = z.infer<typeof BotTemplateResultSchema>;

export const BotCreateRequestSchema = z.object({
  type: z.literal("bot.create.request"),
  requestId: z.string(),
  name: z.string(),
  kind: BotKindSchema.optional(),
  description: z.string().optional(),
  /** An explicit home directory; otherwise `<daemon.bots.root>/<slug>`. */
  path: z.string().optional(),
  launch: BotLaunchDefaultsSchema,
  template: z.object({ overwrite: z.boolean().optional() }).optional(),
});

export const BotCreateResponseSchema = z.object({
  type: z.literal("bot.create.response"),
  payload: z.object({
    requestId: z.string(),
    bot: BotPayloadSchema.nullable(),
    /** True when an existing slug or home directory was returned instead of created. */
    reused: z.boolean().optional(),
    template: BotTemplateResultSchema.optional(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

export const BotListRequestSchema = z.object({
  type: z.literal("bot.list.request"),
  requestId: z.string(),
  includeArchived: z.boolean().optional(),
});

export const BotListResponseSchema = z.object({
  type: z.literal("bot.list.response"),
  payload: z.object({
    requestId: z.string(),
    bots: z.array(BotPayloadSchema),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

/** No `slug`, `cwd`, `projectId` or `workspaceId`: the home never moves (D3). */
export const BotUpdateRequestSchema = z.object({
  type: z.literal("bot.update.request"),
  requestId: z.string(),
  botId: z.string(),
  name: z.string().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  launch: BotLaunchDefaultsSchema.optional(),
});

export const BotUpdateResponseSchema = z.object({
  type: z.literal("bot.update.response"),
  payload: z.object({
    requestId: z.string(),
    bot: BotPayloadSchema.nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

export const BotArchiveRequestSchema = z.object({
  type: z.literal("bot.archive.request"),
  requestId: z.string(),
  botId: z.string(),
});

export const BotArchiveResponseSchema = z.object({
  type: z.literal("bot.archive.response"),
  payload: z.object({
    requestId: z.string(),
    botId: z.string(),
    archivedAt: z.string().nullable(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

/** The one verb that touches files; kept apart from `bot.update` on purpose. */
export const BotTemplateSeedRequestSchema = z.object({
  type: z.literal("bot.template.seed.request"),
  requestId: z.string(),
  botId: z.string(),
  overwrite: z.boolean().optional(),
});

export const BotTemplateSeedResponseSchema = z.object({
  type: z.literal("bot.template.seed.response"),
  payload: z.object({
    requestId: z.string(),
    bot: BotPayloadSchema.nullable(),
    template: BotTemplateResultSchema.optional(),
    error: z.string().nullable(),
    errorCode: z.string().optional(),
  }),
});

export const BotUpdatedSchema = z.object({
  type: z.literal("bot.updated"),
  payload: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("upsert"),
      bot: BotPayloadSchema,
      subscriptionId: z.string().optional(),
    }),
    z.object({
      kind: z.literal("remove"),
      botId: z.string(),
      subscriptionId: z.string().optional(),
    }),
  ]),
});

export type BotCreateRequest = z.infer<typeof BotCreateRequestSchema>;
export type BotCreateResponse = z.infer<typeof BotCreateResponseSchema>;
export type BotListRequest = z.infer<typeof BotListRequestSchema>;
export type BotListResponse = z.infer<typeof BotListResponseSchema>;
export type BotUpdateRequest = z.infer<typeof BotUpdateRequestSchema>;
export type BotUpdateResponse = z.infer<typeof BotUpdateResponseSchema>;
export type BotArchiveRequest = z.infer<typeof BotArchiveRequestSchema>;
export type BotArchiveResponse = z.infer<typeof BotArchiveResponseSchema>;
export type BotTemplateSeedRequest = z.infer<typeof BotTemplateSeedRequestSchema>;
export type BotTemplateSeedResponse = z.infer<typeof BotTemplateSeedResponseSchema>;
export type BotUpdatedMessage = z.infer<typeof BotUpdatedSchema>;
