import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCredentialSkipPaths,
  materializeRuntimeChannelCredentials,
  parseTokenInput,
  validatePersistentChannelCredentials,
} from "../src/config/channels/channel-credentials.ts";
import {
  buildChannelMemEnvName,
  resolveChannelCredentialFilePath,
} from "../src/config/channels/channel-credential-contract.ts";
import {
  getRuntimeCredentialDocument,
  setChannelRuntimeCredential,
} from "../src/config/channels/channel-runtime-credentials.ts";
import {
  applyBootstrapBotsToConfig,
  deactivateExpiredMemBots,
  persistBootstrapMemBotCredentials,
  stageBootstrapRuntimeCredentials,
} from "../src/config/channels/channel-bot-management.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import { setRenderedCliName } from "../src/control/commands/cli-name.ts";

function createConfig(): ClisbotConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        channels: {
          slack: { enabled: false },
          telegram: { enabled: true },
        },
      }),
    ),
  );
  config.bots.telegram.default.botToken = "${TELEGRAM_BOT_TOKEN}";
  return config;
}

function createZaloBotConfig(): ClisbotConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        channels: {
          slack: { enabled: false },
          telegram: { enabled: false },
          "zalo-bot": { enabled: true },
        },
      }),
    ),
  );
  config.bots.zaloBot.default.botToken = "${ZALO_BOT_TOKEN}";
  return config;
}

function createSlackConfig(): ClisbotConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        channels: {
          slack: { enabled: true },
          telegram: { enabled: false },
          "zalo-bot": { enabled: false },
        },
      }),
    ),
  );
  config.bots.slack.default.appToken = "${SLACK_APP_TOKEN}";
  config.bots.slack.default.botToken = "${SLACK_BOT_TOKEN}";
  return config;
}

describe("channel credentials", () => {
  let tempDir = "";
  let previousCliName: string | undefined;
  let previousTelegramBotToken: string | undefined;
  let previousTelegramMemBotToken: string | undefined;
  const originalHome = process.env.CLISBOT_HOME;
  const telegramMemEnvName = buildChannelMemEnvName("telegram", "default", "botToken");

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    previousTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    previousTelegramMemBotToken = process.env[telegramMemEnvName];
    delete process.env.CLISBOT_CLI_NAME;
    setRenderedCliName();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env[telegramMemEnvName];
  });

  afterEach(() => {
    process.env.CLISBOT_CLI_NAME = previousCliName;
    setRenderedCliName(previousCliName);
    process.env.TELEGRAM_BOT_TOKEN = previousTelegramBotToken;
    process.env[telegramMemEnvName] = previousTelegramMemBotToken;
    process.env.CLISBOT_HOME = originalHome;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("parses env placeholders and literal token input", () => {
    expect(parseTokenInput("TELEGRAM_BOT_TOKEN")).toEqual({
      kind: "env",
      envName: "TELEGRAM_BOT_TOKEN",
      placeholder: "${TELEGRAM_BOT_TOKEN}",
    });
    expect(parseTokenInput("${TELEGRAM_BOT_TOKEN}")).toEqual({
      kind: "env",
      envName: "TELEGRAM_BOT_TOKEN",
      placeholder: "${TELEGRAM_BOT_TOKEN}",
    });
    expect(parseTokenInput("123456:abc")).toEqual({
      kind: "mem",
      secret: "123456:abc",
    });
  });

  test("materializes credentialType=mem from the runtime credential store", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    process.env.CLISBOT_HOME = tempDir;
    const runtimeCredentialsPath = join(tempDir, "state", "runtime-credentials.json");
    const config = createConfig();
    config.bots.telegram.default.credentialType = "mem";
    config.bots.telegram.default.botToken = "";
    setChannelRuntimeCredential({
      channel: "telegram",
      botId: "default",
      botToken: "telegram-mem-token",
      runtimeCredentialsPath,
    });

    const resolved = materializeRuntimeChannelCredentials(config, {
      runtimeCredentialsPath,
    });
    expect(resolved.bots.telegram.default.botToken).toBe("telegram-mem-token");
  });

  test("materializes credentialType=mem from runtime env injection", () => {
    const config = createConfig();
    config.bots.telegram.default.credentialType = "mem";
    config.bots.telegram.default.botToken = "";

    const resolved = materializeRuntimeChannelCredentials(config, {
      env: {
        ...process.env,
        [buildChannelMemEnvName("telegram", "default", "botToken")]: "telegram-mem-env-token",
      },
    });

    expect(resolved.bots.telegram.default.botToken).toBe("telegram-mem-env-token");
  });

  test("materializes zalo-bot credentialType=mem from the runtime credential store", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    process.env.CLISBOT_HOME = tempDir;
    const runtimeCredentialsPath = join(tempDir, "state", "runtime-credentials.json");
    const config = createZaloBotConfig();
    config.bots.zaloBot.default.credentialType = "mem";
    config.bots.zaloBot.default.botToken = "";
    setChannelRuntimeCredential({
      channel: "zalo-bot",
      botId: "default",
      botToken: "zalo-mem-token",
      runtimeCredentialsPath,
    });

    const resolved = materializeRuntimeChannelCredentials(config, {
      runtimeCredentialsPath,
    });
    expect(resolved.bots.zaloBot.default.botToken).toBe("zalo-mem-token");
  });

  test("materializes slack credentialType=mem from the runtime credential store", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    process.env.CLISBOT_HOME = tempDir;
    const runtimeCredentialsPath = join(tempDir, "state", "runtime-credentials.json");
    const config = createSlackConfig();
    config.bots.slack.default.credentialType = "mem";
    config.bots.slack.default.appToken = "";
    config.bots.slack.default.botToken = "";
    setChannelRuntimeCredential({
      channel: "slack",
      botId: "default",
      appToken: "slack-app-mem-token",
      botToken: "slack-bot-mem-token",
      runtimeCredentialsPath,
    });

    const resolved = materializeRuntimeChannelCredentials(config, {
      runtimeCredentialsPath,
    });
    expect(resolved.bots.slack.default.appToken).toBe("slack-app-mem-token");
    expect(resolved.bots.slack.default.botToken).toBe("slack-bot-mem-token");
  });

  test("skips missing mem bots instead of throwing during materialization", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    const runtimeCredentialsPath = join(tempDir, "state", "runtime-credentials.json");
    const config = createConfig();
    config.bots.telegram.default.credentialType = "mem";
    config.bots.telegram.default.botToken = "";

    const resolved = materializeRuntimeChannelCredentials(config, {
      runtimeCredentialsPath,
    });
    expect(resolved.bots.telegram.default.botToken).toBe("");
    expect(resolved.bots.telegram.default.credentialType).toBe("mem");
  });

  test("deactivates expired mem bots and disables the channel when none remain", () => {
    const config = createConfig();
    config.bots.telegram.default.enabled = true;
    config.bots.telegram.default.credentialType = "mem";
    config.bots.telegram.default.botToken = "";

    const lines = deactivateExpiredMemBots(config);

    expect(lines).toEqual([
      "Disabled expired telegram/default (credentialType=mem).",
    ]);
    expect(config.bots.telegram.default.enabled).toBe(false);
    expect(config.bots.telegram.defaults.enabled).toBe(false);
    expect(config.bots.telegram.default.botToken).toBe("");
  });

  test("bootstrap bot application keeps channel root tokens empty", () => {
    const config = createConfig();

    applyBootstrapBotsToConfig(
      config,
      {
        slack: [
          {
            botId: "default",
            appToken: {
              kind: "env",
              envName: "SLACK_APP_TOKEN",
              placeholder: "${SLACK_APP_TOKEN}",
            },
            botToken: {
              kind: "env",
              envName: "SLACK_BOT_TOKEN",
              placeholder: "${SLACK_BOT_TOKEN}",
            },
          },
        ],
        telegram: [
          {
            botId: "default",
            botToken: {
              kind: "env",
              envName: "TELEGRAM_BOT_TOKEN",
              placeholder: "${TELEGRAM_BOT_TOKEN}",
            },
          },
        ],
        "zalo-bot": [],
      },
      { firstRun: true },
    );

    expect(config.bots.slack.default.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.bots.slack.default.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(config.bots.telegram.default.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
  });

  test("first-run bootstrap does not leave a fake default bot when the real bot id is different", () => {
    const config = createSlackConfig();

    applyBootstrapBotsToConfig(
      config,
      {
        slack: [
          {
            botId: "ops",
            appToken: {
              kind: "env",
              envName: "SLACK_APP_TOKEN",
              placeholder: "${SLACK_APP_TOKEN}",
            },
            botToken: {
              kind: "env",
              envName: "SLACK_BOT_TOKEN",
              placeholder: "${SLACK_BOT_TOKEN}",
            },
          },
        ],
        telegram: [],
        "zalo-bot": [],
      },
      { firstRun: true },
    );

    expect(config.bots.slack.defaults.defaultBotId).toBe("ops");
    expect(config.bots.slack.ops?.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.bots.slack.ops?.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect("default" in config.bots.slack).toBe(false);
  });

  test("bootstrap env input clears prior persisted credential metadata on existing bots", () => {
    const config = createConfig();
    config.bots.slack.defaults.enabled = true;
    config.bots.slack.default.enabled = true;
    config.bots.slack.default.credentialType = "tokenFile";
    config.bots.slack.default.appToken = "";
    config.bots.slack.default.botToken = "";
    config.bots.slack.default.appTokenFile = "/tmp/slack-app-token";
    config.bots.slack.default.botTokenFile = "/tmp/slack-bot-token";
    config.bots.telegram.defaults.enabled = true;
    config.bots.telegram.default.enabled = true;
    config.bots.telegram.default.credentialType = "tokenFile";
    config.bots.telegram.default.botToken = "";
    config.bots.telegram.default.tokenFile = "/tmp/telegram-bot-token";

    applyBootstrapBotsToConfig(
      config,
      {
        slack: [{
          botId: "default",
          appToken: {
            kind: "env",
            envName: "SLACK_APP_TOKEN",
            placeholder: "${SLACK_APP_TOKEN}",
          },
          botToken: {
            kind: "env",
            envName: "SLACK_BOT_TOKEN",
            placeholder: "${SLACK_BOT_TOKEN}",
          },
        }],
        telegram: [{
          botId: "default",
          botToken: {
            kind: "env",
            envName: "TELEGRAM_BOT_TOKEN",
            placeholder: "${TELEGRAM_BOT_TOKEN}",
          },
        }],
        "zalo-bot": [],
      },
      { firstRun: false },
    );

    expect(config.bots.slack.default.credentialType).toBeUndefined();
    expect(config.bots.slack.default.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.bots.slack.default.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(config.bots.slack.default.appTokenFile).toBeUndefined();
    expect(config.bots.slack.default.botTokenFile).toBeUndefined();
    expect(config.bots.telegram.default.credentialType).toBeUndefined();
    expect(config.bots.telegram.default.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
    expect(config.bots.telegram.default.tokenFile).toBeUndefined();
  });

  test("bootstrap rejects mixed slack credential input kinds", () => {
    const config = createConfig();

    expect(() =>
      applyBootstrapBotsToConfig(
        config,
        {
          slack: [{
            botId: "default",
            appToken: {
              kind: "env",
              envName: "SLACK_APP_TOKEN",
              placeholder: "${SLACK_APP_TOKEN}",
            },
            botToken: {
              kind: "mem",
              secret: "xoxb-mem-token",
            },
          }],
          telegram: [],
          "zalo-bot": [],
        },
        { firstRun: false },
      )
    ).toThrow("Slack bot default must use one credential input kind.");
  });

  test("bootstrap stages and persists slack mem credentials through the channel integration seam", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    process.env.CLISBOT_HOME = tempDir;
    const runtimeCredentialsPath = join(tempDir, "state", "runtime-credentials.json");
    const config = createSlackConfig();
    const bootstrapBots = {
      slack: [{
        botId: "default",
        appToken: {
          kind: "mem" as const,
          secret: "xapp-bootstrap",
        },
        botToken: {
          kind: "mem" as const,
          secret: "xbot-bootstrap",
        },
      }],
      telegram: [],
      "zalo-bot": [],
    };

    applyBootstrapBotsToConfig(config, bootstrapBots, { firstRun: false });
    stageBootstrapRuntimeCredentials(bootstrapBots, runtimeCredentialsPath);

    expect(getRuntimeCredentialDocument(runtimeCredentialsPath)).toEqual({
      slack: {
        default: {
          appToken: "xapp-bootstrap",
          botToken: "xbot-bootstrap",
        },
      },
    });

    expect(persistBootstrapMemBotCredentials(config, bootstrapBots, runtimeCredentialsPath)).toEqual([
      "Persisted slack/default to credential file.",
    ]);
    expect(getRuntimeCredentialDocument(runtimeCredentialsPath)).toEqual({
      slack: {},
    });
    expect(config.bots.slack.default.credentialType).toBe("tokenFile");
    expect(config.bots.slack.default.appToken).toBe("");
    expect(config.bots.slack.default.botToken).toBe("");
    expect(
      readFileSync(
        resolveChannelCredentialFilePath({
          channel: "slack",
          botId: "default",
          field: "appToken",
        }),
        "utf8",
      ),
    ).toBe("xapp-bootstrap\n");
    expect(
      readFileSync(
        resolveChannelCredentialFilePath({
          channel: "slack",
          botId: "default",
          field: "botToken",
        }),
        "utf8",
      ),
    ).toBe("xbot-bootstrap\n");
  });

  test("prefers the canonical credential file before env-backed fallback", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    process.env.CLISBOT_HOME = tempDir;
    const config = createConfig();
    const canonicalPath = resolveChannelCredentialFilePath({
      channel: "telegram",
      botId: "default",
      field: "botToken",
    });
    mkdirSync(join(tempDir, "credentials", "telegram", "default"), { recursive: true });
    writeFileSync(canonicalPath, "telegram-file-token\n", { encoding: "utf8", mode: 0o600 });

    const resolved = materializeRuntimeChannelCredentials(config, {
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: "telegram-env-token",
      },
    });

    expect(resolved.bots.telegram.default.botToken).toBe("telegram-file-token");
  });

  test("can materialize only the requested channel credentials", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    process.env.CLISBOT_HOME = tempDir;
    const config = createConfig();
    config.bots.slack.defaults.enabled = true;
    config.bots.slack.default.appToken = "${SLACK_APP_TOKEN}";
    config.bots.slack.default.botToken = "${SLACK_BOT_TOKEN}";

    const resolved = materializeRuntimeChannelCredentials(config, {
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: "telegram-env-token",
      },
      materializeChannels: ["telegram"],
    });

    expect(resolved.bots.telegram.default.botToken).toBe("telegram-env-token");
    expect(resolved.bots.slack.default?.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(resolved.bots.slack.default?.botToken).toBe("${SLACK_BOT_TOKEN}");
  });

  test("rejects raw persistent config token literals", () => {
    const config = createConfig();
    config.bots.telegram.default.botToken = "123456:abc";
    expect(() => validatePersistentChannelCredentials(config)).toThrow(
      "Raw channel token literals are not allowed",
    );
  });

  test("builds credential env skip paths from the surface contract", () => {
    expect(getCredentialSkipPaths({
      bots: {
        slack: {
          defaults: {},
          ops: {},
        },
        telegram: {
          defaults: {},
          default: {},
        },
        zaloBot: {
          defaults: {},
          sales: {},
        },
      },
    })).toEqual([
      "bots.slack.ops.appToken",
      "bots.slack.ops.botToken",
      "bots.telegram.default.botToken",
      "bots.zaloBot.sales.botToken",
    ]);
  });
});
