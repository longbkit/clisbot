import type { CommandPrefixes } from "../agents/commands.ts";
import type { FollowUpConfig } from "../agents/follow-up-policy.ts";
import { resolveConfigDurationMs } from "../config/duration.ts";
import { getAgentEntry, type LoadedConfig } from "../config/load-config.ts";
import type { SurfaceNotificationsConfig } from "./surface-notifications.ts";

export type SurfaceRoute = {
  agentId: string;
  policy: "open" | "allowlist";
  requireMention: boolean;
  allowBots: boolean;
  allowUsers?: string[];
  blockUsers?: string[];
  commandPrefixes: CommandPrefixes;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  responseMode: "capture-pane" | "message-tool";
  additionalMessageMode: "queue" | "steer";
  surfaceNotifications: SurfaceNotificationsConfig;
  verbose: "off" | "minimal";
  followUp: FollowUpConfig;
  timezone?: string;
  botTimezone?: string;
};

export type ResolvedSurfaceRouteStatus = "admitted" | "disabled" | "missing";

export type SurfaceRouteOverride = {
  enabled?: boolean;
  policy?: "open" | "pairing" | "allowlist" | "disabled";
  agentId?: string;
  requireMention?: boolean;
  allowBots?: boolean;
  allowUsers?: string[];
  blockUsers?: string[];
  commandPrefixes?: Partial<CommandPrefixes>;
  streaming?: "off" | "latest" | "all";
  response?: "all" | "final";
  responseMode?: "capture-pane" | "message-tool";
  additionalMessageMode?: "queue" | "steer";
  surfaceNotifications?: Partial<SurfaceNotificationsConfig>;
  verbose?: "off" | "minimal";
  followUp?: {
    mode?: FollowUpConfig["mode"];
    participationTtlSec?: number;
    participationTtlMin?: number;
  };
  timezone?: string;
};

type SurfaceRouteConfig = {
  agentId?: string;
  allowBots: boolean;
  commandPrefixes: CommandPrefixes;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  responseMode: "capture-pane" | "message-tool";
  additionalMessageMode: "queue" | "steer";
  surfaceNotifications?: SurfaceNotificationsConfig;
  verbose: "off" | "minimal";
  followUp: {
    mode: FollowUpConfig["mode"];
    participationTtlSec?: number;
    participationTtlMin?: number;
  };
  timezone?: string;
};

type BuildSurfaceRouteParams = {
  loadedConfig: LoadedConfig;
  channel: "slack" | "telegram";
  channelConfig: SurfaceRouteConfig;
  route?: SurfaceRouteOverride | null;
  policy: "open" | "allowlist";
  requireMention: boolean;
};

function mergeRouteAudienceEntries(...sources: Array<string[] | undefined>) {
  return [...new Set(
    sources.flatMap((source) =>
      (source ?? []).map((entry) => entry.trim()).filter(Boolean),
    ),
  )];
}

export function mergeSurfaceRouteOverride<
  TRoute extends SurfaceRouteOverride,
>(
  base: TRoute | undefined | null,
  override: TRoute | undefined | null,
) {
  if (!base) {
    return override ?? undefined;
  }

  if (!override) {
    return base;
  }

  return {
    ...base,
    ...override,
    allowUsers: mergeRouteAudienceEntries(base.allowUsers, override.allowUsers),
    blockUsers: mergeRouteAudienceEntries(base.blockUsers, override.blockUsers),
  } satisfies TRoute;
}

export function buildSurfaceRoute(params: BuildSurfaceRouteParams): SurfaceRoute {
  const agentId =
    params.route?.agentId ??
    params.channelConfig.agentId ??
    params.loadedConfig.raw.agents.defaults.defaultAgentId;
  const agentEntry = getAgentEntry(params.loadedConfig, agentId);

  return {
    agentId,
    policy: params.route?.policy === "open" ? "open" : params.policy,
    requireMention: params.route?.requireMention ?? params.requireMention,
    allowBots: params.route?.allowBots ?? params.channelConfig.allowBots,
    allowUsers: [...(params.route?.allowUsers ?? [])],
    blockUsers: [...(params.route?.blockUsers ?? [])],
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
    surfaceNotifications: {
      queueStart:
        params.route?.surfaceNotifications?.queueStart ??
        params.channelConfig.surfaceNotifications?.queueStart ??
        "brief",
      loopStart:
        params.route?.surfaceNotifications?.loopStart ??
        params.channelConfig.surfaceNotifications?.loopStart ??
        "brief",
    },
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
    timezone: params.route?.timezone,
    botTimezone: params.channelConfig.timezone,
  };
}

export function isSurfaceRouteEnabled(
  route: SurfaceRouteOverride | undefined | null,
) {
  return !!route && route.enabled !== false && route.policy !== "disabled";
}

export function renderGroupRouteAccessDeniedMessage() {
  return "You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to `allowUsers` for this surface.";
}
