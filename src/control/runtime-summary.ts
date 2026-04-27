import { AgentService } from "../agents/agent-service.ts";
import {
  getBootstrapWorkspaceState,
  type BootstrapWorkspaceState,
} from "../agents/bootstrap.ts";
import { MissingEnvVarError } from "../config/env-substitution.ts";
import {
  type LoadedConfig,
  loadConfig,
  loadConfigWithoutEnvResolution,
} from "../config/load-config.ts";
import {
  DEFAULT_AGENT_TOOL_TEMPLATES,
  inferAgentCliToolId,
} from "../config/agent-tool-presets.ts";
import {
  resolveSlackBotConfig,
  resolveSlackDirectMessageConfig,
  resolveTelegramBotConfig,
  resolveTelegramDirectMessageConfig,
} from "../config/channel-bots.ts";
import { resolveSharedGroupsWildcardRoute } from "../config/group-routes.ts";
import { isSharedGroupsWildcardRouteId } from "../config/group-routes.ts";
import { ActivityStore } from "./activity-store.ts";
import {
  collapseHomePath,
  getDefaultActivityStorePath,
  getDefaultConfigPath,
  getDefaultRuntimeHealthPath,
} from "../shared/paths.ts";
import {
  renderOperatorHelpLines,
} from "./startup-bootstrap.ts";
import {
  RuntimeHealthStore,
  type ChannelHealthInstance,
  type RuntimeChannelConnection,
} from "./runtime-health-store.ts";
import {
  renderRuntimeDiagnosticsSummary,
  renderStartSummary,
  renderStatusSummary,
} from "./runtime-summary-rendering.ts";
import { listRunnerSessions, type RunnerSessionSummary } from "./runner-debug-state.ts";
import { resolveConfigTimezone } from "../config/timezone.ts";
export {
  renderRuntimeDiagnosticsSummary,
  renderStartSummary,
  renderStatusSummary,
} from "./runtime-summary-rendering.ts";

export type AgentOperatorSummary = {
  id: string;
  cliTool: string;
  workspacePath: string;
  startupOptions: string[];
  responseMode?: "capture-pane" | "message-tool";
  additionalMessageMode?: "queue" | "steer";
  bootstrapMode?: string;
  bootstrapState: BootstrapWorkspaceState;
  bindings: string[];
  lastActivityAt?: string;
};

export type ChannelOperatorSummary = {
  channel: "slack" | "telegram";
  enabled: boolean;
  connection: RuntimeChannelConnection;
  defaultAgentId: string;
  streaming: "off" | "latest" | "all";
  response: "all" | "final";
  responseMode: "capture-pane" | "message-tool";
  additionalMessageMode: "queue" | "steer";
  configuredSurfaceCount: number;
  directMessagesEnabled: boolean;
  directMessagesPolicy: string;
  sharedDefaultPolicy?: string;
  lastActivityAt?: string;
  lastActivityAgentId?: string;
  healthSummary?: string;
  healthDetail?: string;
  healthActions: string[];
  healthInstances: ChannelHealthInstance[];
  healthUpdatedAt?: string;
};

export type RuntimeOperatorSummary = {
  loadedConfig: LoadedConfig;
  ownerSummary: {
    ownerPrincipals: string[];
    adminPrincipals: string[];
    ownerClaimWindowMinutes: number;
  };
  timezoneSummary: {
    effective: string;
    source: string;
    appTimezone?: string;
  };
  agentSummaries: AgentOperatorSummary[];
  channelSummaries: ChannelOperatorSummary[];
  activeRuns: Array<{
    agentId: string;
    sessionKey: string;
    state: "running" | "detached";
    startedAt?: number;
    detachedAt?: number;
  }>;
  configuredAgents: number;
  bootstrapPendingAgents: number;
  bootstrappedAgents: number;
  runningTmuxSessions: number;
  runnerSessions: RunnerSessionSummary[];
};

function deriveAgentTool(
  loadedConfig: LoadedConfig,
  agentId: string,
) {
  const entry = loadedConfig.raw.agents.list.find((item) => item.id === agentId);
  if (entry?.cli) {
    return {
      cliTool: entry.cli,
      startupOptions: entry.runner?.args ?? DEFAULT_AGENT_TOOL_TEMPLATES[entry.cli].startupOptions,
    };
  }

  const resolved = new AgentService(loadedConfig).getResolvedAgentConfig(agentId);

  return {
    cliTool: inferAgentCliToolId(resolved.runner.command) ?? resolved.runner.command,
    startupOptions: resolved.runner.args,
  };
}

function countTelegramSurfaces(loadedConfig: LoadedConfig) {
  return Object.entries(loadedConfig.raw.bots.telegram)
    .filter(([botId]) => botId !== "defaults")
    .reduce((total, [, bot]) => {
      const groups = "groups" in bot ? bot.groups ?? {} : {};
      return total + Object.entries(groups).reduce((groupTotal: number, [groupId, group]) => {
        if (isSharedGroupsWildcardRouteId(groupId)) {
          return groupTotal;
        }
        return groupTotal + 1 + Object.keys(group.topics ?? {}).length;
      }, 0);
    }, 0);
}

function countSlackSurfaces(loadedConfig: LoadedConfig) {
  return Object.entries(loadedConfig.raw.bots.slack)
    .filter(([botId]) => botId !== "defaults")
    .reduce((total, [, bot]) => {
      const groups = "groups" in bot ? bot.groups ?? {} : {};
      return total + Object.keys(groups).filter((groupId) => !isSharedGroupsWildcardRouteId(groupId)).length;
    }, 0);
}

async function getRunnerSessions(loadedConfig: LoadedConfig) {
  try {
    return await listRunnerSessions(loadedConfig);
  } catch {
    return [];
  }
}

export async function getRuntimeOperatorSummary(params: {
  configPath?: string;
  runtimeRunning: boolean;
  activityPath?: string;
  healthPath?: string;
}) {
  const loadedConfig = await loadOperatorSummaryConfig(params.configPath);
  const agentService = new AgentService(loadedConfig);
  const activityStore = new ActivityStore(params.activityPath ?? getDefaultActivityStorePath());
  const activities = await activityStore.read();
  const runtimeHealthStore = new RuntimeHealthStore(
    params.healthPath ?? getDefaultRuntimeHealthPath(),
  );
  const runtimeHealth = await runtimeHealthStore.read();
  const runnerSessions = await getRunnerSessions(loadedConfig);
  const defaultSlackBot = resolveSlackBotConfig(
    loadedConfig.raw.bots.slack,
    loadedConfig.raw.bots.slack.defaults.defaultBotId,
  );
  const defaultTelegramBot = resolveTelegramBotConfig(
    loadedConfig.raw.bots.telegram,
    loadedConfig.raw.bots.telegram.defaults.defaultBotId,
  );
  const defaultSlackDmConfig = resolveSlackDirectMessageConfig(defaultSlackBot);
  const defaultTelegramDmConfig = resolveTelegramDirectMessageConfig(defaultTelegramBot);

  const agentSummaries = loadedConfig.raw.agents.list.map((entry) => {
    const resolved = new AgentService(loadedConfig).getResolvedAgentConfig(entry.id);
    const tool = deriveAgentTool(loadedConfig, entry.id);
    const bootstrapState = getBootstrapWorkspaceState(
      resolved.workspacePath,
      entry.bootstrap?.botType,
      tool.cliTool === "codex" || tool.cliTool === "claude" || tool.cliTool === "gemini"
        ? tool.cliTool
        : undefined,
    );

    return {
      id: entry.id,
      cliTool: tool.cliTool,
      workspacePath: resolved.workspacePath,
      startupOptions: tool.startupOptions,
      responseMode: entry.responseMode,
      additionalMessageMode: entry.additionalMessageMode,
      bootstrapMode: entry.bootstrap?.botType,
      bootstrapState,
      bindings: [],
      lastActivityAt: activities.agents[entry.id]?.updatedAt,
    } satisfies AgentOperatorSummary;
  });

  const slackConnection = deriveChannelConnection({
    enabled: loadedConfig.raw.bots.slack.defaults.enabled,
    runtimeRunning: params.runtimeRunning,
    recordedConnection: runtimeHealth.channels.slack?.connection,
  });
  const telegramConnection = deriveChannelConnection({
    enabled: loadedConfig.raw.bots.telegram.defaults.enabled,
    runtimeRunning: params.runtimeRunning,
    recordedConnection: runtimeHealth.channels.telegram?.connection,
  });

  const channelSummaries = [
    {
      channel: "slack" as const,
      enabled: loadedConfig.raw.bots.slack.defaults.enabled,
      connection: slackConnection,
      defaultAgentId:
        defaultSlackBot.agentId ?? loadedConfig.raw.agents.defaults.defaultAgentId,
      streaming: defaultSlackBot.streaming,
      response: defaultSlackBot.response,
      responseMode: defaultSlackBot.responseMode,
      additionalMessageMode: defaultSlackBot.additionalMessageMode,
      configuredSurfaceCount: countSlackSurfaces(loadedConfig),
      directMessagesEnabled: defaultSlackDmConfig?.enabled !== false,
      directMessagesPolicy: defaultSlackDmConfig?.policy ?? "disabled",
      sharedDefaultPolicy:
        resolveSharedGroupsWildcardRoute(defaultSlackBot.groups)?.policy,
      lastActivityAt: activities.channels.slack?.updatedAt,
      lastActivityAgentId: activities.channels.slack?.agentId,
      healthSummary: deriveHealthSummary({
        channel: "slack",
        connection: slackConnection,
        recordedSummary: runtimeHealth.channels.slack?.summary,
      }),
      healthDetail: runtimeHealth.channels.slack?.detail,
      healthActions: runtimeHealth.channels.slack?.actions ?? [],
      healthInstances: runtimeHealth.channels.slack?.instances ?? [],
      healthUpdatedAt: runtimeHealth.channels.slack?.updatedAt,
    },
    {
      channel: "telegram" as const,
      enabled: loadedConfig.raw.bots.telegram.defaults.enabled,
      connection: telegramConnection,
      defaultAgentId:
        defaultTelegramBot.agentId ?? loadedConfig.raw.agents.defaults.defaultAgentId,
      streaming: defaultTelegramBot.streaming,
      response: defaultTelegramBot.response,
      responseMode: defaultTelegramBot.responseMode,
      additionalMessageMode: defaultTelegramBot.additionalMessageMode,
      configuredSurfaceCount: countTelegramSurfaces(loadedConfig),
      directMessagesEnabled: defaultTelegramDmConfig?.enabled !== false,
      directMessagesPolicy: defaultTelegramDmConfig?.policy ?? "disabled",
      sharedDefaultPolicy:
        resolveSharedGroupsWildcardRoute(defaultTelegramBot.groups)?.policy,
      lastActivityAt: activities.channels.telegram?.updatedAt,
      lastActivityAgentId: activities.channels.telegram?.agentId,
      healthSummary: deriveHealthSummary({
        channel: "telegram",
        connection: telegramConnection,
        recordedSummary: runtimeHealth.channels.telegram?.summary,
      }),
      healthDetail: runtimeHealth.channels.telegram?.detail,
      healthActions: runtimeHealth.channels.telegram?.actions ?? [],
      healthInstances: runtimeHealth.channels.telegram?.instances ?? [],
      healthUpdatedAt: runtimeHealth.channels.telegram?.updatedAt,
    },
  ] satisfies ChannelOperatorSummary[];

  const timezone = resolveConfigTimezone({ config: loadedConfig.raw });
  const runningTmuxSessions = runnerSessions.filter((session) => session.live).length;

  return {
    loadedConfig,
    ownerSummary: {
      ownerPrincipals: loadedConfig.raw.app.auth.roles.owner?.users ?? [],
      adminPrincipals: loadedConfig.raw.app.auth.roles.admin?.users ?? [],
      ownerClaimWindowMinutes: loadedConfig.raw.app.auth.ownerClaimWindowMinutes,
    },
    timezoneSummary: {
      effective: timezone.timezone,
      source: timezone.source,
      appTimezone: loadedConfig.raw.app.timezone,
    },
    agentSummaries,
    channelSummaries,
    activeRuns: await agentService.listActiveSessionRuntimes(),
    configuredAgents: agentSummaries.length,
    bootstrapPendingAgents: agentSummaries.filter((item) =>
      item.bootstrapState === "missing" || item.bootstrapState === "not-bootstrapped"
    ).length,
    bootstrappedAgents: agentSummaries.filter((item) => item.bootstrapState === "bootstrapped")
      .length,
    runningTmuxSessions,
    runnerSessions,
  } satisfies RuntimeOperatorSummary;
}

function deriveChannelConnection(params: {
  enabled: boolean;
  runtimeRunning: boolean;
  recordedConnection?: RuntimeChannelConnection;
}) {
  if (!params.enabled) {
    return "disabled" as const;
  }
  if (params.recordedConnection === "failed") {
    return "failed" as const;
  }
  if (!params.runtimeRunning) {
    return "stopped" as const;
  }
  return params.recordedConnection ?? "active";
}

function deriveHealthSummary(params: {
  channel: "slack" | "telegram";
  connection: RuntimeChannelConnection;
  recordedSummary?: string;
}) {
  if (params.recordedSummary) {
    return params.recordedSummary;
  }

  const label = params.channel === "slack" ? "Slack" : "Telegram";
  switch (params.connection) {
    case "disabled":
      return `${label} channel is disabled in config.`;
    case "stopped":
      return `${label} channel is stopped.`;
    case "starting":
      return `${label} channel is starting.`;
    case "active":
      return `${label} channel is active.`;
    case "failed":
      return `${label} channel failed to start.`;
  }
}

async function loadOperatorSummaryConfig(configPath?: string) {
  return await loadConfigWithoutEnvResolution(configPath);
}
