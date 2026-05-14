import { existsSync } from "node:fs";
import {
  collapseHomePath,
  expandHomePath,
  getDefaultConfigPath,
  getDefaultTmuxSocketPath,
} from "../../infra/paths.ts";
import { renderSupportedChannelsNote } from "../../channels/catalog/registry.ts";
import { renderCliCommand } from "./cli-name.ts";
import {
  renderBootstrapExplicitFlagSummary,
  renderBootstrapPrimaryExampleCommand,
  listBootstrapChannels,
  listStartupChannelDescriptors,
} from "../../channels/catalog/registry.ts";
import type { ChannelBootstrapBotInput } from "../../config/channels/channel-bootstrap.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import type {
  ChannelStartupAvailability,
} from "../../channels/integration/operator-inventory.ts";
import { getChannelPlugin, listChannelPlugins, renderChannelLabel } from "../../channels/catalog/registry.ts";
import type { ClisbotConfig } from "../../config/core/schema.ts";

export const BOTS_AND_CREDENTIALS_DOC_PATH = "docs/user-guide/bots-and-credentials.md";
export const USER_GUIDE_DOC_PATH = "docs/user-guide/README.md";
export const REPO_HELP_HINT =
  "If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.";

type DefaultChannelAvailability = ChannelStartupAvailability;
type StartTokenArgs = Record<ChannelId, ChannelBootstrapBotInput[]>;
type StartupConfig = ClisbotConfig;

export type PairingSetupChannelState = {
  channel: ChannelId;
  enabled?: boolean;
  directMessagesPolicy?: string;
};

function listDefaultPairingSetupChannelStates(): PairingSetupChannelState[] {
  return listChannelPlugins().flatMap((plugin) =>
    plugin.operatorGuidance?.pairingCodeLine
      ? [{
        channel: plugin.id,
        enabled: true,
        directMessagesPolicy: "pairing" as const,
      }]
      : []
  );
}

function resolvePairingSetupChannels(
  channels: readonly PairingSetupChannelState[],
  conditionalOnly: boolean,
) {
  return channels
    .filter((channel) => channel.directMessagesPolicy === "pairing")
    .filter((channel) => !conditionalOnly || channel.enabled)
    .flatMap((channel) => {
      const guidance = getChannelPlugin(channel.channel)?.operatorGuidance?.pairingCodeLine;
      if (!guidance) {
        return [];
      }
      return [{
        channel: channel.channel,
        label: renderChannelLabel(channel.channel),
        pairingCodeLine: guidance,
      }];
    });
}

export function getDefaultChannelAvailability(
  env: NodeJS.ProcessEnv = process.env,
): DefaultChannelAvailability {
  return Object.fromEntries(
    listStartupChannelDescriptors().map((descriptor) => [
      descriptor.channel,
      descriptor.getDefaultAvailability(env),
    ]),
  ) as DefaultChannelAvailability;
}

export function getChannelAvailabilityForBootstrap(
  tokenArgs: StartTokenArgs,
  env: NodeJS.ProcessEnv = process.env,
): DefaultChannelAvailability {
  return Object.fromEntries(
    listStartupChannelDescriptors().map((descriptor) => [
      descriptor.channel,
      descriptor.getBootstrapAvailability(tokenArgs[descriptor.channel] ?? [], env),
    ]),
  ) as DefaultChannelAvailability;
}

export function hasAnyDefaultChannelToken(
  availability: DefaultChannelAvailability,
) {
  return Object.values(availability).some(Boolean);
}

export function renderDisabledConfiguredChannelWarningLines(
  config: StartupConfig,
  availability: DefaultChannelAvailability,
) {
  const lines: string[] = [];
  const configPath = collapseHomePath(getDefaultConfigPath());

  for (const descriptor of listStartupChannelDescriptors()) {
    if (availability[descriptor.channel] && !descriptor.isEnabled(config)) {
      lines.push(...descriptor.renderDisabledConfiguredWarning(configPath));
    }
  }

  return lines;
}

export function renderBootstrapTokenUsageLines(
  tokenArgs: StartTokenArgs,
  env: NodeJS.ProcessEnv = process.env,
) {
  return listStartupChannelDescriptors()
    .map((descriptor) => descriptor.renderBootstrapMissingLine(tokenArgs[descriptor.channel] ?? [], env))
    .filter((line): line is string => Boolean(line));
}

export function renderMissingTokenWarningLines(
  env: NodeJS.ProcessEnv = process.env,
) {
  const setupHelpLines = listStartupChannelDescriptors()
    .flatMap((descriptor) => descriptor.renderSetupHelpLines?.() ?? []);
  return [
    "warning first-run bootstrap needs explicit channel flags, so clisbot did not start.",
    ...listStartupChannelDescriptors().map((descriptor) => descriptor.renderMissingTokenStatusLine(env)),
    `Pass the channels you want explicitly, for example with ${renderBootstrapExplicitFlagSummary(listBootstrapChannels())}.`,
    "Use ENV_NAME or ${ENV_NAME} for env-backed setup, or pass a literal token to cold-start with credentialType=mem.",
    `Example: ${renderBootstrapPrimaryExampleCommand("start") ?? renderCliCommand("start --help")}`,
    `Repo docs path (local or GitHub): ${BOTS_AND_CREDENTIALS_DOC_PATH}`,
    ...setupHelpLines,
    REPO_HELP_HINT,
  ];
}

export function renderConfiguredChannelTokenIssueLines(
  config: StartupConfig,
  env: NodeJS.ProcessEnv = process.env,
) {
  const lines: string[] = [];
  for (const descriptor of listStartupChannelDescriptors()) {
    try {
      if (descriptor.isEnabled(config)) {
        descriptor.describeCredentialSource(config, env);
      }
    } catch (error) {
      lines.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (lines.length === 0) {
    return [];
  }

  return [
    "warning!!! configured channel credentials are invalid or unavailable, so clisbot did not start.",
    ...lines,
    `Docs: ${BOTS_AND_CREDENTIALS_DOC_PATH}`,
    REPO_HELP_HINT,
  ];
}

export function renderConfiguredChannelTokenStatusLines(
  config: StartupConfig,
  env: NodeJS.ProcessEnv = process.env,
) {
  const lines: string[] = [];

  for (const descriptor of listStartupChannelDescriptors()) {
    if (!descriptor.isEnabled(config)) {
      continue;
    }
    const botId = descriptor.getDefaultBotId(config);
    try {
      const source = descriptor.describeCredentialSource(config, env);
      lines.push(`${descriptor.statusLabel} ${botId}: ${source.detail}`);
    } catch (error) {
      lines.push(
        `${descriptor.statusLabel} ${botId}: unavailable (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  if (lines.length === 0) {
    return [`No enabled channels are configured. ${renderSupportedChannelsNote()}`];
  }

  return lines;
}

export function renderRepoHelpLines(prefix = "") {
  return [`${prefix}${REPO_HELP_HINT}`];
}

export function renderOperatorHelpLines(prefix = "") {
  return [
    `${prefix}Help: ${renderCliCommand("--help")}`,
    `${prefix}Docs: ${USER_GUIDE_DOC_PATH}`,
    ...renderRepoHelpLines(prefix),
  ];
}

export function renderPairingSetupHelpLines(
  prefix = "",
  options: {
    channels?: readonly PairingSetupChannelState[];
    ownerConfigured?: boolean;
    ownerClaimWindowMinutes?: number;
    conditionalOnly?: boolean;
  } = {},
) {
  const lines: string[] = [];
  const pairingChannels = resolvePairingSetupChannels(
    options.channels ?? listDefaultPairingSetupChannelStates(),
    options.conditionalOnly === true,
  );

  if (pairingChannels.length === 0) {
    return lines;
  }

  lines.push(`${prefix}Pairing notes:`);
  for (const channel of pairingChannels) {
    lines.push(`${prefix}  - ${channel.pairingCodeLine}`);
    lines.push(
      `${prefix}  - Approve the returned ${channel.label} code with: ${
        renderCliCommand(`pairing approve ${channel.channel} <code>`, { inline: true })
      }`,
    );
  }

  lines.push(
    `${prefix}  - Configured app owner/admin principals bypass pairing in DMs.`,
  );

  if (options.ownerConfigured === false) {
    lines.push(
      `${prefix}  - If no owner is configured yet, the first DM user during the first ${options.ownerClaimWindowMinutes ?? 30} minutes becomes app owner automatically.`,
    );
  }

  return lines;
}

export function renderTmuxDebugHelpLines(prefix = "") {
  const socketPath = collapseHomePath(getDefaultTmuxSocketPath());
  return [
    `${prefix}tmux debug:`,
    `${prefix}  - list sessions: \`tmux -S ${socketPath} list-sessions\``,
    `${prefix}  - attach to a session: \`tmux -S ${socketPath} attach -t <session-name>\``,
  ];
}

export function renderChannelSetupHelpLines(
  prefix = "",
  _options: { includePrivilegeHelp?: boolean } = {},
) {
  return [
    `${prefix}Bot setup docs: ${BOTS_AND_CREDENTIALS_DOC_PATH}`,
    `${prefix}Operator guide: ${USER_GUIDE_DOC_PATH}`,
    `${prefix}If an enabled channel is not responding yet, configure tokens, routes, and defaultAgentId first.`,
    ...renderPairingSetupHelpLines(prefix),
    ...renderTmuxDebugHelpLines(prefix),
    ...renderRepoHelpLines(prefix),
  ];
}

export function shouldBootstrapFirstRunConfig(configPath = getDefaultConfigPath()) {
  return !existsSync(expandHomePath(configPath));
}
