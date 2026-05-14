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
import {
  type RuntimeCredentialDocument,
} from "./channel-credential-input.ts";
import type {
  ChannelCredentialChannelId,
  ChannelCredentialFieldKey,
} from "./channel-credential-contract.ts";
import {
  isSingleTokenChannelCredentialContract,
  requireChannelCredentialContract,
  resolveChannelCredentialFilePath,
} from "./channel-credential-contract.ts";
import {
  expandHomePath,
  getDefaultCredentialsDir,
  getDefaultRuntimeCredentialsPath,
} from "../../infra/paths.ts";
import { resolveProvidedBotId } from "./channel-bot-records.ts";

const CREDENTIALS_GITIGNORE_CONTENT = ["*", "!*/", "!.gitignore", ""].join("\n");
type SharedChannelCredentialParams = {
  channel: ChannelCredentialChannelId;
  botId?: string;
  accountId?: string;
  botToken: string;
  runtimeCredentialsPath?: string;
};
type ChannelRuntimeCredentialParams = SharedChannelCredentialParams & {
  appToken?: string;
};
type ClearChannelRuntimeCredentialParams = {
  channel: ChannelCredentialChannelId;
  botId?: string;
  accountId?: string;
  runtimeCredentialsPath?: string;
};
type PersistChannelCredentialParams = {
  channel: ChannelCredentialChannelId;
  botId?: string;
  accountId?: string;
  botToken: string;
  appToken?: string;
  env?: NodeJS.ProcessEnv;
};
type RuntimeCredentialValueMap = Partial<Record<ChannelCredentialFieldKey, string>>;
type PersistedCredentialPathMap = Partial<Record<ChannelCredentialFieldKey, string>>;

function resolveRuntimeBotId(params: { botId?: string; accountId?: string }) {
  const botId = resolveProvidedBotId(params);
  if (!botId) {
    throw new Error("Missing bot id for runtime credentials.");
  }
  return botId;
}

function readTrimmedFile(pathname: string) {
  return readFileSync(pathname, "utf8").trim();
}

export function readRequiredCredentialFile(pathname: string, configPath: string) {
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

export function readOptionalCanonicalCredentialFile(pathname: string) {
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

export function getRuntimeCredentialDocument(
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

function writeSecretFile(pathname: string, value: string) {
  const expanded = expandHomePath(pathname);
  mkdirSync(dirname(expanded), { recursive: true });
  writeFileSync(expanded, `${value.trim()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(expanded, 0o600);
}

export function removeRuntimeCredentials(
  runtimeCredentialsPath = getDefaultRuntimeCredentialsPath(),
) {
  rmSync(expandHomePath(runtimeCredentialsPath), { force: true });
}

function buildRuntimeCredentialValueMap(
  params: ChannelRuntimeCredentialParams,
): RuntimeCredentialValueMap {
  const contract = requireChannelCredentialContract(params.channel);
  const values: RuntimeCredentialValueMap = {};

  for (const field of contract.fields) {
    const value = field.key === "appToken"
      ? params.appToken?.trim()
      : params.botToken.trim();
    if (!value) {
      throw new Error(
        `Missing ${contract.providerLabel} ${field.label} for runtime credentials.`,
      );
    }
    values[field.key] = value;
  }

  return values;
}

function getPersistCredentialFieldValue(
  params: PersistChannelCredentialParams,
  fieldKey: ChannelCredentialFieldKey,
) {
  return fieldKey === "appToken" ? params.appToken?.trim() : params.botToken.trim();
}

function formatPersistedCredentialResult(
  channel: ChannelCredentialChannelId,
  writtenPaths: PersistedCredentialPathMap,
) {
  const contract = requireChannelCredentialContract(channel);
  if (isSingleTokenChannelCredentialContract(contract)) {
    return writtenPaths.botToken!;
  }
  return {
    appPath: writtenPaths.appToken!,
    botPath: writtenPaths.botToken!,
  };
}

export function setChannelRuntimeCredential(
  params: ChannelRuntimeCredentialParams,
) {
  const botId = resolveRuntimeBotId(params);
  const document = getRuntimeCredentialDocument(params.runtimeCredentialsPath);
  const channelDocument = document[params.channel] ?? (document[params.channel] = {});
  channelDocument[botId] = buildRuntimeCredentialValueMap(params);
  writeRuntimeCredentialDocument(document, params.runtimeCredentialsPath);
}

export function clearChannelRuntimeCredential(
  params: ClearChannelRuntimeCredentialParams,
) {
  const botId = resolveRuntimeBotId(params);
  const document = getRuntimeCredentialDocument(params.runtimeCredentialsPath);
  const channelDocument = document[params.channel];
  if (channelDocument) {
    delete channelDocument[botId];
  }
  writeRuntimeCredentialDocument(document, params.runtimeCredentialsPath);
}

export function persistChannelCredential(
  params: PersistChannelCredentialParams,
) {
  const botId = resolveRuntimeBotId(params);
  const contract = requireChannelCredentialContract(params.channel);
  const writtenPaths: PersistedCredentialPathMap = {};

  ensureCanonicalCredentialArtifacts(params.env);
  for (const field of contract.fields) {
    const value = getPersistCredentialFieldValue(params, field.key);
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Missing ${contract.providerLabel} ${field.label} for bot ${botId}.`);
    }
    const path = resolveChannelCredentialFilePath({
      channel: params.channel,
      botId,
      field: field.key,
      env: params.env,
    });
    writeSecretFile(path, value);
    writtenPaths[field.key] = path;
  }

  return formatPersistedCredentialResult(params.channel, writtenPaths);
}

export function getConfigReloadMtimeMs(configPath: string) {
  return statSync(expandHomePath(configPath)).mtimeMs;
}
