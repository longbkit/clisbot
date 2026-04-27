import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTelegramConversationRoute } from "../src/channels/telegram/route-config.ts";
import { writeEditableConfig } from "../src/config/config-file.ts";
import { loadConfigWithoutEnvResolution } from "../src/config/load-config.ts";
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

  test("adds a slack group route with the new canonical route id and raw stored key", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "slack",
      "group:C1234567890",
      "--bot",
      "default",
      "--policy",
      "open",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.slack.default.groups.C1234567890).toEqual({
      enabled: true,
      requireMention: true,
      allowUsers: [],
      blockUsers: [],
      allowBots: false,
      policy: "open",
    });
  });

  test("keeps backward compatibility with legacy slack channel route ids", async () => {
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
    expect(rawConfig.bots.slack.default.groups.C1234567890.policy).toBe("open");
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
      "set-timezone",
      "--channel",
      "telegram",
      "topic:-1001234567890:42",
      "--bot",
      "default",
      "America/Los_Angeles",
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
      timezone: "America/Los_Angeles",
      agentId: "support",
    });
  });

  test("added telegram groups inherit usable open sender policy through group admission allowlist", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "telegram",
      "group:-1001234567890",
      "--bot",
      "default",
      "--require-mention",
      "true",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.telegram.default.groupPolicy).toBe("allowlist");
    expect(rawConfig.bots.telegram.default.groups["*"].policy).toBe("open");
    expect(rawConfig.bots.telegram.default.groups["-1001234567890"].policy).toBeUndefined();

    const loadedConfig = await loadConfigWithoutEnvResolution(process.env.CLISBOT_CONFIG_PATH!);
    const resolved = resolveTelegramConversationRoute({
      loadedConfig,
      chatType: "supergroup",
      chatId: -1001234567890,
      isForum: false,
      botId: "default",
    });

    expect(resolved.status).toBe("admitted");
    expect(resolved.route?.policy).toBe("open");
    expect(resolved.route?.requireMention).toBe(true);
  });

  test("clears exact shared route policy so it inherits the wildcard sender policy", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "telegram",
      "topic:-1001234567890:4",
      "--bot",
      "default",
      "--policy",
      "disabled",
    ]);
    await runRoutesCli([
      "clear-policy",
      "--channel",
      "telegram",
      "topic:-1001234567890:4",
      "--bot",
      "default",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.telegram.default.groups["-1001234567890"].topics["4"].policy)
      .toBeUndefined();

    const loadedConfig = await loadConfigWithoutEnvResolution(process.env.CLISBOT_CONFIG_PATH!);
    const resolved = resolveTelegramConversationRoute({
      loadedConfig,
      chatType: "supergroup",
      chatId: -1001234567890,
      topicId: 4,
      isForum: true,
      botId: "default",
    });

    expect(resolved.status).toBe("admitted");
    expect(resolved.route?.policy).toBe("open");
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
      "group:C1234567890",
      "--policy",
      "open",
    ]);

    await runRoutesCli([
      "set-agent",
      "--channel",
      "slack",
      "--bot",
      "default",
      "group:C1234567890",
      "--agent",
      "support",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.slack.default.groups.C1234567890?.agentId).toBe("support");
  });

  test("shows effective timezone and current local time for a route", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    const output: string[] = [];
    console.log = ((line?: unknown) => {
      output.push(String(line ?? ""));
    }) as typeof console.log;

    await runRoutesCli([
      "add",
      "--channel",
      "telegram",
      "group:-1001234567890",
      "--bot",
      "default",
    ]);
    await runRoutesCli([
      "set-timezone",
      "--channel",
      "telegram",
      "group:-1001234567890",
      "--bot",
      "default",
      "Asia/Ho_Chi_Minh",
    ]);
    output.length = 0;

    await runRoutesCli([
      "get-timezone",
      "--channel",
      "telegram",
      "group:-1001234567890",
      "--bot",
      "default",
    ]);

    const text = output.join("\n");
    expect(text).toContain("telegram/default/group:-1001234567890 timezone: Asia/Ho_Chi_Minh");
    expect(text).toContain("effective: Asia/Ho_Chi_Minh (route)");
    expect(text).toContain("localTime:");
    expect(text).toContain("Asia/Ho_Chi_Minh");
  });

  test("mutates allow and block users on canonical wildcard ids", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await runRoutesCli([
      "add-allow-user",
      "--channel",
      "slack",
      "group:*",
      "--bot",
      "default",
      "--user",
      "U_OWNER",
    ]);
    await runRoutesCli([
      "add-block-user",
      "--channel",
      "telegram",
      "group:*",
      "--bot",
      "default",
      "--user",
      "1276408333",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.slack.default.groups["*"].allowUsers).toEqual(["U_OWNER"]);
    expect(rawConfig.bots.telegram.default.groups["*"].blockUsers).toEqual(["1276408333"]);
  });

  test("allows exact DM routes to carry admission config in the new shape", async () => {
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
      "--policy",
      "allowlist",
    ]);
    await runRoutesCli([
      "add-allow-user",
      "--channel",
      "slack",
      "dm:U123",
      "--bot",
      "default",
      "--user",
      "U123",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.slack.default.directMessages.U123.policy).toBe("allowlist");
    expect(rawConfig.bots.slack.default.directMessages.U123.allowUsers).toEqual(["U123"]);
  });

  test("rejects invalid route policies before writing config", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await expect(runRoutesCli([
      "add",
      "--channel",
      "telegram",
      "group:-1001234567890",
      "--bot",
      "default",
      "--policy",
      "pairing",
    ])).rejects.toThrow("group:-1001234567890 policy must be one of: disabled, allowlist, open");

    await runRoutesCli([
      "add",
      "--channel",
      "telegram",
      "dm:1276408333",
      "--bot",
      "default",
      "--policy",
      "pairing",
    ]);

    const rawConfig = JSON.parse(readFileSync(process.env.CLISBOT_CONFIG_PATH!, "utf8"));
    expect(rawConfig.bots.telegram.default.groups["-1001234567890"]).toBeUndefined();
    expect(rawConfig.bots.telegram.default.directMessages["1276408333"].policy).toBe("pairing");
  });

  test("rejects removing the shared wildcard route", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-routes-cli-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    await seedConfig();
    console.log = (() => {}) as typeof console.log;

    await expect(runRoutesCli([
      "remove",
      "--channel",
      "slack",
      "group:*",
      "--bot",
      "default",
    ])).rejects.toThrow("group:* always exists");
  });

  test("help explains the canonical ids and the allowlist deny message", async () => {
    const lines: string[] = [];
    console.log = ((line?: unknown) => {
      lines.push(String(line ?? ""));
    }) as typeof console.log;

    await runRoutesCli(["help"]);

    const text = lines.join("\n");
    expect(text).toContain("Canonical CLI ids are `dm:<id>`, `dm:*`, `group:<id>`, `group:*`");
    expect(text).toContain("routes add --channel <slack|telegram> <dm:*|dm:<id>>");
    expect(text).toContain("Shared group policy values are `disabled`, `allowlist`, and `open`.");
    expect(text).toContain("DM wildcard policy values are `disabled`, `pairing`, `allowlist`, and `open`.");
    expect(text).toContain("You are not allowed to use this bot in this group.");
    expect(text).toContain("routes add-allow-user --channel slack group:* --bot default --user U_OWNER");
  });
});
