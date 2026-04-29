import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEditableConfig } from "../src/config/config-file.ts";
import { getCanonicalTelegramBotTokenPath } from "../src/config/channel-credentials.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { runBotsCli } from "../src/control/bots-cli.ts";
import { renderCliCommand } from "../src/shared/cli-name.ts";

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
    expect(readFileSync(getCanonicalTelegramBotTokenPath("alerts"), "utf8").trim()).toBe(
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
});
