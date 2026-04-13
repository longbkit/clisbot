import type {
  AgentBootstrapMode,
  AgentCliToolId,
} from "../config/agent-tool-presets.ts";
import { parseTokenInput, type ParsedTokenInput } from "../config/channel-credentials.ts";

export type ParsedSlackAccountFlags = {
  accountId: string;
  appToken?: ParsedTokenInput;
  botToken?: ParsedTokenInput;
};

export type ParsedTelegramAccountFlags = {
  accountId: string;
  botToken?: ParsedTokenInput;
};

export type ParsedBootstrapFlags = {
  cliTool?: AgentCliToolId;
  bootstrap?: AgentBootstrapMode;
  persist: boolean;
  slackAccounts: ParsedSlackAccountFlags[];
  telegramAccounts: ParsedTelegramAccountFlags[];
  sawCredentialFlags: boolean;
  sawSlackFlags: boolean;
  sawTelegramFlags: boolean;
  literalWarnings: string[];
};

function parseBotType(rawValue: string) {
  const value = rawValue.trim().toLowerCase();
  if (value === "personal" || value === "personal-assistant") {
    return "personal-assistant" satisfies AgentBootstrapMode;
  }
  if (value === "team" || value === "team-assistant") {
    return "team-assistant" satisfies AgentBootstrapMode;
  }
  throw new Error(`Invalid bot type: ${rawValue}`);
}

function parseOptionValue(args: string[], name: string, index: number) {
  const value = args[index + 1]?.trim();
  if (!value) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function getOrCreateSlackAccount(
  accounts: ParsedSlackAccountFlags[],
  accountId: string,
) {
  let account = accounts.find((entry) => entry.accountId === accountId);
  if (!account) {
    account = { accountId };
    accounts.push(account);
  }
  return account;
}

function getOrCreateTelegramAccount(
  accounts: ParsedTelegramAccountFlags[],
  accountId: string,
) {
  let account = accounts.find((entry) => entry.accountId === accountId);
  if (!account) {
    account = { accountId };
    accounts.push(account);
  }
  return account;
}

function ensureUniqueAccount(accounts: Array<{ accountId: string }>, accountId: string, flagName: string) {
  if (accounts.some((entry) => entry.accountId === accountId)) {
    throw new Error(`Duplicate ${flagName} ${accountId}`);
  }
}

function validateSlackAccount(account: ParsedSlackAccountFlags) {
  if (!account.appToken || !account.botToken) {
    throw new Error(`Slack account ${account.accountId} requires both app token and bot token`);
  }
  if (account.appToken.kind !== account.botToken.kind) {
    throw new Error(
      `Slack account ${account.accountId} must use one credential source kind for both app and bot tokens`,
    );
  }
}

function validateTelegramAccount(account: ParsedTelegramAccountFlags) {
  if (!account.botToken) {
    throw new Error(`Telegram account ${account.accountId} requires a bot token`);
  }
}

export function parseBootstrapFlags(args: string[]): ParsedBootstrapFlags {
  const slackAccounts: ParsedSlackAccountFlags[] = [];
  const telegramAccounts: ParsedTelegramAccountFlags[] = [];
  const literalWarnings: string[] = [];
  let currentSlackAccountId: string | undefined;
  let currentTelegramAccountId: string | undefined;
  let cliTool: AgentCliToolId | undefined;
  let bootstrap: AgentBootstrapMode | undefined;
  let persist = false;
  let sawCredentialFlags = false;
  let sawSlackFlags = false;
  let sawTelegramFlags = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cli") {
      cliTool = parseOptionValue(args, arg, index) as AgentCliToolId;
      index += 1;
      continue;
    }
    if (arg === "--bootstrap") {
      bootstrap = parseBotType(parseOptionValue(args, arg, index));
      index += 1;
      continue;
    }
    if (arg === "--bot-type") {
      bootstrap = parseBotType(parseOptionValue(args, arg, index));
      index += 1;
      continue;
    }
    if (arg === "--persist") {
      persist = true;
      continue;
    }
    if (arg === "--slack-account") {
      const accountId = parseOptionValue(args, arg, index);
      ensureUniqueAccount(slackAccounts, accountId, "--slack-account");
      currentSlackAccountId = accountId;
      getOrCreateSlackAccount(slackAccounts, accountId);
      sawSlackFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--telegram-account") {
      const accountId = parseOptionValue(args, arg, index);
      ensureUniqueAccount(telegramAccounts, accountId, "--telegram-account");
      currentTelegramAccountId = accountId;
      getOrCreateTelegramAccount(telegramAccounts, accountId);
      sawTelegramFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--slack-app-token") {
      const token = parseTokenInput(parseOptionValue(args, arg, index));
      const account = getOrCreateSlackAccount(slackAccounts, currentSlackAccountId ?? "default");
      account.appToken = token;
      if (token.kind === "mem") {
        literalWarnings.push(
          `Slack account ${account.accountId} uses a literal CLI token; shell history or process inspection may expose it.`,
        );
      }
      sawCredentialFlags = true;
      sawSlackFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--slack-bot-token") {
      const token = parseTokenInput(parseOptionValue(args, arg, index));
      const account = getOrCreateSlackAccount(slackAccounts, currentSlackAccountId ?? "default");
      account.botToken = token;
      if (token.kind === "mem") {
        literalWarnings.push(
          `Slack account ${account.accountId} uses a literal CLI token; shell history or process inspection may expose it.`,
        );
      }
      sawCredentialFlags = true;
      sawSlackFlags = true;
      index += 1;
      continue;
    }
    if (arg === "--telegram-bot-token") {
      const token = parseTokenInput(parseOptionValue(args, arg, index));
      const account = getOrCreateTelegramAccount(
        telegramAccounts,
        currentTelegramAccountId ?? "default",
      );
      account.botToken = token;
      if (token.kind === "mem") {
        literalWarnings.push(
          `Telegram account ${account.accountId} uses a literal CLI token; shell history or process inspection may expose it.`,
        );
      }
      sawCredentialFlags = true;
      sawTelegramFlags = true;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option for start/init: ${arg}`);
  }

  for (const account of slackAccounts) {
    validateSlackAccount(account);
  }
  for (const account of telegramAccounts) {
    validateTelegramAccount(account);
  }

  return {
    cliTool,
    bootstrap,
    persist,
    slackAccounts,
    telegramAccounts,
    sawCredentialFlags,
    sawSlackFlags,
    sawTelegramFlags,
    literalWarnings,
  };
}
