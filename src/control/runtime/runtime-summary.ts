import { AgentService } from "../../agents/runtime/agent-service.ts";
import {
  getBootstrapWorkspaceState,
  type BootstrapWorkspaceState,
} from "../../agents/runtime/bootstrap.ts";
import { MissingEnvVarError } from "../../config/env/env-substitution.ts";
import {
  type LoadedConfig,
  loadConfig,
  loadConfigWithoutEnvResolution,
} from "../../config/core/load-config.ts";
import {
  DEFAULT_AGENT_TOOL_TEMPLATES,
  inferAgentCliToolId,
} from "../../config/runtime/agent-tool-presets.ts";
import { ActivityStore } from "./activity-store.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import { renderChannelLabel } from "../../channels/catalog/registry.ts";
import {
  collapseHomePath,
  getDefaultActivityStorePath,
  getDefaultConfigPath,
  getDefaultRuntimeHealthPath,
} from "../../infra/paths.ts";
import {
  renderOperatorHelpLines,
} from "../commands/startup-bootstrap.ts";
import {
  RuntimeHealthStore,
  type ChannelHealthRecord,
  type ChannelHealthInstance,
  type RuntimeChannelConnection,
} from "./runtime-health-store.ts";
import {
  renderRuntimeDiagnosticsSummary,
  renderStartSummary,
  renderStatusSummary,
} from "./runtime-summary-rendering.ts";
import { listRunnerSessions, type RunnerSessionSummary } from "../runner/runner-debug-state.ts";
import { resolveConfigTimezone } from "../../config/runtime/timezone.ts";
import { listRuntimeSummaryChannelDescriptors } from "../../channels/catalog/registry.ts";
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
  channel: ChannelId;
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

type SummaryChannelId = ChannelOperatorSummary["channel"];

type ChannelActivityRecord = {
  updatedAt?: string;
  agentId?: string;
};

type ChannelSummaryParams = Omit<
  ChannelOperatorSummary,
  | "lastActivityAt"
  | "lastActivityAgentId"
  | "healthSummary"
  | "healthDetail"
  | "healthActions"
  | "healthInstances"
  | "healthUpdatedAt"
> & {
  activity?: ChannelActivityRecord;
  health?: ChannelHealthRecord;
};

function deriveAgentTool(
  loadedConfig: LoadedConfig,
  agentService: AgentService,
  agentId: string,
) {
  const entry = loadedConfig.raw.agents.list.find((item) => item.id === agentId);
  if (entry?.cli) {
    return {
      cliTool: entry.cli,
      startupOptions: entry.runner?.args ?? DEFAULT_AGENT_TOOL_TEMPLATES[entry.cli].startupOptions,
    };
  }

  const resolved = agentService.getResolvedAgentConfig(agentId);

  return {
    cliTool: inferAgentCliToolId(resolved.runner.command) ?? resolved.runner.command,
    startupOptions: resolved.runner.args,
  };
}

async function getRunnerSessions(loadedConfig: LoadedConfig) {
  try {
    return await listRunnerSessions(loadedConfig);
  } catch {
    return [];
  }
}

function buildChannelSummary(params: ChannelSummaryParams) {
  const health = params.enabled ? params.health : undefined;
  return {
    channel: params.channel,
    enabled: params.enabled,
    connection: params.connection,
    defaultAgentId: params.defaultAgentId,
    streaming: params.streaming,
    response: params.response,
    responseMode: params.responseMode,
    additionalMessageMode: params.additionalMessageMode,
    configuredSurfaceCount: params.configuredSurfaceCount,
    directMessagesEnabled: params.directMessagesEnabled,
    directMessagesPolicy: params.directMessagesPolicy,
    sharedDefaultPolicy: params.sharedDefaultPolicy,
    lastActivityAt: params.activity?.updatedAt,
    lastActivityAgentId: params.activity?.agentId,
    healthSummary: deriveHealthSummary({
      channel: params.channel,
      connection: params.connection,
      recordedSummary: health?.summary,
    }),
    healthDetail: health?.detail,
    healthActions: health?.actions ?? [],
    healthInstances: health?.instances ?? [],
    healthUpdatedAt: health?.updatedAt,
  } satisfies ChannelOperatorSummary;
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

  const agentSummaries = loadedConfig.raw.agents.list.map((entry) => {
    const resolved = agentService.getResolvedAgentConfig(entry.id);
    const tool = deriveAgentTool(loadedConfig, agentService, entry.id);
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

  const channelSummaries = listRuntimeSummaryChannelDescriptors().map((descriptor) =>
    buildChannelSummary(
      descriptor.buildInput({
        loadedConfig,
        runtimeRunning: params.runtimeRunning,
        activities,
        runtimeHealth,
      }),
    )
  ) satisfies ChannelOperatorSummary[];

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
    activeRuns: await agentService.listLiveSessionRuntimes(),
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

function deriveHealthSummary(params: {
  channel: SummaryChannelId;
  connection: RuntimeChannelConnection;
  recordedSummary?: string;
}) {
  if (params.recordedSummary) {
    return params.recordedSummary;
  }

  const label = renderChannelLabel(params.channel);
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
