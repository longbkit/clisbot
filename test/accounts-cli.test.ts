import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAccountsCli } from "../src/control/accounts-cli.ts";
import {
  getCanonicalSlackAppTokenPath,
  getCanonicalSlackBotTokenPath,
  getCanonicalTelegramBotTokenPath,
} from "../src/config/channel-credentials.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { writeEditableConfig } from "../src/config/config-file.ts";

describe("accounts cli", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  let previousHome: string | undefined;
  const originalLog = console.log;
  const originalRuntimeCredentialsPath = process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH;

  afterEach(() => {
    console.log = originalLog;
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    process.env.CLISBOT_HOME = previousHome;
    process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH = originalRuntimeCredentialsPath;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("adds a persisted telegram account without writing raw token into config", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-accounts-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH, config);

    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runAccountsCli([
      "add",
      "telegram",
      "--account",
      "alerts",
      "--token",
      "123456:telegram-dev-token",
      "--persist",
    ], {
      getRuntimeStatus: async () => ({
        running: false,
        configPath: process.env.CLISBOT_CONFIG_PATH!,
        pidPath: join(tempDir, "state", "clisbot.pid"),
        logPath: join(tempDir, "state", "clisbot.log"),
        tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
      }),
    } as any);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.channels.telegram.accounts.alerts.credentialType).toBe("tokenFile");
    expect(rawConfig.channels.telegram.accounts.alerts.botToken ?? "").toBe("");
    expect(readFileSync(getCanonicalTelegramBotTokenPath("alerts"), "utf8").trim()).toBe(
      "123456:telegram-dev-token",
    );
    expect(output.join("\n")).toContain("Added telegram/alerts, persisted=tokenFile, runtime=not-running");
  });

  test("prints help for explicit help alias", async () => {
    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runAccountsCli(["help"]);

    const text = output.join("\n");
    expect(text).toContain("clisbot accounts");
    expect(text).toContain("clisbot accounts help");
    expect(text).toContain("--slack-app-token");
    expect(text).toContain("literal token input without `--persist` stays runtime-only");
  });

  test("accepts bootstrap-style Slack token flag aliases", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-accounts-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH, config);

    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runAccountsCli([
      "add",
      "slack",
      "--account",
      "ops",
      "--slack-app-token",
      "xapp-test-token",
      "--slack-bot-token",
      "xoxb-test-token",
      "--persist",
    ], {
      getRuntimeStatus: async () => ({
        running: false,
        configPath: process.env.CLISBOT_CONFIG_PATH!,
        pidPath: join(tempDir, "state", "clisbot.pid"),
        logPath: join(tempDir, "state", "clisbot.log"),
        tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
      }),
    } as any);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.channels.slack.accounts.ops.credentialType).toBe("tokenFile");
    expect(rawConfig.channels.slack.accounts.ops.appToken ?? "").toBe("");
    expect(rawConfig.channels.slack.accounts.ops.botToken ?? "").toBe("");
    expect(readFileSync(getCanonicalSlackAppTokenPath("ops"), "utf8").trim()).toBe("xapp-test-token");
    expect(readFileSync(getCanonicalSlackBotTokenPath("ops"), "utf8").trim()).toBe("xoxb-test-token");
    expect(output.join("\n")).toContain("Added slack/ops, persisted=tokenFile, runtime=not-running");
  });

  test("accepts bootstrap-style Telegram token flag alias", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-accounts-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH, config);

    await runAccountsCli([
      "add",
      "telegram",
      "--account",
      "alerts",
      "--telegram-bot-token",
      "123456:telegram-dev-token",
      "--persist",
    ], {
      getRuntimeStatus: async () => ({
        running: false,
        configPath: process.env.CLISBOT_CONFIG_PATH!,
        pidPath: join(tempDir, "state", "clisbot.pid"),
        logPath: join(tempDir, "state", "clisbot.log"),
        tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
      }),
    } as any);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.channels.telegram.accounts.alerts.credentialType).toBe("tokenFile");
    expect(readFileSync(getCanonicalTelegramBotTokenPath("alerts"), "utf8").trim()).toBe(
      "123456:telegram-dev-token",
    );
  });

  test("rejects raw add without --persist when runtime is stopped", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-accounts-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH, config);

    await expect(
      runAccountsCli([
        "add",
        "telegram",
        "--account",
        "alerts",
        "--token",
        "123456:telegram-dev-token",
      ], {
        getRuntimeStatus: async () => ({
          running: false,
          configPath: process.env.CLISBOT_CONFIG_PATH!,
          pidPath: join(tempDir, "state", "clisbot.pid"),
          logPath: join(tempDir, "state", "clisbot.log"),
          tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
        }),
      } as any),
    ).rejects.toThrow("requires a running clisbot runtime");
  });

  test("persists all mem-backed accounts from the runtime credential store", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-accounts-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH = join(tempDir, "state", "runtime-credentials.json");
    mkdirSync(join(tempDir, "state"), { recursive: true });

    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.channels.telegram.enabled = true;
    config.channels.telegram.accounts.default = {
      credentialType: "mem",
      botToken: "",
    };
    config.channels.telegram.botToken = "";
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH, config);
    writeFileSync(
      process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH,
      JSON.stringify({
        telegram: {
          default: {
            botToken: "persist-me",
          },
        },
      }),
    );

    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runAccountsCli(["persist", "--all"], {
      getRuntimeStatus: async () => ({
        running: true,
        configPath: process.env.CLISBOT_CONFIG_PATH!,
        pidPath: join(tempDir, "state", "clisbot.pid"),
        logPath: join(tempDir, "state", "clisbot.log"),
        tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
      }),
    } as any);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.channels.telegram.accounts.default.credentialType).toBe("tokenFile");
    expect(readFileSync(getCanonicalTelegramBotTokenPath("default"), "utf8").trim()).toBe("persist-me");
    expect(output.join("\n")).toContain("Persisted telegram/default");
  });
});
