import type { ClisbotConfig } from "../core/schema.ts";
import type { ChannelBootstrapBotInput } from "./channel-bootstrap.ts";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import {
  clearChannelRuntimeCredential,
  persistChannelCredential,
  setChannelRuntimeCredential,
} from "./channel-credentials.ts";
import {
  buildChannelMemEnvName,
  getChannelCredentialFileConfigKey,
  listChannelCredentialContracts,
  type ChannelCredentialContract,
  type ChannelCredentialFieldKey,
} from "./channel-credential-contract.ts";
import { reconcileChannelProviderDefaults } from "./channel-bots.ts";
import { buildZaloPersonalBotConfig } from "../../channels/zalo-personal/config.ts";

export type ChannelBootstrapBots = Record<ChannelId, ChannelBootstrapBotInput[]>;

type ParsedBootstrapToken = NonNullable<ChannelBootstrapBotInput["botToken"]>;
type ManagedBootstrapBot = {
  enabled?: boolean;
  name?: string;
  credentialType?: "mem" | "tokenFile";
  appToken?: string;
  botToken?: string;
  appTokenFile?: string;
  botTokenFile?: string;
  tokenFile?: string;
  dmPolicy?: string;
  groupPolicy?: string;
  directMessages?: Record<string, unknown>;
  groups?: Record<string, unknown>;
  followUp?: Record<string, unknown>;
};
type ManagedProviderDefaults = {
  enabled?: boolean;
  defaultBotId?: string;
};
type ManagedProviderConfig = Record<string, ManagedBootstrapBot | ManagedProviderDefaults | undefined> & {
  defaults: ManagedProviderDefaults;
};
type ResolvedBootstrapBot = {
  kind: ParsedBootstrapToken["kind"];
  fields: Array<{
    fieldKey: ChannelCredentialFieldKey;
    value: ParsedBootstrapToken;
  }>;
};

function getFirstBotId(bots: Array<{ botId: string }>) {
  return bots[0]?.botId ?? "default";
}

function getManagedProviderConfig(
  config: ClisbotConfig,
  contract: ChannelCredentialContract,
) {
  return config.bots[contract.configBotKey] as unknown as ManagedProviderConfig;
}

function getManagedBotRecords(config: ManagedProviderConfig) {
  const { defaults, ...bots } = config;
  return bots as Record<string, ManagedBootstrapBot | undefined>;
}

function getZaloPersonalProviderConfig(config: ClisbotConfig) {
  return config.bots.zaloPersonal as unknown as ManagedProviderConfig;
}

function applyZaloPersonalBootstrapBots(
  config: ClisbotConfig,
  bootstrapBots: ChannelBootstrapBotInput[],
  options: {
    firstRun: boolean;
  },
) {
  const providerConfig = getZaloPersonalProviderConfig(config);
  if (options.firstRun) {
    resetBootstrapProvider({
      contract: {
        channel: "zalo-personal",
        configBotKey: "zaloPersonal",
        providerLabel: "Zalo Personal",
        literalTokenLabel: "Zalo Personal auth/session",
        fields: [],
      },
      providerConfig,
      bootstrapBots,
    });
  }

  if (bootstrapBots.length === 0) {
    return;
  }

  providerConfig.defaults.enabled = true;
  if (!providerConfig.defaults.defaultBotId || providerConfig.defaults.defaultBotId === "default") {
    providerConfig.defaults.defaultBotId = getFirstBotId(bootstrapBots);
  }

  for (const bot of bootstrapBots) {
    providerConfig[bot.botId] = buildZaloPersonalBotConfig({
      botId: bot.botId,
      existing: providerConfig[bot.botId] as Record<string, unknown> | undefined,
    });
  }

  reconcileChannelProviderDefaults(config, "zalo-personal");
}

function createManagedBotShell(
  contract: ChannelCredentialContract,
  botId: string,
): ManagedBootstrapBot {
  const shell: ManagedBootstrapBot = {
    enabled: false,
    name: botId,
    dmPolicy: "pairing",
    groupPolicy: "allowlist",
    botToken: "",
    directMessages: {},
    groups: {},
    ...contract.createBotShellExtra?.(botId),
  };
  if (contract.fields.some((field) => field.key === "appToken")) {
    shell.appToken = "";
  }
  return shell;
}

function resolveBootstrapBot(
  contract: ChannelCredentialContract,
  bot: ChannelBootstrapBotInput,
) {
  const fields = contract.fields.map((field) => {
    const value = bot[field.key];
    if (!value) {
      throw new Error(`${contract.providerLabel} bot ${bot.botId} is incomplete`);
    }
    return {
      fieldKey: field.key,
      value,
    };
  });

  const kinds = new Set(fields.map(({ value }) => value.kind));
  if (kinds.size !== 1) {
    throw new Error(`${contract.providerLabel} bot ${bot.botId} must use one credential input kind.`);
  }

  return {
    kind: fields[0]!.value.kind,
    fields,
  } satisfies ResolvedBootstrapBot;
}

function getBootstrapEnvPlaceholder(
  contract: ChannelCredentialContract,
  botId: string,
  value: ParsedBootstrapToken,
) {
  if (value.kind !== "env") {
    throw new Error(`${contract.providerLabel} bot ${botId} must use env placeholders for every field.`);
  }
  return value.placeholder;
}

function getBootstrapMemSecret(
  contract: ChannelCredentialContract,
  botId: string,
  value: ParsedBootstrapToken,
) {
  if (value.kind !== "mem") {
    throw new Error(`${contract.providerLabel} bot ${botId} must use literal tokens for every field.`);
  }
  return value.secret;
}

function buildManagedBotCredentialPatch(
  contract: ChannelCredentialContract,
  botId: string,
  resolved: ResolvedBootstrapBot,
) {
  const patch: ManagedBootstrapBot = {
    enabled: true,
    credentialType: resolved.kind === "env" ? undefined : "mem",
  };

  for (const { fieldKey, value } of resolved.fields) {
    patch[fieldKey] = resolved.kind === "env"
      ? getBootstrapEnvPlaceholder(contract, botId, value)
      : "";
    patch[getChannelCredentialFileConfigKey(contract, fieldKey)] = undefined;
  }

  return patch;
}

function applyManagedBotConfig(params: {
  contract: ChannelCredentialContract;
  providerConfig: ManagedProviderConfig;
  bot: ChannelBootstrapBotInput;
}) {
  const existing = params.providerConfig[params.bot.botId] ??
    createManagedBotShell(params.contract, params.bot.botId);
  const resolved = resolveBootstrapBot(params.contract, params.bot);
  params.providerConfig[params.bot.botId] = {
    ...existing,
    ...buildManagedBotCredentialPatch(params.contract, params.bot.botId, resolved),
  };
}

function getResolvedFieldSecret(
  contract: ChannelCredentialContract,
  botId: string,
  resolved: ResolvedBootstrapBot,
  fieldKey: ChannelCredentialFieldKey,
) {
  const value = resolved.fields.find((field) => field.fieldKey === fieldKey)?.value;
  return value ? getBootstrapMemSecret(contract, botId, value) : undefined;
}

function buildRuntimeCredentialParams(
  contract: ChannelCredentialContract,
  botId: string,
  resolved: ResolvedBootstrapBot,
) {
  const botToken = getResolvedFieldSecret(contract, botId, resolved, "botToken");
  if (!botToken) {
    throw new Error(`${contract.providerLabel} bot ${botId} is incomplete`);
  }
  const appToken = getResolvedFieldSecret(contract, botId, resolved, "appToken");
  return {
    channel: contract.channel,
    botId,
    botToken,
    ...(typeof appToken === "string" ? { appToken } : {}),
  };
}

function buildPersistedManagedBotPatch(contract: ChannelCredentialContract) {
  const patch: ManagedBootstrapBot = {
    enabled: true,
    credentialType: "tokenFile",
  };
  for (const field of contract.fields) {
    patch[field.key] = "";
    patch[getChannelCredentialFileConfigKey(contract, field.key)] = undefined;
  }
  return patch;
}

function deactivateExpiredContractMemBots(params: {
  contract: ChannelCredentialContract;
  providerConfig: ManagedProviderConfig;
  activeMemBots: Set<string>;
  summaries: string[];
}) {
  for (const [botId, managedBot] of Object.entries(getManagedBotRecords(params.providerConfig))) {
    if (!managedBot) {
      continue;
    }
    if (managedBot.credentialType !== "mem" || params.activeMemBots.has(botId)) {
      continue;
    }
    if (managedBot.enabled !== false) {
      params.summaries.push(
        `Disabled expired ${params.contract.channel}/${botId} (credentialType=mem).`,
      );
    }
    managedBot.enabled = false;
  }
}

function clearConfiguredBots(providerConfig: ManagedProviderConfig) {
  for (const botId of Object.keys(providerConfig)) {
    if (botId === "defaults") {
      continue;
    }
    delete providerConfig[botId];
  }
}

function resetBootstrapProvider(params: {
  contract: ChannelCredentialContract;
  providerConfig: ManagedProviderConfig;
  bootstrapBots: ChannelBootstrapBotInput[];
}) {
  params.providerConfig.defaults.enabled = params.bootstrapBots.length > 0;
  clearConfiguredBots(params.providerConfig);
  params.providerConfig.defaults.defaultBotId = getFirstBotId(params.bootstrapBots);
}

function applyBootstrapBotsForContract(params: {
  contract: ChannelCredentialContract;
  providerConfig: ManagedProviderConfig;
  bootstrapBots: ChannelBootstrapBotInput[];
}) {
  if (params.bootstrapBots.length === 0) {
    return;
  }

  params.providerConfig.defaults.enabled = true;
  if (!params.providerConfig.defaults.defaultBotId) {
    params.providerConfig.defaults.defaultBotId = getFirstBotId(params.bootstrapBots);
  }
  for (const bot of params.bootstrapBots) {
    applyManagedBotConfig({
      contract: params.contract,
      providerConfig: params.providerConfig,
      bot,
    });
  }
}

export function buildBootstrapRuntimeMemEnv(
  bots: ChannelBootstrapBots,
  env: NodeJS.ProcessEnv = process.env,
) {
  const extraEnv: NodeJS.ProcessEnv = { ...env };

  for (const contract of listChannelCredentialContracts()) {
    for (const bot of bots[contract.channel]) {
      const resolved = resolveBootstrapBot(contract, bot);
      if (resolved.kind !== "mem") {
        continue;
      }
      for (const { fieldKey, value } of resolved.fields) {
        extraEnv[buildChannelMemEnvName(contract.channel, bot.botId, fieldKey)] =
          getBootstrapMemSecret(contract, bot.botId, value);
      }
    }
  }

  return extraEnv;
}

export function deactivateExpiredMemBots(
  config: ClisbotConfig,
  activeMemBots: Partial<Record<ChannelId, Set<string>>> = {},
) {
  const summaries: string[] = [];
  for (const contract of listChannelCredentialContracts()) {
    deactivateExpiredContractMemBots({
      contract,
      providerConfig: getManagedProviderConfig(config, contract),
      activeMemBots: activeMemBots[contract.channel] ?? new Set<string>(),
      summaries,
    });
    reconcileChannelProviderDefaults(config, contract.channel);
  }

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
    for (const contract of listChannelCredentialContracts()) {
      resetBootstrapProvider({
        contract,
        providerConfig: getManagedProviderConfig(config, contract),
        bootstrapBots: bots[contract.channel],
      });
    }
  }

  for (const contract of listChannelCredentialContracts()) {
    applyBootstrapBotsForContract({
      contract,
      providerConfig: getManagedProviderConfig(config, contract),
      bootstrapBots: bots[contract.channel],
    });
    if (bots[contract.channel].length > 0) {
      reconcileChannelProviderDefaults(config, contract.channel);
    }
  }

  applyZaloPersonalBootstrapBots(config, bots["zalo-personal"] ?? [], {
    firstRun: options.firstRun,
  });
}

export function stageBootstrapRuntimeCredentials(
  bots: ChannelBootstrapBots,
  runtimeCredentialsPath?: string,
) {
  for (const contract of listChannelCredentialContracts()) {
    for (const bot of bots[contract.channel]) {
      const resolved = resolveBootstrapBot(contract, bot);
      if (resolved.kind !== "mem") {
        continue;
      }
      setChannelRuntimeCredential({
        ...buildRuntimeCredentialParams(contract, bot.botId, resolved),
        runtimeCredentialsPath,
      });
    }
  }
}

export function persistBootstrapMemBotCredentials(
  config: ClisbotConfig,
  bots: ChannelBootstrapBots,
  runtimeCredentialsPath?: string,
) {
  const summaries: string[] = [];

  for (const contract of listChannelCredentialContracts()) {
    const providerConfig = getManagedProviderConfig(config, contract);
    for (const bot of bots[contract.channel]) {
      const resolved = resolveBootstrapBot(contract, bot);
      if (resolved.kind !== "mem") {
        continue;
      }
      persistChannelCredential(buildRuntimeCredentialParams(contract, bot.botId, resolved));
      providerConfig[bot.botId] = {
        ...(providerConfig[bot.botId] ?? {}),
        ...buildPersistedManagedBotPatch(contract),
      };
      clearChannelRuntimeCredential({
        channel: contract.channel,
        botId: bot.botId,
        runtimeCredentialsPath,
      });
      summaries.push(`Persisted ${contract.channel}/${bot.botId} to credential file.`);
    }
    reconcileChannelProviderDefaults(config, contract.channel);
  }

  return summaries;
}
