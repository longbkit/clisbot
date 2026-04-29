import type { ClisbotConfig } from "./schema.ts";
import type {
  ParsedSlackBotFlags,
  ParsedTelegramBotFlags,
} from "../control/channel-bootstrap-flags.ts";
import {
  clearSlackRuntimeCredential,
  clearTelegramRuntimeCredential,
  getSlackMemAppEnvName,
  getSlackMemBotEnvName,
  getTelegramMemEnvName,
  persistSlackCredential,
  persistTelegramCredential,
  setSlackRuntimeCredential,
  setTelegramRuntimeCredential,
} from "./channel-credentials.ts";

export type ChannelBootstrapBots = {
  slackBots: ParsedSlackBotFlags[];
  telegramBots: ParsedTelegramBotFlags[];
};

function getFirstBotId(bots: Array<{ botId: string }>) {
  return bots[0]?.botId ?? "default";
}

function getEnabledBotIds(bots: Record<string, { enabled?: boolean }>) {
  return Object.entries(bots)
    .filter(([, bot]) => bot.enabled !== false)
    .map(([botId]) => botId);
}

function getSlackBots(config: ClisbotConfig) {
  const { defaults, ...bots } = config.bots.slack;
  return bots;
}

function getTelegramBots(config: ClisbotConfig) {
  const { defaults, ...bots } = config.bots.telegram;
  return bots;
}

function createSlackBotShell(botId: string): ClisbotConfig["bots"]["slack"][string] {
  return {
    enabled: false,
    name: botId,
    dmPolicy: "pairing",
    channelPolicy: "allowlist",
    groupPolicy: "allowlist",
    appToken: "",
    botToken: "",
    directMessages: {},
    groups: {},
  };
}

function createTelegramBotShell(botId: string): ClisbotConfig["bots"]["telegram"][string] {
  return {
    enabled: false,
    name: botId,
    dmPolicy: "pairing",
    groupPolicy: "allowlist",
    botToken: "",
    directMessages: {},
    groups: {},
  };
}

function reconcileSlackConfiguredBots(config: ClisbotConfig) {
  const enabledBotIds = getEnabledBotIds(getSlackBots(config));
  if (enabledBotIds.length === 0) {
    config.bots.slack.defaults.enabled = false;
    return;
  }

  if (
    !config.bots.slack.defaults.defaultBotId ||
    !enabledBotIds.includes(config.bots.slack.defaults.defaultBotId)
  ) {
    config.bots.slack.defaults.defaultBotId = enabledBotIds[0];
  }
}

function reconcileTelegramConfiguredBots(config: ClisbotConfig) {
  const enabledBotIds = getEnabledBotIds(getTelegramBots(config));
  if (enabledBotIds.length === 0) {
    config.bots.telegram.defaults.enabled = false;
    return;
  }

  if (
    !config.bots.telegram.defaults.defaultBotId ||
    !enabledBotIds.includes(config.bots.telegram.defaults.defaultBotId)
  ) {
    config.bots.telegram.defaults.defaultBotId = enabledBotIds[0];
  }
}

function applySlackBotConfig(
  config: ClisbotConfig,
  bot: ParsedSlackBotFlags,
) {
  if (!bot.appToken || !bot.botToken) {
    throw new Error(`Slack bot ${bot.botId} is incomplete`);
  }

  const existing = config.bots.slack[bot.botId] ?? createSlackBotShell(bot.botId);
  config.bots.slack[bot.botId] = bot.appToken.kind === "env" &&
      bot.botToken.kind === "env"
    ? {
        ...existing,
        enabled: true,
        appToken: bot.appToken.placeholder,
        botToken: bot.botToken.placeholder,
      }
    : {
        ...existing,
        enabled: true,
        credentialType: "mem",
        appToken: "",
        botToken: "",
      };
}

function applyTelegramBotConfig(
  config: ClisbotConfig,
  bot: ParsedTelegramBotFlags,
) {
  if (!bot.botToken) {
    throw new Error(`Telegram bot ${bot.botId} is incomplete`);
  }

  const existing = config.bots.telegram[bot.botId] ?? createTelegramBotShell(bot.botId);
  config.bots.telegram[bot.botId] = bot.botToken.kind === "env"
    ? {
        ...existing,
        enabled: true,
        botToken: bot.botToken.placeholder,
      }
    : {
        ...existing,
        enabled: true,
        credentialType: "mem",
        botToken: "",
      };
}

export function buildBootstrapRuntimeMemEnv(
  bots: ChannelBootstrapBots,
  env: NodeJS.ProcessEnv = process.env,
) {
  const extraEnv: NodeJS.ProcessEnv = { ...env };

  for (const bot of bots.telegramBots) {
    if (bot.botToken?.kind !== "mem") {
      continue;
    }
    extraEnv[getTelegramMemEnvName(bot.botId)] = bot.botToken.secret;
  }

  for (const bot of bots.slackBots) {
    if (bot.appToken?.kind !== "mem" || bot.botToken?.kind !== "mem") {
      continue;
    }
    extraEnv[getSlackMemAppEnvName(bot.botId)] = bot.appToken.secret;
    extraEnv[getSlackMemBotEnvName(bot.botId)] = bot.botToken.secret;
  }

  return extraEnv;
}

export function deactivateExpiredMemBots(
  config: ClisbotConfig,
  activeMemBots: Partial<Record<"slack" | "telegram", Set<string>>> = {},
) {
  const summaries: string[] = [];
  const activeSlackMemBots = activeMemBots.slack ?? new Set<string>();
  const activeTelegramMemBots = activeMemBots.telegram ?? new Set<string>();

  for (const [botId, bot] of Object.entries(getSlackBots(config))) {
    if (bot.credentialType !== "mem" || activeSlackMemBots.has(botId)) {
      continue;
    }
    if (bot.enabled !== false) {
      summaries.push(`Disabled expired slack/${botId} (credentialType=mem).`);
    }
    bot.enabled = false;
  }

  for (const [botId, bot] of Object.entries(getTelegramBots(config))) {
    if (bot.credentialType !== "mem" || activeTelegramMemBots.has(botId)) {
      continue;
    }
    if (bot.enabled !== false) {
      summaries.push(`Disabled expired telegram/${botId} (credentialType=mem).`);
    }
    bot.enabled = false;
  }

  reconcileSlackConfiguredBots(config);
  reconcileTelegramConfiguredBots(config);

  return summaries;
}

export function applyBootstrapBotsToConfig(
  config: ClisbotConfig,
  bots: ChannelBootstrapBots,
  options: {
    firstRun: boolean;
  },
) {
  if (options.firstRun) {
    config.bots.slack.defaults.enabled = bots.slackBots.length > 0;
    for (const botId of Object.keys(getSlackBots(config))) {
      delete config.bots.slack[botId];
    }
    config.bots.slack.default = createSlackBotShell("default");
    config.bots.slack.defaults.defaultBotId = getFirstBotId(bots.slackBots);

    config.bots.telegram.defaults.enabled = bots.telegramBots.length > 0;
    for (const botId of Object.keys(getTelegramBots(config))) {
      delete config.bots.telegram[botId];
    }
    config.bots.telegram.default = createTelegramBotShell("default");
    config.bots.telegram.defaults.defaultBotId = getFirstBotId(bots.telegramBots);
  }

  if (bots.slackBots.length > 0) {
    config.bots.slack.defaults.enabled = true;
    if (!config.bots.slack.defaults.defaultBotId) {
      config.bots.slack.defaults.defaultBotId = getFirstBotId(bots.slackBots);
    }
    for (const bot of bots.slackBots) {
      applySlackBotConfig(config, bot);
    }
    reconcileSlackConfiguredBots(config);
  }

  if (bots.telegramBots.length > 0) {
    config.bots.telegram.defaults.enabled = true;
    if (!config.bots.telegram.defaults.defaultBotId) {
      config.bots.telegram.defaults.defaultBotId = getFirstBotId(bots.telegramBots);
    }
    for (const bot of bots.telegramBots) {
      applyTelegramBotConfig(config, bot);
    }
    reconcileTelegramConfiguredBots(config);
  }
}

export function stageBootstrapRuntimeCredentials(
  bots: ChannelBootstrapBots,
  runtimeCredentialsPath?: string,
) {
  for (const bot of bots.slackBots) {
    if (bot.appToken?.kind !== "mem" || bot.botToken?.kind !== "mem") {
      continue;
    }
    setSlackRuntimeCredential({
      botId: bot.botId,
      appToken: bot.appToken.secret,
      botToken: bot.botToken.secret,
      runtimeCredentialsPath,
    });
  }

  for (const bot of bots.telegramBots) {
    if (bot.botToken?.kind !== "mem") {
      continue;
    }
    setTelegramRuntimeCredential({
      botId: bot.botId,
      botToken: bot.botToken.secret,
      runtimeCredentialsPath,
    });
  }
}

export function persistBootstrapMemBotCredentials(
  config: ClisbotConfig,
  bots: ChannelBootstrapBots,
  runtimeCredentialsPath?: string,
) {
  const summaries: string[] = [];

  for (const bot of bots.slackBots) {
    if (bot.appToken?.kind !== "mem" || bot.botToken?.kind !== "mem") {
      continue;
    }
    persistSlackCredential({
      botId: bot.botId,
      appToken: bot.appToken.secret,
      botToken: bot.botToken.secret,
    });
    config.bots.slack[bot.botId] = {
      ...(config.bots.slack[bot.botId] ?? {}),
      enabled: true,
      credentialType: "tokenFile",
      appToken: "",
      botToken: "",
      appTokenFile: undefined,
      botTokenFile: undefined,
    };
    clearSlackRuntimeCredential({
      botId: bot.botId,
      runtimeCredentialsPath,
    });
    summaries.push(`Persisted slack/${bot.botId} to credential file.`);
  }

  for (const bot of bots.telegramBots) {
    if (bot.botToken?.kind !== "mem") {
      continue;
    }
    persistTelegramCredential({
      botId: bot.botId,
      botToken: bot.botToken.secret,
    });
    config.bots.telegram[bot.botId] = {
      ...(config.bots.telegram[bot.botId] ?? {}),
      enabled: true,
      credentialType: "tokenFile",
      botToken: "",
      tokenFile: undefined,
    };
    clearTelegramRuntimeCredential({
      botId: bot.botId,
      runtimeCredentialsPath,
    });
    summaries.push(`Persisted telegram/${bot.botId} to credential file.`);
  }

  reconcileSlackConfiguredBots(config);
  reconcileTelegramConfiguredBots(config);

  return summaries;
}
