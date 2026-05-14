import type {
  CommandPrefixesConfig,
  FollowUpConfig,
  SurfaceNotificationsConfig,
} from "../core/schema.ts";
import {
  cloneStandardRoutes,
  mergeStandardRoutes,
  mergeTopicAwareGroupRoutes,
  resolveBotCommandPrefixes,
  resolveBotFollowUp,
  resolveBotSurfaceNotifications,
  resolveDirectMessageAdmissionConfig as resolveManagedDirectMessageAdmissionConfig,
  resolveDirectMessageConfig as resolveManagedDirectMessageConfig,
} from "./channel-bot-route-config.ts";
import {
  getChannelProviderBotRecords,
  getConfiguredDefaultBotId,
  listEnabledBotIds,
  normalizeBotId,
} from "./channel-bot-records.ts";
import type {
  ChannelBotRecord,
  ChannelDirectMessageRoutes,
  ChannelGroupRoutes,
  ChannelProviderConfig,
  ChannelProviderDefaults,
} from "./channel-config-shapes.ts";

export type ResolvedChannelBotConfig = {
  id: string;
  enabled: boolean;
  name?: string;
  agentId?: string;
  allowBots: boolean;
  dmPolicy: "open" | "pairing" | "allowlist" | "disabled";
  groupPolicy: "open" | "allowlist" | "disabled";
  agentPrompt: ChannelProviderDefaults["agentPrompt"];
  commandPrefixes: CommandPrefixesConfig;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  responseMode: "capture-pane" | "message-tool";
  additionalMessageMode: "queue" | "steer";
  surfaceNotifications?: SurfaceNotificationsConfig;
  verbose: "off" | "minimal";
  followUp: FollowUpConfig;
  timezone?: string;
  directMessages: ChannelDirectMessageRoutes;
  groups: ChannelGroupRoutes;
};

export function resolveChannelProviderBotId(
  config: ChannelProviderConfig,
  botId?: string | null,
) {
  return normalizeBotId(botId) ?? getConfiguredDefaultBotId({
    defaultBotId: config.defaults.defaultBotId,
    bots: getChannelProviderBotRecords(config),
  });
}

export function listEnabledChannelProviderBotIds(config: ChannelProviderConfig) {
  return listEnabledBotIds(getChannelProviderBotRecords(config));
}

export function requireChannelProviderBotRecord(params: {
  config: ChannelProviderConfig;
  botId: string;
  providerLabel: string;
}) {
  const botConfig = getChannelProviderBotRecords(params.config)[params.botId];
  if (!botConfig) {
    throw new Error(`Unknown ${params.providerLabel} bot: ${params.botId}`);
  }
  return botConfig;
}

export function mergeResolvedChannelBotConfig(params: {
  resolvedBotId: string;
  providerDefaults: ChannelProviderDefaults;
  botConfig: ChannelBotRecord;
  groups: ChannelGroupRoutes;
}): ResolvedChannelBotConfig {
  const { resolvedBotId, providerDefaults, botConfig, groups } = params;
  return {
    id: resolvedBotId,
    enabled: botConfig.enabled,
    name: typeof botConfig.name === "string" ? botConfig.name : undefined,
    agentId: typeof botConfig.agentId === "string" ? botConfig.agentId : undefined,
    allowBots: botConfig.allowBots ?? providerDefaults.allowBots,
    dmPolicy: botConfig.dmPolicy ?? providerDefaults.dmPolicy,
    groupPolicy: botConfig.groupPolicy ?? providerDefaults.groupPolicy,
    agentPrompt: botConfig.agentPrompt ?? providerDefaults.agentPrompt,
    commandPrefixes: resolveBotCommandPrefixes(providerDefaults, botConfig),
    streaming: botConfig.streaming ?? providerDefaults.streaming,
    response: botConfig.response ?? providerDefaults.response,
    responseMode: botConfig.responseMode ?? providerDefaults.responseMode,
    additionalMessageMode:
      botConfig.additionalMessageMode ?? providerDefaults.additionalMessageMode,
    surfaceNotifications: resolveBotSurfaceNotifications(providerDefaults, botConfig),
    verbose: botConfig.verbose ?? providerDefaults.verbose,
    followUp: resolveBotFollowUp(providerDefaults, botConfig),
    timezone: botConfig.timezone ?? providerDefaults.timezone,
    directMessages: {
      ...cloneStandardRoutes(providerDefaults.directMessages),
      ...cloneStandardRoutes(botConfig.directMessages ?? {}),
    },
    groups,
  };
}

export function resolveChannelProviderBotConfig(params: {
  config: ChannelProviderConfig;
  providerLabel: string;
  botId?: string | null;
  mergeGroups: (
    defaults: ChannelGroupRoutes,
    routes: ChannelGroupRoutes,
  ) => ChannelGroupRoutes;
}) {
  const resolvedBotId = resolveChannelProviderBotId(params.config, params.botId);
  const botConfig = requireChannelProviderBotRecord({
    config: params.config,
    botId: resolvedBotId,
    providerLabel: params.providerLabel,
  });
  return mergeResolvedChannelBotConfig({
    resolvedBotId,
    providerDefaults: params.config.defaults,
    botConfig,
    groups: params.mergeGroups(params.config.defaults.groups, botConfig.groups ?? {}),
  });
}

export function mergeStandardChannelGroupRoutes(
  defaults: ChannelGroupRoutes,
  routes: ChannelGroupRoutes,
) {
  return mergeStandardRoutes(defaults, routes);
}

export function mergeTopicAwareChannelGroupRoutes(
  defaults: ChannelGroupRoutes,
  routes: ChannelGroupRoutes,
) {
  return mergeTopicAwareGroupRoutes(defaults, routes);
}

export function resolveChannelDirectMessageConfig(
  config: ResolvedChannelBotConfig,
  senderId?: string | number | null,
) {
  return resolveManagedDirectMessageConfig(config, senderId);
}

export function resolveChannelDirectMessageAdmissionConfig(
  config: ResolvedChannelBotConfig,
) {
  return resolveManagedDirectMessageAdmissionConfig(config);
}
