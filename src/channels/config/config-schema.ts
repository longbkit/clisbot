import type { z } from "zod";
import type { ChannelConfigBotKey } from "../integration/channel-config-key.ts";
import type { ChannelProviderConfig } from "../../config/channels/channel-config-shapes.ts";
import type { ChannelConfigSchemaParams } from "../../config/channels/channel-schema-contract.ts";
import { CHANNEL_SCHEMA_CONTRACTS } from "../integration/channel-installation-inventory.ts";

type ChannelBotsSchemaShape = Record<ChannelConfigBotKey, z.ZodType<ChannelProviderConfig>>;

export function createChannelBotsSchemaShape<RouteShape extends z.ZodRawShape>(
  params: ChannelConfigSchemaParams<RouteShape>,
): ChannelBotsSchemaShape {
  const shape = {} as ChannelBotsSchemaShape;
  for (const contract of CHANNEL_SCHEMA_CONTRACTS) {
    shape[contract.configBotKey] = contract.createSchema(params);
  }
  return shape;
}
