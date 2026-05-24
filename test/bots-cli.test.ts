import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEditableConfig } from "../src/config/core/config-file.ts";
import {
  resolveChannelCredentialFilePath,
} from "../src/config/channels/channel-credential-contract.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import { runBotsCli } from "../src/control/commands/bots-cli.ts";
import { renderCliCommand } from "../src/control/commands/cli-name.ts";

describe("bots cli", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  let previousHome: string | undefined;
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    process.env.CLISBOT_HOME = previousHome;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function seedConfig(agentIds = ["default", "support"]) {
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = agentIds.map((id) => ({ id }));
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, config);
  }

  test("subcommand help prints guidance without requiring bot args", async () => {
    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runBotsCli(["add", "--help"]);

    expect(output.join("\n")).toContain("Usage:");
    expect(output.join("\n")).toContain("bots add --channel telegram");
  });

  test("adds a persisted telegram bot without writing raw token into config", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();

    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runBotsCli(
      [
        "add",
        "--channel",
        "telegram",
        "--bot",
        "alerts",
        "--bot-token",
        "123456:telegram-dev-token",
        "--agent",
        "support",
        "--persist",
      ],
      {
        getRuntimeStatus: async () => ({
          running: false,
          configPath: process.env.CLISBOT_CONFIG_PATH!,
          pidPath: join(tempDir, "state", "clisbot.pid"),
          logPath: join(tempDir, "state", "clisbot.log"),
          tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
        }),
      } as any,
    );

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.telegram.alerts.credentialType).toBe("tokenFile");
    expect(rawConfig.bots.telegram.alerts.botToken ?? "").toBe("");
    expect(rawConfig.bots.telegram.alerts.agentId).toBe("support");
    expect(rawConfig.bots.telegram.defaults.defaultBotId).toBe("alerts");
    expect(readFileSync(resolveChannelCredentialFilePath({
      channel: "telegram",
      botId: "alerts",
      field: "botToken",
    }), "utf8").trim()).toBe(
      "123456:telegram-dev-token",
    );
    expect(output.join("\n")).toContain(
      "Added telegram/alerts, persisted=tokenFile, runtime=not-running",
    );
  });

  test("add fails with guidance when the bot already exists", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = () => {};

    await expect(
      runBotsCli(
        [
          "add",
          "--channel",
          "telegram",
          "--bot",
          "default",
          "--bot-token",
          "${TELEGRAM_BOT_TOKEN}",
        ],
        {
          getRuntimeStatus: async () => ({
            running: false,
            configPath: process.env.CLISBOT_CONFIG_PATH!,
            pidPath: join(tempDir, "state", "clisbot.pid"),
            logPath: join(tempDir, "state", "clisbot.log"),
            tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
          }),
        } as any,
      ),
    ).rejects.toThrow(
      `Use ${renderCliCommand("bots set-agent ...", { inline: true })}, ${renderCliCommand("bots set-credentials ...", { inline: true })}`,
    );
  });

  test("adds a persisted zalo-bot bot without writing raw token into config", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();

    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runBotsCli(
      [
        "add",
        "--channel",
        "zalo-bot",
        "--bot",
        "zalo-main",
        "--bot-token",
        "123456:zalo-bot-token",
        "--agent",
        "support",
        "--persist",
      ],
      {
        getRuntimeStatus: async () => ({
          running: false,
          configPath: process.env.CLISBOT_CONFIG_PATH!,
          pidPath: join(tempDir, "state", "clisbot.pid"),
          logPath: join(tempDir, "state", "clisbot.log"),
          tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
        }),
      } as any,
    );

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.zaloBot["zalo-main"].credentialType).toBe("tokenFile");
    expect(rawConfig.bots.zaloBot["zalo-main"].botToken ?? "").toBe("");
    expect(rawConfig.bots.zaloBot["zalo-main"].agentId).toBe("support");
    expect(rawConfig.bots.zaloBot.defaults.defaultBotId).toBe("zalo-main");
    expect(readFileSync(resolveChannelCredentialFilePath({
      channel: "zalo-bot",
      botId: "zalo-main",
      field: "botToken",
    }), "utf8").trim()).toBe(
      "123456:zalo-bot-token",
    );
    expect(output.join("\n")).toContain(
      "Added zalo-bot/zalo-main, persisted=tokenFile, runtime=not-running",
    );
  });

  test("adds a persisted slack bot without writing raw tokens into config", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();

    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runBotsCli(
      [
        "add",
        "--channel",
        "slack",
        "--bot",
        "ops",
        "--app-token",
        "xapp-slack-app-token",
        "--bot-token",
        "xoxb-slack-bot-token",
        "--agent",
        "support",
        "--persist",
      ],
      {
        getRuntimeStatus: async () => ({
          running: false,
          configPath: process.env.CLISBOT_CONFIG_PATH!,
          pidPath: join(tempDir, "state", "clisbot.pid"),
          logPath: join(tempDir, "state", "clisbot.log"),
          tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
        }),
      } as any,
    );

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.slack.ops.credentialType).toBe("tokenFile");
    expect(rawConfig.bots.slack.ops.appToken ?? "").toBe("");
    expect(rawConfig.bots.slack.ops.botToken ?? "").toBe("");
    expect(rawConfig.bots.slack.ops.agentId).toBe("support");
    expect(rawConfig.bots.slack.defaults.defaultBotId).toBe("ops");
    expect(readFileSync(resolveChannelCredentialFilePath({
      channel: "slack",
      botId: "ops",
      field: "appToken",
    }), "utf8").trim()).toBe(
      "xapp-slack-app-token",
    );
    expect(readFileSync(resolveChannelCredentialFilePath({
      channel: "slack",
      botId: "ops",
      field: "botToken",
    }), "utf8").trim()).toBe(
      "xoxb-slack-bot-token",
    );
    expect(output.join("\n")).toContain(
      "Added slack/ops, persisted=tokenFile, runtime=not-running",
    );
  });

  test("set-agent updates the bot fallback agent", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();

    console.log = (() => {}) as typeof console.log;

    await runBotsCli([
      "set-agent",
      "--channel",
      "telegram",
      "--bot",
      "default",
      "--agent",
      "support",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.telegram.default.agentId).toBe("support");
  });

  test("sets and clears concrete bot timezone", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();

    console.log = (() => {}) as typeof console.log;

    await runBotsCli([
      "set-timezone",
      "--channel",
      "telegram",
      "--bot",
      "default",
      "Asia/Ho_Chi_Minh",
    ]);
    let rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.telegram.default.timezone).toBe("Asia/Ho_Chi_Minh");

    await runBotsCli(["clear-timezone", "--channel", "telegram", "--bot", "default"]);
    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.telegram.default.timezone).toBeUndefined();
  });

  test("list counts telegram group, topic, and dm routes through config-owned summaries", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();

    const config = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    config.bots.telegram.default.groups = {
      "-1001": {
        enabled: true,
        topics: {
          "10": { enabled: true },
          "11": { enabled: true },
        },
      },
      "-1002": {
        enabled: true,
        topics: {},
      },
    };
    config.bots.telegram.default.directMessages = {
      "1276408333": {
        enabled: true,
      },
    };
    writeFileSync(process.env.CLISBOT_CONFIG_PATH!, `${JSON.stringify(config, null, 2)}\n`);

    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runBotsCli(["list", "--channel", "telegram", "--json"]);

    const parsed = JSON.parse(output.join("\n"));
    expect(parsed).toEqual([
      expect.objectContaining({
        channel: "telegram",
        botId: "default",
        enabled: false,
        routeCount: 7,
      }),
    ]);
  });

  test("reads zalo personal default dmPolicy without opening unknown DMs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();

    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };

    await runBotsCli(["get-dm-policy", "--channel", "zalo-personal", "--bot", "default"]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(output.join("\n")).toContain("zalo-personal/default dmPolicy: allowlist");
    expect(rawConfig.bots.zaloPersonal.default.dmPolicy).toBe("allowlist");
    expect(rawConfig.bots.zaloPersonal.default.directMessages["*"]).toMatchObject({
      enabled: true,
      policy: "allowlist",
      allowUsers: [],
    });
  });

  test("keeps dmPolicy and the wildcard DM route consistent when setting policy", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = () => {};

    await runBotsCli([
      "set-dm-policy",
      "--channel",
      "zalo-personal",
      "--bot",
      "default",
      "--policy",
      "pairing",
    ]);

    let rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.zaloPersonal.default.dmPolicy).toBe("pairing");
    expect(rawConfig.bots.zaloPersonal.default.directMessages["*"].enabled).toBe(true);
    expect(rawConfig.bots.zaloPersonal.default.directMessages["*"].policy).toBe("pairing");

    await runBotsCli([
      "set-dm-policy",
      "--channel",
      "zalo-personal",
      "--bot",
      "default",
      "--policy",
      "disabled",
    ]);

    rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.zaloPersonal.default.dmPolicy).toBe("disabled");
    expect(rawConfig.bots.zaloPersonal.default.directMessages["*"].enabled).toBe(false);
    expect(rawConfig.bots.zaloPersonal.default.directMessages["*"].policy).toBe("disabled");
  });

});
