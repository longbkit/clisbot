import { join } from "node:path";
import type {
  ClisbotConfig,
  SlackBotConfig,
  TelegramBotConfig,
  ZaloBotConfig,
} from "./schema.ts";
import { extractEnvReferenceName, normalizeEnvReference } from "../shared/env-references.ts";
import { getDefaultCredentialsDir } from "../shared/paths.ts";

const TOKEN_ENV_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export type SlackPersistentBotConfig = SlackBotConfig;
export type TelegramPersistentBotConfig = TelegramBotConfig;
export type ZaloBotPersistentBotConfig = ZaloBotConfig;
export type SlackPersistentAccountConfig = SlackPersistentBotConfig;
export type TelegramPersistentAccountConfig = TelegramPersistentBotConfig;
export type ZaloBotPersistentAccountConfig = ZaloBotPersistentBotConfig;

export type RuntimeCredentialDocument = {
  slack?: Record<string, { appToken?: string; botToken?: string }>;
  telegram?: Record<string, { botToken?: string }>;
  "zalo-bot"?: Record<string, { botToken?: string }>;
};

export type ParsedTokenInput =
  | {
      kind: "env";
      envName: string;
      placeholder: string;
    }
  | {
      kind: "mem";
      secret: string;
    };

export type ResolvedCredentialSource =
  | {
      source: "cli-ephemeral";
      detail: string;
    }
  | {
      source: "credential-file";
      detail: string;
      paths: string[];
    }
  | {
      source: "env";
      detail: string;
      names: string[];
    }
  | {
      source: "config-inline";
      detail: string;
    };

export type ResolvedSlackCredential = {
  botId: string;
  appToken: string;
  botToken: string;
  source: ResolvedCredentialSource;
};

export type ResolvedTelegramCredential = {
  botId: string;
  botToken: string;
  source: ResolvedCredentialSource;
};

export type ResolvedZaloBotCredential = {
  botId: string;
  botToken: string;
  source: ResolvedCredentialSource;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeBotId(botId?: string | null) {
  const trimmed = botId?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeAccountId(accountId?: string | null) {
  return normalizeBotId(accountId);
}

export function getSlackBotsRecord(
  config: ClisbotConfig["bots"]["slack"],
) {
  const { defaults, ...bots } = config;
  return bots;
}

export function getTelegramBotsRecord(
  config: ClisbotConfig["bots"]["telegram"],
) {
  const { defaults, ...bots } = config;
  return bots;
}

export function getZaloBotBotsRecord(
  config: ClisbotConfig["bots"]["zaloBot"],
) {
  const { defaults, ...bots } = config;
  return bots;
}

function normalizeBotEnvSegment(botId: string) {
  return botId
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_|_$/g, "")
    .toUpperCase() || "DEFAULT";
}

export function getConfiguredDefaultBotId(params: {
  defaultAccount?: string;
  defaultBotId?: string;
  accounts?: unknown;
  bots?: Record<string, unknown>;
}) {
  const explicit =
    normalizeBotId(params.defaultBotId) ??
    normalizeBotId(params.defaultAccount);
  if (explicit) {
    return explicit;
  }

  const bots = params.bots ??
    (isRecord(params.accounts) ? (params.accounts as Record<string, unknown>) : {});

  if ("default" in bots) {
    return "default";
  }

  const firstBotId = Object.keys(bots)[0];
  return normalizeBotId(firstBotId) ?? "default";
}

export function getConfiguredDefaultAccountId(params: {
  defaultAccount?: string;
  defaultBotId?: string;
  accounts?: unknown;
  bots?: Record<string, unknown>;
}) {
  return getConfiguredDefaultBotId(params);
}

export function getTelegramMemEnvName(botId: string) {
  return `CLISBOT_MEM_TELEGRAM__${normalizeBotEnvSegment(botId)}__BOT_TOKEN`;
}

export function getZaloBotMemEnvName(botId: string) {
  return `CLISBOT_MEM_ZALO_BOT__${normalizeBotEnvSegment(botId)}__BOT_TOKEN`;
}

export function getSlackMemAppEnvName(botId: string) {
  return `CLISBOT_MEM_SLACK__${normalizeBotEnvSegment(botId)}__APP_TOKEN`;
}

export function getSlackMemBotEnvName(botId: string) {
  return `CLISBOT_MEM_SLACK__${normalizeBotEnvSegment(botId)}__BOT_TOKEN`;
}

export function trimString(value?: string) {
  return value?.trim() ?? "";
}

export function getTelegramBotConfig(
  config: ClisbotConfig["bots"]["telegram"],
  botId: string,
) {
  return getTelegramBotsRecord(config)[botId] as TelegramPersistentBotConfig | undefined;
}

export function getZaloBotConfig(
  config: ClisbotConfig["bots"]["zaloBot"],
  botId: string,
) {
  return getZaloBotBotsRecord(config)[botId] as ZaloBotPersistentBotConfig | undefined;
}

export function getSlackBotConfig(
  config: ClisbotConfig["bots"]["slack"],
  botId: string,
) {
  return getSlackBotsRecord(config)[botId] as SlackPersistentBotConfig | undefined;
}

export function getTelegramAccountConfig(
  config: ClisbotConfig["bots"]["telegram"],
  accountId: string,
) {
  return getTelegramBotConfig(config, accountId);
}

export function getSlackAccountConfig(
  config: ClisbotConfig["bots"]["slack"],
  accountId: string,
) {
  return getSlackBotConfig(config, accountId);
}

export function getTelegramEnvReference(
  config: ClisbotConfig["bots"]["telegram"],
  botId: string,
) {
  const bot = getTelegramBotConfig(config, botId);
  return trimString(bot?.botToken);
}

export function getZaloBotEnvReference(
  config: ClisbotConfig["bots"]["zaloBot"],
  botId: string,
) {
  const bot = getZaloBotConfig(config, botId);
  return trimString(bot?.botToken);
}

export function getSlackEnvReference(
  config: ClisbotConfig["bots"]["slack"],
  botId: string,
) {
  const bot = getSlackBotConfig(config, botId);
  return {
    appToken: trimString(bot?.appToken),
    botToken: trimString(bot?.botToken),
  };
}

export function getCredentialSkipPaths(parsed: unknown) {
  const skipPaths: string[] = [];
  const bots = isRecord(parsed) ? parsed.bots : undefined;

  if (!isRecord(bots)) {
    return skipPaths;
  }

  const slack = isRecord(bots.slack) ? bots.slack : undefined;
  if (slack) {
    for (const [botId, bot] of Object.entries(slack)) {
      if (botId === "defaults" || !isRecord(bot)) {
        continue;
      }
      skipPaths.push(
        `bots.slack.${botId}.appToken`,
        `bots.slack.${botId}.botToken`,
      );
    }
  }

  const telegram = isRecord(bots.telegram) ? bots.telegram : undefined;
  if (telegram) {
    for (const [botId, bot] of Object.entries(telegram)) {
      if (botId === "defaults" || !isRecord(bot)) {
        continue;
      }
      skipPaths.push(`bots.telegram.${botId}.botToken`);
    }
  }

  const zaloBot = isRecord(bots.zaloBot) ? bots.zaloBot : undefined;
  if (zaloBot) {
    for (const [botId, bot] of Object.entries(zaloBot)) {
      if (botId === "defaults" || !isRecord(bot)) {
        continue;
      }
      skipPaths.push(`bots.zaloBot.${botId}.botToken`);
    }
  }

  return skipPaths;
}

export function parseTokenInput(value: string): ParsedTokenInput {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Expected a token value or env reference");
  }

  const normalizedEnv = normalizeEnvReference(trimmed);
  const envName = extractEnvReferenceName(normalizedEnv);
  if (envName) {
    return {
      kind: "env",
      envName,
      placeholder: `\${${envName}}`,
    };
  }

  if (TOKEN_ENV_PATTERN.test(trimmed)) {
    return {
      kind: "env",
      envName: trimmed,
      placeholder: `\${${trimmed}}`,
    };
  }

  return {
    kind: "mem",
    secret: trimmed,
  };
}

export function getCanonicalTelegramBotTokenPath(
  botId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return join(getDefaultCredentialsDir(env), "telegram", botId, "bot-token");
}

export function getCanonicalZaloBotTokenPath(
  botId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return join(getDefaultCredentialsDir(env), "zalo-bot", botId, "bot-token");
}

export function getCanonicalSlackAppTokenPath(
  botId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return join(getDefaultCredentialsDir(env), "slack", botId, "app-token");
}

export function getCanonicalSlackBotTokenPath(
  botId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return join(getDefaultCredentialsDir(env), "slack", botId, "bot-token");
}
