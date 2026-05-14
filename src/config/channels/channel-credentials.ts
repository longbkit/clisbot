import { MissingEnvVarError } from "../env/env-substitution.ts";
import type { ClisbotConfig } from "../core/schema.ts";
import {
  buildChannelMemEnvName,
  getChannelCredentialConfigPathPrefix,
  getChannelCredentialFileConfigKey,
  listChannelCredentialContracts,
  requireChannelCredentialContract,
  resolveChannelCredentialFilePath,
  type ChannelCredentialContract,
  type ChannelCredentialFieldKey,
} from "./channel-credential-contract.ts";
import {
  renderDefaultChannelLabel,
  type ChannelId,
} from "../../channels/integration/channel-surface-contract.ts";
import {
  getCredentialSkipPaths,
  parseTokenInput,
  type ParsedTokenInput,
  type ResolvedCredentialSource,
  trimString,
} from "./channel-credential-input.ts";
import {
  getChannelProviderBotRecords,
  getConfiguredDefaultBotId,
  resolveProvidedBotId,
} from "./channel-bot-records.ts";
import {
  clearChannelRuntimeCredential,
  getConfigReloadMtimeMs,
  persistChannelCredential,
  getRuntimeCredentialDocument,
  readOptionalCanonicalCredentialFile,
  readRequiredCredentialFile,
  removeRuntimeCredentials,
  setChannelRuntimeCredential,
} from "./channel-runtime-credentials.ts";
import { extractEnvReferenceName } from "../env/env-references.ts";
import {
  collapseHomePath,
  expandHomePath,
} from "../../infra/paths.ts";
import {
  type ChannelBotRecord,
  type ChannelProviderConfig,
} from "./channel-config-shapes.ts";

export class MissingMemCredentialError extends Error {
  constructor(
    readonly provider: ChannelId,
    readonly botId: string,
  ) {
    const providerLabel = renderDefaultChannelLabel(provider);
    super(
      `${providerLabel} bot ${botId} is configured with credentialType=mem but no runtime credential is available.`,
    );
    this.name = "MissingMemCredentialError";
  }
}

type CredentialValues = Partial<Record<ChannelCredentialFieldKey, string>>;
type ResolvedChannelCredential = {
  botId: string;
  values: CredentialValues;
  source: ResolvedCredentialSource;
};

function buildCliEphemeralCredentialSource() {
  return {
    source: "cli-ephemeral" as const,
    detail: "source=cli-ephemeral restartRequiresPersistence=yes",
  };
}

function getProviderConfig(
  config: ClisbotConfig,
  contract: ChannelCredentialContract,
) {
  return config.bots[contract.configBotKey] as ChannelProviderConfig;
}

function getFieldFilePathsSource(
  contract: ChannelCredentialContract,
  pathsByField: CredentialValues,
): ResolvedCredentialSource {
  const paths = contract.fields.map((field) => pathsByField[field.key]!);
  if (paths.length === 1) {
    return {
      source: "credential-file",
      detail: `source=credential-file path=${collapseHomePath(paths[0]!)}`,
      paths,
    };
  }
  if (pathsByField.appToken && pathsByField.botToken) {
    return {
      source: "credential-file",
      detail:
        `source=credential-file appPath=${collapseHomePath(pathsByField.appToken)} ` +
        `botPath=${collapseHomePath(pathsByField.botToken)}`,
      paths,
    };
  }
  return {
    source: "credential-file",
    detail: `source=credential-file fields=${contract.fields.map((field) => field.key).join(",")}`,
    paths,
  };
}

function resolveConfiguredChannelCredentialBotId(params: {
  config: ChannelProviderConfig;
  botId?: string | null;
  accountId?: string | null;
}) {
  return resolveProvidedBotId(params) ??
    getConfiguredDefaultBotId({
      defaultBotId: params.config.defaults.defaultBotId,
      bots: getChannelProviderBotRecords(params.config),
    });
}

function readRuntimeCredentialField(params: {
  contract: ChannelCredentialContract;
  botId: string;
  fieldKey: ChannelCredentialFieldKey;
  env: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const envName = buildChannelMemEnvName(params.contract.channel, params.botId, params.fieldKey);
  const runtimeValue = getRuntimeCredentialDocument(params.runtimeCredentialsPath)
    [params.contract.channel]?.[params.botId]?.[params.fieldKey]?.trim();
  return {
    envName,
    value: params.env[envName]?.trim() || runtimeValue || "",
  };
}

function resolveMemCredentialValues(params: {
  contract: ChannelCredentialContract;
  botId: string;
  env: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const values: CredentialValues = {};
  for (const field of params.contract.fields) {
    const { value } = readRuntimeCredentialField({ ...params, fieldKey: field.key });
    if (!value) {
      throw new MissingMemCredentialError(params.contract.channel, params.botId);
    }
    values[field.key] = value;
  }
  return values;
}

function getExplicitCredentialFilePaths(
  contract: ChannelCredentialContract,
  bot: ChannelBotRecord | undefined,
) {
  const pathsByField: CredentialValues = {};
  let hasAny = false;
  for (const field of contract.fields) {
    const configKey = getChannelCredentialFileConfigKey(contract, field.key);
    const path = trimString(bot?.[configKey] as string | undefined);
    if (path) {
      hasAny = true;
    }
    pathsByField[field.key] = path;
  }
  return hasAny ? pathsByField : undefined;
}

function requireCompleteCredentialFilePaths(params: {
  contract: ChannelCredentialContract;
  botId: string;
  pathsByField: CredentialValues;
}) {
  const missing = params.contract.fields.filter((field) => !params.pathsByField[field.key]);
  if (missing.length > 0) {
    const required = params.contract.fields
      .map((field) => getChannelCredentialFileConfigKey(params.contract, field.key))
      .join(" and ");
    throw new Error(
      `${params.contract.providerLabel} bot ${params.botId} requires ${required} when any credential file is configured.`,
    );
  }
}

function readExplicitCredentialFiles(params: {
  contract: ChannelCredentialContract;
  botId: string;
  pathsByField: CredentialValues;
}) {
  requireCompleteCredentialFilePaths(params);
  const values: CredentialValues = {};
  const expandedPaths: CredentialValues = {};
  const configPathPrefix = getChannelCredentialConfigPathPrefix(params.contract.channel);
  for (const field of params.contract.fields) {
    const path = params.pathsByField[field.key]!;
    const configKey = getChannelCredentialFileConfigKey(params.contract, field.key);
    values[field.key] = readRequiredCredentialFile(path, `${configPathPrefix}.${params.botId}.${configKey}`);
    expandedPaths[field.key] = expandHomePath(path);
  }
  return {
    values,
    source: getFieldFilePathsSource(params.contract, expandedPaths),
  };
}

function getCanonicalCredentialFilePaths(
  contract: ChannelCredentialContract,
  botId: string,
  env: NodeJS.ProcessEnv,
) {
  const pathsByField: CredentialValues = {};
  for (const field of contract.fields) {
    pathsByField[field.key] = resolveChannelCredentialFilePath({
      channel: contract.channel,
      botId,
      field: field.key,
      env,
    });
  }
  return pathsByField;
}

function readCanonicalCredentialFiles(params: {
  contract: ChannelCredentialContract;
  botId: string;
  pathsByField: CredentialValues;
  required: boolean;
}) {
  const values: CredentialValues = {};
  let foundAny = false;
  let foundAll = true;
  for (const field of params.contract.fields) {
    const path = params.pathsByField[field.key]!;
    const value = params.required
      ? readRequiredCredentialFile(path, `${getChannelCredentialConfigPathPrefix(params.contract.channel)}.${params.botId}`)
      : readOptionalCanonicalCredentialFile(path);
    foundAny ||= Boolean(value);
    foundAll &&= Boolean(value);
    if (value) {
      values[field.key] = value;
    }
  }
  if (!params.required && !foundAny) {
    return undefined;
  }
  if (!foundAll) {
    throw new Error(
      `${params.contract.providerLabel} canonical credential files for bot ${params.botId} are incomplete.`,
    );
  }
  return {
    values,
    source: getFieldFilePathsSource(params.contract, params.pathsByField),
  };
}

function getConfigFieldReferences(
  contract: ChannelCredentialContract,
  bot: ChannelBotRecord | undefined,
) {
  const values: CredentialValues = {};
  for (const field of contract.fields) {
    values[field.key] = trimString(bot?.[field.key] as string | undefined);
  }
  return values;
}

function resolveEnvCredentialValues(params: {
  contract: ChannelCredentialContract;
  botId: string;
  env: NodeJS.ProcessEnv;
  fieldReferences: CredentialValues;
}) {
  const envNames: CredentialValues = {};
  const values: CredentialValues = {};
  let hasAnyEnvReference = false;
  for (const field of params.contract.fields) {
    const envName = extractEnvReferenceName(params.fieldReferences[field.key] ?? "");
    if (envName) {
      hasAnyEnvReference = true;
    }
    envNames[field.key] = envName ?? "";
  }
  if (!hasAnyEnvReference) {
    return undefined;
  }
  for (const field of params.contract.fields) {
    const envName = envNames[field.key];
    if (!envName) {
      throw new Error(
        `${params.contract.providerLabel} bot ${params.botId} requires env placeholders for every credential field.`,
      );
    }
    const value = params.env[envName]?.trim();
    if (!value) {
      throw new MissingEnvVarError(
        envName,
        `${getChannelCredentialConfigPathPrefix(params.contract.channel)}.${params.botId}.${field.key}`,
      );
    }
    values[field.key] = value;
  }
  const names = params.contract.fields.map((field) => envNames[field.key]!);
  const detail = names.length === 1
    ? `source=env name=${names[0]}`
    : `source=env ${params.contract.fields.map((field) => `${field.key.replace(/Token$/, "")}=${envNames[field.key]}`).join(" ")}`;
  return {
    values,
    source: {
      source: "env" as const,
      detail,
      names,
    },
  };
}

function resolveInlineCredentialValues(
  contract: ChannelCredentialContract,
  fieldReferences: CredentialValues,
) {
  const values: CredentialValues = {};
  for (const field of contract.fields) {
    const value = fieldReferences[field.key]?.trim();
    if (!value) {
      return undefined;
    }
    values[field.key] = value;
  }
  return {
    values,
    source: {
      source: "config-inline" as const,
      detail: "source=config-inline legacyCompatibility=yes",
    },
  };
}

function resolveContractCredential(params: {
  contract: ChannelCredentialContract;
  config: ChannelProviderConfig;
  botId?: string | null;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}): ResolvedChannelCredential {
  const env = params.env ?? process.env;
  const botId = resolveConfiguredChannelCredentialBotId(params);
  const bot = getChannelProviderBotRecords(params.config)[botId];
  if (bot?.credentialType === "mem") {
    return {
      botId,
      values: resolveMemCredentialValues({
        contract: params.contract,
        botId,
        env,
        runtimeCredentialsPath: params.runtimeCredentialsPath,
      }),
      source: buildCliEphemeralCredentialSource(),
    };
  }
  const explicitFilePaths = getExplicitCredentialFilePaths(params.contract, bot);
  if (explicitFilePaths) {
    return {
      botId,
      ...readExplicitCredentialFiles({
        contract: params.contract,
        botId,
        pathsByField: explicitFilePaths,
      }),
    };
  }
  const canonicalFilePaths = getCanonicalCredentialFilePaths(params.contract, botId, env);
  const canonical = readCanonicalCredentialFiles({
    contract: params.contract,
    botId,
    pathsByField: canonicalFilePaths,
    required: bot?.credentialType === "tokenFile",
  });
  if (canonical) {
    return { botId, ...canonical };
  }
  const fieldReferences = getConfigFieldReferences(params.contract, bot);
  const envCredential = resolveEnvCredentialValues({
    contract: params.contract,
    botId,
    env,
    fieldReferences,
  });
  if (envCredential) {
    return { botId, ...envCredential };
  }
  const inlineCredential = resolveInlineCredentialValues(params.contract, fieldReferences);
  if (inlineCredential) {
    return { botId, ...inlineCredential };
  }
  throw new Error(`Unknown ${params.contract.providerLabel} bot: ${botId}`);
}

function describeMemCredentialSource(params: {
  contract: ChannelCredentialContract;
  botId: string;
  env: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const hasValue = params.contract.fields.some((field) =>
    Boolean(readRuntimeCredentialField({ ...params, fieldKey: field.key }).value)
  );
  return {
    source: "cli-ephemeral" as const,
    detail: hasValue
      ? "source=cli-ephemeral restartRequiresPersistence=yes"
      : "source=cli-ephemeral available=no restartRequiresPersistence=yes",
  };
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

  for (const contract of listChannelCredentialContracts()) {
    const configPathPrefix = getChannelCredentialConfigPathPrefix(contract.channel);
    const providerConfig = config.bots[contract.configBotKey] as unknown as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const [botId, botConfig] of Object.entries(providerConfig)) {
      if (botId === "defaults" || !botConfig) {
        continue;
      }
      for (const field of contract.fields) {
        validateTokenField(botConfig[field.key], `${configPathPrefix}.${botId}.${field.key}`);
      }
    }
  }
}

export function resolveChannelCredential(params: {
  config: ClisbotConfig;
  channel: ChannelId;
  botId?: string | null;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const contract = requireChannelCredentialContract(params.channel);
  return resolveContractCredential({
    contract,
    config: getProviderConfig(params.config, contract),
    botId: params.botId,
    accountId: params.accountId,
    env: params.env,
    runtimeCredentialsPath: params.runtimeCredentialsPath,
  });
}

export function materializeRuntimeChannelCredentials(
  config: ClisbotConfig,
  options: {
    env?: NodeJS.ProcessEnv;
    runtimeCredentialsPath?: string;
    materializeChannels?: ChannelId[];
  } = {},
) {
  const env = options.env ?? process.env;
  const nextConfig = structuredClone(config) as ClisbotConfig;
  const materializeChannels = options.materializeChannels ?? [];
  const materializeAll = materializeChannels.length === 0;
  for (const contract of listChannelCredentialContracts()) {
    if (!materializeAll && !materializeChannels.includes(contract.channel)) {
      continue;
    }
    const sourceProviderConfig = getProviderConfig(config, contract);
    const targetProviderConfig = getProviderConfig(nextConfig, contract);
    if (targetProviderConfig.defaults.enabled === false) {
      continue;
    }
    const configuredBotIds = Object.keys(getChannelProviderBotRecords(targetProviderConfig));
    const botIds = configuredBotIds.length > 0
      ? configuredBotIds
      : [resolveConfiguredChannelCredentialBotId({ config: targetProviderConfig })];
    for (const botId of botIds) {
      const current = getChannelProviderBotRecords(targetProviderConfig)[botId];
      if (!current || current.enabled === false) {
        continue;
      }
      try {
        const resolved = resolveContractCredential({
          contract,
          config: sourceProviderConfig,
          botId,
          env,
          runtimeCredentialsPath: options.runtimeCredentialsPath,
        });
        for (const field of contract.fields) {
          current[field.key] = resolved.values[field.key] ?? "";
        }
      } catch (error) {
        if (!(error instanceof MissingMemCredentialError)) {
          throw error;
        }
      }
    }
  }

  return nextConfig;
}

function describeContractCredentialSource(params: {
  contract: ChannelCredentialContract;
  config: ChannelProviderConfig;
  botId?: string | null;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const env = params.env ?? process.env;
  const botId = resolveConfiguredChannelCredentialBotId(params);
  const bot = getChannelProviderBotRecords(params.config)[botId];
  if (bot?.credentialType === "mem") {
    return describeMemCredentialSource({
      contract: params.contract,
      botId,
      env,
      runtimeCredentialsPath: params.runtimeCredentialsPath,
    });
  }
  return resolveContractCredential(params).source;
}

export function describeChannelCredentialSource(params: {
  config: ClisbotConfig;
  channel: ChannelId;
  botId?: string | null;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
  runtimeCredentialsPath?: string;
}) {
  const contract = requireChannelCredentialContract(params.channel);
  return describeContractCredentialSource({
    contract,
    config: getProviderConfig(params.config, contract),
    botId: params.botId,
    accountId: params.accountId,
    env: params.env,
    runtimeCredentialsPath: params.runtimeCredentialsPath,
  });
}

export {
  clearChannelRuntimeCredential,
  getConfigReloadMtimeMs,
  getCredentialSkipPaths,
  parseTokenInput,
  persistChannelCredential,
  removeRuntimeCredentials,
  setChannelRuntimeCredential,
};
export type {
  ParsedTokenInput,
  ResolvedCredentialSource,
};
