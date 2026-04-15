import { existsSync } from "node:fs";
import {
  collapseHomePath,
  expandHomePath,
  getDefaultConfigPath,
  getDefaultTmuxSocketPath,
} from "../shared/paths.ts";
import { describeEnvReference } from "../shared/env-references.ts";
import {
  describeSlackCredentialSource,
  describeTelegramCredentialSource,
} from "../config/channel-credentials.ts";

export const CHANNEL_ACCOUNT_DOC_PATH = "docs/user-guide/channel-accounts.md";
export const USER_GUIDE_DOC_PATH = "docs/user-guide/README.md";
export const SLACK_TOKEN_DOC_URL = "https://api.slack.com/apps";
export const TELEGRAM_TOKEN_DOC_URL = "https://core.telegram.org/bots#6-botfather";
export const REPO_HELP_HINT =
  "If you still need help: clone https://github.com/longbkit/clisbot, open it in Codex or Claude Code, and ask for setup help.";

export type DefaultChannelAvailability = {
  slack: boolean;
  telegram: boolean;
};

export type StartTokenArgs = {
  slackAppTokenRef?: string;
  slackBotTokenRef?: string;
  telegramBotTokenRef?: string;
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
  const slackApp = describeEnvReference(tokenArgs.slackAppTokenRef, "SLACK_APP_TOKEN", env);
  const slackBot = describeEnvReference(tokenArgs.slackBotTokenRef, "SLACK_BOT_TOKEN", env);
  const telegramBot = describeEnvReference(
    tokenArgs.telegramBotTokenRef,
    "TELEGRAM_BOT_TOKEN",
    env,
  );
  return {
    slack: Boolean(slackApp.hasValue && slackBot.hasValue),
    telegram: Boolean(telegramBot.hasValue),
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
      slack: { enabled: boolean };
      telegram: { enabled: boolean };
    };
  },
  availability: DefaultChannelAvailability,
) {
  const lines: string[] = [];
  const configPath = collapseHomePath(getDefaultConfigPath());

  if (availability.slack && !config.channels.slack.enabled) {
    lines.push(
      "warning default Slack tokens are available in SLACK_APP_TOKEN and SLACK_BOT_TOKEN, but channels.slack.enabled is false in the existing config.",
    );
    lines.push(
      `Run \`clisbot channels enable slack\` to enable Slack quickly, or update ${configPath} manually.`,
    );
  }

  if (availability.telegram && !config.channels.telegram.enabled) {
    lines.push(
      "warning default Telegram token is available in TELEGRAM_BOT_TOKEN, but channels.telegram.enabled is false in the existing config.",
    );
    lines.push(
      `Run \`clisbot channels enable telegram\` to enable Telegram quickly, or update ${configPath} manually.`,
    );
  }

  return lines;
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
    lines.push(
      `Slack channel: token not found (app=${slackApp.envName}, bot=${slackBot.envName}), pass explicit flags for Slack bootstrap.`,
    );
  }
  if (!telegramBot.hasValue) {
    lines.push(
      `Telegram channel: token not found (${telegramBot.envName}), pass --telegram-bot-token explicitly for Telegram bootstrap.`,
    );
  }

  return lines;
}

export function renderMissingTokenWarningLines(
  env: NodeJS.ProcessEnv = process.env,
) {
  const slackApp = describeEnvReference("SLACK_APP_TOKEN", "SLACK_APP_TOKEN", env);
  const slackBot = describeEnvReference("SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN", env);
  const telegramBot = describeEnvReference("TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", env);

  return [
    "warning first-run bootstrap needs explicit channel flags, so clisbot did not start.",
    `Slack token refs: app=${slackApp.envName} (${slackApp.hasValue ? "set" : "missing"}), bot=${slackBot.envName} (${slackBot.hasValue ? "set" : "missing"})`,
    `Telegram token ref: ${telegramBot.envName} (${telegramBot.hasValue ? "set" : "missing"})`,
    "Pass the channels you want explicitly, for example with --telegram-bot-token or --slack-app-token plus --slack-bot-token.",
    "Use ENV_NAME or ${ENV_NAME} for env-backed setup, or pass a literal token to cold-start with credentialType=mem.",
    "Example: clisbot start --cli codex --bot-type personal --telegram-bot-token TELEGRAM_BOT_TOKEN",
    `Repo docs path (local or GitHub): ${CHANNEL_ACCOUNT_DOC_PATH}`,
    `Slack docs: ${SLACK_TOKEN_DOC_URL}`,
    `Telegram docs: ${TELEGRAM_TOKEN_DOC_URL}`,
    REPO_HELP_HINT,
  ];
}

export function renderConfiguredChannelTokenIssueLines(
  config: {
    channels: {
      slack: any;
      telegram: any;
    };
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const lines: string[] = [];
  try {
    if (config.channels.slack.enabled) {
      describeSlackCredentialSource({
        config: config.channels.slack,
        env,
      });
    }
  } catch (error) {
    lines.push(error instanceof Error ? error.message : String(error));
  }

  try {
    if (config.channels.telegram.enabled) {
      describeTelegramCredentialSource({
        config: config.channels.telegram,
        env,
      });
    }
  } catch (error) {
    lines.push(error instanceof Error ? error.message : String(error));
  }

  if (lines.length === 0) {
    return [];
  }

  return [
    "warning!!! configured channel credentials are invalid or unavailable, so clisbot did not start.",
    ...lines,
    `Docs: ${CHANNEL_ACCOUNT_DOC_PATH}`,
    REPO_HELP_HINT,
  ];
}

export function renderConfiguredChannelTokenStatusLines(
  config: {
    channels: {
      slack: any;
      telegram: any;
    };
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const lines: string[] = [];

  if (config.channels.slack.enabled) {
    const accountId = config.channels.slack.defaultAccount || "default";
    try {
      const source = describeSlackCredentialSource({
        config: config.channels.slack,
        env,
      });
      lines.push(`Slack account ${accountId}: ${source.detail}`);
    } catch (error) {
      lines.push(
        `Slack account ${accountId}: unavailable (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  if (config.channels.telegram.enabled) {
    const accountId = config.channels.telegram.defaultAccount || "default";
    try {
      const source = describeTelegramCredentialSource({
        config: config.channels.telegram,
        env,
      });
      lines.push(`Telegram account ${accountId}: ${source.detail}`);
    } catch (error) {
      lines.push(
        `Telegram account ${accountId}: unavailable (${error instanceof Error ? error.message : String(error)})`,
      );
    }
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
    `${prefix}Help: clisbot --help`,
    `${prefix}Docs: ${USER_GUIDE_DOC_PATH}`,
    ...renderRepoHelpLines(prefix),
  ];
}

export function renderPairingSetupHelpLines(
  prefix = "",
  options: {
    slackEnabled?: boolean;
    telegramEnabled?: boolean;
    slackDirectMessagesPolicy?: string;
    telegramDirectMessagesPolicy?: string;
    conditionalOnly?: boolean;
  } = {},
) {
  const lines: string[] = [];
  const slackPairing = options.slackDirectMessagesPolicy === "pairing";
  const telegramPairing = options.telegramDirectMessagesPolicy === "pairing";
  const shouldRenderSlack = options.conditionalOnly === true
    ? Boolean(options.slackEnabled && slackPairing)
    : slackPairing;
  const shouldRenderTelegram = options.conditionalOnly === true
    ? Boolean(options.telegramEnabled && telegramPairing)
    : telegramPairing;

  if (!shouldRenderSlack && !shouldRenderTelegram) {
    return lines;
  }

  lines.push(`${prefix}Pairing notes:`);

  if (shouldRenderSlack && shouldRenderTelegram) {
    lines.push(
      `${prefix}  - Send a direct message (DM) to the Telegram or Slack bot. Send \`/start\` or \`hi\` to receive a pairing code.`,
    );
  }

  if (shouldRenderTelegram) {
    if (!shouldRenderSlack) {
      lines.push(
        `${prefix}  - Send a direct message (DM) to the Telegram bot. Send \`/start\` or \`hi\` to receive a pairing code.`,
      );
    }
    lines.push(
      `${prefix}  - Approve the returned Telegram code with: \`clisbot pairing approve telegram <code>\``,
    );
  }

  if (shouldRenderSlack) {
    if (!shouldRenderTelegram) {
      lines.push(
        `${prefix}  - Send a direct message (DM) to the Slack bot. Say \`hi\` to receive a pairing code.`,
      );
    }
    lines.push(
      `${prefix}  - Approve the returned Slack code with: \`clisbot pairing approve slack <code>\``,
    );
  }

  lines.push(
    `${prefix}  - Configured app owner/admin principals bypass pairing in DMs.`,
  );

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
    `${prefix}Channel setup docs: ${CHANNEL_ACCOUNT_DOC_PATH}`,
    `${prefix}Operator guide: ${USER_GUIDE_DOC_PATH}`,
    `${prefix}If Slack or Telegram is not responding yet, configure tokens, routes, and defaultAgentId first.`,
    ...renderPairingSetupHelpLines(prefix, {
      slackDirectMessagesPolicy: "pairing",
      telegramDirectMessagesPolicy: "pairing",
    }),
    ...renderTmuxDebugHelpLines(prefix),
    ...renderRepoHelpLines(prefix),
  ];
}

export function shouldBootstrapFirstRunConfig(configPath = getDefaultConfigPath()) {
  return !existsSync(expandHomePath(configPath));
}
