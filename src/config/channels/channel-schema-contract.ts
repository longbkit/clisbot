import type { z, ZodTypeAny } from "zod";
import type { ChannelConfigBotKey, ChannelProviderConfig } from "./channel-config-shapes.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";

export type ChannelConfigSchemaParams<RouteShape extends z.ZodRawShape = z.ZodRawShape> = {
  botRouteSchema: z.ZodObject<RouteShape>;
  commandPrefixesOverrideSchema: ZodTypeAny;
  commandPrefixesSchema: ZodTypeAny;
  streamingSchema: ZodTypeAny;
  responseSchema: ZodTypeAny;
  responseModeSchema: ZodTypeAny;
  additionalMessageModeSchema: ZodTypeAny;
  surfaceNotificationsOverrideSchema: ZodTypeAny;
  surfaceNotificationsSchema: ZodTypeAny;
  verboseSchema: ZodTypeAny;
  followUpOverrideSchema: ZodTypeAny;
  followUpSchema: ZodTypeAny;
  timezoneSchema: ZodTypeAny;
  dmPolicySchema: ZodTypeAny;
  conversationPolicySchema: ZodTypeAny;
};

export type ChannelSchemaContract<
  TConfigBotKey extends ChannelConfigBotKey = ChannelConfigBotKey,
> = {
  channel: ChannelId;
  configBotKey: TConfigBotKey;
  createSchema(params: ChannelConfigSchemaParams): z.ZodType<ChannelProviderConfig>;
};

export function defineChannelSchemaContract<
  TConfigBotKey extends ChannelConfigBotKey,
>(contract: ChannelSchemaContract<TConfigBotKey>) {
  return contract;
}
