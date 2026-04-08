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
import { type TelegramConversationKind } from "./session-routing.ts";

export type TelegramRoute = {
  agentId: string;
  requireMention: boolean;
  allowBots: boolean;
  privilegeCommands: PrivilegeCommandsConfig;
  commandPrefixes: CommandPrefixes;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  followUp: FollowUpConfig;
};

export type TelegramResolvedRoute = {
  conversationKind: TelegramConversationKind;
  route: TelegramRoute | null;
};

type TelegramRouteOverride = {
  requireMention?: boolean;
  allowBots?: boolean;
  agentId?: string;
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

function normalizeTelegramPrivilegeUsers(userIds: string[]) {
  return userIds.map((userId) => userId.trim()).filter(Boolean);
}

function buildRoute(
  loadedConfig: LoadedConfig,
  params: {
    route?: TelegramRouteOverride | null;
    requireMention: boolean;
    accountId?: string;
  },
): TelegramRoute {
  const telegramConfig = loadedConfig.raw.channels.telegram;
  const privilegeCommands = resolvePrivilegeCommands(
    telegramConfig.privilegeCommands,
    params.route?.privilegeCommands,
  );
  return {
    agentId:
      params.route?.agentId ??
      resolveTopLevelBoundAgentId(loadedConfig, {
        channel: "telegram",
        accountId: params.accountId,
      }) ??
      telegramConfig.defaultAgentId,
    requireMention: params.route?.requireMention ?? params.requireMention,
    allowBots: params.route?.allowBots ?? telegramConfig.allowBots,
    privilegeCommands: {
      enabled: privilegeCommands.enabled,
      allowUsers: normalizeTelegramPrivilegeUsers(privilegeCommands.allowUsers),
    },
    commandPrefixes: {
      slash: params.route?.commandPrefixes?.slash ?? telegramConfig.commandPrefixes.slash,
      bash: params.route?.commandPrefixes?.bash ?? telegramConfig.commandPrefixes.bash,
    },
    streaming: params.route?.streaming ?? telegramConfig.streaming,
    response: params.route?.response ?? telegramConfig.response,
    followUp: {
      mode: params.route?.followUp?.mode ?? telegramConfig.followUp.mode,
      participationTtlMs: resolveConfigDurationMs({
        seconds: params.route?.followUp?.participationTtlSec ??
          telegramConfig.followUp.participationTtlSec,
        minutes: params.route?.followUp?.participationTtlMin ??
          telegramConfig.followUp.participationTtlMin,
        defaultMinutes: 5,
      }),
    },
  };
}

function resolveGroupRoute(
  loadedConfig: LoadedConfig,
  chatId: number,
  topicId?: number,
  accountId?: string,
): TelegramRoute | null {
  const telegramConfig = loadedConfig.raw.channels.telegram;
  const groupRoute = telegramConfig.groups[String(chatId)] ?? telegramConfig.groups["*"];
  const topicRoute =
    topicId != null ? groupRoute?.topics?.[String(topicId)] : undefined;

  if (groupRoute || topicRoute) {
    return buildRoute(loadedConfig, {
      route: {
        ...groupRoute,
        ...topicRoute,
      },
      requireMention: groupRoute?.requireMention ?? true,
      accountId,
    });
  }

  if (telegramConfig.groupPolicy === "open") {
    return buildRoute(loadedConfig, {
      requireMention: true,
      accountId,
    });
  }

  return null;
}

function resolveDirectMessageRoute(loadedConfig: LoadedConfig, accountId?: string) {
  const telegramConfig = loadedConfig.raw.channels.telegram;
  if (!telegramConfig.directMessages.enabled) {
    return null;
  }

  return buildRoute(loadedConfig, {
    route: telegramConfig.directMessages,
    requireMention: false,
    accountId,
  });
}

export function resolveTelegramConversationRoute(params: {
  loadedConfig: LoadedConfig;
  chatType: "private" | "group" | "supergroup" | "channel";
  chatId: number;
  topicId?: number;
  isForum?: boolean;
  accountId?: string;
}) {
  if (params.chatType === "private") {
    return {
      conversationKind: "dm" as const,
      route: resolveDirectMessageRoute(params.loadedConfig, params.accountId),
    };
  }

  if (params.chatType !== "group" && params.chatType !== "supergroup") {
    return {
      conversationKind: "group" as const,
      route: null,
    };
  }

  const conversationKind =
    params.isForum || params.topicId != null ? ("topic" as const) : ("group" as const);

  return {
    conversationKind,
    route: resolveGroupRoute(
      params.loadedConfig,
      params.chatId,
      params.topicId,
      params.accountId,
    ),
  };
}
