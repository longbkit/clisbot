import type { ClisbotConfig } from "./schema.ts";
import type {
  ParsedSlackAccountFlags,
  ParsedTelegramAccountFlags,
} from "../control/channel-bootstrap-flags.ts";
import {
  clearSlackRuntimeCredential,
  clearTelegramRuntimeCredential,
  getSlackMemAppEnvName,
  getSlackMemBotEnvName,
  getTelegramMemEnvName,
  persistSlackCredential,
  persistTelegramCredential,
  setSlackRuntimeCredential,
  setTelegramRuntimeCredential,
} from "./channel-credentials.ts";

export type ChannelBootstrapAccounts = {
  slackAccounts: ParsedSlackAccountFlags[];
  telegramAccounts: ParsedTelegramAccountFlags[];
};

function getFirstAccountId(accounts: Array<{ accountId: string }>) {
  return accounts[0]?.accountId ?? "default";
}

function applySlackAccountConfig(
  config: ClisbotConfig["channels"]["slack"],
  account: ParsedSlackAccountFlags,
) {
  if (!account.appToken || !account.botToken) {
    throw new Error(`Slack account ${account.accountId} is incomplete`);
  }

  config.accounts[account.accountId] = account.appToken.kind === "env" &&
      account.botToken.kind === "env"
    ? {
        enabled: true,
        appToken: account.appToken.placeholder,
        botToken: account.botToken.placeholder,
      }
    : {
        enabled: true,
        credentialType: "mem",
        appToken: "",
        botToken: "",
      };
}

function applyTelegramAccountConfig(
  config: ClisbotConfig["channels"]["telegram"],
  account: ParsedTelegramAccountFlags,
) {
  if (!account.botToken) {
    throw new Error(`Telegram account ${account.accountId} is incomplete`);
  }

  config.accounts[account.accountId] = account.botToken.kind === "env"
    ? {
        enabled: true,
        botToken: account.botToken.placeholder,
      }
    : {
        enabled: true,
        credentialType: "mem",
        botToken: "",
      };
}

function syncSlackCompatibilityRoot(
  config: ClisbotConfig["channels"]["slack"],
) {
  const defaultAccountId = config.defaultAccount || "default";
  const defaultAccount = config.accounts[defaultAccountId];
  if (!defaultAccount) {
    config.appToken = "";
    config.botToken = "";
    return;
  }
  config.appToken = defaultAccount.appToken ?? "";
  config.botToken = defaultAccount.botToken ?? "";
}

function syncTelegramCompatibilityRoot(
  config: ClisbotConfig["channels"]["telegram"],
) {
  const defaultAccountId = config.defaultAccount || "default";
  const defaultAccount = config.accounts[defaultAccountId];
  config.botToken = defaultAccount?.botToken ?? "";
}

function getEnabledAccountIds(accounts: Record<string, { enabled?: boolean }>) {
  return Object.entries(accounts)
    .filter(([, account]) => account.enabled !== false)
    .map(([accountId]) => accountId);
}

function reconcileSlackConfiguredAccounts(
  config: ClisbotConfig["channels"]["slack"],
) {
  const enabledAccountIds = getEnabledAccountIds(config.accounts);
  if (enabledAccountIds.length === 0) {
    config.enabled = false;
    syncSlackCompatibilityRoot(config);
    return;
  }
  if (!config.defaultAccount || !enabledAccountIds.includes(config.defaultAccount)) {
    config.defaultAccount = enabledAccountIds[0];
  }
  syncSlackCompatibilityRoot(config);
}

function reconcileTelegramConfiguredAccounts(
  config: ClisbotConfig["channels"]["telegram"],
) {
  const enabledAccountIds = getEnabledAccountIds(config.accounts);
  if (enabledAccountIds.length === 0) {
    config.enabled = false;
    syncTelegramCompatibilityRoot(config);
    return;
  }
  if (!config.defaultAccount || !enabledAccountIds.includes(config.defaultAccount)) {
    config.defaultAccount = enabledAccountIds[0];
  }
  syncTelegramCompatibilityRoot(config);
}

export function buildBootstrapRuntimeMemEnv(
  accounts: ChannelBootstrapAccounts,
  env: NodeJS.ProcessEnv = process.env,
) {
  const extraEnv: NodeJS.ProcessEnv = { ...env };

  for (const account of accounts.telegramAccounts) {
    if (account.botToken?.kind !== "mem") {
      continue;
    }
    extraEnv[getTelegramMemEnvName(account.accountId)] = account.botToken.secret;
  }

  for (const account of accounts.slackAccounts) {
    if (account.appToken?.kind !== "mem" || account.botToken?.kind !== "mem") {
      continue;
    }
    extraEnv[getSlackMemAppEnvName(account.accountId)] = account.appToken.secret;
    extraEnv[getSlackMemBotEnvName(account.accountId)] = account.botToken.secret;
  }

  return extraEnv;
}

export function deactivateExpiredMemAccounts(
  config: ClisbotConfig,
  activeMemAccounts: Partial<Record<"slack" | "telegram", Set<string>>> = {},
) {
  const summaries: string[] = [];
  const activeSlackMemAccounts = activeMemAccounts.slack ?? new Set<string>();
  const activeTelegramMemAccounts = activeMemAccounts.telegram ?? new Set<string>();

  for (const [accountId, account] of Object.entries(config.channels.slack.accounts)) {
    if (account.credentialType !== "mem" || activeSlackMemAccounts.has(accountId)) {
      continue;
    }
    if (account.enabled !== false) {
      summaries.push(`Disabled expired slack/${accountId} (credentialType=mem).`);
    }
    account.enabled = false;
  }

  for (const [accountId, account] of Object.entries(config.channels.telegram.accounts)) {
    if (account.credentialType !== "mem" || activeTelegramMemAccounts.has(accountId)) {
      continue;
    }
    if (account.enabled !== false) {
      summaries.push(`Disabled expired telegram/${accountId} (credentialType=mem).`);
    }
    account.enabled = false;
  }

  reconcileSlackConfiguredAccounts(config.channels.slack);
  reconcileTelegramConfiguredAccounts(config.channels.telegram);

  return summaries;
}

export function applyBootstrapAccountsToConfig(
  config: ClisbotConfig,
  accounts: ChannelBootstrapAccounts,
  options: {
    firstRun: boolean;
  },
) {
  if (options.firstRun) {
    config.channels.slack.enabled = accounts.slackAccounts.length > 0;
    config.channels.slack.accounts = {};
    config.channels.slack.appToken = "";
    config.channels.slack.botToken = "";
    config.channels.slack.defaultAccount = getFirstAccountId(accounts.slackAccounts);

    config.channels.telegram.enabled = accounts.telegramAccounts.length > 0;
    config.channels.telegram.accounts = {};
    config.channels.telegram.botToken = "";
    config.channels.telegram.defaultAccount = getFirstAccountId(accounts.telegramAccounts);
  }

  if (accounts.slackAccounts.length > 0) {
    config.channels.slack.enabled = true;
    if (!config.channels.slack.defaultAccount || !(config.channels.slack.defaultAccount in config.channels.slack.accounts)) {
      config.channels.slack.defaultAccount = getFirstAccountId(accounts.slackAccounts);
    }
    for (const account of accounts.slackAccounts) {
      applySlackAccountConfig(config.channels.slack, account);
    }
    reconcileSlackConfiguredAccounts(config.channels.slack);
  }

  if (accounts.telegramAccounts.length > 0) {
    config.channels.telegram.enabled = true;
    if (
      !config.channels.telegram.defaultAccount ||
      !(config.channels.telegram.defaultAccount in config.channels.telegram.accounts)
    ) {
      config.channels.telegram.defaultAccount = getFirstAccountId(accounts.telegramAccounts);
    }
    for (const account of accounts.telegramAccounts) {
      applyTelegramAccountConfig(config.channels.telegram, account);
    }
    reconcileTelegramConfiguredAccounts(config.channels.telegram);
  }
}

export function stageBootstrapRuntimeCredentials(
  accounts: ChannelBootstrapAccounts,
  runtimeCredentialsPath?: string,
) {
  for (const account of accounts.slackAccounts) {
    if (account.appToken?.kind !== "mem" || account.botToken?.kind !== "mem") {
      continue;
    }
    setSlackRuntimeCredential({
      accountId: account.accountId,
      appToken: account.appToken.secret,
      botToken: account.botToken.secret,
      runtimeCredentialsPath,
    });
  }

  for (const account of accounts.telegramAccounts) {
    if (account.botToken?.kind !== "mem") {
      continue;
    }
    setTelegramRuntimeCredential({
      accountId: account.accountId,
      botToken: account.botToken.secret,
      runtimeCredentialsPath,
    });
  }
}

export function persistBootstrapMemCredentials(
  config: ClisbotConfig,
  accounts: ChannelBootstrapAccounts,
  runtimeCredentialsPath?: string,
) {
  const summaries: string[] = [];

  for (const account of accounts.slackAccounts) {
    if (account.appToken?.kind !== "mem" || account.botToken?.kind !== "mem") {
      continue;
    }
    const paths = persistSlackCredential({
      accountId: account.accountId,
      appToken: account.appToken.secret,
      botToken: account.botToken.secret,
    });
    config.channels.slack.accounts[account.accountId] = {
      ...(config.channels.slack.accounts[account.accountId] ?? {}),
      enabled: true,
      credentialType: "tokenFile",
      appToken: "",
      botToken: "",
      appTokenFile: undefined,
      botTokenFile: undefined,
    };
    clearSlackRuntimeCredential({
      accountId: account.accountId,
      runtimeCredentialsPath,
    });
    summaries.push(
      `Persisted slack/${account.accountId} to ${paths.appPath} and ${paths.botPath}.`,
    );
  }

  for (const account of accounts.telegramAccounts) {
    if (account.botToken?.kind !== "mem") {
      continue;
    }
    const path = persistTelegramCredential({
      accountId: account.accountId,
      botToken: account.botToken.secret,
    });
    config.channels.telegram.accounts[account.accountId] = {
      ...(config.channels.telegram.accounts[account.accountId] ?? {}),
      enabled: true,
      credentialType: "tokenFile",
      botToken: "",
      tokenFile: undefined,
    };
    clearTelegramRuntimeCredential({
      accountId: account.accountId,
      runtimeCredentialsPath,
    });
    summaries.push(`Persisted telegram/${account.accountId} to ${path}.`);
  }

  syncSlackCompatibilityRoot(config.channels.slack);
  syncTelegramCompatibilityRoot(config.channels.telegram);

  return summaries;
}
