import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCanonicalTelegramBotTokenPath,
  getTelegramMemEnvName,
  materializeRuntimeChannelCredentials,
  parseTokenInput,
  setTelegramRuntimeCredential,
  validatePersistentChannelCredentials,
} from "../src/config/channel-credentials.ts";
import {
  applyBootstrapBotsToConfig,
  deactivateExpiredMemBots,
} from "../src/config/channel-bot-management.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

function createConfig(): ClisbotConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: false,
        telegramEnabled: true,
      }),
    ),
  );
  config.bots.telegram.default.botToken = "${TELEGRAM_BOT_TOKEN}";
  return config;
}

describe("channel credentials", () => {
  let tempDir = "";
  let previousCliName: string | undefined;
  let previousTelegramBotToken: string | undefined;
  let previousTelegramMemBotToken: string | undefined;
  const originalHome = process.env.CLISBOT_HOME;
  const telegramMemEnvName = getTelegramMemEnvName("default");

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    previousTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    previousTelegramMemBotToken = process.env[telegramMemEnvName];
    delete process.env.CLISBOT_CLI_NAME;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env[telegramMemEnvName];
  });

  afterEach(() => {
    process.env.CLISBOT_CLI_NAME = previousCliName;
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
    setTelegramRuntimeCredential({
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
        [getTelegramMemEnvName("default")]: "telegram-mem-env-token",
      },
    });

    expect(resolved.bots.telegram.default.botToken).toBe("telegram-mem-env-token");
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
        slackBots: [
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
        telegramBots: [
          {
            botId: "default",
            botToken: {
              kind: "env",
              envName: "TELEGRAM_BOT_TOKEN",
              placeholder: "${TELEGRAM_BOT_TOKEN}",
            },
          },
        ],
        zaloBotBots: [],
      },
      { firstRun: true },
    );

    expect(config.bots.slack.default.appToken).toBe("${SLACK_APP_TOKEN}");
    expect(config.bots.slack.default.botToken).toBe("${SLACK_BOT_TOKEN}");
    expect(config.bots.telegram.default.botToken).toBe("${TELEGRAM_BOT_TOKEN}");
  });

  test("prefers the canonical credential file before env-backed fallback", () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channel-credentials-"));
    process.env.CLISBOT_HOME = tempDir;
    const config = createConfig();
    const canonicalPath = getCanonicalTelegramBotTokenPath("default");
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
});
