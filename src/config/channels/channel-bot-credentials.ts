import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import {
  getChannelCredentialFileConfigKey,
  listChannelCredentialContracts,
  requireChannelCredentialContract,
  type ChannelCredentialChannelId,
  type ChannelCredentialContract,
  type ChannelCredentialFieldKey,
} from "./channel-credential-contract.ts";
import {
  getChannelProviderDefaults,
  reconcileChannelProviderDefaults,
} from "./channel-bots.ts";
import {
  clearChannelRuntimeCredential,
  parseTokenInput,
  persistChannelCredential,
  setChannelRuntimeCredential,
  type ParsedTokenInput,
} from "./channel-credentials.ts";
import type { ClisbotConfig } from "../core/schema.ts";

export type ParsedChannelBotCredentialInput = Partial<
  Record<ChannelCredentialFieldKey, ParsedTokenInput>
>;

type ManagedBotCredentialConfig = {
  enabled?: boolean;
  agentId?: string;
  credentialType?: "mem" | "tokenFile";
  appToken?: string;
  botToken?: string;
  appTokenFile?: string;
  botTokenFile?: string;
  tokenFile?: string;
};

type ManagedProviderConfig = Record<string, ManagedBotCredentialConfig | undefined>;

function parseOptionValue(args: string[], name: string) {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1]?.trim();
  if (!value) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function parseAliasedOptionValue(args: string[], names: string[], label: string) {
  const values = names.flatMap((name) => {
    const value = parseOptionValue(args, name);
    return value === undefined ? [] : [{ name, value }];
  });

  if (values.length === 0) {
    return undefined;
  }

  const distinctValues = Array.from(new Set(values.map((entry) => entry.value)));
  if (distinctValues.length > 1) {
    const seen = values.map((entry) => `${entry.name}=${entry.value}`).join(", ");
    throw new Error(`Conflicting values for ${label}: ${seen}`);
  }

  return values[values.length - 1]?.value;
}

function renderFieldNames(fields: readonly ChannelCredentialContract["fields"][number][]) {
  if (fields.length === 0) {
    return "credential inputs";
  }
  if (fields.length === 1) {
    return fields[0]!.label;
  }
  if (fields.length === 2) {
    return `both ${fields[0]!.label} and ${fields[1]!.label}`;
  }
  return fields.map((field) => field.label).join(", ");
}

function getManagedProviderConfig(
  config: ClisbotConfig,
  contract: ChannelCredentialContract,
) {
  return config.bots[contract.configBotKey] as unknown as ManagedProviderConfig;
}

function requireParsedFieldValue(params: {
  contract: ChannelCredentialContract;
  botId: string;
  parsed: ParsedChannelBotCredentialInput;
  fieldKey: ChannelCredentialFieldKey;
}) {
  const value = params.parsed[params.fieldKey];
  if (!value) {
    const field = params.contract.fields.find((entry) => entry.key === params.fieldKey);
    throw new Error(
      `Missing ${params.contract.providerLabel} ${field?.label ?? params.fieldKey} for bot ${params.botId}.`,
    );
  }
  return value;
}

function buildRuntimeCredentialParams(params: {
  contract: ChannelCredentialContract;
  botId: string;
  parsed: ParsedChannelBotCredentialInput;
}) {
  const fieldValues = Object.fromEntries(
    params.contract.fields.map((field) => [
      field.key,
      requireParsedFieldValue({
        contract: params.contract,
        botId: params.botId,
        parsed: params.parsed,
        fieldKey: field.key,
      }),
    ]),
  ) as Record<ChannelCredentialFieldKey, ParsedTokenInput>;

  const botToken = fieldValues.botToken;
  if (botToken.kind !== "mem") {
    throw new Error(
      `${params.contract.providerLabel} ${renderFieldNames(params.contract.fields)} must use literal tokens for runtime staging.`,
    );
  }

  const runtimeParams: {
    channel: ChannelCredentialChannelId;
    botId: string;
    botToken: string;
    appToken?: string;
  } = {
    channel: params.contract.channel,
    botId: params.botId,
    botToken: botToken.secret,
  };
  if (fieldValues.appToken) {
    if (fieldValues.appToken.kind !== "mem") {
      throw new Error(
        `${params.contract.providerLabel} ${renderFieldNames(params.contract.fields)} must use literal tokens for runtime staging.`,
      );
    }
    runtimeParams.appToken = fieldValues.appToken.secret;
  }
  return runtimeParams;
}

function requireEnvPlaceholder(
  value: ParsedTokenInput,
  contract: ChannelCredentialContract,
  botId: string,
) {
  if (value.kind !== "env") {
    throw new Error(
      `${contract.providerLabel} ${renderFieldNames(contract.fields)} must use env references for config placeholders on bot ${botId}.`,
    );
  }
  return value.placeholder;
}

function applyManagedBotCredential(params: {
  contract: ChannelCredentialContract;
  config: ClisbotConfig;
  botId: string;
  parsed: ParsedChannelBotCredentialInput;
  kind: ParsedTokenInput["kind"];
  agentId?: string;
  persist: boolean;
}) {
  const providerConfig = getManagedProviderConfig(params.config, params.contract);
  const existing = providerConfig[params.botId];
  const next: ManagedBotCredentialConfig = {
    ...existing,
    enabled: true,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    credentialType: params.kind === "env"
      ? undefined
      : params.persist
      ? "tokenFile"
      : "mem",
  };

  for (const field of params.contract.fields) {
    const value = requireParsedFieldValue({
      contract: params.contract,
      botId: params.botId,
      parsed: params.parsed,
      fieldKey: field.key,
    });
    next[field.key] = params.kind === "env"
      ? requireEnvPlaceholder(value, params.contract, params.botId)
      : "";
    next[getChannelCredentialFileConfigKey(params.contract, field.key)] = undefined;
  }

  providerConfig[params.botId] = next;

  let persisted = params.kind === "env" ? "env" : "mem";
  if (params.kind === "mem") {
    const runtimeParams = buildRuntimeCredentialParams({
      contract: params.contract,
      botId: params.botId,
      parsed: params.parsed,
    });
    setChannelRuntimeCredential(runtimeParams);
    if (params.persist) {
      persistChannelCredential(runtimeParams);
      clearChannelRuntimeCredential({
        channel: params.contract.channel,
        botId: params.botId,
      });
      persisted = "tokenFile";
    }
  }

  return persisted;
}

export function listChannelBotCredentialContracts() {
  return listChannelCredentialContracts();
}

export function renderChannelBotCredentialUsage(channel: ChannelId) {
  const contract = requireChannelCredentialContract(channel);
  return contract.fields
    .map((field) => `${field.primaryFlag} <ENV_NAME|\${ENV_NAME}|literal>`)
    .join(" ");
}

export function parseChannelBotCredentialInput(
  args: string[],
  channel: ChannelId,
) {
  const contract = requireChannelCredentialContract(channel);
  return Object.fromEntries(
    contract.fields.map((field) => [
      field.key,
      parseTokenInput(
        parseAliasedOptionValue(
          args,
          [field.primaryFlag, ...(field.aliasFlags ?? [])],
          `${contract.providerLabel} ${field.label}`,
        ) ?? "",
      ),
    ]),
  ) as ParsedChannelBotCredentialInput;
}

export function applyChannelBotCredentialInput(params: {
  config: ClisbotConfig;
  channel: ChannelId;
  botId: string;
  parsed: ParsedChannelBotCredentialInput;
  persist: boolean;
  runtimeRunning: boolean;
  agentId?: string;
}) {
  const contract = requireChannelCredentialContract(params.channel);
  const distinctKinds = Array.from(
    new Set(
      contract.fields
        .map((field) => params.parsed[field.key]?.kind)
        .filter((kind): kind is ParsedTokenInput["kind"] => Boolean(kind)),
    ),
  );

  if (distinctKinds.length > 1) {
    throw new Error(
      `${contract.providerLabel} ${renderFieldNames(contract.fields)} must use the same input kind.`,
    );
  }

  if (distinctKinds[0] === "mem" && !params.persist && !params.runtimeRunning) {
    throw new Error(
      `Raw ${contract.literalTokenLabel} input without --persist requires a running clisbot runtime.`,
    );
  }

  const kind = distinctKinds[0];
  if (!kind) {
    throw new Error(`Missing ${renderFieldNames(contract.fields)}.`);
  }

  const persisted = applyManagedBotCredential({
    contract,
    config: params.config,
    botId: params.botId,
    parsed: params.parsed,
    kind,
    agentId: params.agentId,
    persist: params.persist,
  });

  const defaults = getChannelProviderDefaults(params.config, params.channel);
  if (!defaults.defaultBotId || defaults.defaultBotId === "default") {
    defaults.defaultBotId = params.botId;
  }
  reconcileChannelProviderDefaults(params.config, params.channel);

  return { persisted };
}
