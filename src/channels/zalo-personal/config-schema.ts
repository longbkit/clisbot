import { z } from "zod";
import { defineChannelSchemaContract } from "../../config/channels/channel-schema-contract.ts";
import {
  asChannelProviderConfigSchema,
  createBaseBotSchema,
  createBaseDefaults,
  createBaseDefaultsSchema,
  createGroupDefault,
} from "../config/config-schema-base.ts";

const zaloPersonalChannelSchemaContract = defineChannelSchemaContract({
  channel: "zalo-personal",
  configBotKey: "zaloPersonal",
  createSchema: (params) => {
    const botSchema = z.object({
      ...createBaseBotSchema(params),
      mode: z.literal("listener").optional(),
      groups: z.record(z.string(), params.botRouteSchema).default({}),
    });
    const defaults = createBaseDefaults("listener", {
      dmPolicy: "disabled",
      directMessages: {},
      groups: createGroupDefault(),
      followUp: {
        mode: "mention-only",
      },
    });
    const defaultsSchema = z.object({
      ...createBaseDefaultsSchema(params, z.literal("listener").default("listener")),
      directMessages: z.record(z.string(), params.botRouteSchema).default({}),
      groups: z.record(z.string(), params.botRouteSchema).default({}),
    });
    return asChannelProviderConfigSchema(
      z.object({
        defaults: defaultsSchema.default(defaults as any),
      }).catchall(botSchema).default({ defaults } as any),
    );
  },
});

export default zaloPersonalChannelSchemaContract;
