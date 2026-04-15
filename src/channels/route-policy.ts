import type { CommandPrefixes } from "../agents/commands.ts";
import type { FollowUpConfig } from "../agents/follow-up-policy.ts";
import { resolveTopLevelBoundAgentId } from "../config/bindings.ts";
import { resolveConfigDurationMs } from "../config/duration.ts";
import { getAgentEntry, type LoadedConfig } from "../config/load-config.ts";
import {
  resolvePrivilegeCommands,
  type PrivilegeCommandsConfig,
  type PrivilegeCommandsOverride,
} from "./privilege-commands.ts";

export type SharedChannelRoute = {
  agentId: string;
  requireMention: boolean;
  allowBots: boolean;
  privilegeCommands: PrivilegeCommandsConfig;
  commandPrefixes: CommandPrefixes;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  responseMode: "capture-pane" | "message-tool";
  additionalMessageMode: "queue" | "steer";
  verbose: "off" | "minimal";
  followUp: FollowUpConfig;
  timezone?: string;
};

export type SharedChannelRouteOverride = {
  agentId?: string;
  requireMention?: boolean;
  allowBots?: boolean;
  privilegeCommands?: PrivilegeCommandsOverride;
  commandPrefixes?: Partial<CommandPrefixes>;
  streaming?: "off" | "latest" | "all";
  response?: "all" | "final";
  responseMode?: "capture-pane" | "message-tool";
  additionalMessageMode?: "queue" | "steer";
  verbose?: "off" | "minimal";
  followUp?: {
    mode?: FollowUpConfig["mode"];
    participationTtlSec?: number;
    participationTtlMin?: number;
  };
  timezone?: string;
};

type SharedChannelConfig = {
  defaultAgentId: string;
  allowBots: boolean;
  privilegeCommands?: PrivilegeCommandsConfig;
  commandPrefixes: CommandPrefixes;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  responseMode: "capture-pane" | "message-tool";
  additionalMessageMode: "queue" | "steer";
  verbose: "off" | "minimal";
  followUp: {
    mode: FollowUpConfig["mode"];
    participationTtlSec?: number;
    participationTtlMin?: number;
  };
  timezone?: string;
};

type BuildSharedChannelRouteParams = {
  loadedConfig: LoadedConfig;
  channel: "slack" | "telegram";
  channelConfig: SharedChannelConfig;
  route?: SharedChannelRouteOverride | null;
  requireMention: boolean;
  normalizePrivilegeUsers(userIds: string[]): string[];
  accountId?: string;
};

export function buildSharedChannelRoute(params: BuildSharedChannelRouteParams): SharedChannelRoute {
  const privilegeCommands = resolvePrivilegeCommands(
    params.channelConfig.privilegeCommands ?? {
      enabled: false,
      allowUsers: [],
    },
    params.route?.privilegeCommands,
  );
  const agentId =
    params.route?.agentId ??
    resolveTopLevelBoundAgentId(params.loadedConfig, {
      channel: params.channel,
      accountId: params.accountId,
    }) ??
    params.channelConfig.defaultAgentId;
  const agentEntry = getAgentEntry(params.loadedConfig, agentId);

  return {
    agentId,
    requireMention: params.route?.requireMention ?? params.requireMention,
    allowBots: params.route?.allowBots ?? params.channelConfig.allowBots,
    privilegeCommands: {
      enabled: privilegeCommands.enabled,
      allowUsers: params.normalizePrivilegeUsers(privilegeCommands.allowUsers),
    },
    commandPrefixes: {
      slash: params.route?.commandPrefixes?.slash ?? params.channelConfig.commandPrefixes.slash,
      bash: params.route?.commandPrefixes?.bash ?? params.channelConfig.commandPrefixes.bash,
    },
    streaming: params.route?.streaming ?? params.channelConfig.streaming,
    response: params.route?.response ?? params.channelConfig.response,
    responseMode:
      params.route?.responseMode ??
      agentEntry?.responseMode ??
      params.channelConfig.responseMode,
    additionalMessageMode:
      params.route?.additionalMessageMode ??
      agentEntry?.additionalMessageMode ??
      params.channelConfig.additionalMessageMode,
    verbose: params.route?.verbose ?? params.channelConfig.verbose,
    followUp: {
      mode: params.route?.followUp?.mode ?? params.channelConfig.followUp.mode,
      participationTtlMs: resolveConfigDurationMs({
        seconds:
          params.route?.followUp?.participationTtlSec ??
          params.channelConfig.followUp.participationTtlSec,
        minutes:
          params.route?.followUp?.participationTtlMin ??
          params.channelConfig.followUp.participationTtlMin,
        defaultMinutes: 5,
      }),
    },
    timezone: params.route?.timezone ?? params.channelConfig.timezone,
  };
}
