import { MissingEnvVarError } from "./env-substitution.ts";
import type { ClisbotConfig } from "./schema.ts";
import {
  getCanonicalSlackAppTokenPath,
  getCanonicalSlackBotTokenPath,
  getCanonicalTelegramBotTokenPath,
  getConfiguredDefaultBotId,
  getCredentialSkipPaths,
  getSlackBotConfig,
  getSlackBotsRecord,
  getSlackEnvReference,
  getSlackMemAppEnvName,
  getSlackMemBotEnvName,
  getTelegramBotConfig,
  getTelegramBotsRecord,
  getTelegramEnvReference,
  getTelegramMemEnvName,
  normalizeBotId,
  parseTokenInput,
  type ParsedTokenInput,
  type ResolvedCredentialSource,
  type ResolvedSlackCredential,
  type ResolvedTelegramCredential,
  type SlackPersistentBotConfig,
  type TelegramPersistentBotConfig,
  trimString,
} from "./channel-credentials-shared.ts";
import {
  clearSlackRuntimeCredential,
  clearTelegramRuntimeCredential,
  getConfigReloadMtimeMs,
  getRuntimeCredentialDocument,
  persistSlackCredential,
  persistTelegramCredential,
  readOptionalCanonicalCredentialFile,
  readRequiredCredentialFile,
  removeRuntimeCredentials,
  setSlackRuntimeCredential,
  setTelegramRuntimeCredential,
} from "./channel-runtime-credentials.ts";
import { extractEnvReferenceName } from "../shared/env-references.ts";
import {
  collapseHomePath,
  expandHomePath,
} from "../shared/paths.ts";

export class MissingMemCredentialError extends Error {
  constructor(
    readonly provider: "slack" | "telegram",
    readonly botId: string,
  ) {
    super(
      provider === "telegram"
        ? `Telegram bot ${botId} is configured with credentialType=mem but no runtime credential is available.`
        : `Slack bot ${botId} is configured with credentialType=mem but no runtime credential is available.`,
    );
    this.name = "MissingMemCredentialError";
  }
}

export function validatePersistentChannelCredentials(config: ClisbotConfig) {
  const validateTokenField = (value: string | undefined, configPath: string) => {
    const trimmed = trimString(value);
    if (!trimmed) {
      return;
    }
    if (extractEnvReferenceName(trimmed)) {
      return;
    }
    throw new Error(
      `Raw channel token literals are not allowed in clisbot.json (${configPath}). Use an env placeholder, credentialType=mem, or credentialType=tokenFile.`,
    );
  };

  for (const botId of Object.keys(getSlackBotsRecord(config.bots.slack))) {
    const bot = getSlackBotConfig(config.bots.slack, botId);
    validateTokenField(bot?.appToken, `bots.slack.${botId}.appToken`);
    validateTokenField(bot?.botToken, `bots.slack.${botId}.botToken`);
  }

  for (const botId of Object.keys(getTelegramBotsRecord(config.bots.telegram))) {
    const bot = getTelegramBotConfig(config.bots.telegram, botId);
    validateTokenField(bot?.botToken, `bots.telegram.${botId}.botToken`);
  }
}

export function resolveTelegramCredential(params: {
  config: ClisbotConfig["bots"]["telegram"];
  botId?: string | null;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}): ResolvedTelegramCredential {
  const env = params.env ?? process.env;
  const botId = normalizeBotId(params.botId ?? params.accountId) ?? getConfiguredDefaultBotId({
    defaultBotId: params.config.defaults.defaultBotId,
    bots: getTelegramBotsRecord(params.config),
  });
  const bot = getTelegramBotConfig(params.config, botId);

  if (bot?.credentialType === "mem") {
    const envName = getTelegramMemEnvName(botId);
    const secret = env[envName]?.trim() ||
      getRuntimeCredentialDocument(params.runtimeCredentialsPath).telegram?.[botId]?.botToken
        ?.trim();
    if (!secret) {
      throw new MissingMemCredentialError("telegram", botId);
    }
    return {
      botId,
      botToken: secret,
      source: {
        source: "cli-ephemeral",
        detail: "source=cli-ephemeral restartRequiresPersistence=yes",
      },
    };
  }

  const explicitTokenFile = trimString(bot?.tokenFile);
  const canonicalTokenFile = getCanonicalTelegramBotTokenPath(botId, env);
  if (explicitTokenFile) {
    return {
      botId,
      botToken: readRequiredCredentialFile(
        explicitTokenFile,
        `bots.telegram.${botId}.tokenFile`,
      ),
      source: {
        source: "credential-file",
        detail: `source=credential-file path=${collapseHomePath(expandHomePath(explicitTokenFile))}`,
        paths: [expandHomePath(explicitTokenFile)],
      },
    };
  }

  if (bot?.credentialType === "tokenFile") {
    return {
      botId,
      botToken: readRequiredCredentialFile(
        canonicalTokenFile,
        `bots.telegram.${botId}`,
      ),
      source: {
        source: "credential-file",
        detail: `source=credential-file path=${collapseHomePath(canonicalTokenFile)}`,
        paths: [canonicalTokenFile],
      },
    };
  }

  const canonicalToken = readOptionalCanonicalCredentialFile(canonicalTokenFile);
  if (canonicalToken) {
    return {
      botId,
      botToken: canonicalToken,
      source: {
        source: "credential-file",
        detail: `source=credential-file path=${collapseHomePath(canonicalTokenFile)}`,
        paths: [canonicalTokenFile],
      },
    };
  }

  const envReference = getTelegramEnvReference(params.config, botId);
  const envName = extractEnvReferenceName(envReference);
  if (envName) {
    const value = env[envName]?.trim();
    if (!value) {
      throw new MissingEnvVarError(
        envName,
        `bots.telegram.${botId}.botToken`,
      );
    }
    return {
      botId,
      botToken: value,
      source: {
        source: "env",
        detail: `source=env name=${envName}`,
        names: [envName],
      },
    };
  }

  if (envReference.trim()) {
    return {
      botId,
      botToken: envReference.trim(),
      source: {
        source: "config-inline",
        detail: "source=config-inline legacyCompatibility=yes",
      },
    };
  }

  throw new Error(`Unknown Telegram bot: ${botId}`);
}

export function resolveSlackCredential(params: {
  config: ClisbotConfig["bots"]["slack"];
  botId?: string | null;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}): ResolvedSlackCredential {
  const env = params.env ?? process.env;
  const botId = normalizeBotId(params.botId ?? params.accountId) ?? getConfiguredDefaultBotId({
    defaultBotId: params.config.defaults.defaultBotId,
    bots: getSlackBotsRecord(params.config),
  });
  const bot = getSlackBotConfig(params.config, botId);

  if (bot?.credentialType === "mem") {
    const appEnvName = getSlackMemAppEnvName(botId);
    const botEnvName = getSlackMemBotEnvName(botId);
    const runtime = getRuntimeCredentialDocument(params.runtimeCredentialsPath).slack?.[botId];
    const appToken = env[appEnvName]?.trim() || runtime?.appToken?.trim();
    const botToken = env[botEnvName]?.trim() || runtime?.botToken?.trim();
    if (!appToken || !botToken) {
      throw new MissingMemCredentialError("slack", botId);
    }
    return {
      botId,
      appToken,
      botToken,
      source: {
        source: "cli-ephemeral",
        detail: "source=cli-ephemeral restartRequiresPersistence=yes",
      },
    };
  }

  const explicitAppTokenFile = trimString(bot?.appTokenFile);
  const explicitBotTokenFile = trimString(bot?.botTokenFile);
  if (explicitAppTokenFile || explicitBotTokenFile) {
    if (!explicitAppTokenFile || !explicitBotTokenFile) {
      throw new Error(
        `Slack bot ${botId} requires both appTokenFile and botTokenFile when either one is configured.`,
      );
    }
    return {
      botId,
      appToken: readRequiredCredentialFile(
        explicitAppTokenFile,
        `bots.slack.${botId}.appTokenFile`,
      ),
      botToken: readRequiredCredentialFile(
        explicitBotTokenFile,
        `bots.slack.${botId}.botTokenFile`,
      ),
      source: {
        source: "credential-file",
        detail:
          `source=credential-file appPath=${collapseHomePath(expandHomePath(explicitAppTokenFile))} ` +
          `botPath=${collapseHomePath(expandHomePath(explicitBotTokenFile))}`,
        paths: [
          expandHomePath(explicitAppTokenFile),
          expandHomePath(explicitBotTokenFile),
        ],
      },
    };
  }

  const canonicalAppTokenFile = getCanonicalSlackAppTokenPath(botId, env);
  const canonicalBotTokenFile = getCanonicalSlackBotTokenPath(botId, env);
  if (bot?.credentialType === "tokenFile") {
    return {
      botId,
      appToken: readRequiredCredentialFile(
        canonicalAppTokenFile,
        `bots.slack.${botId}`,
      ),
      botToken: readRequiredCredentialFile(
        canonicalBotTokenFile,
        `bots.slack.${botId}`,
      ),
      source: {
        source: "credential-file",
        detail:
          `source=credential-file appPath=${collapseHomePath(canonicalAppTokenFile)} ` +
          `botPath=${collapseHomePath(canonicalBotTokenFile)}`,
        paths: [canonicalAppTokenFile, canonicalBotTokenFile],
      },
    };
  }

  const canonicalAppToken = readOptionalCanonicalCredentialFile(canonicalAppTokenFile);
  const canonicalBotToken = readOptionalCanonicalCredentialFile(canonicalBotTokenFile);
  if (canonicalAppToken || canonicalBotToken) {
    if (!canonicalAppToken || !canonicalBotToken) {
      throw new Error(
        `Slack canonical credential files for bot ${botId} are incomplete.`,
      );
    }
    return {
      botId,
      appToken: canonicalAppToken,
      botToken: canonicalBotToken,
      source: {
        source: "credential-file",
        detail:
          `source=credential-file appPath=${collapseHomePath(canonicalAppTokenFile)} ` +
          `botPath=${collapseHomePath(canonicalBotTokenFile)}`,
        paths: [canonicalAppTokenFile, canonicalBotTokenFile],
      },
    };
  }

  const envReference = getSlackEnvReference(params.config, botId);
  const appEnvName = extractEnvReferenceName(envReference.appToken);
  const botEnvName = extractEnvReferenceName(envReference.botToken);
  if (appEnvName && botEnvName) {
    const appToken = env[appEnvName]?.trim();
    const botToken = env[botEnvName]?.trim();
    if (!appToken) {
      throw new MissingEnvVarError(
        appEnvName,
        `bots.slack.${botId}.appToken`,
      );
    }
    if (!botToken) {
      throw new MissingEnvVarError(
        botEnvName,
        `bots.slack.${botId}.botToken`,
      );
    }
    return {
      botId,
      appToken,
      botToken,
      source: {
        source: "env",
        detail: `source=env app=${appEnvName} bot=${botEnvName}`,
        names: [appEnvName, botEnvName],
      },
    };
  }

  if (envReference.appToken.trim() && envReference.botToken.trim()) {
    return {
      botId,
      appToken: envReference.appToken.trim(),
      botToken: envReference.botToken.trim(),
      source: {
        source: "config-inline",
        detail: "source=config-inline legacyCompatibility=yes",
      },
    };
  }

  throw new Error(`Unknown Slack bot: ${botId}`);
}

export function materializeRuntimeChannelCredentials(
  config: ClisbotConfig,
  options: {
    env?: NodeJS.ProcessEnv;
    runtimeCredentialsPath?: string;
    materializeChannels?: Array<"slack" | "telegram" | "teams">;
  } = {},
) {
  const env = options.env ?? process.env;
  const nextConfig = structuredClone(config) as ClisbotConfig;
  const materializeChannels = options.materializeChannels ?? [];
  const materializeAll = materializeChannels.length === 0;
  const shouldMaterializeTelegram =
    materializeAll || materializeChannels.includes("telegram");
  const shouldMaterializeSlack =
    materializeAll || materializeChannels.includes("slack");

  if (shouldMaterializeTelegram && nextConfig.bots.telegram.defaults.enabled) {
    const configuredBotIds = Object.keys(getTelegramBotsRecord(nextConfig.bots.telegram));
    const botIds = configuredBotIds.length > 0
      ? configuredBotIds
      : [getConfiguredDefaultBotId({
        defaultBotId: nextConfig.bots.telegram.defaults.defaultBotId,
        bots: getTelegramBotsRecord(nextConfig.bots.telegram),
      })];
    const resolvedBots: Record<string, TelegramPersistentBotConfig> = {};
    for (const botId of botIds) {
      const existing = (getTelegramBotConfig(nextConfig.bots.telegram, botId) ?? {}) as
        TelegramPersistentBotConfig;
      if (existing.enabled === false) {
        continue;
      }
      let resolved: ResolvedTelegramCredential | undefined;
      try {
        resolved = resolveTelegramCredential({
          config: config.bots.telegram,
          botId,
          env,
          runtimeCredentialsPath: options.runtimeCredentialsPath,
        });
      } catch (error) {
        if (!(error instanceof MissingMemCredentialError)) {
          throw error;
        }
      }
      if (!resolved) {
        continue;
      }
      resolvedBots[botId] = {
        ...existing,
        botToken: resolved.botToken,
      };
    }
    for (const [botId, resolved] of Object.entries(resolvedBots)) {
      const current = nextConfig.bots.telegram[botId] as TelegramPersistentBotConfig | undefined;
      if (!current) {
        continue;
      }
      nextConfig.bots.telegram[botId] = {
        ...current,
        botToken: resolved.botToken,
      };
    }
  }

  if (shouldMaterializeSlack && nextConfig.bots.slack.defaults.enabled) {
    const configuredBotIds = Object.keys(getSlackBotsRecord(nextConfig.bots.slack));
    const botIds = configuredBotIds.length > 0
      ? configuredBotIds
      : [getConfiguredDefaultBotId({
        defaultBotId: nextConfig.bots.slack.defaults.defaultBotId,
        bots: getSlackBotsRecord(nextConfig.bots.slack),
      })];
    const resolvedBots: Record<string, SlackPersistentBotConfig> = {};
    for (const botId of botIds) {
      const existing = (getSlackBotConfig(nextConfig.bots.slack, botId) ?? {}) as
        SlackPersistentBotConfig;
      if (existing.enabled === false) {
        continue;
      }
      let resolved: ResolvedSlackCredential | undefined;
      try {
        resolved = resolveSlackCredential({
          config: config.bots.slack,
          botId,
          env,
          runtimeCredentialsPath: options.runtimeCredentialsPath,
        });
      } catch (error) {
        if (!(error instanceof MissingMemCredentialError)) {
          throw error;
        }
      }
      if (!resolved) {
        continue;
      }
      resolvedBots[botId] = {
        ...existing,
        appToken: resolved.appToken,
        botToken: resolved.botToken,
      };
    }
    for (const [botId, resolved] of Object.entries(resolvedBots)) {
      const current = nextConfig.bots.slack[botId] as SlackPersistentBotConfig | undefined;
      if (!current) {
        continue;
      }
      nextConfig.bots.slack[botId] = {
        ...current,
        appToken: resolved.appToken,
        botToken: resolved.botToken,
      };
    }
  }

  return nextConfig;
}

export function describeTelegramCredentialSource(params: {
  config: ClisbotConfig["bots"]["telegram"];
  botId?: string | null;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const env = params.env ?? process.env;
  const botId = normalizeBotId(params.botId ?? params.accountId) ?? getConfiguredDefaultBotId({
    defaultBotId: params.config.defaults.defaultBotId,
    bots: getTelegramBotsRecord(params.config),
  });
  const bot = getTelegramBotConfig(params.config, botId);
  if (bot?.credentialType === "mem") {
    const envName = getTelegramMemEnvName(botId);
    const runtimeBotToken = getRuntimeCredentialDocument(params.runtimeCredentialsPath).telegram?.[botId]
      ?.botToken?.trim();
    return {
      source: "cli-ephemeral" as const,
      detail: env[envName]?.trim() || runtimeBotToken
        ? "source=cli-ephemeral restartRequiresPersistence=yes"
        : "source=cli-ephemeral available=no restartRequiresPersistence=yes",
    };
  }
  return resolveTelegramCredential(params).source;
}

export function describeSlackCredentialSource(params: {
  config: ClisbotConfig["bots"]["slack"];
  botId?: string | null;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const env = params.env ?? process.env;
  const botId = normalizeBotId(params.botId ?? params.accountId) ?? getConfiguredDefaultBotId({
    defaultBotId: params.config.defaults.defaultBotId,
    bots: getSlackBotsRecord(params.config),
  });
  const bot = getSlackBotConfig(params.config, botId);
  if (bot?.credentialType === "mem") {
    const appEnvName = getSlackMemAppEnvName(botId);
    const botEnvName = getSlackMemBotEnvName(botId);
    const runtime = getRuntimeCredentialDocument(params.runtimeCredentialsPath).slack?.[botId];
    return {
      source: "cli-ephemeral" as const,
      detail:
        env[appEnvName]?.trim() || env[botEnvName]?.trim() || runtime?.appToken?.trim() || runtime?.botToken?.trim()
          ? "source=cli-ephemeral restartRequiresPersistence=yes"
          : "source=cli-ephemeral available=no restartRequiresPersistence=yes",
    };
  }
  return resolveSlackCredential(params).source;
}

export {
  clearSlackRuntimeCredential,
  clearTelegramRuntimeCredential,
  getCanonicalSlackAppTokenPath,
  getCanonicalSlackBotTokenPath,
  getCanonicalTelegramBotTokenPath,
  getConfigReloadMtimeMs,
  getCredentialSkipPaths,
  getSlackMemAppEnvName,
  getSlackMemBotEnvName,
  getTelegramMemEnvName,
  parseTokenInput,
  persistSlackCredential,
  persistTelegramCredential,
  removeRuntimeCredentials,
  setSlackRuntimeCredential,
  setTelegramRuntimeCredential,
};
export type {
  ParsedTokenInput,
  ResolvedCredentialSource,
  ResolvedSlackCredential,
  ResolvedTelegramCredential,
};
