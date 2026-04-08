import type { CommandPrefixes } from "../../agents/commands.ts";
import type { FollowUpConfig } from "../../agents/follow-up-policy.ts";
import { resolveTopLevelBoundAgentId } from "../../config/bindings.ts";
import { resolveConfigDurationMs } from "../../config/duration.ts";
import { type LoadedConfig } from "../../config/load-config.ts";
import {
  resolvePrivilegeCommands,
  type PrivilegeCommandsConfig,
  type PrivilegeCommandsOverride,
} from "../privilege-commands.ts";
import { type SlackConversationKind } from "./session-routing.ts";

export type SlackRoute = {
  agentId: string;
  requireMention: boolean;
  allowBots: boolean;
  replyToMode: "thread" | "all";
  privilegeCommands: PrivilegeCommandsConfig;
  commandPrefixes: CommandPrefixes;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  followUp: FollowUpConfig;
};

export type SlackResolvedRoute = {
  conversationKind: SlackConversationKind;
  route: SlackRoute | null;
};

type SlackRouteOverride = {
  agentId?: string;
  requireMention?: boolean;
  allowBots?: boolean;
  privilegeCommands?: PrivilegeCommandsOverride;
  commandPrefixes?: Partial<CommandPrefixes>;
  streaming?: "off" | "latest" | "all";
  response?: "all" | "final";
  followUp?: {
    mode?: FollowUpConfig["mode"];
    participationTtlSec?: number;
    participationTtlMin?: number;
  };
};

function normalizeSlackPrivilegeUsers(userIds: string[]) {
  return userIds
    .map((userId) => userId.trim().toUpperCase())
    .filter(Boolean);
}

function buildRoute(loadedConfig: LoadedConfig, params: {
  route?: SlackRouteOverride | null;
  requireMention: boolean;
  accountId?: string;
}): SlackRoute {
  const slackConfig = loadedConfig.raw.channels.slack;
  const privilegeCommands = resolvePrivilegeCommands(
    slackConfig.privilegeCommands,
    params.route?.privilegeCommands,
  );
  return {
    agentId:
      params.route?.agentId ??
      resolveTopLevelBoundAgentId(loadedConfig, {
        channel: "slack",
        accountId: params.accountId,
      }) ??
      slackConfig.defaultAgentId,
    requireMention: params.route?.requireMention ?? params.requireMention,
    allowBots: params.route?.allowBots ?? slackConfig.allowBots,
    replyToMode: slackConfig.replyToMode,
    privilegeCommands: {
      enabled: privilegeCommands.enabled,
      allowUsers: normalizeSlackPrivilegeUsers(privilegeCommands.allowUsers),
    },
    commandPrefixes: {
      slash: params.route?.commandPrefixes?.slash ?? slackConfig.commandPrefixes.slash,
      bash: params.route?.commandPrefixes?.bash ?? slackConfig.commandPrefixes.bash,
    },
    streaming: params.route?.streaming ?? slackConfig.streaming,
    response: params.route?.response ?? slackConfig.response,
    followUp: {
      mode: params.route?.followUp?.mode ?? slackConfig.followUp.mode,
      participationTtlMs: resolveConfigDurationMs({
        seconds: params.route?.followUp?.participationTtlSec ??
          slackConfig.followUp.participationTtlSec,
        minutes: params.route?.followUp?.participationTtlMin ??
          slackConfig.followUp.participationTtlMin,
        defaultMinutes: 5,
      }),
    },
  };
}

function resolveChannelRoute(
  loadedConfig: LoadedConfig,
  channelId: string,
  accountId?: string,
): SlackRoute | null {
  const slackConfig = loadedConfig.raw.channels.slack;
  const route = slackConfig.channels[channelId] ?? slackConfig.channels["*"];
  if (route) {
    return buildRoute(loadedConfig, {
      route,
      requireMention: true,
      accountId,
    });
  }

  if (slackConfig.channelPolicy === "open") {
    return buildRoute(loadedConfig, {
      requireMention: true,
      accountId,
    });
  }

  return null;
}

function resolveGroupRoute(
  loadedConfig: LoadedConfig,
  channelId: string,
  accountId?: string,
): SlackRoute | null {
  const slackConfig = loadedConfig.raw.channels.slack;
  const route = slackConfig.groups[channelId] ?? slackConfig.groups["*"];
  if (route) {
    return buildRoute(loadedConfig, {
      route,
      requireMention: true,
      accountId,
    });
  }

  if (slackConfig.groupPolicy === "open") {
    return buildRoute(loadedConfig, {
      requireMention: true,
      accountId,
    });
  }

  return null;
}

function resolveDirectMessageRoute(
  loadedConfig: LoadedConfig,
  accountId?: string,
): SlackRoute | null {
  const slackConfig = loadedConfig.raw.channels.slack;
  if (!slackConfig.directMessages.enabled) {
    return null;
  }

  return buildRoute(loadedConfig, {
    route: slackConfig.directMessages,
    requireMention: false,
    accountId,
  });
}

export function resolveSlackConversationRoute(
  loadedConfig: LoadedConfig,
  event: any,
  options: {
    accountId?: string;
  } = {},
): SlackResolvedRoute {
  const channelType = (event.channel_type as string | undefined)?.trim().toLowerCase();
  const channelId = event.channel as string | undefined;

  if (channelType === "im") {
    return {
      conversationKind: "dm",
      route: resolveDirectMessageRoute(loadedConfig, options.accountId),
    };
  }

  if (channelType === "mpim") {
    return {
      conversationKind: "group",
      route: channelId
        ? resolveGroupRoute(loadedConfig, channelId, options.accountId)
        : null,
    };
  }

  return {
    conversationKind: "channel",
    route: channelId
      ? resolveChannelRoute(loadedConfig, channelId, options.accountId)
      : null,
  };
}
