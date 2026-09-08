// Fusion-owned account adapter for `extensions/telegram/src/accounts.ts` (D-TG-010).
//
// Upstream resolves a Telegram account out of `OpenClawConfig` through
// `openclaw/plugin-sdk/account-core` (account gates, default-account fallback),
// `./token.js` (env / tokenFile / secret-ref resolution) and `./account-selection.js`
// (account listing + default warnings). Fusion's Hub owns channel configuration and
// credentials: the drive-time `cfg` the Hub hands a vertical already carries
// `channels.telegram.accounts.<id>`. This module keeps every upstream function
// signature and the `ResolvedTelegramAccount` shape, and resolves them against that
// record instead of the OpenClaw config graph. No config is written back.
import type {
  OpenClawConfig,
  TelegramAccountConfig,
  TelegramActionConfig,
} from "@getpaseo/channels-core/plugin-sdk/config-contracts";
import { normalizeOptionalString } from "@getpaseo/channels-core/plugin-sdk/string-coerce-runtime";
import { normalizeAccountId } from "@getpaseo/channels-core/plugin-sdk/routing";
import { inspectTelegramAccount } from "../account-inspect.js";

const DEFAULT_ACCOUNT_ID = "default";

export type ResolvedTelegramAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "tokenFile" | "config" | "none";
  tokenStatus: "available" | "configured_unavailable" | "missing";
  config: TelegramAccountConfig;
};

export type TelegramMediaRuntimeOptions = {
  token: string;
  apiRoot?: string;
  trustedLocalFileRoots?: readonly string[];
  dangerouslyAllowPrivateNetwork?: boolean;
};

type TelegramChannelConfig = TelegramAccountConfig & {
  accounts?: Record<string, TelegramAccountConfig>;
  defaultAccount?: string;
};

function readTelegramChannelConfig(cfg: OpenClawConfig): TelegramChannelConfig | undefined {
  return cfg?.channels?.telegram as TelegramChannelConfig | undefined;
}

function readAccountEntry(
  cfg: OpenClawConfig,
  accountId: string,
): TelegramAccountConfig | undefined {
  const accounts = readTelegramChannelConfig(cfg)?.accounts;
  if (!accounts) {
    return undefined;
  }
  if (Object.hasOwn(accounts, accountId)) {
    return accounts[accountId];
  }
  // Config keys are display-ish ("Carey Notifications"); routing ids are slugs.
  // Upstream normalizes both sides through `normalizeAccountId`.
  const key = Object.keys(accounts).find((entry) => normalizeAccountId(entry) === accountId);
  return key ? accounts[key] : undefined;
}

/** The per-account config block, without channel-level inheritance. */
export function resolveTelegramAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): TelegramAccountConfig | undefined {
  return readAccountEntry(cfg, normalizeAccountId(accountId));
}

/** Channel-level config merged with the account block; the account wins per key. */
export function mergeTelegramAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): TelegramAccountConfig {
  const channelConfig = readTelegramChannelConfig(cfg);
  const { accounts: _accounts, defaultAccount: _defaultAccount, ...base } = channelConfig ?? {};
  return { ...base, ...resolveTelegramAccountConfig(cfg, accountId) };
}

export function listTelegramAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = readTelegramChannelConfig(cfg)?.accounts;
  const ids = accounts ? Object.keys(accounts).map((key) => normalizeAccountId(key)) : [];
  return ids.length > 0 ? [...new Set(ids)] : [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultTelegramAccountId(cfg: OpenClawConfig): string {
  const channelConfig = readTelegramChannelConfig(cfg);
  const explicit = normalizeOptionalString(channelConfig?.defaultAccount);
  if (explicit) {
    return normalizeAccountId(explicit);
  }
  const ids = listTelegramAccountIds(cfg);
  return normalizeAccountId(ids.includes(DEFAULT_ACCOUNT_ID) ? DEFAULT_ACCOUNT_ID : ids[0]);
}

export function resolveTelegramAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedTelegramAccount {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultTelegramAccountId(params.cfg),
  );
  const merged = mergeTelegramAccountConfig(params.cfg, accountId);
  const baseEnabled = readTelegramChannelConfig(params.cfg)?.enabled !== false;
  const inspected = inspectTelegramAccount({ cfg: params.cfg, accountId });
  return {
    accountId,
    enabled: baseEnabled && merged.enabled !== false,
    ...(normalizeOptionalString(merged.name) ? { name: merged.name } : {}),
    token: inspected.token,
    tokenSource: inspected.tokenSource,
    tokenStatus: inspected.tokenStatus,
    config: merged,
  };
}

export function listEnabledTelegramAccounts(cfg: OpenClawConfig): ResolvedTelegramAccount[] {
  if (readTelegramChannelConfig(cfg)?.enabled === false) {
    return [];
  }
  return listTelegramAccountIds(cfg)
    .map((accountId) => resolveTelegramAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}

/** Per-action gate; channel-level `actions` is the default, the account overrides it. */
export function createTelegramActionGate(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): (key: keyof TelegramActionConfig, defaultValue?: boolean) => boolean {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultTelegramAccountId(params.cfg),
  );
  const baseActions = readTelegramChannelConfig(params.cfg)?.actions;
  const accountActions = resolveTelegramAccountConfig(params.cfg, accountId)?.actions;
  return (key, defaultValue = true) => {
    const accountValue = accountActions?.[key];
    if (typeof accountValue === "boolean") {
      return accountValue;
    }
    const baseValue = baseActions?.[key];
    return typeof baseValue === "boolean" ? baseValue : defaultValue;
  };
}

export type TelegramPollActionGateState = {
  sendMessageEnabled: boolean;
  pollEnabled: boolean;
  enabled: boolean;
};

export function resolveTelegramPollActionGateState(
  isActionEnabled: (key: keyof TelegramActionConfig, defaultValue?: boolean) => boolean,
): TelegramPollActionGateState {
  const sendMessageEnabled = isActionEnabled("sendMessage");
  const pollEnabled = isActionEnabled("poll");
  return {
    sendMessageEnabled,
    pollEnabled,
    enabled: sendMessageEnabled && pollEnabled,
  };
}

export function resolveTelegramMediaRuntimeOptions(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  token: string;
}): TelegramMediaRuntimeOptions {
  const accountCfg = mergeTelegramAccountConfig(
    params.cfg,
    normalizeAccountId(params.accountId ?? resolveDefaultTelegramAccountId(params.cfg)),
  );
  return {
    token: params.token,
    ...(accountCfg.apiRoot ? { apiRoot: accountCfg.apiRoot } : {}),
    ...(accountCfg.trustedLocalFileRoots
      ? { trustedLocalFileRoots: accountCfg.trustedLocalFileRoots }
      : {}),
    ...(accountCfg.network?.dangerouslyAllowPrivateNetwork !== undefined
      ? { dangerouslyAllowPrivateNetwork: accountCfg.network.dangerouslyAllowPrivateNetwork }
      : {}),
  };
}
