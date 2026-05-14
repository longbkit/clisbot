import type { BotRouteConfig, ClisbotConfig } from "../core/schema.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";

export type ChannelTemplateConfigKey = Exclude<keyof ClisbotConfig["bots"], "defaults">;
export type ChannelTemplateConfigMap = Pick<ClisbotConfig["bots"], ChannelTemplateConfigKey>;

export type ChannelBootstrapTemplateOptions = {
  enabled?: boolean;
  appTokenRef?: string;
  botTokenRef?: string;
};

export type ChannelTemplateContract<
  TConfigBotKey extends ChannelTemplateConfigKey = ChannelTemplateConfigKey,
> = {
  channel: ChannelId;
  configBotKey: TConfigBotKey;
  buildTemplate(params: {
    options: ChannelBootstrapTemplateOptions;
    renderEnvReference(name: string, override?: string): string;
  }): ChannelTemplateConfigMap[TConfigBotKey];
};

function createDirectMessageWildcardRoute(): BotRouteConfig {
  return {
    enabled: true,
    requireMention: false,
    policy: "pairing",
    allowUsers: [],
    blockUsers: [],
    allowBots: false,
  };
}

function createStandardGroupWildcardRoute(): BotRouteConfig {
  return {
    enabled: true,
    requireMention: true,
    policy: "open",
    allowUsers: [],
    blockUsers: [],
    allowBots: false,
  };
}

function createTopicGroupWildcardRoute(): BotRouteConfig & {
  topics: Record<string, BotRouteConfig>;
} {
  return {
    enabled: true,
    requireMention: true,
    policy: "open",
    allowUsers: [],
    blockUsers: [],
    allowBots: false,
    topics: {},
  };
}

type BaseProviderDefaultsTemplate<TMode extends "socket" | "polling"> = {
  enabled: boolean;
  defaultBotId: string;
  mode: TMode;
  allowBots: boolean;
  dmPolicy: "pairing";
  groupPolicy: "allowlist";
  agentPrompt: {
    enabled: boolean;
    maxProgressMessages: number;
    requireFinalResponse: boolean;
  };
  commandPrefixes: {
    slash: string[];
    bash: string[];
  };
  streaming: "off";
  response: "final";
  responseMode: "message-tool";
  additionalMessageMode: "steer";
  surfaceNotifications: {
    queueStart: "brief";
    loopStart: "brief";
  };
  verbose: "minimal";
  followUp: {
    mode: "auto";
    participationTtlMin: number;
  };
};

type StandardProviderDefaultsTemplate<TMode extends "socket" | "polling", TExtra extends object> =
  BaseProviderDefaultsTemplate<TMode> & {
    directMessages: {
      "*": BotRouteConfig;
    };
    groups: {
      "*": BotRouteConfig;
    };
  } & TExtra;

type TopicProviderDefaultsTemplate<TMode extends "polling", TExtra extends object> =
  BaseProviderDefaultsTemplate<TMode> & {
    directMessages: {
      "*": BotRouteConfig;
    };
    groups: {
      "*": BotRouteConfig & {
        topics: Record<string, BotRouteConfig>;
      };
    };
  } & TExtra;

export function createStandardChannelProviderDefaultsTemplate<
  TMode extends "socket" | "polling",
  TExtra extends object = {},
>(params: {
  enabled: boolean;
  mode: TMode;
  extra?: TExtra;
}): StandardProviderDefaultsTemplate<TMode, TExtra> {
  return {
    enabled: params.enabled,
    defaultBotId: "default",
    mode: params.mode,
    allowBots: false,
    dmPolicy: "pairing",
    groupPolicy: "allowlist",
    agentPrompt: {
      enabled: true,
      maxProgressMessages: 3,
      requireFinalResponse: true,
    },
    directMessages: {
      "*": createDirectMessageWildcardRoute(),
    },
    groups: {
      "*": createStandardGroupWildcardRoute(),
    },
    commandPrefixes: {
      slash: ["::", "\\"],
      bash: ["!"],
    },
    streaming: "off",
    response: "final",
    responseMode: "message-tool",
    additionalMessageMode: "steer",
    surfaceNotifications: {
      queueStart: "brief",
      loopStart: "brief",
    },
    verbose: "minimal",
    followUp: {
      mode: "auto",
      participationTtlMin: 5,
    },
    ...params.extra,
  } as StandardProviderDefaultsTemplate<TMode, TExtra>;
}

export function createTopicChannelProviderDefaultsTemplate<
  TExtra extends object = {},
>(params: {
  enabled: boolean;
  mode: "polling";
  extra?: TExtra;
}): TopicProviderDefaultsTemplate<"polling", TExtra> {
  return {
    enabled: params.enabled,
    defaultBotId: "default",
    mode: params.mode,
    allowBots: false,
    dmPolicy: "pairing",
    groupPolicy: "allowlist",
    agentPrompt: {
      enabled: true,
      maxProgressMessages: 3,
      requireFinalResponse: true,
    },
    directMessages: {
      "*": createDirectMessageWildcardRoute(),
    },
    groups: {
      "*": createTopicGroupWildcardRoute(),
    },
    commandPrefixes: {
      slash: ["::", "\\"],
      bash: ["!"],
    },
    streaming: "off",
    response: "final",
    responseMode: "message-tool",
    additionalMessageMode: "steer",
    surfaceNotifications: {
      queueStart: "brief",
      loopStart: "brief",
    },
    verbose: "minimal",
    followUp: {
      mode: "auto",
      participationTtlMin: 5,
    },
    ...params.extra,
  } as TopicProviderDefaultsTemplate<"polling", TExtra>;
}

type ChannelDefaultBotTemplate<TExtra extends object> = {
  enabled: boolean;
  name: string;
  dmPolicy: "pairing";
  groupPolicy: "allowlist";
  directMessages: Record<string, never>;
  groups: Record<string, never>;
} & TExtra;

export function createChannelDefaultBotTemplate<TExtra extends object = {}>(params: {
  enabled: boolean;
  extra?: TExtra;
}): ChannelDefaultBotTemplate<TExtra> {
  return {
    enabled: params.enabled,
    name: "default",
    dmPolicy: "pairing",
    groupPolicy: "allowlist",
    directMessages: {},
    groups: {},
    ...params.extra,
  } as ChannelDefaultBotTemplate<TExtra>;
}

export function defineChannelTemplateContract<
  TConfigBotKey extends ChannelTemplateConfigKey,
>(contract: ChannelTemplateContract<TConfigBotKey>) {
  return contract;
}
