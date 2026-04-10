import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChannelsCli } from "../src/control/channels-cli.ts";

describe("channels cli", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  const originalLog = console.log;

  afterEach(() => {
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    console.log = originalLog;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("adds and removes telegram group routes", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channels-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runChannelsCli([
      "add",
      "telegram-group",
      "-1001234567890",
      "--agent",
      "default",
      "--require-mention",
      "false",
    ]);

    let rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      channels: {
        telegram: {
          groups: Record<string, {
            agentId?: string;
            requireMention?: boolean;
            topics?: Record<string, unknown>;
          }>;
        };
      };
    };

    expect(rawConfig.channels.telegram.groups["-1001234567890"]).toEqual({
      agentId: "default",
      requireMention: false,
      topics: {},
    });

    await runChannelsCli(["remove", "telegram-group", "-1001234567890"]);

    rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    );
    expect(rawConfig.channels.telegram.groups).toEqual({});
  });

  test("adds telegram topic routes under the group", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channels-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runChannelsCli([
      "add",
      "telegram-group",
      "-1001234567890",
      "--topic",
      "42",
      "--agent",
      "default",
    ]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      channels: {
        telegram: {
          groups: Record<string, { topics?: Record<string, { agentId?: string; requireMention?: boolean }> }>;
        };
      };
    };

    expect(rawConfig.channels.telegram.groups["-1001234567890"]?.topics?.["42"]).toEqual({
      agentId: "default",
      requireMention: true,
    });
  });

  test("prints policy guidance after adding a telegram route", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channels-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runChannelsCli([
      "add",
      "telegram-group",
      "-1001234567890",
      "--topic",
      "42",
    ]);

    expect(logs.some((line) => line.includes("Telegram route next steps:"))).toBe(true);
    expect(logs).toContain("");
    expect(logs).toContain("+---------+");
    expect(logs).toContain("| SUCCESS |");
    expect(logs.some((line) =>
      line.includes("direct messages still follow channels.telegram.directMessages.policy")
    )).toBe(true);
    expect(logs.some((line) => line.includes("this topic is now on the Telegram allowlist"))).toBe(
      true,
    );
  });

  test("updates token references", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channels-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runChannelsCli(["set-token", "telegram-bot", "${CUSTOM_TELEGRAM_BOT_TOKEN}"]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      channels: {
        telegram: {
          botToken: string;
        };
      };
    };

    expect(rawConfig.channels.telegram.botToken).toBe("${CUSTOM_TELEGRAM_BOT_TOKEN}");
  });

  test("prints help when no channels subcommand is provided", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runChannelsCli([]);

    const output = logs.join("\n");
    expect(output).toContain("clisbot channels");
    expect(output).toContain("Policy guide:");
    expect(output).toContain("Telegram DMs still follow channels.telegram.directMessages.policy");
    expect(output).toContain("Telegram DMs use `pairing`.");
    expect(output).toContain("clisbot pairing approve telegram <code>");
    expect(output).toContain("additional-message-mode");
    expect(output).toContain("tmux -S ~/.clisbot/state/clisbot.sock list-sessions");
    expect(output).toContain("tmux -S ~/.clisbot/state/clisbot.sock attach -t <session-name>");
  });

  test("prints the same help for channels --help", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;

    await runChannelsCli(["--help"]);

    const output = logs.join("\n");
    expect(output).toContain("clisbot channels");
    expect(output).toContain("Discovery tips:");
    expect(output).toContain("Next steps:");
  });

  test("updates route privilege commands", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channels-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runChannelsCli([
      "add",
      "telegram-group",
      "-1001234567890",
      "--topic",
      "42",
    ]);

    await runChannelsCli([
      "privilege",
      "enable",
      "telegram-group",
      "-1001234567890",
      "--topic",
      "42",
    ]);
    await runChannelsCli([
      "privilege",
      "allow-user",
      "telegram-group",
      "-1001234567890",
      "123456",
      "--topic",
      "42",
    ]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      channels: {
        telegram: {
          groups: Record<string, {
            topics?: Record<string, {
              privilegeCommands?: {
                enabled?: boolean;
                allowUsers?: string[];
              };
            }>;
          }>;
        };
      };
    };

    expect(
      rawConfig.channels.telegram.groups["-1001234567890"]?.topics?.["42"]?.privilegeCommands,
    ).toEqual({
      enabled: true,
      allowUsers: ["123456"],
    });
  });

  test("updates top-level channel responseMode", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channels-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runChannelsCli(["response-mode", "set", "capture-pane", "--channel", "slack"]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      channels: {
        slack: {
          responseMode: string;
        };
      };
    };

    expect(rawConfig.channels.slack.responseMode).toBe("capture-pane");
  });

  test("updates telegram topic responseMode", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channels-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runChannelsCli([
      "add",
      "telegram-group",
      "-1001234567890",
      "--topic",
      "42",
      "--agent",
      "default",
    ]);

    await runChannelsCli([
      "response-mode",
      "set",
      "capture-pane",
      "--channel",
      "telegram",
      "--target",
      "-1001234567890",
      "--topic",
      "42",
    ]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      channels: {
        telegram: {
          groups: Record<string, { topics?: Record<string, { responseMode?: string }> }>;
        };
      };
    };

    expect(rawConfig.channels.telegram.groups["-1001234567890"]?.topics?.["42"]?.responseMode)
      .toBe("capture-pane");
  });

  test("updates top-level channel additionalMessageMode", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channels-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runChannelsCli(["additional-message-mode", "set", "queue", "--channel", "slack"]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      channels: {
        slack: {
          additionalMessageMode: string;
        };
      };
    };

    expect(rawConfig.channels.slack.additionalMessageMode).toBe("queue");
  });

  test("updates telegram topic additionalMessageMode", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-channels-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;

    await runChannelsCli([
      "add",
      "telegram-group",
      "-1001234567890",
      "--topic",
      "42",
      "--agent",
      "default",
    ]);

    await runChannelsCli([
      "additional-message-mode",
      "set",
      "queue",
      "--channel",
      "telegram",
      "--target",
      "-1001234567890",
      "--topic",
      "42",
    ]);

    const rawConfig = JSON.parse(
      readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"),
    ) as {
      channels: {
        telegram: {
          groups: Record<string, { topics?: Record<string, { additionalMessageMode?: string }> }>;
        };
      };
    };

    expect(
      rawConfig.channels.telegram.groups["-1001234567890"]?.topics?.["42"]?.additionalMessageMode,
    ).toBe("queue");
  });
});
