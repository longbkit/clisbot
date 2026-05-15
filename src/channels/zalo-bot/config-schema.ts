import { z } from "zod";
import { defineChannelSchemaContract } from "../../config/channels/channel-schema-contract.ts";
import {
  asChannelProviderConfigSchema,
  createBaseBotSchema,
  createBaseDefaults,
  createBaseDefaultsSchema,
  createPollingSchema,
} from "../config/config-schema-base.ts";

const zaloBotChannelSchemaContract = defineChannelSchemaContract({
  channel: "zalo-bot",
  configBotKey: "zaloBot",
  createSchema: (params) => {
    const pollingSchema = createPollingSchema();
    const botSchema = z.object({
      ...createBaseBotSchema(params),
      mode: z.enum(["polling", "webhook"]).optional(),
      webhookUrl: z.string().optional(),
      webhookSecret: z.string().optional(),
      webhookPath: z.string().optional(),
      groups: z.record(z.string(), params.botRouteSchema).default({}),
      polling: pollingSchema.optional(),
    });
    const defaults = createBaseDefaults("polling", {
      groups: {},
      polling: {
        timeoutSeconds: 20,
        retryDelayMs: 1000,
      },
    });
    const defaultsSchema = z.object({
      ...createBaseDefaultsSchema(
        params,
        z.enum(["polling", "webhook"]).default("polling"),
      ),
      groups: z.record(z.string(), params.botRouteSchema).default({}),
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

export default zaloBotChannelSchemaContract;
