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
import {
  collapseHomePath,
  getDefaultActivityStorePath,
  getDefaultConfigPath,
  getDefaultRuntimeHealthPath,
} from "../shared/paths.ts";
import {
  renderOperatorHelpLines,
  renderPairingSetupHelpLines,
  renderRepoHelpLines,
  renderTmuxDebugHelpLines,
} from "./startup-bootstrap.ts";
import {
  RuntimeHealthStore,
  type ChannelHealthInstance,
  type RuntimeChannelConnection,
} from "./runtime-health-store.ts";

type AgentOperatorSummary = {
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

type ChannelOperatorSummary = {
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
  groupPolicy?: string;
  lastActivityAt?: string;
  lastActivityAgentId?: string;
  healthSummary?: string;
  healthDetail?: string;
  healthActions: string[];
  healthInstances: ChannelHealthInstance[];
  healthUpdatedAt?: string;
};

type RuntimeOperatorSummary = {
  loadedConfig: LoadedConfig;
  ownerSummary: {
    ownerPrincipals: string[];
    adminPrincipals: string[];
    ownerClaimWindowMinutes: number;
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
  const activityStore = new ActivityStore(params.activityPath ?? getDefaultActivityStorePath());
  const activities = await activityStore.read();
  const runtimeHealthStore = new RuntimeHealthStore(
    params.healthPath ?? getDefaultRuntimeHealthPath(),
  );
  const runtimeHealth = await runtimeHealthStore.read();
  const runningTmuxSessions = params.runtimeRunning ? await getRunningTmuxSessions(loadedConfig) : 0;

  const agentSummaries = loadedConfig.raw.agents.list.map((entry) => {
    const resolved = new AgentService(loadedConfig).getResolvedAgentConfig(entry.id);
    const tool = deriveAgentTool(loadedConfig, entry.id);
    const bootstrapState = getBootstrapWorkspaceState(
      resolved.workspacePath,
      entry.bootstrap?.mode,
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
      bootstrapMode: entry.bootstrap?.mode,
      bootstrapState,
      bindings: loadedConfig.raw.bindings
        .filter((binding) => binding.agentId === entry.id)
        .map((binding) => formatBinding(binding.match)),
      lastActivityAt: activities.agents[entry.id]?.updatedAt,
    } satisfies AgentOperatorSummary;
  });

  const slackConnection = deriveChannelConnection({
    enabled: loadedConfig.raw.channels.slack.enabled,
    runtimeRunning: params.runtimeRunning,
    recordedConnection: runtimeHealth.channels.slack?.connection,
  });
  const telegramConnection = deriveChannelConnection({
    enabled: loadedConfig.raw.channels.telegram.enabled,
    runtimeRunning: params.runtimeRunning,
    recordedConnection: runtimeHealth.channels.telegram?.connection,
  });

  const channelSummaries = [
    {
      channel: "slack" as const,
      enabled: loadedConfig.raw.channels.slack.enabled,
      connection: slackConnection,
      defaultAgentId: loadedConfig.raw.channels.slack.defaultAgentId,
      streaming: loadedConfig.raw.channels.slack.streaming,
      response: loadedConfig.raw.channels.slack.response,
      responseMode: loadedConfig.raw.channels.slack.responseMode,
      additionalMessageMode: loadedConfig.raw.channels.slack.additionalMessageMode,
      configuredSurfaceCount: countSlackSurfaces(loadedConfig),
      directMessagesEnabled: loadedConfig.raw.channels.slack.directMessages.enabled,
      directMessagesPolicy: loadedConfig.raw.channels.slack.directMessages.policy,
      groupPolicy: loadedConfig.raw.channels.slack.groupPolicy,
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
      enabled: loadedConfig.raw.channels.telegram.enabled,
      connection: telegramConnection,
      defaultAgentId: loadedConfig.raw.channels.telegram.defaultAgentId,
      streaming: loadedConfig.raw.channels.telegram.streaming,
      response: loadedConfig.raw.channels.telegram.response,
      responseMode: loadedConfig.raw.channels.telegram.responseMode,
      additionalMessageMode: loadedConfig.raw.channels.telegram.additionalMessageMode,
      configuredSurfaceCount: countTelegramSurfaces(loadedConfig),
      directMessagesEnabled: loadedConfig.raw.channels.telegram.directMessages.enabled,
      directMessagesPolicy: loadedConfig.raw.channels.telegram.directMessages.policy,
      groupPolicy: loadedConfig.raw.channels.telegram.groupPolicy,
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

  return {
    loadedConfig,
    ownerSummary: {
      ownerPrincipals: loadedConfig.raw.app.auth.roles.owner?.users ?? [],
      adminPrincipals: loadedConfig.raw.app.auth.roles.admin?.users ?? [],
      ownerClaimWindowMinutes: loadedConfig.raw.app.auth.ownerClaimWindowMinutes,
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
  return await loadConfigWithoutEnvResolution(configPath);
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
      const responseMode = ` responseMode=${agent.responseMode ?? "inherit"}`;
      const additionalMessageMode =
        ` additionalMessageMode=${agent.additionalMessageMode ?? "inherit"}`;
      return `  - ${agent.id} tool=${agent.cliTool} ${bootstrap}${bindings} last=${formatTime(
        agent.lastActivityAt,
      )}${responseMode}${additionalMessageMode}`;
    }),
  ];
}

function renderOwnerSummaryLines(summary: RuntimeOperatorSummary) {
  const ownerPrincipals = summary.ownerSummary.ownerPrincipals;
  const adminPrincipals = summary.ownerSummary.adminPrincipals;
  const configuredOwners = ownerPrincipals.length > 0 ? ownerPrincipals.join(",") : "none";
  const claimWindow = `${summary.ownerSummary.ownerClaimWindowMinutes}m`;
  const lines = [
    "Owner:",
    `  - configured=${ownerPrincipals.length > 0 ? "yes" : "no"} principals=${configuredOwners} claimWindow=${claimWindow}`,
    "  - access=full app control, DM pairing bypass, implicit admin across all agents/channels",
  ];

  if (adminPrincipals.length > 0) {
    lines.push(`  - appAdmins=${adminPrincipals.join(",")}`);
  }

  return lines;
}

function hasConfiguredPrivilegedPrincipal(summary: RuntimeOperatorSummary) {
  return (
    summary.ownerSummary.ownerPrincipals.length > 0 ||
    summary.ownerSummary.adminPrincipals.length > 0
  );
}

function renderPrivilegedChatHint(summary: RuntimeOperatorSummary, action: string) {
  if (hasConfiguredPrivilegedPrincipal(summary)) {
    return `chat with the bot from that owner/admin account to ${action}`;
  }
  return `after you configure an owner/admin principal, use that account to ${action}`;
}

function appendChannelNextStepLines(
  lines: string[],
  summary: RuntimeOperatorSummary,
  prefix = "",
) {
  const slackEnabled = summary.channelSummaries.some((channel) =>
    channel.channel === "slack" && channel.enabled
  );
  const telegramEnabled = summary.channelSummaries.some((channel) =>
    channel.channel === "telegram" && channel.enabled
  );
  const hasEnabledChannel = slackEnabled || telegramEnabled;
  const hasDisabledChannel = summary.channelSummaries.some((channel) => !channel.enabled);

  if (!hasEnabledChannel) {
    lines.push(
      `${prefix}- run \`clisbot channels enable <slack|telegram>\` for the first channel you want to expose`,
    );
    return;
  }

  if (telegramEnabled && slackEnabled) {
    lines.push(
      `${prefix}- DM the Telegram or Slack bot first to confirm it responds normally`,
    );
  } else if (telegramEnabled) {
    lines.push(
      `${prefix}- DM the Telegram bot first to confirm it responds normally`,
    );
  } else {
    lines.push(
      `${prefix}- DM the Slack bot first to confirm it responds normally`,
    );
  }

  if (hasDisabledChannel) {
    lines.push(
      `${prefix}- run \`clisbot channels enable <slack|telegram>\` for any other disabled channel you want to expose`,
    );
  }

  lines.push(
    `${prefix}- after DM works, add the bot to the target Slack channel or Telegram group/topic`,
  );
  lines.push(
    `${prefix}- route that surface with \`clisbot channels add slack-channel <channelId> --agent <id>\` or \`clisbot channels add telegram-group <chatId> --agent <id>\``,
  );

  if (telegramEnabled) {
    lines.push(
      `${prefix}- Telegram: send \`/start\` in the target DM, group, or topic to get onboarding or pairing guidance`,
    );
  }

  if (slackEnabled) {
    lines.push(
      `${prefix}- Slack: mention \`@<botname> \\start\` in the target channel to verify mention flow`,
    );
  }
}

function appendAuthOnboardingLines(
  lines: string[],
  summary: RuntimeOperatorSummary,
  prefix = "",
) {
  lines.push(`${prefix}Auth onboarding:`);

  if (!hasConfiguredPrivilegedPrincipal(summary)) {
    lines.push(
      `${prefix}  - get the principal from a surface the bot can already see; Telegram groups or topics can use \`/whoami\` before routing, while DMs with pairing must pair first`,
    );
    lines.push(
      `${prefix}  - set the first owner with: \`clisbot auth add-user app --role owner --user <principal>\``,
    );
  } else {
    lines.push(`${prefix}  - inspect current app roles with: \`clisbot auth show app\``);
  }

  lines.push(
    `${prefix}  - inspect default agent roles with: \`clisbot auth show agent-defaults\``,
  );
  lines.push(
    `${prefix}  - add or remove principals with: \`clisbot auth add-user ...\` and \`clisbot auth remove-user ...\``,
  );
  lines.push(
    `${prefix}  - tune role permissions with: \`clisbot auth add-permission ...\` and \`clisbot auth remove-permission ...\``,
  );
  lines.push(
    `${prefix}  - run \`clisbot auth --help\` or read docs/user-guide/auth-and-roles.md for scopes and permission names`,
  );
}

function renderChannelSummaryLines(summary: RuntimeOperatorSummary) {
  return [
    "",
    "Channels:",
    ...summary.channelSummaries.map((channel) => {
      if (!channel.enabled) {
        return `  - ${channel.channel} enabled=no`;
      }
      const last = channel.lastActivityAt
        ? ` last=${formatTime(channel.lastActivityAt)} via ${channel.lastActivityAgentId ?? "unknown"}`
        : " last=never";
      const dm = ` dm=${channel.directMessagesEnabled ? channel.directMessagesPolicy : "disabled"}`;
      const group = channel.groupPolicy ? ` groups=${channel.groupPolicy}` : "";
      const render =
        ` streaming=${channel.streaming} response=${channel.response} responseMode=${channel.responseMode} additionalMessageMode=${channel.additionalMessageMode}`;
      const routeHint =
        channel.configuredSurfaceCount === 0
          ? " routes=none"
          : ` routes=${channel.configuredSurfaceCount}`;
      return `  - ${channel.channel} enabled=${channel.enabled ? "yes" : "no"} connection=${channel.connection} defaultAgent=${channel.defaultAgentId}${render}${dm}${group}${routeHint}${last}`;
    }),
  ];
}

function renderChannelDiagnosticLines(summary: RuntimeOperatorSummary) {
  const channelsNeedingDiagnostics = summary.channelSummaries.filter((channel) =>
    Boolean(channel.healthSummary) ||
    channel.healthActions.length > 0 ||
    Boolean(channel.healthDetail) ||
    channel.healthInstances.length > 0
  );
  if (channelsNeedingDiagnostics.length === 0) {
    return [];
  }

  return [
    "",
    "Channel health:",
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
      if (channel.healthInstances.length > 0) {
        lines.push(
          `    instances: ${channel.healthInstances.map((instance) => formatHealthInstance(instance)).join("; ")}`,
        );
      }
      for (const action of channel.healthActions) {
        lines.push(`    action: ${action}`);
      }
      return lines;
    }),
  ];
}

function formatHealthInstance(instance: ChannelHealthInstance) {
  const parts = [instance.accountId];
  if (instance.label) {
    parts.push(instance.label);
  }
  if (instance.appLabel) {
    parts.push(instance.appLabel);
  }
  if (instance.tokenHint) {
    parts.push(`token#${instance.tokenHint}`);
  }
  return parts.join(" ");
}

export function renderRuntimeDiagnosticsSummary(summary: RuntimeOperatorSummary) {
  return renderChannelDiagnosticLines(summary).join("\n").trim();
}

export function renderStartSummary(summary: RuntimeOperatorSummary) {
  const lines = [
    ...renderOwnerSummaryLines(summary),
    "",
    ...renderAgentSummaryLines(summary),
    ...renderChannelSummaryLines(summary),
  ];

  if (summary.agentSummaries.length === 0) {
    lines.push("");
    lines.push("Guidance:");
    lines.push("  No agents are configured yet.");
    lines.push("  First run requires both `--cli` and `--bot-type`.");
    lines.push("  personal = one assistant for one human.");
    lines.push("  team = one shared assistant for a team or channel.");
    lines.push("  Example: clisbot start --cli codex --bot-type personal");
    lines.push("  Example: clisbot start --cli codex --bot-type team");
    lines.push("  Manual setup is still available with `clisbot agents add ...`.");
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
          `    run: clisbot agents bootstrap ${agent.id} --mode ${agent.bootstrapMode}`,
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
    appendChannelNextStepLines(lines, summary, "  ");
    lines.push(
      `  - ${renderPrivilegedChatHint(summary, "verify DM access and adjust in-chat settings")}`,
    );
    lines.push("");
    appendAuthOnboardingLines(lines, summary, "  ");
    lines.push("  - run `clisbot status` to recheck runtime and bootstrap state");
    lines.push("  - run `clisbot logs` if the bot does not answer as expected");
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
  appendChannelNextStepLines(lines, summary, "  ");
  lines.push("  - verify routes and defaultAgentId values match the agent you want to expose");
  lines.push(
    `  - ${renderPrivilegedChatHint(summary, "adjust in-chat surface settings")}`,
  );
  lines.push("");
  appendAuthOnboardingLines(lines, summary);
  lines.push("  - run `clisbot status` to inspect agents, channels, and tmux session state");
  lines.push("  - run `clisbot logs` if anything looks wrong");
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
        `${prefix}    add group: \`clisbot channels add telegram-group <chatId> --agent <id>\``,
      );
      lines.push(
        `${prefix}    add topic: \`clisbot channels add telegram-group <chatId> --topic <topicId> --agent <id>\``,
      );
      lines.push(
        `${prefix}    adjust later: ${renderPrivilegedChatHint(summary, "run in-chat commands here")}`,
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
      `${prefix}    add channel: \`clisbot channels add slack-channel <channelId> --agent <id>\``,
    );
    lines.push(
      `${prefix}    add group: \`clisbot channels add slack-group <groupId> --agent <id>\``,
    );
    lines.push(
      `${prefix}    adjust later: ${renderPrivilegedChatHint(summary, "run in-chat commands here")}`,
    );
  }
}

export function renderStatusSummary(summary: RuntimeOperatorSummary) {
  const lines = [
    `stats agents=${summary.configuredAgents} bootstrapped=${summary.bootstrappedAgents} pendingBootstrap=${summary.bootstrapPendingAgents} tmuxSessions=${summary.runningTmuxSessions}`,
    ...renderOwnerSummaryLines(summary),
    "",
    ...renderAgentSummaryLines(summary),
    ...renderChannelSummaryLines(summary),
    ...renderChannelDiagnosticLines(summary),
    ...renderActiveRunSummaryLines(summary),
  ];

  appendChannelSetupNotes(lines, summary);

  return lines.join("\n");
}
