import { z, type ZodTypeAny } from "zod";
import type { ChannelProviderConfig } from "../../config/channels/channel-config-shapes.ts";
import type { ChannelConfigSchemaParams } from "../../config/channels/channel-schema-contract.ts";

export function createAgentPromptSchema() {
  return z.object({
    enabled: z.boolean().default(true),
    maxProgressMessages: z.number().int().min(0).default(3),
    requireFinalResponse: z.boolean().default(true),
  });
}

export function createPollingSchema() {
  return z.object({
    timeoutSeconds: z.number().int().positive().default(20),
    retryDelayMs: z.number().int().positive().default(1000),
  });
}

export function createProcessingStatusSchema() {
  return z.object({
    enabled: z.boolean().default(true),
    status: z.string().min(1).default("Working..."),
    loadingMessages: z.array(z.string().min(1)).default([]),
  });
}

export function createDirectMessagesDefault() {
  return {
    "*": {
      enabled: true,
      requireMention: false,
      policy: "pairing",
      allowUsers: [],
      blockUsers: [],
      allowBots: false,
    },
  };
}

export function createGroupDefault(extra: Record<string, unknown> = {}) {
  return {
    "*": {
      enabled: true,
      requireMention: true,
      policy: "open",
      allowUsers: [],
      blockUsers: [],
      allowBots: false,
      ...extra,
    },
  };
}

export function createBaseBotSchema<RouteShape extends z.ZodRawShape>(
  params: ChannelConfigSchemaParams<RouteShape>,
) {
  return {
    enabled: z.boolean().default(true),
    name: z.string().optional(),
    agentId: z.string().optional(),
    credentialType: z.enum(["mem", "tokenFile"]).optional(),
    botToken: z.string().optional(),
    tokenFile: z.string().optional(),
    allowBots: z.boolean().optional(),
    dmPolicy: params.dmPolicySchema.optional(),
    groupPolicy: params.conversationPolicySchema.optional(),
    agentPrompt: createAgentPromptSchema().optional(),
    commandPrefixes: params.commandPrefixesOverrideSchema.optional(),
    streaming: params.streamingSchema.optional(),
    response: params.responseSchema.optional(),
    responseMode: params.responseModeSchema.optional(),
    additionalMessageMode: params.additionalMessageModeSchema.optional(),
    surfaceNotifications: params.surfaceNotificationsOverrideSchema.optional(),
    verbose: params.verboseSchema.optional(),
    followUp: params.followUpOverrideSchema.optional(),
    timezone: params.timezoneSchema.optional(),
    directMessages: z.record(z.string(), params.botRouteSchema).default({}),
  };
}

export function createBaseDefaultsSchema<
  RouteShape extends z.ZodRawShape,
  ModeSchema extends ZodTypeAny,
>(params: ChannelConfigSchemaParams<RouteShape>, modeSchema: ModeSchema) {
  return {
    enabled: z.boolean().default(false),
    defaultBotId: z.string().min(1).default("default"),
    mode: modeSchema,
    allowBots: z.boolean().default(false),
    dmPolicy: params.dmPolicySchema.default("pairing"),
    groupPolicy: params.conversationPolicySchema.default("allowlist"),
    agentPrompt: createAgentPromptSchema().default({
      enabled: true,
      maxProgressMessages: 3,
      requireFinalResponse: true,
    }),
    commandPrefixes: params.commandPrefixesSchema.default({
      slash: ["::", "\\"],
      bash: ["!"],
    }),
    streaming: params.streamingSchema.default("off"),
    response: params.responseSchema.default("final"),
    responseMode: params.responseModeSchema.default("message-tool"),
    additionalMessageMode: params.additionalMessageModeSchema.default("steer"),
    surfaceNotifications: params.surfaceNotificationsSchema.optional(),
    verbose: params.verboseSchema.default("minimal"),
    followUp: params.followUpSchema.default({
      mode: "auto",
      participationTtlMin: 5,
    }),
    timezone: params.timezoneSchema.optional(),
    directMessages: z.record(z.string(), params.botRouteSchema).default({}),
  };
}

export function createBaseDefaults(
  mode: "socket" | "polling" | "listener",
  extra: Record<string, unknown> = {},
) {
  return {
    enabled: false,
    defaultBotId: "default",
    mode,
    allowBots: false,
    dmPolicy: "pairing",
    groupPolicy: "allowlist",
    agentPrompt: {
      enabled: true,
      maxProgressMessages: 3,
      requireFinalResponse: true,
    },
    commandPrefixes: {
      slash: ["::", "\\"],
      bash: ["!"],
    },
    streaming: "off",
    response: "final",
    responseMode: "message-tool",
    additionalMessageMode: "steer",
    verbose: "minimal",
    followUp: {
      mode: "auto",
      participationTtlMin: 5,
    },
    directMessages: createDirectMessagesDefault(),
    ...extra,
  };
}

export function asChannelProviderConfigSchema(schema: ZodTypeAny) {
  return schema as z.ZodType<ChannelProviderConfig>;
}
