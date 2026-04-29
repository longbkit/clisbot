import type {
  AgentOperatorSummary,
  ChannelOperatorSummary,
  RuntimeOperatorSummary,
} from "./runtime-summary.ts";
import {
  renderPairingSetupHelpLines,
  renderOperatorHelpLines,
  renderRepoHelpLines,
  renderTmuxDebugHelpLines,
} from "./startup-bootstrap.ts";
import type { ChannelHealthInstance } from "./runtime-health-store.ts";
import { renderCliCommand } from "../shared/cli-name.ts";

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
    ...summary.agentSummaries.map((agent) => renderAgentSummaryLine(agent)),
  ];
}

function renderAgentSummaryLine(agent: AgentOperatorSummary) {
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

function renderTimezoneSummaryLines(summary: RuntimeOperatorSummary) {
  return [
    "Timezone:",
    `  - effective=${summary.timezoneSummary.effective} source=${summary.timezoneSummary.source} app=${summary.timezoneSummary.appTimezone ?? "(unset)"}`,
    `  - change app default with ${renderCliCommand("timezone set <iana-timezone>", { inline: true })}; use agent/route timezone only for scoped overrides`,
  ];
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

  if (!hasEnabledChannel) {
    lines.push(
      `${prefix}- run ${renderCliCommand("bots add --channel <slack|telegram> ...", { inline: true })} for the first provider bot you want to expose`,
    );
    return;
  }

  if (telegramEnabled && slackEnabled) {
    lines.push(`${prefix}- DM the Telegram or Slack bot first to confirm it responds normally`);
  } else if (telegramEnabled) {
    lines.push(`${prefix}- DM the Telegram bot first to confirm it responds normally`);
  } else {
    lines.push(`${prefix}- DM the Slack bot first to confirm it responds normally`);
  }

  lines.push(
    `${prefix}- after DM works, add the bot to the target Slack channel or Telegram group/topic`,
  );
  lines.push(
    `${prefix}- add the route with ${renderCliCommand("routes add --channel slack group:<channelId> --bot default", { inline: true })} or ${renderCliCommand("routes add --channel telegram group:<chatId> --bot default", { inline: true })}`,
  );
  lines.push(
    `${prefix}- bind the agent with ${renderCliCommand("routes set-agent --channel slack group:<channelId> --bot default --agent <id>", { inline: true })} or ${renderCliCommand("routes set-agent --channel telegram group:<chatId> --bot default --agent <id>", { inline: true })}`,
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
      `${prefix}  - if no owner exists yet, the first DM user during the first ${summary.ownerSummary.ownerClaimWindowMinutes} minutes becomes app owner automatically`,
    );
    lines.push(
      `${prefix}  - after the first owner exists, add more principals with: ${renderCliCommand("auth add-user app --role <owner|admin> --user <principal>", { inline: true })}`,
    );
  } else {
    lines.push(`${prefix}  - inspect current app roles with: ${renderCliCommand("auth show app", { inline: true })}`);
  }

  lines.push(`${prefix}  - inspect default agent roles with: ${renderCliCommand("auth show agent-defaults", { inline: true })}`);
  lines.push(
    `${prefix}  - add or remove principals with: ${renderCliCommand("auth add-user ...", { inline: true })} and ${renderCliCommand("auth remove-user ...", { inline: true })}`,
  );
  lines.push(
    `${prefix}  - tune role permissions with: ${renderCliCommand("auth add-permission ...", { inline: true })} and ${renderCliCommand("auth remove-permission ...", { inline: true })}`,
  );
  lines.push(
    `${prefix}  - run ${renderCliCommand("auth --help", { inline: true })} or read docs/user-guide/auth-and-roles.md for scopes and permission names`,
  );
}

function renderChannelSummaryLines(summary: RuntimeOperatorSummary) {
  return [
    "",
    "Channels:",
    ...summary.channelSummaries.map((channel) => renderChannelSummaryLine(channel)),
  ];
}

function renderChannelSummaryLine(channel: ChannelOperatorSummary) {
  if (!channel.enabled) {
    return `  - ${channel.channel} enabled=no`;
  }
  const last = channel.lastActivityAt
    ? ` last=${formatTime(channel.lastActivityAt)} via ${channel.lastActivityAgentId ?? "unknown"}`
    : " last=never";
  const dm = ` dm=${channel.directMessagesEnabled ? channel.directMessagesPolicy : "disabled"}`;
  const sharedDefault = channel.sharedDefaultPolicy
    ? ` sharedDefault=${channel.sharedDefaultPolicy}`
    : "";
  const render =
    ` streaming=${channel.streaming} response=${channel.response} responseMode=${channel.responseMode} additionalMessageMode=${channel.additionalMessageMode}`;
  const routeHint =
    channel.configuredSurfaceCount === 0
      ? " routes=none"
      : ` routes=${channel.configuredSurfaceCount}`;
  return `  - ${channel.channel} enabled=${channel.enabled ? "yes" : "no"} connection=${channel.connection} defaultAgent=${channel.defaultAgentId}${render}${dm}${sharedDefault}${routeHint}${last}`;
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
    ...channelsNeedingDiagnostics.flatMap((channel) => renderChannelDiagnosticLinesForChannel(channel)),
  ];
}

function renderChannelDiagnosticLinesForChannel(channel: ChannelOperatorSummary) {
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
  if (channel.sharedDefaultPolicy) {
    lines.push(`    sharedDefault: ${channel.sharedDefaultPolicy}`);
  }
  return lines;
}

function formatHealthInstance(instance: ChannelHealthInstance) {
  const parts = [`bot=${instance.botId || "unknown"}`];
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

function renderActiveRunSummaryLines(summary: RuntimeOperatorSummary) {
  if (summary.activeRuns.length === 0) {
    return ["", "Active runs:", "  none"];
  }

  const liveRunnerSessionKeys = new Set(
    summary.runnerSessions
      .filter((session) => session.live && session.entry)
      .map((session) => session.entry!.sessionKey),
  );

  return [
    "",
    "Active runs:",
    ...summary.activeRuns.map((run) => {
      const startedAt = run.startedAt ? new Date(run.startedAt).toISOString() : "unknown";
      const detachedAt = run.detachedAt ? ` detachedAt=${new Date(run.detachedAt).toISOString()}` : "";
      const runnerLive = liveRunnerSessionKeys.has(run.sessionKey);
      const liveSuffix = runnerLive ? "" : " runner=lost";
      return `  - agent=${run.agentId} state=${run.state}${liveSuffix} startedAt=${startedAt}${detachedAt} sessionKey=${run.sessionKey}`;
    }),
  ];
}

function formatSessionTimestamp(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "unknown";
  }
  return new Date(value).toISOString();
}

function renderRunnerSessionSummaryLines(summary: RuntimeOperatorSummary) {
  if (summary.runnerSessions.length === 0) {
    return ["", "Runner sessions:", "  none"];
  }

  const visibleSessions = summary.runnerSessions.slice(0, 5);
  const hiddenCount = Math.max(0, summary.runnerSessions.length - visibleSessions.length);

  return [
    "",
    "Runner sessions:",
    ...visibleSessions.map((session) => {
      if (!session.entry) {
        return `  - ${session.sessionName} live=${session.live ? "yes" : "no"}`;
      }
      return `  - ${session.sessionName} live=${session.live ? "yes" : "no"} agent=${session.entry.agentId} state=${session.entry.runtime?.state ?? "no-runtime"} sessionKey=${session.entry.sessionKey} lastAdmittedPromptAt=${formatSessionTimestamp(session.entry.lastAdmittedPromptAt)}`;
    }),
    ...(hiddenCount > 0 ? [`  (${hiddenCount}) sessions more`] : []),
    `  hint: ${renderCliCommand("runner list", { inline: true })} or ${renderCliCommand("runner watch --latest", { inline: true })}`,
  ];
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
    appendChannelSetupNote(lines, summary, channel, prefix);
  }
}

function appendChannelSetupNote(
  lines: string[],
  summary: RuntimeOperatorSummary,
  channel: ChannelOperatorSummary,
  prefix: string,
) {
  if (channel.channel === "telegram") {
    lines.push(`${prefix}  - telegram: no explicit group or topic routes are configured yet`);
    lines.push(
      `${prefix}    dms: ${channel.directMessagesEnabled ? `enabled (${channel.directMessagesPolicy})` : "disabled"}`,
    );
    lines.push(`${prefix}    sharedDefault: ${channel.sharedDefaultPolicy ?? "n/a"}`);
    lines.push(
      `${prefix}    add group: ${renderCliCommand("routes add --channel telegram group:<chatId> --bot default", { inline: true })}`,
    );
    lines.push(
      `${prefix}    bind group: ${renderCliCommand("routes set-agent --channel telegram group:<chatId> --bot default --agent <id>", { inline: true })}`,
    );
    lines.push(
      `${prefix}    add topic: ${renderCliCommand("routes add --channel telegram topic:<chatId>:<topicId> --bot default", { inline: true })}`,
    );
    lines.push(
      `${prefix}    bind topic: ${renderCliCommand("routes set-agent --channel telegram topic:<chatId>:<topicId> --bot default --agent <id>", { inline: true })}`,
    );
    lines.push(
      `${prefix}    adjust later: ${renderPrivilegedChatHint(summary, "run in-chat commands here")}`,
    );
    return;
  }

  lines.push(`${prefix}  - slack: no explicit channel or group routes are configured yet`);
  lines.push(
    `${prefix}    dms: ${channel.directMessagesEnabled ? `enabled (${channel.directMessagesPolicy})` : "disabled"}`,
  );
  lines.push(`${prefix}    sharedDefault: ${channel.sharedDefaultPolicy ?? "n/a"}`);
  lines.push(
    `${prefix}    add group: ${renderCliCommand("routes add --channel slack group:<channelId> --bot default", { inline: true })}`,
  );
  lines.push(
    `${prefix}    bind group: ${renderCliCommand("routes set-agent --channel slack group:<channelId> --bot default --agent <id>", { inline: true })}`,
  );
  lines.push(
    `${prefix}    adjust later: ${renderPrivilegedChatHint(summary, "run in-chat commands here")}`,
  );
}

function appendBootstrapGuidance(lines: string[], summary: RuntimeOperatorSummary) {
  const pendingBootstrap = summary.agentSummaries.filter(
    (agent) => agent.bootstrapState === "missing" || agent.bootstrapState === "not-bootstrapped",
  );
  if (pendingBootstrap.length === 0) {
    return false;
  }

  lines.push("");
  lines.push("Guidance:");
  for (const agent of pendingBootstrap) {
    const botType = agent.bootstrapMode === "team-assistant" ? "team" : "personal";
    if (agent.bootstrapState === "missing") {
      lines.push(`  Agent ${agent.id} is missing bootstrap files.`);
      lines.push(`    workspace: ${agent.workspacePath}`);
      lines.push(`    run: ${renderCliCommand(`agents bootstrap ${agent.id} --bot-type ${botType}`)}`);
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
  lines.push(`  - ${renderPrivilegedChatHint(summary, "verify DM access and adjust in-chat settings")}`);
  lines.push("");
  appendAuthOnboardingLines(lines, summary, "  ");
  lines.push(`  - run ${renderCliCommand("status", { inline: true })} to recheck runtime and bootstrap state`);
  lines.push(`  - run ${renderCliCommand("logs", { inline: true })} if the bot does not answer as expected`);
  lines.push(
    ...renderPairingSetupHelpLines("  ", {
      slackEnabled: summary.channelSummaries.some((channel) => channel.channel === "slack" && channel.enabled),
      telegramEnabled: summary.channelSummaries.some((channel) =>
        channel.channel === "telegram" && channel.enabled
      ),
      ownerConfigured: hasConfiguredPrivilegedPrincipal(summary),
      ownerClaimWindowMinutes: summary.ownerSummary.ownerClaimWindowMinutes,
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
  return true;
}

export function renderRuntimeDiagnosticsSummary(summary: RuntimeOperatorSummary) {
  return renderChannelDiagnosticLines(summary).join("\n").trim();
}

export function renderStartSummary(summary: RuntimeOperatorSummary) {
  const lines = [
    ...renderOwnerSummaryLines(summary),
    "",
    ...renderTimezoneSummaryLines(summary),
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
    lines.push(`  Example: ${renderCliCommand("start --cli codex --bot-type personal")}`);
    lines.push(`  Example: ${renderCliCommand("start --cli codex --bot-type team")}`);
    lines.push(`  Manual setup is still available with ${renderCliCommand("agents add ...", { inline: true })}.`);
    lines.push(...renderOperatorHelpLines("  "));
    lines.push(
      "  Bootstrap files will be seeded in the agent workspace. Review BOOTSTRAP.md, SOUL.md, USER.md, IDENTITY.md, and MEMORY.md.",
    );
    return lines.join("\n");
  }

  if (appendBootstrapGuidance(lines, summary)) {
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Next steps:");
  appendChannelNextStepLines(lines, summary, "  ");
  lines.push("  - verify routes and defaultAgentId values match the agent you want to expose");
  lines.push(`  - ${renderPrivilegedChatHint(summary, "adjust in-chat surface settings")}`);
  lines.push("");
  appendAuthOnboardingLines(lines, summary);
  lines.push(`  - run ${renderCliCommand("status", { inline: true })} to inspect agents, channels, and tmux session state`);
  lines.push(`  - run ${renderCliCommand("logs", { inline: true })} if anything looks wrong`);
  lines.push(
    ...renderPairingSetupHelpLines("", {
      slackEnabled: summary.channelSummaries.some((channel) => channel.channel === "slack" && channel.enabled),
      telegramEnabled: summary.channelSummaries.some((channel) => channel.channel === "telegram" && channel.enabled),
      ownerConfigured: hasConfiguredPrivilegedPrincipal(summary),
      ownerClaimWindowMinutes: summary.ownerSummary.ownerClaimWindowMinutes,
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

export function renderStatusSummary(summary: RuntimeOperatorSummary) {
  const lines = [
    `stats agents=${summary.configuredAgents} bootstrapped=${summary.bootstrappedAgents} pendingBootstrap=${summary.bootstrapPendingAgents} tmuxSessions=${summary.runningTmuxSessions}`,
    ...renderOwnerSummaryLines(summary),
    "",
    ...renderTimezoneSummaryLines(summary),
    "",
    ...renderAgentSummaryLines(summary),
    ...renderChannelSummaryLines(summary),
    ...renderChannelDiagnosticLines(summary),
    ...renderRunnerSessionSummaryLines(summary),
    ...renderActiveRunSummaryLines(summary),
  ];

  appendChannelSetupNotes(lines, summary);

  return lines.join("\n");
}
