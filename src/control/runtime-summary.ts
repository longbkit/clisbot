import { AgentService } from "../agents/agent-service.ts";
import {
  getBootstrapWorkspaceState,
  type BootstrapWorkspaceState,
} from "../agents/bootstrap.ts";
import { type LoadedConfig, loadConfig } from "../config/load-config.ts";
import { formatBinding } from "../config/bindings.ts";
import {
  DEFAULT_AGENT_TOOL_TEMPLATES,
  inferAgentCliToolId,
} from "../config/agent-tool-presets.ts";
import { ActivityStore } from "./activity-store.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { DEFAULT_ACTIVITY_STORE_PATH } from "../shared/paths.ts";
import { renderOperatorHelpLines, renderRepoHelpLines } from "./startup-bootstrap.ts";

type AgentOperatorSummary = {
  id: string;
  cliTool: string;
  workspacePath: string;
  startupOptions: string[];
  bootstrapMode?: string;
  bootstrapState: BootstrapWorkspaceState;
  bindings: string[];
  lastActivityAt?: string;
  lastActivitySurface?: string;
};

type ChannelOperatorSummary = {
  channel: "slack" | "telegram";
  enabled: boolean;
  connection: "disabled" | "stopped" | "active";
  defaultAgentId: string;
  configuredSurfaceCount: number;
  directMessagesEnabled: boolean;
  directMessagesPolicy: string;
  groupPolicy?: string;
  lastActivityAt?: string;
  lastActivitySurface?: string;
  lastActivityAgentId?: string;
};

type RuntimeOperatorSummary = {
  loadedConfig: LoadedConfig;
  agentSummaries: AgentOperatorSummary[];
  channelSummaries: ChannelOperatorSummary[];
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
}) {
  const loadedConfig = await loadConfig(params.configPath);
  const activityStore = new ActivityStore(params.activityPath ?? DEFAULT_ACTIVITY_STORE_PATH);
  const activities = await activityStore.read();
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
      lastActivitySurface: activities.agents[entry.id]?.surface,
    } satisfies AgentOperatorSummary;
  });

  const channelSummaries = [
    {
      channel: "slack" as const,
      enabled: loadedConfig.raw.channels.slack.enabled,
      connection: !loadedConfig.raw.channels.slack.enabled
        ? "disabled"
        : params.runtimeRunning
          ? "active"
          : "stopped",
      defaultAgentId: loadedConfig.raw.channels.slack.defaultAgentId,
      configuredSurfaceCount: countSlackSurfaces(loadedConfig),
      directMessagesEnabled: loadedConfig.raw.channels.slack.directMessages.enabled,
      directMessagesPolicy: loadedConfig.raw.channels.slack.directMessages.policy,
      groupPolicy: loadedConfig.raw.channels.slack.groupPolicy,
      lastActivityAt: activities.channels.slack?.updatedAt,
      lastActivitySurface: activities.channels.slack?.surface,
      lastActivityAgentId: activities.channels.slack?.agentId,
    },
    {
      channel: "telegram" as const,
      enabled: loadedConfig.raw.channels.telegram.enabled,
      connection: !loadedConfig.raw.channels.telegram.enabled
        ? "disabled"
        : params.runtimeRunning
          ? "active"
          : "stopped",
      defaultAgentId: loadedConfig.raw.channels.telegram.defaultAgentId,
      configuredSurfaceCount: countTelegramSurfaces(loadedConfig),
      directMessagesEnabled: loadedConfig.raw.channels.telegram.directMessages.enabled,
      directMessagesPolicy: loadedConfig.raw.channels.telegram.directMessages.policy,
      groupPolicy: loadedConfig.raw.channels.telegram.groupPolicy,
      lastActivityAt: activities.channels.telegram?.updatedAt,
      lastActivitySurface: activities.channels.telegram?.surface,
      lastActivityAgentId: activities.channels.telegram?.agentId,
    },
  ] satisfies ChannelOperatorSummary[];

  return {
    loadedConfig,
    agentSummaries,
    channelSummaries,
    configuredAgents: agentSummaries.length,
    bootstrapPendingAgents: agentSummaries.filter((item) =>
      item.bootstrapState === "missing" || item.bootstrapState === "not-bootstrapped"
    ).length,
    bootstrappedAgents: agentSummaries.filter((item) => item.bootstrapState === "bootstrapped")
      .length,
    runningTmuxSessions,
  } satisfies RuntimeOperatorSummary;
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

export function renderStartSummary(summary: RuntimeOperatorSummary) {
  const lines = [
    ...renderAgentSummaryLines(summary),
    ...renderChannelSummaryLines(summary),
  ];

  if (summary.agentSummaries.length === 0) {
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
      "  Bootstrap files will be seeded in the agent workspace. Review BOOTSTRAP.md, SOUL.md, USER.md, and IDENTITY.md.",
    );
    return lines.join("\n");
  }

  const pendingBootstrap = summary.agentSummaries.filter(
    (agent) => agent.bootstrapState === "missing" || agent.bootstrapState === "not-bootstrapped",
  );
  if (pendingBootstrap.length > 0) {
    lines.push("Guidance:");
    for (const agent of pendingBootstrap) {
      if (agent.bootstrapState === "missing") {
        lines.push(
          `  Agent ${agent.id} is missing bootstrap files in ${agent.workspacePath}. Run: muxbot agents bootstrap ${agent.id} --mode ${agent.bootstrapMode}`,
        );
        continue;
      }

      lines.push(
        `  Agent ${agent.id} still needs bootstrap completion in ${agent.workspacePath}. Chat with the bot or open the workspace, then follow BOOTSTRAP.md and the ${agent.bootstrapMode} personality files.`,
      );
    }

    lines.push("  Next steps after bootstrap:");
    lines.push("  - chat with the bot or open the workspace, then follow BOOTSTRAP.md");
    lines.push("  - configure Slack channels or Telegram groups/topics in ~/.muxbot/muxbot.json");
    lines.push("  - run `muxbot status` to recheck runtime and bootstrap state");
    lines.push("  - run `muxbot logs` if the bot does not answer as expected");
    lines.push(...renderRepoHelpLines("  - "));
    appendChannelSetupNotes(lines, summary, "  ");
    return lines.join("\n");
  }

  lines.push("Next steps:");
  lines.push("  - configure Slack channels or Telegram groups/topics in ~/.muxbot/muxbot.json");
  lines.push("  - verify routing and defaultAgentId values match the agent you want to expose");
  lines.push("  - send a test message from Slack or Telegram");
  lines.push("  - run `muxbot status` to inspect agents, channels, and tmux session state");
  lines.push("  - run `muxbot logs` if anything looks wrong");
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

  lines.push(`${prefix}Channel setup notes:`);
  for (const channel of channelsNeedingRoutes) {
    if (channel.channel === "telegram") {
      lines.push(
        `${prefix}  - telegram: no explicit group or topic routes are configured yet. Telegram DMs are ${channel.directMessagesEnabled ? `enabled (${channel.directMessagesPolicy})` : "disabled"}, but a Telegram group will not route to the bot until you add channels.telegram.groups.<chatId> in ~/.muxbot/muxbot.json.`,
      );
      lines.push(
        `${prefix}    Example: add channels.telegram.groups."-1001234567890".agentId = "default" for a normal group, or use channels.telegram.groups.<chatId>.topics.<topicId> for forum topics.`,
      );
      continue;
    }

    lines.push(
      `${prefix}  - slack: no explicit channel or group routes are configured yet. Direct messages are ${channel.directMessagesEnabled ? `enabled (${channel.directMessagesPolicy})` : "disabled"}, and group routing is ${channel.groupPolicy}. Configure channels.slack.channels.<channelId> or channels.slack.groups.<groupId> in ~/.muxbot/muxbot.json if you expect channel traffic.`,
    );
  }
}

export function renderStatusSummary(summary: RuntimeOperatorSummary) {
  const lines = [
    `stats agents=${summary.configuredAgents} bootstrapped=${summary.bootstrappedAgents} pendingBootstrap=${summary.bootstrapPendingAgents} tmuxSessions=${summary.runningTmuxSessions}`,
    ...renderAgentSummaryLines(summary),
    ...renderChannelSummaryLines(summary),
  ];

  appendChannelSetupNotes(lines, summary);

  return lines.join("\n");
}
