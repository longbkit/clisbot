import { existsSync } from "node:fs";
import { DEFAULT_CONFIG_PATH, expandHomePath } from "../shared/paths.ts";
import {
  describeEnvReference,
  extractEnvReferenceName,
  hasEnvReferenceValue,
} from "../shared/env-references.ts";
import type {
  AgentBootstrapMode,
  AgentCliToolId,
} from "../config/agent-tool-presets.ts";
import { renderGenericPrivilegeCommandHelpLines } from "../channels/privilege-help.ts";

export const CHANNEL_ACCOUNT_DOC_PATH = "docs/user-guide/channel-accounts.md";
export const USER_GUIDE_DOC_PATH = "docs/user-guide/README.md";
export const SLACK_TOKEN_DOC_URL = "https://api.slack.com/apps";
export const TELEGRAM_TOKEN_DOC_URL = "https://core.telegram.org/bots#6-botfather";
export const REPO_HELP_HINT =
  "If you still need help: clone https://github.com/longbkit/muxbot, open it in Codex or Claude Code, and ask for setup help.";

export type DefaultChannelAvailability = {
  slack: boolean;
  telegram: boolean;
};

export type StartTokenArgs = {
  slackAppTokenRef?: string;
  slackBotTokenRef?: string;
  telegramBotTokenRef?: string;
};

export type StartCommandOptions = StartTokenArgs & {
  cliTool?: AgentCliToolId;
  bootstrap?: AgentBootstrapMode;
};

export function getDefaultChannelAvailability(
  env: NodeJS.ProcessEnv = process.env,
): DefaultChannelAvailability {
  return {
    slack: Boolean(env.SLACK_APP_TOKEN?.trim() && env.SLACK_BOT_TOKEN?.trim()),
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN?.trim()),
  };
}

export function getChannelAvailabilityForBootstrap(
  tokenArgs: StartTokenArgs,
  env: NodeJS.ProcessEnv = process.env,
): DefaultChannelAvailability {
  return {
    slack:
      Boolean(
        hasEnvReferenceValue(tokenArgs.slackAppTokenRef, env) &&
          hasEnvReferenceValue(tokenArgs.slackBotTokenRef, env),
      ) ||
      Boolean(env.SLACK_APP_TOKEN?.trim() && env.SLACK_BOT_TOKEN?.trim()),
    telegram: Boolean(hasEnvReferenceValue(tokenArgs.telegramBotTokenRef, env)) ||
      Boolean(env.TELEGRAM_BOT_TOKEN?.trim()),
  };
}

export function hasAnyDefaultChannelToken(
  availability: DefaultChannelAvailability,
) {
  return availability.slack || availability.telegram;
}

export function renderDisabledConfiguredChannelWarningLines(
  config: {
    channels: {
      slack: {
        enabled: boolean;
      };
      telegram: {
        enabled: boolean;
      };
    };
  },
  availability: DefaultChannelAvailability,
) {
  const lines: string[] = [];

  if (availability.slack && !config.channels.slack.enabled) {
    lines.push(
      "warning default Slack tokens are available in SLACK_APP_TOKEN and SLACK_BOT_TOKEN, but channels.slack.enabled is false in the existing config.",
    );
    lines.push(
      "Run `muxbot channels enable slack` to enable Slack quickly, or update ~/.muxbot/muxbot.json manually.",
    );
  }

  if (availability.telegram && !config.channels.telegram.enabled) {
    lines.push(
      "warning default Telegram token is available in TELEGRAM_BOT_TOKEN, but channels.telegram.enabled is false in the existing config.",
    );
    lines.push(
      "Run `muxbot channels enable telegram` to enable Telegram quickly, or update ~/.muxbot/muxbot.json manually.",
    );
  }

  return lines;
}

export function renderMissingTokenWarningLines(
  tokenArgs: StartTokenArgs = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  const slackApp = describeEnvReference(tokenArgs.slackAppTokenRef, "SLACK_APP_TOKEN", env);
  const slackBot = describeEnvReference(tokenArgs.slackBotTokenRef, "SLACK_BOT_TOKEN", env);
  const telegramBot = describeEnvReference(
    tokenArgs.telegramBotTokenRef,
    "TELEGRAM_BOT_TOKEN",
    env,
  );

  return [
    "warning no default Slack or Telegram tokens were found, so muxbot did not start.",
    `Slack token refs: app=${slackApp.envName} (${slackApp.hasValue ? "set" : "missing"}), bot=${slackBot.envName} (${slackBot.hasValue ? "set" : "missing"})`,
    `Telegram token ref: ${telegramBot.envName} (${telegramBot.hasValue ? "set" : "missing"})`,
    "Set either Slack app+bot tokens or a Telegram bot token in your shell, then run start again.",
    "If you use different env var names, pass them explicitly with --slack-app-token, --slack-bot-token, and --telegram-bot-token.",
    "Example: muxbot start --cli codex --bootstrap personal-assistant --slack-app-token CUSTOM_SLACK_APP_TOKEN --slack-bot-token CUSTOM_SLACK_BOT_TOKEN",
    `Repo docs path (local or GitHub): ${CHANNEL_ACCOUNT_DOC_PATH}`,
    `Slack docs: ${SLACK_TOKEN_DOC_URL}`,
    `Telegram docs: ${TELEGRAM_TOKEN_DOC_URL}`,
    REPO_HELP_HINT,
  ];
}

export function renderBootstrapTokenUsageLines(
  tokenArgs: StartTokenArgs,
  env: NodeJS.ProcessEnv = process.env,
) {
  const lines: string[] = [];
  const slackApp = describeEnvReference(tokenArgs.slackAppTokenRef, "SLACK_APP_TOKEN", env);
  const slackBot = describeEnvReference(tokenArgs.slackBotTokenRef, "SLACK_BOT_TOKEN", env);
  const telegramBot = describeEnvReference(
    tokenArgs.telegramBotTokenRef,
    "TELEGRAM_BOT_TOKEN",
    env,
  );

  if (!(slackApp.hasValue && slackBot.hasValue)) {
    lines.push(...renderEnvPresenceLines({
      channel: "Slack",
      found: false,
      detail: `app=${slackApp.envName}, bot=${slackBot.envName}`,
      flagHint: "--slack-app-token / --slack-bot-token",
    }));
  }
  if (!telegramBot.hasValue) {
    lines.push(...renderEnvPresenceLines({
      channel: "Telegram",
      found: false,
      detail: telegramBot.envName,
      flagHint: "--telegram-bot-token",
    }));
  }

  return lines;
}

export function renderConfiguredChannelTokenIssueLines(
  config: {
    channels: {
      slack: {
        enabled: boolean;
        appToken: string;
        botToken: string;
      };
      telegram: {
        enabled: boolean;
        botToken: string;
      };
    };
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const lines: string[] = [];
  const hardErrorLines: string[] = [];
  const slackAppEnv = extractEnvReferenceName(config.channels.slack.appToken);
  const slackBotEnv = extractEnvReferenceName(config.channels.slack.botToken);
  const telegramBotEnv = extractEnvReferenceName(config.channels.telegram.botToken);

  if (config.channels.slack.enabled) {
    if (!config.channels.slack.appToken.trim()) {
      hardErrorLines.push("Configured Slack app token is empty.");
    } else if (slackAppEnv && !env[slackAppEnv]?.trim()) {
      lines.push(`Configured Slack app token env var is missing: ${slackAppEnv}`);
    }

    if (!config.channels.slack.botToken.trim()) {
      hardErrorLines.push("Configured Slack bot token is empty.");
    } else if (slackBotEnv && !env[slackBotEnv]?.trim()) {
      lines.push(`Configured Slack bot token env var is missing: ${slackBotEnv}`);
    }
  }

  if (config.channels.telegram.enabled) {
    if (!config.channels.telegram.botToken.trim()) {
      hardErrorLines.push("Configured Telegram bot token is empty.");
    } else if (telegramBotEnv && !env[telegramBotEnv]?.trim()) {
      lines.push(`Configured Telegram bot token env var is missing: ${telegramBotEnv}`);
    }
  }

  if (hardErrorLines.length > 0) {
    return [
      "warning configured channel tokens are invalid, so muxbot did not start.",
      ...hardErrorLines,
      "Set the missing token value in config or switch the channel token field back to an env placeholder.",
      `Docs: ${CHANNEL_ACCOUNT_DOC_PATH}`,
      REPO_HELP_HINT,
    ];
  }

  if (lines.length === 0) {
    return [];
  }

  const shellHint = [
    "Set the missing env vars in your shell, for example in ~/.bashrc or ~/.zshrc, then reload your shell with `source ~/.bashrc` or `source ~/.zshrc`.",
    "If you want different env var names on first run, pass them explicitly with --slack-app-token, --slack-bot-token, or --telegram-bot-token.",
    `Docs: ${CHANNEL_ACCOUNT_DOC_PATH}`,
  ];

  return [
    "warning!!! configured channel token references are missing, so muxbot did not start.",
    ...lines,
    ...shellHint,
    REPO_HELP_HINT,
  ];
}

export function renderConfiguredChannelTokenStatusLines(
  config: {
    channels: {
      slack: {
        enabled: boolean;
        appToken: string;
        botToken: string;
      };
      telegram: {
        enabled: boolean;
        botToken: string;
      };
    };
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const lines: string[] = [];

  if (config.channels.slack.enabled) {
    const slackApp = describeConfiguredTokenSource(config.channels.slack.appToken, env);
    const slackBot = describeConfiguredTokenSource(config.channels.slack.botToken, env);
    lines.push(...renderConfiguredTokenSourceLines({
      channel: "Slack",
      sources: [
        { label: "app", source: slackApp },
        { label: "bot", source: slackBot },
      ],
      flagHint: "--slack-app-token / --slack-bot-token",
    }));
  }

  if (config.channels.telegram.enabled) {
    const telegramBot = describeConfiguredTokenSource(config.channels.telegram.botToken, env);
    lines.push(...renderConfiguredTokenSourceLines({
      channel: "Telegram",
      sources: [{ label: "bot", source: telegramBot }],
      flagHint: "--telegram-bot-token",
    }));
  }

  if (lines.length === 0) {
    return ["No Slack or Telegram channels are enabled in the current config."];
  }

  return lines;
}

export function renderRepoHelpLines(prefix = "") {
  return [`${prefix}${REPO_HELP_HINT}`];
}

export function renderOperatorHelpLines(prefix = "") {
  return [
    `${prefix}Help: muxbot --help`,
    `${prefix}Docs: ${USER_GUIDE_DOC_PATH}`,
    ...renderRepoHelpLines(prefix),
  ];
}

export function renderChannelSetupHelpLines(
  prefix = "",
  options: { includePrivilegeHelp?: boolean } = {},
) {
  return [
    `${prefix}Channel setup docs: ${CHANNEL_ACCOUNT_DOC_PATH}`,
    `${prefix}Operator guide: ${USER_GUIDE_DOC_PATH}`,
    `${prefix}If Slack or Telegram is not responding yet, configure tokens, routes, and defaultAgentId first.`,
    ...(options.includePrivilegeHelp === false ? [] : renderGenericPrivilegeCommandHelpLines(prefix)),
    ...renderRepoHelpLines(prefix),
  ];
}

export function shouldBootstrapFirstRunConfig(configPath = DEFAULT_CONFIG_PATH) {
  return !existsSync(expandHomePath(configPath));
}

function describeConfiguredTokenSource(
  configuredValue: string,
  env: NodeJS.ProcessEnv,
) {
  const trimmed = configuredValue.trim();
  if (!trimmed) {
    return {
      kind: "empty" as const,
      hasValue: false,
      label: "empty",
    };
  }

  const envName = extractEnvReferenceName(trimmed);
  if (envName) {
    return {
      kind: "env" as const,
      hasValue: Boolean(env[envName]?.trim()),
      label: `env ${envName}`,
    };
  }

  return {
    kind: "literal" as const,
    hasValue: true,
    label: "literal configured",
  };
}

function renderEnvPresenceLines(params: {
  channel: string;
  found: boolean;
  detail: string;
  flagHint: string;
}) {
  if (params.found) {
    return [`${params.channel} channel: found token, using ${params.detail}`];
  }

  return [
    `${params.channel} channel: token not found (${params.detail}), set it or use ${params.flagHint} for custom env name. Follow ${CHANNEL_ACCOUNT_DOC_PATH} to set up ${params.channel}.`,
  ];
}

function renderConfiguredTokenSourceLines(params: {
  channel: string;
  sources: Array<{
    label: string;
    source: ReturnType<typeof describeConfiguredTokenSource>;
  }>;
  flagHint: string;
}) {
  const details = params.sources.map(({ label, source }) => `${label}=${source.label}`).join(", ");
  const missingEnvSources = params.sources.filter(
    ({ source }) => source.kind === "env" && !source.hasValue,
  );

  if (missingEnvSources.length > 0) {
    return [
      `${params.channel} channel: token not found (${details}), set it or use ${params.flagHint} for custom env name. Follow ${CHANNEL_ACCOUNT_DOC_PATH} to set up ${params.channel}.`,
    ];
  }

  const literalSources = params.sources.filter(({ source }) => source.kind === "literal");
  if (literalSources.length > 0) {
    return [`${params.channel} channel: configured literal token (${details})`];
  }

  return [`${params.channel} channel: found token, using ${details}`];
}
