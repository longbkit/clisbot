import { z } from "zod";
import { defineChannelSchemaContract } from "../../config/channels/channel-schema-contract.ts";
import {
  asChannelProviderConfigSchema,
  createBaseBotSchema,
  createBaseDefaults,
  createBaseDefaultsSchema,
  createGroupDefault,
  createProcessingStatusSchema,
} from "../config/config-schema-base.ts";

const slackChannelSchemaContract = defineChannelSchemaContract({
  channel: "slack",
  configBotKey: "slack",
  createSchema: (params) => {
    const processingStatusSchema = createProcessingStatusSchema();
    const botSchema = z.object({
      ...createBaseBotSchema(params),
      appToken: z.string().optional(),
      appTokenFile: z.string().optional(),
      botTokenFile: z.string().optional(),
      channelPolicy: params.conversationPolicySchema.optional(),
      ackReaction: z.string().optional(),
      typingReaction: z.string().optional(),
      replyToMode: z.enum(["thread", "all"]).optional(),
      processingStatus: processingStatusSchema.optional(),
      groups: z.record(z.string(), params.botRouteSchema).default({}),
    });
    const defaults = createBaseDefaults("socket", {
      channelPolicy: "allowlist",
      ackReaction: "",
      typingReaction: "",
      replyToMode: "thread",
      processingStatus: {
        enabled: true,
        status: "Working...",
        loadingMessages: [],
      },
      groups: createGroupDefault(),
    });
    const defaultsSchema = z.object({
      ...createBaseDefaultsSchema(params, z.literal("socket").default("socket")),
      channelPolicy: params.conversationPolicySchema.default("allowlist"),
      ackReaction: z.string().default(""),
      typingReaction: z.string().default(""),
      replyToMode: z.enum(["thread", "all"]).default("thread"),
      processingStatus: processingStatusSchema.default({
        enabled: true,
        status: "Working...",
        loadingMessages: [],
      }),
      groups: z.record(z.string(), params.botRouteSchema).default({}),
    });
    return asChannelProviderConfigSchema(
      z.object({
        defaults: defaultsSchema.default(defaults as any),
      }).catchall(botSchema).default({ defaults } as any),
    );
  },
});

export default slackChannelSchemaContract;
