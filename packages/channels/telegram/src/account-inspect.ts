// upstream: extensions/telegram/src/account-inspect.ts@5d8067a4483
// D-TG-010: upstream resolves the credential through OpenClaw's secret system
// (`tryReadSecretFileSync` for `tokenFile` with symlink rejection,
// `normalizeSecretInputString` / `hasConfiguredSecretInput` for `SecretRef`
// values against `secrets.defaults`, and the `TELEGRAM_BOT_TOKEN` env fallback
// for the default account). Fusion's Hub owns credentials, so the resolution is
// against the drive-time `cfg` record. Upstream's *decisions* are kept exactly:
//
//   - the precedence order account.tokenFile → account.botToken →
//     channel.tokenFile → channel.botToken → env (default account only);
//   - the channel-level credential falls back to an account only when the
//     account is `default`, is declared, or no accounts are declared at all
//     (`allowChannelCredentialFallback`), so an unknown scoped account in a
//     multi-account config is not silently credentialed;
//   - `configured` is `tokenStatus !== "missing"`, so an unresolved secret
//     reference still advertises its actions instead of disappearing.
//
// The upstream diagnostics array (`credentialDiagnostics`) has no Fusion
// producer and is not carried.
import type {
  OpenClawConfig,
  TelegramAccountConfig,
} from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { normalizeAccountId } from "@getpaseo/channels-core/plugin-sdk/routing";
import { normalizeOptionalString } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import {
  mergeTelegramAccountConfig,
  resolveDefaultTelegramAccountId,
  resolveTelegramAccountConfig,
} from "./accounts.js";

const DEFAULT_ACCOUNT_ID = "default";

export type TelegramCredentialStatus = "available" | "configured_unavailable" | "missing";

type TelegramCredential = {
  token: string;
  tokenSource: "env" | "tokenFile" | "config" | "none";
  tokenStatus: TelegramCredentialStatus;
};

export type InspectedTelegramAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "tokenFile" | "config" | "none";
  tokenStatus: TelegramCredentialStatus;
  configured: boolean;
  config: TelegramAccountConfig;
};

/** A configured `tokenFile` is a credential the process may not be able to read yet. */
function inspectTokenFile(pathValue: unknown): TelegramCredential | null {
  const filePath = normalizeOptionalString(pathValue);
  return filePath
    ? { token: "", tokenSource: "tokenFile", tokenStatus: "configured_unavailable" }
    : null;
}

/** A literal token is available; a `SecretRef` object is configured-but-unresolved. */
function inspectTokenValue(value: unknown): TelegramCredential | null {
  const token = normalizeOptionalString(value);
  if (token) {
    return { token, tokenSource: "config", tokenStatus: "available" };
  }
  if (value !== undefined && value !== null && typeof value === "object") {
    return { token: "", tokenSource: "config", tokenStatus: "configured_unavailable" };
  }
  return null;
}

function hasConfiguredTelegramAccounts(cfg: OpenClawConfig): boolean {
  const accounts = (cfg.channels?.telegram as { accounts?: unknown } | undefined)?.accounts;
  return (
    Boolean(accounts) &&
    typeof accounts === "object" &&
    !Array.isArray(accounts) &&
    Object.keys(accounts as Record<string, unknown>).length > 0
  );
}

/** One account's enablement + credential state, as message-tool discovery reads it. */
export function inspectTelegramAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  envToken?: string | null;
}): InspectedTelegramAccount {
  // An omitted account id means the configured default account, not "default".
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultTelegramAccountId(params.cfg),
  );
  const merged = mergeTelegramAccountConfig(params.cfg, accountId);
  const channelConfig = params.cfg.channels?.telegram as TelegramAccountConfig | undefined;
  const enabled = channelConfig?.enabled !== false && merged.enabled !== false;
  const accountConfig = resolveTelegramAccountConfig(params.cfg, accountId);
  const allowChannelCredentialFallback =
    accountId === DEFAULT_ACCOUNT_ID ||
    Boolean(accountConfig) ||
    !hasConfiguredTelegramAccounts(params.cfg);

  const credential =
    inspectTokenFile(accountConfig?.tokenFile) ??
    inspectTokenValue(accountConfig?.botToken) ??
    (allowChannelCredentialFallback
      ? (inspectTokenFile(channelConfig?.tokenFile) ?? inspectTokenValue(channelConfig?.botToken))
      : null) ??
    resolveEnvCredential(accountId, params.envToken);

  return {
    accountId,
    enabled,
    ...(normalizeOptionalString(merged.name) ? { name: merged.name } : {}),
    ...credential,
    configured: credential.tokenStatus !== "missing",
    config: merged,
  };
}

function resolveEnvCredential(accountId: string, envToken?: string | null): TelegramCredential {
  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const token = allowEnv
    ? (normalizeOptionalString(envToken) ??
      normalizeOptionalString(process.env.TELEGRAM_BOT_TOKEN) ??
      "")
    : "";
  return token
    ? { token, tokenSource: "env", tokenStatus: "available" }
    : { token: "", tokenSource: "none", tokenStatus: "missing" };
}
