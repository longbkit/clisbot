import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { MissingEnvVarError } from "./env-substitution.ts";
import type { ClisbotConfig } from "./schema.ts";
import { extractEnvReferenceName, normalizeEnvReference } from "../shared/env-references.ts";
import {
  collapseHomePath,
  expandHomePath,
  getDefaultCredentialsDir,
  getDefaultRuntimeCredentialsPath,
} from "../shared/paths.ts";

const ENV_REFERENCE_PATHS = [
  "channels.slack.appToken",
  "channels.slack.botToken",
  "channels.telegram.botToken",
];

const CREDENTIALS_GITIGNORE_CONTENT = ["*", "!*/", "!.gitignore", ""].join("\n");

const TOKEN_ENV_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

type SlackPersistentAccountConfig = ClisbotConfig["channels"]["slack"]["accounts"][string];
type TelegramPersistentAccountConfig = ClisbotConfig["channels"]["telegram"]["accounts"][string];

type RuntimeCredentialDocument = {
  slack?: Record<string, { appToken?: string; botToken?: string }>;
  telegram?: Record<string, { botToken?: string }>;
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
  accountId: string;
  appToken: string;
  botToken: string;
  source: ResolvedCredentialSource;
};

export type ResolvedTelegramCredential = {
  accountId: string;
  botToken: string;
  source: ResolvedCredentialSource;
};

export class MissingMemCredentialError extends Error {
  constructor(
    readonly provider: "slack" | "telegram",
    readonly accountId: string,
  ) {
    super(
      provider === "telegram"
        ? `Telegram account ${accountId} is configured with credentialType=mem but no runtime credential is available.`
        : `Slack account ${accountId} is configured with credentialType=mem but no runtime credential is available.`,
    );
    this.name = "MissingMemCredentialError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAccountsRecord(accounts: unknown) {
  if (!isRecord(accounts)) {
    return {} as Record<string, unknown>;
  }
  return accounts;
}

function normalizeAccountId(accountId?: string | null) {
  const trimmed = accountId?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAccountEnvSegment(accountId: string) {
  return accountId
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_|_$/g, "")
    .toUpperCase() || "DEFAULT";
}

function getConfiguredDefaultAccountId(params: {
  defaultAccount?: string;
  accounts: unknown;
}) {
  const accounts = getAccountsRecord(params.accounts);
  const explicit = normalizeAccountId(params.defaultAccount);
  if (explicit) {
    return explicit;
  }

  if ("default" in accounts) {
    return "default";
  }

  const firstAccountId = Object.keys(accounts)[0];
  return normalizeAccountId(firstAccountId) ?? "default";
}

export function getTelegramMemEnvName(accountId: string) {
  return `CLISBOT_MEM_TELEGRAM__${normalizeAccountEnvSegment(accountId)}__BOT_TOKEN`;
}

export function getSlackMemAppEnvName(accountId: string) {
  return `CLISBOT_MEM_SLACK__${normalizeAccountEnvSegment(accountId)}__APP_TOKEN`;
}

export function getSlackMemBotEnvName(accountId: string) {
  return `CLISBOT_MEM_SLACK__${normalizeAccountEnvSegment(accountId)}__BOT_TOKEN`;
}

function readTrimmedFile(pathname: string) {
  return readFileSync(pathname, "utf8").trim();
}

function readRequiredCredentialFile(pathname: string, configPath: string) {
  const expanded = expandHomePath(pathname);
  if (!existsSync(expanded)) {
    throw new Error(`Missing credential file for ${configPath}: ${expanded}`);
  }

  const value = readTrimmedFile(expanded);
  if (!value) {
    throw new Error(`Credential file is empty for ${configPath}: ${expanded}`);
  }

  return value;
}

function readOptionalCanonicalCredentialFile(pathname: string) {
  const expanded = expandHomePath(pathname);
  if (!existsSync(expanded)) {
    return undefined;
  }

  const value = readTrimmedFile(expanded);
  if (!value) {
    throw new Error(`Credential file is empty: ${expanded}`);
  }

  return value;
}

function getRuntimeCredentialDocument(
  runtimeCredentialsPath = getDefaultRuntimeCredentialsPath(),
): RuntimeCredentialDocument {
  const expanded = expandHomePath(runtimeCredentialsPath);
  if (!existsSync(expanded)) {
    return {};
  }

  const text = readTrimmedFile(expanded);
  if (!text) {
    return {};
  }

  return JSON.parse(text) as RuntimeCredentialDocument;
}

function writeRuntimeCredentialDocument(
  document: RuntimeCredentialDocument,
  runtimeCredentialsPath = getDefaultRuntimeCredentialsPath(),
) {
  const expanded = expandHomePath(runtimeCredentialsPath);
  mkdirSync(dirname(expanded), { recursive: true });
  writeFileSync(expanded, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(expanded, 0o600);
}

function writeSecretFile(pathname: string, value: string) {
  const expanded = expandHomePath(pathname);
  mkdirSync(dirname(expanded), { recursive: true });
  writeFileSync(expanded, `${value.trim()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(expanded, 0o600);
}

function trimString(value?: string) {
  return value?.trim() ?? "";
}

function getTelegramAccountConfig(
  config: ClisbotConfig["channels"]["telegram"],
  accountId: string,
) {
  return getAccountsRecord(config.accounts)[accountId] as TelegramPersistentAccountConfig | undefined;
}

function getSlackAccountConfig(
  config: ClisbotConfig["channels"]["slack"],
  accountId: string,
) {
  return getAccountsRecord(config.accounts)[accountId] as SlackPersistentAccountConfig | undefined;
}

function getTelegramEnvReference(
  config: ClisbotConfig["channels"]["telegram"],
  accountId: string,
) {
  const account = getTelegramAccountConfig(config, accountId);
  const accountToken = trimString(account?.botToken);
  if (accountToken) {
    return accountToken;
  }
  return trimString(config.botToken);
}

function getSlackEnvReference(
  config: ClisbotConfig["channels"]["slack"],
  accountId: string,
) {
  const account = getSlackAccountConfig(config, accountId);
  return {
    appToken: trimString(account?.appToken) || trimString(config.appToken),
    botToken: trimString(account?.botToken) || trimString(config.botToken),
  };
}

function ensureCanonicalCredentialArtifacts(env: NodeJS.ProcessEnv = process.env) {
  const credentialsDir = getDefaultCredentialsDir(env);
  mkdirSync(credentialsDir, { recursive: true });
  const ignorePath = join(credentialsDir, ".gitignore");
  if (!existsSync(ignorePath)) {
    writeFileSync(ignorePath, CREDENTIALS_GITIGNORE_CONTENT, {
      encoding: "utf8",
      mode: 0o644,
    });
  }
}

export function getCredentialSkipPaths(parsed: unknown) {
  const skipPaths = [...ENV_REFERENCE_PATHS];
  const channels = isRecord(parsed) ? parsed.channels : undefined;

  if (!isRecord(channels)) {
    return skipPaths;
  }

  const slack = isRecord(channels.slack) ? channels.slack : undefined;
  const slackAccounts = isRecord(slack?.accounts) ? slack.accounts : undefined;
  if (slackAccounts) {
    for (const accountId of Object.keys(slackAccounts)) {
      skipPaths.push(
        `channels.slack.accounts.${accountId}.appToken`,
        `channels.slack.accounts.${accountId}.botToken`,
      );
    }
  }

  const telegram = isRecord(channels.telegram) ? channels.telegram : undefined;
  const telegramAccounts = isRecord(telegram?.accounts) ? telegram.accounts : undefined;
  if (telegramAccounts) {
    for (const accountId of Object.keys(telegramAccounts)) {
      skipPaths.push(`channels.telegram.accounts.${accountId}.botToken`);
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
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return join(getDefaultCredentialsDir(env), "telegram", accountId, "bot-token");
}

export function getCanonicalSlackAppTokenPath(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return join(getDefaultCredentialsDir(env), "slack", accountId, "app-token");
}

export function getCanonicalSlackBotTokenPath(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  return join(getDefaultCredentialsDir(env), "slack", accountId, "bot-token");
}

export function removeRuntimeCredentials(
  runtimeCredentialsPath = getDefaultRuntimeCredentialsPath(),
) {
  rmSync(expandHomePath(runtimeCredentialsPath), { force: true });
}

export function setTelegramRuntimeCredential(params: {
  accountId: string;
  botToken: string;
  runtimeCredentialsPath?: string;
}) {
  const document = getRuntimeCredentialDocument(params.runtimeCredentialsPath);
  document.telegram ??= {};
  document.telegram[params.accountId] = {
    botToken: params.botToken.trim(),
  };
  writeRuntimeCredentialDocument(document, params.runtimeCredentialsPath);
}

export function setSlackRuntimeCredential(params: {
  accountId: string;
  appToken: string;
  botToken: string;
  runtimeCredentialsPath?: string;
}) {
  const document = getRuntimeCredentialDocument(params.runtimeCredentialsPath);
  document.slack ??= {};
  document.slack[params.accountId] = {
    appToken: params.appToken.trim(),
    botToken: params.botToken.trim(),
  };
  writeRuntimeCredentialDocument(document, params.runtimeCredentialsPath);
}

export function clearTelegramRuntimeCredential(params: {
  accountId: string;
  runtimeCredentialsPath?: string;
}) {
  const document = getRuntimeCredentialDocument(params.runtimeCredentialsPath);
  if (document.telegram) {
    delete document.telegram[params.accountId];
  }
  writeRuntimeCredentialDocument(document, params.runtimeCredentialsPath);
}

export function clearSlackRuntimeCredential(params: {
  accountId: string;
  runtimeCredentialsPath?: string;
}) {
  const document = getRuntimeCredentialDocument(params.runtimeCredentialsPath);
  if (document.slack) {
    delete document.slack[params.accountId];
  }
  writeRuntimeCredentialDocument(document, params.runtimeCredentialsPath);
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

  validateTokenField(config.channels.slack.appToken, "channels.slack.appToken");
  validateTokenField(config.channels.slack.botToken, "channels.slack.botToken");
  validateTokenField(config.channels.telegram.botToken, "channels.telegram.botToken");

  for (const accountId of Object.keys(getAccountsRecord(config.channels.slack.accounts))) {
    const account = getSlackAccountConfig(config.channels.slack, accountId);
    validateTokenField(account?.appToken, `channels.slack.accounts.${accountId}.appToken`);
    validateTokenField(account?.botToken, `channels.slack.accounts.${accountId}.botToken`);
  }

  for (const accountId of Object.keys(getAccountsRecord(config.channels.telegram.accounts))) {
    const account = getTelegramAccountConfig(config.channels.telegram, accountId);
    validateTokenField(account?.botToken, `channels.telegram.accounts.${accountId}.botToken`);
  }
}

export function resolveTelegramCredential(params: {
  config: ClisbotConfig["channels"]["telegram"];
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}): ResolvedTelegramCredential {
  const env = params.env ?? process.env;
  const accountId = normalizeAccountId(params.accountId) ?? getConfiguredDefaultAccountId({
    defaultAccount: params.config.defaultAccount,
    accounts: params.config.accounts,
  });
  const account = getTelegramAccountConfig(params.config, accountId);

  if (account?.credentialType === "mem") {
    const envName = getTelegramMemEnvName(accountId);
    const secret = env[envName]?.trim() ||
      getRuntimeCredentialDocument(params.runtimeCredentialsPath).telegram?.[accountId]?.botToken
        ?.trim();
    if (!secret) {
      throw new MissingMemCredentialError("telegram", accountId);
    }
    return {
      accountId,
      botToken: secret,
      source: {
        source: "cli-ephemeral",
        detail: "source=cli-ephemeral restartRequiresPersistence=yes",
      },
    };
  }

  const explicitTokenFile = trimString(account?.tokenFile);
  const canonicalTokenFile = getCanonicalTelegramBotTokenPath(accountId, env);
  if (explicitTokenFile) {
    return {
      accountId,
      botToken: readRequiredCredentialFile(
        explicitTokenFile,
        `channels.telegram.accounts.${accountId}.tokenFile`,
      ),
      source: {
        source: "credential-file",
        detail: `source=credential-file path=${collapseHomePath(expandHomePath(explicitTokenFile))}`,
        paths: [expandHomePath(explicitTokenFile)],
      },
    };
  }

  if (account?.credentialType === "tokenFile") {
    return {
      accountId,
      botToken: readRequiredCredentialFile(
        canonicalTokenFile,
        `channels.telegram.accounts.${accountId}`,
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
      accountId,
      botToken: canonicalToken,
      source: {
        source: "credential-file",
        detail: `source=credential-file path=${collapseHomePath(canonicalTokenFile)}`,
        paths: [canonicalTokenFile],
      },
    };
  }

  const envReference = getTelegramEnvReference(params.config, accountId);
  const envName = extractEnvReferenceName(envReference);
  if (envName) {
    const value = env[envName]?.trim();
    if (!value) {
      throw new MissingEnvVarError(
        envName,
        `channels.telegram.accounts.${accountId}.botToken`,
      );
    }
    return {
      accountId,
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
      accountId,
      botToken: envReference.trim(),
      source: {
        source: "config-inline",
        detail: "source=config-inline legacyCompatibility=yes",
      },
    };
  }

  throw new Error(`Unknown Telegram account: ${accountId}`);
}

export function resolveSlackCredential(params: {
  config: ClisbotConfig["channels"]["slack"];
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}): ResolvedSlackCredential {
  const env = params.env ?? process.env;
  const accountId = normalizeAccountId(params.accountId) ?? getConfiguredDefaultAccountId({
    defaultAccount: params.config.defaultAccount,
    accounts: params.config.accounts,
  });
  const account = getSlackAccountConfig(params.config, accountId);

  if (account?.credentialType === "mem") {
    const appEnvName = getSlackMemAppEnvName(accountId);
    const botEnvName = getSlackMemBotEnvName(accountId);
    const runtime = getRuntimeCredentialDocument(params.runtimeCredentialsPath).slack?.[accountId];
    const appToken = env[appEnvName]?.trim() || runtime?.appToken?.trim();
    const botToken = env[botEnvName]?.trim() || runtime?.botToken?.trim();
    if (!appToken || !botToken) {
      throw new MissingMemCredentialError("slack", accountId);
    }
    return {
      accountId,
      appToken,
      botToken,
      source: {
        source: "cli-ephemeral",
        detail: "source=cli-ephemeral restartRequiresPersistence=yes",
      },
    };
  }

  const explicitAppTokenFile = trimString(account?.appTokenFile);
  const explicitBotTokenFile = trimString(account?.botTokenFile);
  if (explicitAppTokenFile || explicitBotTokenFile) {
    if (!explicitAppTokenFile || !explicitBotTokenFile) {
      throw new Error(
        `Slack account ${accountId} requires both appTokenFile and botTokenFile when either one is configured.`,
      );
    }
    return {
      accountId,
      appToken: readRequiredCredentialFile(
        explicitAppTokenFile,
        `channels.slack.accounts.${accountId}.appTokenFile`,
      ),
      botToken: readRequiredCredentialFile(
        explicitBotTokenFile,
        `channels.slack.accounts.${accountId}.botTokenFile`,
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

  const canonicalAppTokenFile = getCanonicalSlackAppTokenPath(accountId, env);
  const canonicalBotTokenFile = getCanonicalSlackBotTokenPath(accountId, env);
  if (account?.credentialType === "tokenFile") {
    return {
      accountId,
      appToken: readRequiredCredentialFile(
        canonicalAppTokenFile,
        `channels.slack.accounts.${accountId}`,
      ),
      botToken: readRequiredCredentialFile(
        canonicalBotTokenFile,
        `channels.slack.accounts.${accountId}`,
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
        `Slack canonical credential files for account ${accountId} are incomplete.`,
      );
    }
    return {
      accountId,
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

  const envReference = getSlackEnvReference(params.config, accountId);
  const appEnvName = extractEnvReferenceName(envReference.appToken);
  const botEnvName = extractEnvReferenceName(envReference.botToken);
  if (appEnvName && botEnvName) {
    const appToken = env[appEnvName]?.trim();
    const botToken = env[botEnvName]?.trim();
    if (!appToken) {
      throw new MissingEnvVarError(
        appEnvName,
        `channels.slack.accounts.${accountId}.appToken`,
      );
    }
    if (!botToken) {
      throw new MissingEnvVarError(
        botEnvName,
        `channels.slack.accounts.${accountId}.botToken`,
      );
    }
    return {
      accountId,
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
      accountId,
      appToken: envReference.appToken.trim(),
      botToken: envReference.botToken.trim(),
      source: {
        source: "config-inline",
        detail: "source=config-inline legacyCompatibility=yes",
      },
    };
  }

  throw new Error(`Unknown Slack account: ${accountId}`);
}

export function materializeRuntimeChannelCredentials(
  config: ClisbotConfig,
  options: {
    env?: NodeJS.ProcessEnv;
    runtimeCredentialsPath?: string;
  } = {},
) {
  const env = options.env ?? process.env;
  const nextConfig = structuredClone(config) as ClisbotConfig;

  if (nextConfig.channels.telegram.enabled) {
    const accountIds = Object.keys(getAccountsRecord(nextConfig.channels.telegram.accounts));
    const ids = accountIds.length > 0
      ? accountIds
      : [getConfiguredDefaultAccountId({
        defaultAccount: nextConfig.channels.telegram.defaultAccount,
        accounts: nextConfig.channels.telegram.accounts,
      })];
    const resolvedAccounts: Record<string, TelegramPersistentAccountConfig> = {};
    for (const accountId of ids) {
      const existing = (getTelegramAccountConfig(nextConfig.channels.telegram, accountId) ?? {}) as
        TelegramPersistentAccountConfig;
      if (existing.enabled === false) {
        continue;
      }
      let resolved: ResolvedTelegramCredential | undefined;
      try {
        resolved = resolveTelegramCredential({
          config: config.channels.telegram,
          accountId,
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
      resolvedAccounts[accountId] = {
        ...existing,
        botToken: resolved.botToken,
      };
    }
    nextConfig.channels.telegram.accounts = resolvedAccounts;
    const preferredDefaultTelegramAccountId = normalizeAccountId(
      nextConfig.channels.telegram.defaultAccount,
    );
    const fallbackTelegramAccountId = preferredDefaultTelegramAccountId &&
        resolvedAccounts[preferredDefaultTelegramAccountId]
      ? preferredDefaultTelegramAccountId
      : Object.keys(resolvedAccounts)[0];
    nextConfig.channels.telegram.botToken = fallbackTelegramAccountId
      ? resolvedAccounts[fallbackTelegramAccountId]?.botToken ?? ""
      : "";
  }

  if (nextConfig.channels.slack.enabled) {
    const accountIds = Object.keys(getAccountsRecord(nextConfig.channels.slack.accounts));
    const ids = accountIds.length > 0
      ? accountIds
      : [getConfiguredDefaultAccountId({
        defaultAccount: nextConfig.channels.slack.defaultAccount,
        accounts: nextConfig.channels.slack.accounts,
      })];
    const resolvedAccounts: Record<string, SlackPersistentAccountConfig> = {};
    for (const accountId of ids) {
      const existing = (getSlackAccountConfig(nextConfig.channels.slack, accountId) ?? {}) as
        SlackPersistentAccountConfig;
      if (existing.enabled === false) {
        continue;
      }
      let resolved: ResolvedSlackCredential | undefined;
      try {
        resolved = resolveSlackCredential({
          config: config.channels.slack,
          accountId,
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
      resolvedAccounts[accountId] = {
        ...existing,
        appToken: resolved.appToken,
        botToken: resolved.botToken,
      };
    }
    nextConfig.channels.slack.accounts = resolvedAccounts;
    const preferredDefaultSlackAccountId = normalizeAccountId(nextConfig.channels.slack.defaultAccount);
    const fallbackSlackAccountId = preferredDefaultSlackAccountId &&
        resolvedAccounts[preferredDefaultSlackAccountId]
      ? preferredDefaultSlackAccountId
      : Object.keys(resolvedAccounts)[0];
    nextConfig.channels.slack.appToken = fallbackSlackAccountId
      ? resolvedAccounts[fallbackSlackAccountId]?.appToken ?? ""
      : "";
    nextConfig.channels.slack.botToken = fallbackSlackAccountId
      ? resolvedAccounts[fallbackSlackAccountId]?.botToken ?? ""
      : "";
  }

  return nextConfig;
}

export function describeTelegramCredentialSource(params: {
  config: ClisbotConfig["channels"]["telegram"];
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const env = params.env ?? process.env;
  const accountId = normalizeAccountId(params.accountId) ?? getConfiguredDefaultAccountId({
    defaultAccount: params.config.defaultAccount,
    accounts: params.config.accounts,
  });
  const account = getTelegramAccountConfig(params.config, accountId);
  if (account?.credentialType === "mem") {
    const envName = getTelegramMemEnvName(accountId);
    const runtimeBotToken = getRuntimeCredentialDocument(params.runtimeCredentialsPath).telegram?.[accountId]
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
  config: ClisbotConfig["channels"]["slack"];
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const env = params.env ?? process.env;
  const accountId = normalizeAccountId(params.accountId) ?? getConfiguredDefaultAccountId({
    defaultAccount: params.config.defaultAccount,
    accounts: params.config.accounts,
  });
  const account = getSlackAccountConfig(params.config, accountId);
  if (account?.credentialType === "mem") {
    const appEnvName = getSlackMemAppEnvName(accountId);
    const botEnvName = getSlackMemBotEnvName(accountId);
    const runtime = getRuntimeCredentialDocument(params.runtimeCredentialsPath).slack?.[accountId];
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

export function persistTelegramCredential(params: {
  accountId: string;
  botToken: string;
  env?: NodeJS.ProcessEnv;
}) {
  ensureCanonicalCredentialArtifacts(params.env);
  const path = getCanonicalTelegramBotTokenPath(params.accountId, params.env);
  writeSecretFile(path, params.botToken);
  return path;
}

export function persistSlackCredential(params: {
  accountId: string;
  appToken: string;
  botToken: string;
  env?: NodeJS.ProcessEnv;
}) {
  ensureCanonicalCredentialArtifacts(params.env);
  const appPath = getCanonicalSlackAppTokenPath(params.accountId, params.env);
  const botPath = getCanonicalSlackBotTokenPath(params.accountId, params.env);
  writeSecretFile(appPath, params.appToken);
  writeSecretFile(botPath, params.botToken);
  return {
    appPath,
    botPath,
  };
}

export function getConfigReloadMtimeMs(configPath: string) {
  return statSync(expandHomePath(configPath)).mtimeMs;
}
