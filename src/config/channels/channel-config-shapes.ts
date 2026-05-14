import type {
  BotRouteConfig,
  CommandPrefixesConfig,
  FollowUpConfig,
  SurfaceNotificationsConfig,
} from "../core/schema.ts";
import type { ChannelConfigBotKey } from "../../channels/integration/channel-config-key.ts";

export type { ChannelConfigBotKey };

export type ChannelAgentPromptConfig = {
  enabled: boolean;
  maxProgressMessages: number;
  requireFinalResponse: boolean;
};

export type ChannelTopicRoute = BotRouteConfig;
export type ChannelTopicRoutes = Record<string, ChannelTopicRoute>;

export type ChannelGroupRoute = BotRouteConfig & {
  topics?: ChannelTopicRoutes;
};

export type ChannelGroupRoutes = Record<string, ChannelGroupRoute>;
export type ChannelDirectMessageRoutes = Record<string, BotRouteConfig>;

export type ChannelBotRecord = Record<string, unknown> & {
  enabled: boolean;
  name?: string;
  agentId?: string;
  credentialType?: "mem" | "tokenFile";
  appToken?: string;
  botToken?: string;
  appTokenFile?: string;
  botTokenFile?: string;
  tokenFile?: string;
  allowBots?: boolean;
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  agentPrompt?: ChannelAgentPromptConfig;
  commandPrefixes?: Partial<CommandPrefixesConfig>;
  streaming?: "off" | "latest" | "all";
  response?: "all" | "final";
  responseMode?: "capture-pane" | "message-tool";
  additionalMessageMode?: "queue" | "steer";
  surfaceNotifications?: Partial<SurfaceNotificationsConfig>;
  verbose?: "off" | "minimal";
  followUp?: Partial<FollowUpConfig>;
  timezone?: string;
  directMessages: ChannelDirectMessageRoutes;
  groups: ChannelGroupRoutes;
};

export type ChannelProviderDefaults = Record<string, unknown> & {
  enabled: boolean;
  defaultBotId: string;
  mode: string;
  allowBots: boolean;
  dmPolicy: "open" | "pairing" | "allowlist" | "disabled";
  groupPolicy: "open" | "allowlist" | "disabled";
  agentPrompt: ChannelAgentPromptConfig;
  commandPrefixes: CommandPrefixesConfig;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  responseMode: "capture-pane" | "message-tool";
  additionalMessageMode: "queue" | "steer";
  surfaceNotifications?: Partial<SurfaceNotificationsConfig>;
  verbose: "off" | "minimal";
  followUp: FollowUpConfig;
  timezone?: string;
  directMessages: ChannelDirectMessageRoutes;
  groups: ChannelGroupRoutes;
};

export type ChannelProviderConfig = Record<string, ChannelBotRecord | ChannelProviderDefaults> & {
  defaults: ChannelProviderDefaults;
};
