import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync } from "node:fs";
import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import {
  clearSlackRuntimeCredential,
  clearTelegramRuntimeCredential,
  getConfigReloadMtimeMs,
  parseTokenInput,
  persistSlackCredential,
  persistTelegramCredential,
  setSlackRuntimeCredential,
  setTelegramRuntimeCredential,
} from "../config/channel-credentials.ts";
import { applyBootstrapAccountsToConfig } from "../config/channel-account-management.ts";
import { RuntimeHealthStore } from "./runtime-health-store.ts";
import { getRuntimeStatus } from "./runtime-process.ts";
import { getDefaultRuntimeCredentialsPath } from "../shared/paths.ts";

type Provider = "slack" | "telegram";

type AccountsCliDependencies = {
  getRuntimeStatus: typeof getRuntimeStatus;
  runtimeHealthStore: RuntimeHealthStore;
};

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

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

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

function readRuntimeCredentialDocument() {
  const path = process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH ?? getDefaultRuntimeCredentialsPath();
  if (!existsSync(path)) {
    return {};
  }
  const text = readFileSync(path, "utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function waitForReloadResult(
  configPath: string,
  deps: AccountsCliDependencies,
  timeoutMs = 12_000,
) {
  const expectedMtimeMs = getConfigReloadMtimeMs(configPath);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const document = await deps.runtimeHealthStore.read();
    if (
      document.reload &&
      document.reload.reason === "watch" &&
      (document.reload.configMtimeMs ?? 0) >= expectedMtimeMs
    ) {
      return document.reload.status;
    }
    await sleep(200);
  }

  return "failed" as const;
}

function renderAccountsHelp() {
  return [
    "clisbot accounts",
    "",
    "Usage:",
    "  clisbot accounts --help",
    "  clisbot accounts help",
    "  clisbot accounts add telegram --account <id> (--token | --telegram-bot-token) <ENV_NAME|${ENV_NAME}|literal> [--persist]",
    "  clisbot accounts add slack --account <id> (--app-token | --slack-app-token) <ENV_NAME|${ENV_NAME}|literal> (--bot-token | --slack-bot-token) <ENV_NAME|${ENV_NAME}|literal> [--persist]",
    "  clisbot accounts persist --channel <slack|telegram> --account <id>",
    "  clisbot accounts persist --all",
    "",
    "Notes:",
    "  - env-style input such as `TELEGRAM_BOT_TOKEN` or `${TELEGRAM_BOT_TOKEN}` keeps the account env-backed in config",
    "  - `accounts add` accepts both the short account-local flags and the bootstrap-style channel flags",
    "  - literal token input without `--persist` stays runtime-only and requires a running clisbot runtime",
    "  - `--persist` writes canonical token files so later plain `clisbot start` can reuse the account safely",
    "  - `persist --all` converts every configured `credentialType=mem` account into canonical token files",
  ].join("\n");
}

async function addTelegramAccount(
  args: string[],
  deps: AccountsCliDependencies,
) {
  const accountId = parseOptionValue(args, "--account") ?? "default";
  const token = parseTokenInput(
    parseAliasedOptionValue(args, ["--token", "--telegram-bot-token"], "telegram bot token") ?? "",
  );
  const persist = hasFlag(args, "--persist");
  const runtimeStatus = await deps.getRuntimeStatus();

  if (token.kind === "mem" && !persist && !runtimeStatus.running) {
    throw new Error(
      "Raw telegram token input without --persist requires a running clisbot runtime.",
    );
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  applyBootstrapAccountsToConfig(
    config,
    {
      slackAccounts: [],
      telegramAccounts: [{ accountId, botToken: token }],
    },
    { firstRun: false },
  );

  let persisted = token.kind === "env" ? "env" : "mem";
  if (token.kind === "mem") {
    setTelegramRuntimeCredential({ accountId, botToken: token.secret });
  }
  if (persist && token.kind === "mem") {
    persistTelegramCredential({ accountId, botToken: token.secret });
    config.channels.telegram.accounts[accountId] = {
      ...(config.channels.telegram.accounts[accountId] ?? {}),
      enabled: true,
      credentialType: "tokenFile",
      botToken: "",
      tokenFile: undefined,
    };
    clearTelegramRuntimeCredential({ accountId });
    persisted = "tokenFile";
  }

  await writeEditableConfig(configPath, config);

  let runtime = "not-running";
  if (runtimeStatus.running) {
    runtime = await waitForReloadResult(configPath, deps) === "success" ? "started" : "failed";
  }

  console.log(`Added telegram/${accountId}, persisted=${persisted}, runtime=${runtime}`);
  console.log(`config: ${configPath}`);
}

async function addSlackAccount(
  args: string[],
  deps: AccountsCliDependencies,
) {
  const accountId = parseOptionValue(args, "--account") ?? "default";
  const appToken = parseTokenInput(
    parseAliasedOptionValue(args, ["--app-token", "--slack-app-token"], "slack app token") ?? "",
  );
  const botToken = parseTokenInput(
    parseAliasedOptionValue(args, ["--bot-token", "--slack-bot-token"], "slack bot token") ?? "",
  );
  const persist = hasFlag(args, "--persist");
  const runtimeStatus = await deps.getRuntimeStatus();

  if (appToken.kind !== botToken.kind) {
    throw new Error("Slack account tokens must use the same input kind.");
  }
  if (appToken.kind === "mem" && !persist && !runtimeStatus.running) {
    throw new Error(
      "Raw slack token input without --persist requires a running clisbot runtime.",
    );
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  applyBootstrapAccountsToConfig(
    config,
    {
      slackAccounts: [{ accountId, appToken, botToken }],
      telegramAccounts: [],
    },
    { firstRun: false },
  );

  let persisted = appToken.kind === "env" ? "env" : "mem";
  if (appToken.kind === "mem" && botToken.kind === "mem") {
    setSlackRuntimeCredential({
      accountId,
      appToken: appToken.secret,
      botToken: botToken.secret,
    });
  }
  if (persist && appToken.kind === "mem" && botToken.kind === "mem") {
    persistSlackCredential({
      accountId,
      appToken: appToken.secret,
      botToken: botToken.secret,
    });
    config.channels.slack.accounts[accountId] = {
      ...(config.channels.slack.accounts[accountId] ?? {}),
      enabled: true,
      credentialType: "tokenFile",
      appToken: "",
      botToken: "",
      appTokenFile: undefined,
      botTokenFile: undefined,
    };
    clearSlackRuntimeCredential({ accountId });
    persisted = "tokenFile";
  }

  await writeEditableConfig(configPath, config);

  let runtime = "not-running";
  if (runtimeStatus.running) {
    runtime = await waitForReloadResult(configPath, deps) === "success" ? "started" : "failed";
  }

  console.log(`Added slack/${accountId}, persisted=${persisted}, runtime=${runtime}`);
  console.log(`config: ${configPath}`);
}

async function persistConfiguredAccount(
  provider: Provider,
  accountId: string,
  deps: AccountsCliDependencies,
) {
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());

  if (provider === "telegram") {
    const account = config.channels.telegram.accounts[accountId];
    if (account?.credentialType !== "mem") {
      throw new Error(`telegram/${accountId} is not using credentialType=mem`);
    }

    const runtimeStatus = await deps.getRuntimeStatus();
    if (!runtimeStatus.running) {
      throw new Error(`telegram/${accountId} requires a running runtime to persist mem credentials`);
    }

    const document = readRuntimeCredentialDocument() as {
      telegram?: Record<string, { botToken?: string }>;
    };
    const botToken = document.telegram?.[accountId]?.botToken?.trim();
    if (!botToken) {
      throw new Error(`No runtime credential is available for telegram/${accountId}`);
    }

    const path = persistTelegramCredential({ accountId, botToken });
    config.channels.telegram.accounts[accountId] = {
      ...account,
      credentialType: "tokenFile",
      botToken: "",
      tokenFile: undefined,
    };
    clearTelegramRuntimeCredential({ accountId });
    await writeEditableConfig(configPath, config);
    console.log(`Persisted telegram/${accountId} to ${path}.`);
    console.log(`config: ${configPath}`);
    return;
  }

  const account = config.channels.slack.accounts[accountId];
  if (account?.credentialType !== "mem") {
    throw new Error(`slack/${accountId} is not using credentialType=mem`);
  }

  const runtimeStatus = await deps.getRuntimeStatus();
  if (!runtimeStatus.running) {
    throw new Error(`slack/${accountId} requires a running runtime to persist mem credentials`);
  }

  const document = readRuntimeCredentialDocument() as {
    slack?: Record<string, { appToken?: string; botToken?: string }>;
  };
  const appToken = document.slack?.[accountId]?.appToken?.trim();
  const botToken = document.slack?.[accountId]?.botToken?.trim();
  if (!appToken || !botToken) {
    throw new Error(`No runtime credential is available for slack/${accountId}`);
  }

  const paths = persistSlackCredential({ accountId, appToken, botToken });
  config.channels.slack.accounts[accountId] = {
    ...account,
    credentialType: "tokenFile",
    appToken: "",
    botToken: "",
    appTokenFile: undefined,
    botTokenFile: undefined,
  };
  clearSlackRuntimeCredential({ accountId });
  await writeEditableConfig(configPath, config);
  console.log(`Persisted slack/${accountId} to ${paths.appPath} and ${paths.botPath}.`);
  console.log(`config: ${configPath}`);
}

async function persistAllConfiguredAccounts(
  deps: AccountsCliDependencies,
) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const targets: Array<{ provider: Provider; accountId: string }> = [];

  for (const [accountId, account] of Object.entries(config.channels.slack.accounts)) {
    if (account.credentialType === "mem") {
      targets.push({ provider: "slack", accountId });
    }
  }
  for (const [accountId, account] of Object.entries(config.channels.telegram.accounts)) {
    if (account.credentialType === "mem") {
      targets.push({ provider: "telegram", accountId });
    }
  }

  if (targets.length === 0) {
    console.log("No mem-backed accounts are waiting for persistence.");
    return;
  }

  for (const target of targets) {
    await persistConfiguredAccount(target.provider, target.accountId, deps);
  }
}

export async function runAccountsCli(
  args: string[],
  deps: Partial<AccountsCliDependencies> = {},
) {
  const resolvedDeps: AccountsCliDependencies = {
    getRuntimeStatus,
    runtimeHealthStore: new RuntimeHealthStore(),
    ...deps,
  };
  const action = args[0];

  if (!action || action === "--help" || action === "-h" || action === "help") {
    console.log(renderAccountsHelp());
    return;
  }

  if (action === "add") {
    const provider = args[1];
    const rest = args.slice(2);
    if (provider === "telegram") {
      await addTelegramAccount(rest, resolvedDeps);
      return;
    }
    if (provider === "slack") {
      await addSlackAccount(rest, resolvedDeps);
      return;
    }
    throw new Error(renderAccountsHelp());
  }

  if (action === "persist") {
    if (hasFlag(args, "--all")) {
      await persistAllConfiguredAccounts(resolvedDeps);
      return;
    }

    const provider = parseOptionValue(args, "--channel");
    const accountId = parseOptionValue(args, "--account") ?? "default";
    if (provider !== "slack" && provider !== "telegram") {
      throw new Error(renderAccountsHelp());
    }
    await persistConfiguredAccount(provider, accountId, resolvedDeps);
    return;
  }

  throw new Error(renderAccountsHelp());
}
