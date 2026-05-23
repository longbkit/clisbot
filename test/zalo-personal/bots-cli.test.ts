import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEditableConfig } from "../../src/config/core/config-file.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import { runBotsCli } from "../../src/control/commands/bots-cli.ts";

describe("zalo-personal bots cli", () => {
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

  async function seedConfig() {
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.agents.list = [{ id: "default" }];
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, config);
  }

  function setTestConfigEnv() {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-personal-bots-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    previousHome = process.env.CLISBOT_HOME;
    process.env.CLISBOT_HOME = tempDir;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
  }

  function captureConsole() {
    const output: string[] = [];
    console.log = (value?: unknown) => {
      output.push(String(value ?? ""));
    };
    return output;
  }

  function createRuntimeDeps(params: {
    running: boolean;
    activeBotIds?: string[];
  }) {
    return {
      getRuntimeStatus: async () => ({
        running: params.running,
        configPath: process.env.CLISBOT_CONFIG_PATH!,
        pidPath: join(tempDir, "state", "clisbot.pid"),
        logPath: join(tempDir, "state", "clisbot.log"),
        tmuxSocketPath: join(tempDir, "state", "clisbot.sock"),
      }),
      runtimeHealthStore: {
        read: async () => ({
          channels: params.activeBotIds
            ? {
                "zalo-personal": {
                  channel: "zalo-personal",
                  connection: "active",
                  summary: `Zalo Personal listener connected for ${params.activeBotIds.length} bot(s).`,
                  actions: [],
                  instances: params.activeBotIds.map((botId) => ({ botId, tokenHint: "tokenFile" })),
                  updatedAt: new Date(0).toISOString(),
                },
              }
            : {},
        }),
      },
    } as any;
  }

  test("status reports missing QR session without token contract", async () => {
    setTestConfigEnv();
    await seedConfig();

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    rawConfig.bots.zaloPersonal.defaults.enabled = true;
    rawConfig.bots.zaloPersonal.default.enabled = true;
    rawConfig.bots.zaloPersonal.default.credentialType = "tokenFile";
    rawConfig.bots.zaloPersonal.default.tokenFile = "~/.clisbot/credentials/zalo-personal/default/auth-session";
    writeFileSync(process.env.CLISBOT_CONFIG_PATH!, `${JSON.stringify(rawConfig, null, 2)}\n`);

    const output = captureConsole();
    await runBotsCli(["status", "--channel", "zalo-personal"], createRuntimeDeps({ running: false }));

    expect(output.join("\n")).toContain("zalo-personal/default login=missing connection=not-running");
    expect(output.join("\n")).toContain("credentials: missing path=~/.clisbot/credentials/zalo-personal/default/auth-session");
  });

  test("status scopes active connection to the selected bot", async () => {
    setTestConfigEnv();
    await seedConfig();

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    rawConfig.bots.zaloPersonal.defaults.enabled = true;
    rawConfig.bots.zaloPersonal.default.enabled = true;
    rawConfig.bots.zaloPersonal.default.credentialType = "tokenFile";
    rawConfig.bots.zaloPersonal.default.tokenFile = "~/.clisbot/credentials/zalo-personal/default/auth-session";
    rawConfig.bots.zaloPersonal.work = {
      enabled: true,
      credentialType: "tokenFile",
      tokenFile: "~/.clisbot/credentials/zalo-personal/work/auth-session",
    };
    writeFileSync(process.env.CLISBOT_CONFIG_PATH!, `${JSON.stringify(rawConfig, null, 2)}\n`);

    const output = captureConsole();
    const deps = createRuntimeDeps({ running: true, activeBotIds: ["default"] });
    await runBotsCli(["status", "--channel", "zalo-personal"], deps);
    await runBotsCli(["status", "--channel", "zalo-personal", "--bot", "work"], deps);

    expect(output.join("\n")).toContain("zalo-personal/default login=missing connection=active");
    expect(output.join("\n")).toContain("zalo-personal/work login=missing connection=stopped");
  });

  test("logout warns when the selected listener is still active", async () => {
    setTestConfigEnv();
    await seedConfig();

    const tokenFile = join(tempDir, "zalo-work-session");
    writeFileSync(tokenFile, "{}\n");
    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    rawConfig.bots.zaloPersonal.defaults.enabled = true;
    rawConfig.bots.zaloPersonal.work = {
      enabled: true,
      credentialType: "tokenFile",
      tokenFile,
    };
    writeFileSync(process.env.CLISBOT_CONFIG_PATH!, `${JSON.stringify(rawConfig, null, 2)}\n`);

    const output = captureConsole();
    await runBotsCli(
      ["logout", "--channel", "zalo-personal", "--bot", "work"],
      createRuntimeDeps({ running: true, activeBotIds: ["work"] }),
    );

    expect(existsSync(tokenFile)).toBe(false);
    expect(output.join("\n")).toContain("logged out zalo-personal/work");
    expect(output.join("\n")).toContain("warning listener may remain connected");
  });

  test("add requires confirmation before mutating config", async () => {
    setTestConfigEnv();
    await seedConfig();
    console.log = () => {};

    await expect(
      runBotsCli(
        ["add", "--channel", "zalo-personal", "--bot", "work"],
        createRuntimeDeps({ running: false }),
      ),
    ).rejects.toThrow("requires explicit approval");

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.zaloPersonal.work).toBeUndefined();
  });
});
