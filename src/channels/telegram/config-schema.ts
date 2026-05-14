import { z } from "zod";
import { defineChannelSchemaContract } from "../../config/channels/channel-schema-contract.ts";
import {
  asChannelProviderConfigSchema,
  createBaseBotSchema,
  createBaseDefaults,
  createBaseDefaultsSchema,
  createGroupDefault,
  createPollingSchema,
} from "../config/config-schema-base.ts";

const telegramChannelSchemaContract = defineChannelSchemaContract({
  channel: "telegram",
  configBotKey: "telegram",
  createSchema: (params) => {
    const pollingSchema = createPollingSchema();
    const topicAwareGroupRouteSchema = params.botRouteSchema.extend({
      topics: z.record(z.string(), params.botRouteSchema).default({}),
    });
    const botSchema = z.object({
      ...createBaseBotSchema(params),
      groups: z.record(z.string(), topicAwareGroupRouteSchema).default({}),
      polling: pollingSchema.optional(),
    });
    const defaults = createBaseDefaults("polling", {
      groups: createGroupDefault({ topics: {} }),
      polling: {
        timeoutSeconds: 20,
        retryDelayMs: 1000,
      },
    });
    const defaultsSchema = z.object({
      ...createBaseDefaultsSchema(params, z.literal("polling").default("polling")),
      groups: z.record(z.string(), topicAwareGroupRouteSchema).default({}),
      polling: pollingSchema.default({
        timeoutSeconds: 20,
        retryDelayMs: 1000,
      }),
    });
    return asChannelProviderConfigSchema(
      z.object({
        defaults: defaultsSchema.default(defaults as any),
      }).catchall(botSchema).default({ defaults } as any),
    );
  },
});

export default telegramChannelSchemaContract;
