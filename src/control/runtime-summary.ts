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
import { formatBinding } from "../config/bindings.ts";
import {
  DEFAULT_AGENT_TOOL_TEMPLATES,
  inferAgentCliToolId,
} from "../config/agent-tool-presets.ts";
import { ActivityStore } from "./activity-store.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { DEFAULT_ACTIVITY_STORE_PATH, DEFAULT_RUNTIME_HEALTH_PATH } from "../shared/paths.ts";
import {
  renderOperatorHelpLines,
  renderPairingSetupHelpLines,
  renderRepoHelpLines,
  renderTmuxDebugHelpLines,
} from "./startup-bootstrap.ts";
import { RuntimeHealthStore, type RuntimeChannelConnection } from "./runtime-health-store.ts";

type AgentOperatorSummary = {
  id: string;
  cliTool: string;
  workspacePath: string;
  startupOptions: string[];
  bootstrapMode?: string;
  bootstrapState: BootstrapWorkspaceState;
  bindings: string[];
  lastActivityAt?: string;
};

type ChannelOperatorSummary = {
  channel: "slack" | "telegram";
  enabled: boolean;
  connection: RuntimeChannelConnection;
  defaultAgentId: string;
  configuredSurfaceCount: number;
  directMessagesEnabled: boolean;
  directMessagesPolicy: string;
  groupPolicy?: string;
  lastActivityAt?: string;
  lastActivityAgentId?: string;
  healthSummary?: string;
  healthDetail?: string;
  healthActions: string[];
  healthUpdatedAt?: string;
};

type RuntimeOperatorSummary = {
  loadedConfig: LoadedConfig;
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
};

function deriveAgentTool(
  loadedConfig: LoadedConfig,
  agentId: string,
) {
  const entry = loadedConfig.raw.agents.list.find((item) => item.id === agentId);
  if (entry?.cliTool) {
    return {
      cliTool: entry.cliTool,
      startupOptions:
        entry.startupOptions ??
        DEFAULT_AGENT_TOOL_TEMPLATES[entry.cliTool]?.startupOptions ??
        [],
    };
  }

  const resolved = new AgentService(loadedConfig).getResolvedAgentConfig(agentId);
  return {
    cliTool: inferAgentCliToolId(resolved.runner.command) ?? resolved.runner.command,
    startupOptions: resolved.runner.args,
  };
}

function countTelegramSurfaces(loadedConfig: LoadedConfig) {
  return Object.values(loadedConfig.raw.channels.telegram.groups).reduce((total, group) => {
    return total + 1 + Object.keys(group.topics ?? {}).length;
  }, 0);
}

function countSlackSurfaces(loadedConfig: LoadedConfig) {
  return (
    Object.keys(loadedConfig.raw.channels.slack.channels).length +
    Object.keys(loadedConfig.raw.channels.slack.groups).length
  );
}

async function getRunningTmuxSessions(loadedConfig: LoadedConfig) {
  const tmux = new TmuxClient(loadedConfig.raw.tmux.socketPath);
  try {
    const sessions = await tmux.listSessions();
    return sessions.length;
  } catch {
    return 0;
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
  const activityStore = new ActivityStore(params.activityPath ?? DEFAULT_ACTIVITY_STORE_PATH);
  const activities = await activityStore.read();
  const runtimeHealthStore = new RuntimeHealthStore(params.healthPath ?? DEFAULT_RUNTIME_HEALTH_PATH);
  const runtimeHealth = await runtimeHealthStore.read();
  const runningTmuxSessions = params.runtimeRunning ? await getRunningTmuxSessions(loadedConfig) : 0;

  const agentSummaries = loadedConfig.raw.agents.list.map((entry) => {
    const resolved = new AgentService(loadedConfig).getResolvedAgentConfig(entry.id);
    const tool = deriveAgentTool(loadedConfig, entry.id);
    const bootstrapState = getBootstrapWorkspaceState(
      resolved.workspacePath,
      entry.bootstrap?.mode,
      tool.cliTool === "codex" || tool.cliTool === "claude" ? tool.cliTool : undefined,
    );

    return {
      id: entry.id,
      cliTool: tool.cliTool,
      workspacePath: resolved.workspacePath,
      startupOptions: tool.startupOptions,
      bootstrapMode: entry.bootstrap?.mode,
      bootstrapState,
      bindings: loadedConfig.raw.bindings
        .filter((binding) => binding.agentId === entry.id)
        .map((binding) => formatBinding(binding.match)),
      lastActivityAt: activities.agents[entry.id]?.updatedAt,
    } satisfies AgentOperatorSummary;
  });

  const channelSummaries = [
    {
      channel: "slack" as const,
      enabled: loadedConfig.raw.channels.slack.enabled,
      connection: deriveChannelConnection({
        enabled: loadedConfig.raw.channels.slack.enabled,
        runtimeRunning: params.runtimeRunning,
        recordedConnection: runtimeHealth.channels.slack?.connection,
      }),
      defaultAgentId: loadedConfig.raw.channels.slack.defaultAgentId,
      configuredSurfaceCount: countSlackSurfaces(loadedConfig),
      directMessagesEnabled: loadedConfig.raw.channels.slack.directMessages.enabled,
      directMessagesPolicy: loadedConfig.raw.channels.slack.directMessages.policy,
      groupPolicy: loadedConfig.raw.channels.slack.groupPolicy,
      lastActivityAt: activities.channels.slack?.updatedAt,
      lastActivityAgentId: activities.channels.slack?.agentId,
      healthSummary: runtimeHealth.channels.slack?.summary,
      healthDetail: runtimeHealth.channels.slack?.detail,
      healthActions: runtimeHealth.channels.slack?.actions ?? [],
      healthUpdatedAt: runtimeHealth.channels.slack?.updatedAt,
    },
    {
      channel: "telegram" as const,
      enabled: loadedConfig.raw.channels.telegram.enabled,
      connection: deriveChannelConnection({
        enabled: loadedConfig.raw.channels.telegram.enabled,
        runtimeRunning: params.runtimeRunning,
        recordedConnection: runtimeHealth.channels.telegram?.connection,
      }),
      defaultAgentId: loadedConfig.raw.channels.telegram.defaultAgentId,
      configuredSurfaceCount: countTelegramSurfaces(loadedConfig),
      directMessagesEnabled: loadedConfig.raw.channels.telegram.directMessages.enabled,
      directMessagesPolicy: loadedConfig.raw.channels.telegram.directMessages.policy,
      groupPolicy: loadedConfig.raw.channels.telegram.groupPolicy,
      lastActivityAt: activities.channels.telegram?.updatedAt,
      lastActivityAgentId: activities.channels.telegram?.agentId,
      healthSummary: runtimeHealth.channels.telegram?.summary,
      healthDetail: runtimeHealth.channels.telegram?.detail,
      healthActions: runtimeHealth.channels.telegram?.actions ?? [],
      healthUpdatedAt: runtimeHealth.channels.telegram?.updatedAt,
    },
  ] satisfies ChannelOperatorSummary[];

  return {
    loadedConfig,
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

function renderActiveRunSummaryLines(summary: RuntimeOperatorSummary) {
  if (summary.activeRuns.length === 0) {
    return [
      "",
      "Active runs:",
      "  none",
    ];
  }

  return [
    "",
    "Active runs:",
    ...summary.activeRuns.map((run) => {
      const startedAt = run.startedAt ? new Date(run.startedAt).toISOString() : "unknown";
      const detachedAt = run.detachedAt ? ` detachedAt=${new Date(run.detachedAt).toISOString()}` : "";
      return `  - agent=${run.agentId} state=${run.state} startedAt=${startedAt}${detachedAt} sessionKey=${run.sessionKey}`;
    }),
  ];
}

async function loadOperatorSummaryConfig(configPath?: string) {
  try {
    return await loadConfig(configPath);
  } catch (error) {
    if (!(error instanceof MissingEnvVarError)) {
      throw error;
    }

    return await loadConfigWithoutEnvResolution(configPath);
  }
}

function formatTime(value?: string) {
  if (!value) {
    return "never";
  }
  return new Date(value).toISOString();
}

function renderAgentSummaryLines(summary: RuntimeOperatorSummary) {
  if (summary.agentSummaries.length === 0) {
    return ["Agents:", "  none configured"];
  }

  return [
    "Agents:",
    ...summary.agentSummaries.map((agent) => {
      const bootstrap =
        agent.bootstrapMode == null
          ? "bootstrap=not-configured"
          : `bootstrap=${agent.bootstrapMode}:${agent.bootstrapState}`;
      const bindings = agent.bindings.length ? ` bindings=${agent.bindings.join(",")}` : "";
      return `  - ${agent.id} tool=${agent.cliTool} ${bootstrap}${bindings} last=${formatTime(
        agent.lastActivityAt,
      )}`;
    }),
  ];
}

function renderChannelSummaryLines(summary: RuntimeOperatorSummary) {
  return [
    "",
    "Channels:",
    ...summary.channelSummaries.map((channel) => {
      const last = channel.lastActivityAt
        ? ` last=${formatTime(channel.lastActivityAt)} via ${channel.lastActivityAgentId ?? "unknown"}`
        : " last=never";
      const dm = ` dm=${channel.directMessagesEnabled ? channel.directMessagesPolicy : "disabled"}`;
      const group = channel.groupPolicy ? ` groups=${channel.groupPolicy}` : "";
      const routeHint =
        channel.configuredSurfaceCount === 0
          ? " routes=none"
          : ` routes=${channel.configuredSurfaceCount}`;
      return `  - ${channel.channel} enabled=${channel.enabled ? "yes" : "no"} connection=${channel.connection} defaultAgent=${channel.defaultAgentId}${dm}${group}${routeHint}${last}`;
    }),
  ];
}

function renderChannelDiagnosticLines(summary: RuntimeOperatorSummary) {
  const channelsNeedingDiagnostics = summary.channelSummaries.filter((channel) =>
    channel.connection === "failed" || channel.healthActions.length > 0
  );
  if (channelsNeedingDiagnostics.length === 0) {
    return [];
  }

  return [
    "",
    "Channel diagnostics:",
    ...channelsNeedingDiagnostics.flatMap((channel) => {
      const lines = [
        `  - ${channel.channel}: ${channel.healthSummary ?? "channel diagnostics available"}`,
      ];
      if (channel.healthUpdatedAt) {
        lines.push(`    updated: ${formatTime(channel.healthUpdatedAt)}`);
      }
      if (channel.healthDetail) {
        lines.push(`    detail: ${channel.healthDetail}`);
      }
      for (const action of channel.healthActions) {
        lines.push(`    action: ${action}`);
      }
      return lines;
    }),
  ];
}

export function renderRuntimeDiagnosticsSummary(summary: RuntimeOperatorSummary) {
  return renderChannelDiagnosticLines(summary).join("\n").trim();
}

export function renderStartSummary(summary: RuntimeOperatorSummary) {
  const lines = [
    ...renderAgentSummaryLines(summary),
    ...renderChannelSummaryLines(summary),
  ];

  if (summary.agentSummaries.length === 0) {
    lines.push("");
    lines.push("Guidance:");
    lines.push("  No agents are configured yet.");
    lines.push("  First run requires both `--cli` and `--bootstrap`.");
    lines.push("  personal-assistant = one assistant for one human.");
    lines.push("  team-assistant = one shared assistant for a team or channel.");
    lines.push("  Example: muxbot start --cli codex --bootstrap personal-assistant");
    lines.push("  Example: muxbot start --cli codex --bootstrap team-assistant");
    lines.push("  Manual setup is still available with `muxbot agents add ...`.");
    lines.push(...renderOperatorHelpLines("  "));
    lines.push(
      "  Bootstrap files will be seeded in the agent workspace. Review BOOTSTRAP.md, SOUL.md, USER.md, IDENTITY.md, and MEMORY.md.",
    );
    return lines.join("\n");
  }

  const pendingBootstrap = summary.agentSummaries.filter(
    (agent) => agent.bootstrapState === "missing" || agent.bootstrapState === "not-bootstrapped",
  );
  if (pendingBootstrap.length > 0) {
    lines.push("");
    lines.push("Guidance:");
    for (const agent of pendingBootstrap) {
      if (agent.bootstrapState === "missing") {
        lines.push(`  Agent ${agent.id} is missing bootstrap files.`);
        lines.push(`    workspace: ${agent.workspacePath}`);
        lines.push(
          `    run: muxbot agents bootstrap ${agent.id} --mode ${agent.bootstrapMode}`,
        );
        continue;
      }

      lines.push(`  Agent ${agent.id} still needs bootstrap completion.`);
      lines.push(`    workspace: ${agent.workspacePath}`);
      lines.push("    next: chat with the bot or open the workspace");
      lines.push(`    follow: BOOTSTRAP.md and the ${agent.bootstrapMode} personality files`);
    }

    lines.push("");
    lines.push("  Next steps after bootstrap:");
    lines.push("  - chat with the bot or open the workspace, then follow BOOTSTRAP.md");
    lines.push("  - configure Slack channels or Telegram groups/topics in ~/.muxbot/muxbot.json");
    lines.push("  - run `muxbot status` to recheck runtime and bootstrap state");
    lines.push("  - run `muxbot logs` if the bot does not answer as expected");
    lines.push(
      ...renderPairingSetupHelpLines("  ", {
        slackEnabled: summary.channelSummaries.some((channel) => channel.channel === "slack" && channel.enabled),
        telegramEnabled: summary.channelSummaries.some((channel) =>
          channel.channel === "telegram" && channel.enabled
        ),
        slackDirectMessagesPolicy: summary.channelSummaries.find((channel) => channel.channel === "slack")
          ?.directMessagesPolicy,
        telegramDirectMessagesPolicy: summary.channelSummaries.find((channel) => channel.channel === "telegram")
          ?.directMessagesPolicy,
        conditionalOnly: true,
      }),
    );
    lines.push(...renderTmuxDebugHelpLines("  "));
    lines.push(...renderRepoHelpLines("  - "));
    appendChannelSetupNotes(lines, summary, "  ");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Next steps:");
  lines.push("  - configure Slack channels or Telegram groups/topics in ~/.muxbot/muxbot.json");
  lines.push("  - verify routing and defaultAgentId values match the agent you want to expose");
  lines.push("  - send a test message from Slack or Telegram");
  lines.push("  - run `muxbot status` to inspect agents, channels, and tmux session state");
  lines.push("  - run `muxbot logs` if anything looks wrong");
  lines.push(
    ...renderPairingSetupHelpLines("", {
      slackEnabled: summary.channelSummaries.some((channel) => channel.channel === "slack" && channel.enabled),
      telegramEnabled: summary.channelSummaries.some((channel) => channel.channel === "telegram" && channel.enabled),
      slackDirectMessagesPolicy: summary.channelSummaries.find((channel) => channel.channel === "slack")
        ?.directMessagesPolicy,
      telegramDirectMessagesPolicy: summary.channelSummaries.find((channel) => channel.channel === "telegram")
        ?.directMessagesPolicy,
      conditionalOnly: true,
    }),
  );
  lines.push(...renderTmuxDebugHelpLines());
  lines.push(...renderRepoHelpLines("  - "));

  appendChannelSetupNotes(lines, summary);

  return lines.join("\n");
}

function appendChannelSetupNotes(
  lines: string[],
  summary: RuntimeOperatorSummary,
  prefix = "",
) {
  const channelsNeedingRoutes = summary.channelSummaries.filter((channel) =>
    channel.enabled && channel.configuredSurfaceCount === 0
  );
  if (channelsNeedingRoutes.length === 0) {
    return;
  }

  lines.push("");
  lines.push(`${prefix}Channel setup notes:`);
  for (const channel of channelsNeedingRoutes) {
    if (channel.channel === "telegram") {
      lines.push(
        `${prefix}  - telegram: no explicit group or topic routes are configured yet`,
      );
      lines.push(
        `${prefix}    dms: ${channel.directMessagesEnabled ? `enabled (${channel.directMessagesPolicy})` : "disabled"}`,
      );
      lines.push(
        `${prefix}    route: add channels.telegram.groups.<chatId> in ~/.muxbot/muxbot.json`,
      );
      lines.push(
        `${prefix}    example: channels.telegram.groups."-1001234567890".agentId = "default"`,
      );
      lines.push(
        `${prefix}    forum topics: use channels.telegram.groups.<chatId>.topics.<topicId>`,
      );
      continue;
    }

    lines.push(
      `${prefix}  - slack: no explicit channel or group routes are configured yet`,
    );
    lines.push(
      `${prefix}    dms: ${channel.directMessagesEnabled ? `enabled (${channel.directMessagesPolicy})` : "disabled"}`,
    );
    lines.push(
      `${prefix}    groups: ${channel.groupPolicy ?? "n/a"}`,
    );
    lines.push(
      `${prefix}    route: configure channels.slack.channels.<channelId> or channels.slack.groups.<groupId>`,
    );
  }
}

export function renderStatusSummary(summary: RuntimeOperatorSummary) {
  const lines = [
    `stats agents=${summary.configuredAgents} bootstrapped=${summary.bootstrappedAgents} pendingBootstrap=${summary.bootstrapPendingAgents} tmuxSessions=${summary.runningTmuxSessions}`,
    ...renderAgentSummaryLines(summary),
    ...renderChannelSummaryLines(summary),
    ...renderChannelDiagnosticLines(summary),
    ...renderActiveRunSummaryLines(summary),
  ];

  appendChannelSetupNotes(lines, summary);

  return lines.join("\n");
}
