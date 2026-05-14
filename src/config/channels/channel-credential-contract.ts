import { join } from "node:path";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import { getDefaultCredentialsDir } from "../../infra/paths.ts";
import { CHANNEL_CREDENTIAL_CONTRACTS } from "../../channels/integration/channel-installation-inventory.ts";
import type { ChannelConfigBotKey } from "./channel-config-shapes.ts";

export type ChannelCredentialChannelId = ChannelId;
export type ChannelCredentialFieldKey = "appToken" | "botToken";

export type ChannelCredentialFieldContract = {
  key: ChannelCredentialFieldKey;
  label: string;
  primaryFlag: string;
  aliasFlags?: readonly string[];
  fileName: string;
};
export type ChannelCredentialFileConfigKey = "appTokenFile" | "botTokenFile" | "tokenFile";

export type ChannelCredentialContract = {
  channel: ChannelCredentialChannelId;
  configBotKey: ChannelConfigBotKey;
  providerLabel: string;
  literalTokenLabel: string;
  fields: readonly ChannelCredentialFieldContract[];
  createBotShellExtra?: (botId: string) => Record<string, unknown>;
};

export type SingleTokenChannelCredentialContract = ChannelCredentialContract & {
  fields: readonly [ChannelCredentialFieldContract & { key: "botToken" }];
};

const FIELD_ENV_SUFFIX: Record<ChannelCredentialFieldKey, string> = {
  appToken: "APP_TOKEN",
  botToken: "BOT_TOKEN",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBotEnvSegment(botId: string) {
  return botId
    .trim()
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_|_$/g, "")
    .toUpperCase() || "DEFAULT";
}

export function listChannelCredentialContracts() {
  return [...CHANNEL_CREDENTIAL_CONTRACTS];
}

export function isSingleTokenChannelCredentialContract(
  contract: ChannelCredentialContract,
): contract is SingleTokenChannelCredentialContract {
  return contract.fields.length === 1 && contract.fields[0]?.key === "botToken";
}

export function listSingleTokenChannelCredentialContracts() {
  return CHANNEL_CREDENTIAL_CONTRACTS.filter(isSingleTokenChannelCredentialContract);
}

export function requireChannelCredentialContract(channel: ChannelId) {
  const contract = CHANNEL_CREDENTIAL_CONTRACTS.find((entry) => entry.channel === channel);
  if (!contract) {
    throw new Error(`Unsupported channel credential contract: ${channel}`);
  }
  return contract;
}

export function requireSingleTokenChannelCredentialContract(channel: ChannelId) {
  const contract = requireChannelCredentialContract(channel);
  if (!isSingleTokenChannelCredentialContract(contract)) {
    throw new Error(`Channel does not use a single bot-token credential contract: ${channel}`);
  }
  return contract;
}

export function getChannelCredentialConfigPathPrefix(channel: ChannelId) {
  return `bots.${requireChannelCredentialContract(channel).configBotKey}`;
}

export function getChannelCredentialFieldContract(
  channel: ChannelId,
  fieldKey: ChannelCredentialFieldKey,
) {
  const contract = requireChannelCredentialContract(channel);
  const field = contract.fields.find((entry) => entry.key === fieldKey);
  if (!field) {
    throw new Error(`Unsupported ${contract.providerLabel} credential field: ${fieldKey}`);
  }
  return field;
}

export function getChannelCredentialFileConfigKey(
  contract: ChannelCredentialContract,
  fieldKey: ChannelCredentialFieldKey,
): ChannelCredentialFileConfigKey {
  if (isSingleTokenChannelCredentialContract(contract) && fieldKey === "botToken") {
    return "tokenFile";
  }
  return fieldKey === "appToken" ? "appTokenFile" : "botTokenFile";
}

export function buildChannelMemEnvName(
  channel: ChannelId,
  botId: string,
  fieldKey: ChannelCredentialFieldKey,
) {
  const channelSegment = requireChannelCredentialContract(channel).channel
    .replaceAll("-", "_")
    .toUpperCase();
  return `CLISBOT_MEM_${channelSegment}__${normalizeBotEnvSegment(botId)}__${FIELD_ENV_SUFFIX[fieldKey]}`;
}

export function resolveChannelCredentialFilePath(params: {
  channel: ChannelId;
  botId: string;
  field: ChannelCredentialFieldKey;
  env?: NodeJS.ProcessEnv;
}) {
  const field = getChannelCredentialFieldContract(params.channel, params.field);
  return join(
    getDefaultCredentialsDir(params.env ?? process.env),
    requireChannelCredentialContract(params.channel).channel,
    params.botId,
    field.fileName,
  );
}

export function listChannelCredentialSkipPaths(parsed: unknown) {
  const skipPaths: string[] = [];
  const bots = isRecord(parsed) ? parsed.bots : undefined;

  if (!isRecord(bots)) {
    return skipPaths;
  }

  for (const contract of CHANNEL_CREDENTIAL_CONTRACTS) {
    const channelBots = isRecord(bots[contract.configBotKey]) ? bots[contract.configBotKey] : undefined;
    if (!channelBots) {
      continue;
    }
    for (const [botId, bot] of Object.entries(channelBots)) {
      if (botId === "defaults" || !isRecord(bot)) {
        continue;
      }
      for (const field of contract.fields) {
        skipPaths.push(`bots.${contract.configBotKey}.${botId}.${field.key}`);
      }
    }
  }

  return skipPaths.sort();
}
