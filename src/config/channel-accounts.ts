import type { ClisbotConfig } from "./schema.ts";

export type SlackAccountConfig = {
  appToken: string;
  botToken: string;
};

export type TelegramAccountConfig = {
  botToken: string;
};

function normalizeAccountId(accountId?: string | null) {
  const normalized = accountId?.trim();
  return normalized ? normalized : undefined;
}

function getAccountsRecord(accounts: unknown) {
  if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
    return {} as Record<string, unknown>;
  }
  return accounts as Record<string, unknown>;
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

export function resolveSlackAccountId(
  config: ClisbotConfig["channels"]["slack"],
  accountId?: string | null,
) {
  return normalizeAccountId(accountId) ?? getConfiguredDefaultAccountId({
    defaultAccount: config.defaultAccount,
    accounts: config.accounts,
  });
}

export function resolveTelegramAccountId(
  config: ClisbotConfig["channels"]["telegram"],
  accountId?: string | null,
) {
  return normalizeAccountId(accountId) ?? getConfiguredDefaultAccountId({
    defaultAccount: config.defaultAccount,
    accounts: config.accounts,
  });
}

export function resolveSlackAccountConfig(
  config: ClisbotConfig["channels"]["slack"],
  accountId?: string | null,
): { accountId: string; config: SlackAccountConfig } {
  const resolvedAccountId = resolveSlackAccountId(config, accountId);
  const accountConfig = getAccountsRecord(config.accounts)[resolvedAccountId] as
    | SlackAccountConfig
    | undefined;
  if (accountConfig?.appToken.trim() && accountConfig.botToken.trim()) {
    return {
      accountId: resolvedAccountId,
      config: accountConfig,
    };
  }

  if (config.appToken.trim() && config.botToken.trim()) {
    return {
      accountId: resolvedAccountId,
      config: {
        appToken: config.appToken,
        botToken: config.botToken,
      },
    };
  }

  throw new Error(`Unknown Slack account: ${resolvedAccountId}`);
}

export function resolveTelegramAccountConfig(
  config: ClisbotConfig["channels"]["telegram"],
  accountId?: string | null,
): { accountId: string; config: TelegramAccountConfig } {
  const resolvedAccountId = resolveTelegramAccountId(config, accountId);
  const accountConfig = getAccountsRecord(config.accounts)[resolvedAccountId] as
    | TelegramAccountConfig
    | undefined;
  if (accountConfig?.botToken.trim()) {
    return {
      accountId: resolvedAccountId,
      config: accountConfig,
    };
  }

  if (config.botToken.trim()) {
    return {
      accountId: resolvedAccountId,
      config: {
        botToken: config.botToken,
      },
    };
  }

  throw new Error(`Unknown Telegram account: ${resolvedAccountId}`);
}

export function listSlackAccounts(
  config: ClisbotConfig["channels"]["slack"],
): Array<{ accountId: string; config: SlackAccountConfig }> {
  const accounts = Object.entries(getAccountsRecord(config.accounts)).map(([accountId, accountConfig]) => ({
    accountId,
    config: accountConfig as SlackAccountConfig & { enabled?: boolean },
  })).filter(({ config }) => config.enabled !== false && config.appToken.trim() && config.botToken.trim());
  if (accounts.length > 0) {
    return accounts;
  }

  if (config.appToken.trim() && config.botToken.trim()) {
    return [
      {
        accountId: resolveSlackAccountId(config),
        config: {
          appToken: config.appToken,
          botToken: config.botToken,
        },
      },
    ];
  }

  return [];
}

export function listTelegramAccounts(
  config: ClisbotConfig["channels"]["telegram"],
): Array<{ accountId: string; config: TelegramAccountConfig }> {
  const accounts = Object.entries(getAccountsRecord(config.accounts)).map(([accountId, accountConfig]) => ({
    accountId,
    config: accountConfig as TelegramAccountConfig & { enabled?: boolean },
  })).filter(({ config }) => config.enabled !== false && config.botToken.trim());
  if (accounts.length > 0) {
    return accounts;
  }

  if (config.botToken.trim()) {
    return [
      {
        accountId: resolveTelegramAccountId(config),
        config: {
          botToken: config.botToken,
        },
      },
    ];
  }

  return [];
}
