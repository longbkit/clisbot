import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeEditableConfig } from "../src/config/config-file.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { runRoutesCli } from "../src/control/routes-cli.ts";

describe("routes cli", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  let previousCliName: string | undefined;
  const originalLog = console.log;

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    delete process.env.CLISBOT_CLI_NAME;
  });

  afterEach(() => {
    console.log = originalLog;
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    process.env.CLISBOT_CLI_NAME = previousCliName;
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

  test("adds a slack channel route with the new canonical route id", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "slack",
      "channel:C1234567890",
      "--bot",
      "default",
      "--policy",
      "open",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.slack.default.groups["channel:C1234567890"]).toEqual({
      enabled: true,
      requireMention: true,
      allowUsers: [],
      blockUsers: [],
      allowBots: false,
      policy: "open",
    });
  });

  test("adds a telegram topic route and allows route-local mode overrides", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "telegram",
      "topic:-1001234567890:42",
      "--bot",
      "default",
      "--policy",
      "open",
    ]);
    await runRoutesCli([
      "set-response-mode",
      "--channel",
      "telegram",
      "topic:-1001234567890:42",
      "--bot",
      "default",
      "--mode",
      "capture-pane",
    ]);
    await runRoutesCli([
      "set-agent",
      "--channel",
      "telegram",
      "topic:-1001234567890:42",
      "--bot",
      "default",
      "--agent",
      "support",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.telegram.default.groups["-1001234567890"].topics["42"]).toEqual({
      enabled: true,
      requireMention: true,
      allowUsers: [],
      blockUsers: [],
      allowBots: false,
      policy: "open",
      responseMode: "capture-pane",
      agentId: "support",
    });
  });

  test("add fails with guidance when the route already exists", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "slack",
      "channel:C1234567890",
      "--bot",
      "default",
    ]);

    await expect(
      runRoutesCli([
        "add",
        "--channel",
        "slack",
        "channel:C1234567890",
        "--bot",
        "default",
      ]),
    ).rejects.toThrow("Use a matching `set-<key>` command instead.");
  });

  test("accepts route ids after option values instead of mistaking --bot values for the route", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "slack",
      "--bot",
      "default",
      "channel:C1234567890",
      "--policy",
      "open",
    ]);

    await runRoutesCli([
      "set-agent",
      "--channel",
      "slack",
      "--bot",
      "default",
      "channel:C1234567890",
      "--agent",
      "support",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.slack.default.groups["channel:C1234567890"]?.agentId).toBe("support");
  });

  test("remove fails when the route does not exist", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await expect(
      runRoutesCli([
        "remove",
        "--channel",
        "telegram",
        "group:-1001234567890",
        "--bot",
        "default",
      ]),
    ).rejects.toThrow("Unknown route: telegram/default/group:-1001234567890");
  });

  test("list rejects unknown channel filters instead of silently showing empty results", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await expect(runRoutesCli(["list", "--channel", "discord"])).rejects.toThrow(
      "clisbot routes",
    );
  });

  test("help explains DM wildcard auth ownership", async () => {
    const lines: string[] = [];
    console.log = ((line?: unknown) => {
      lines.push(String(line ?? ""));
    }) as typeof console.log;

    await runRoutesCli(["help"]);

    const text = lines.join("\n");
    expect(text).toContain("For DM auth, mutate `dm:*`, not `dm:<userId>`.");
    expect(text).toContain("pairing approve <channel> <code>");
    expect(text).toContain("routes add-block-user --channel telegram dm:* --bot alerts --user 1276408333");
  });

  test("rejects DM admission policy changes on exact DM routes", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "slack",
      "dm:U123",
      "--bot",
      "default",
    ]);

    await expect(
      runRoutesCli([
        "set-policy",
        "--channel",
        "slack",
        "dm:U123",
        "--bot",
        "default",
        "--policy",
        "disabled",
      ]),
    ).rejects.toThrow("dm:* only");
  });

  test("rejects DM allowlist mutations on exact DM routes", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "slack",
      "dm:U123",
      "--bot",
      "default",
    ]);

    await expect(
      runRoutesCli([
        "add-allow-user",
        "--channel",
        "slack",
        "dm:U123",
        "--bot",
        "default",
        "--user",
        "U123",
      ]),
    ).rejects.toThrow("dm:* only");
  });

  test("materializes the DM wildcard route when mutating DM allow users", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add-allow-user",
      "--channel",
      "slack",
      "dm:*",
      "--bot",
      "default",
      "--user",
      "U123",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.slack.default.directMessages["dm:*"].allowUsers).toEqual(["U123"]);
  });
});
