import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSlackConversationRoute } from "../src/channels/slack/route-config.ts";
import { resolveTelegramConversationRoute } from "../src/channels/telegram/route-config.ts";
import { writeEditableConfig } from "../src/config/config-file.ts";
import { loadConfigWithoutEnvResolution } from "../src/config/load-config.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { runRoutesCli } from "../src/control/routes-cli.ts";

describe("shared route audience e2e", () => {
  let tempDir = "";
  let previousConfigPath: string | undefined;
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
    process.env.CLISBOT_CONFIG_PATH = previousConfigPath;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function seedConfig() {
    const config = clisbotConfigSchema.parse(
      JSON.parse(
        renderDefaultConfigTemplate({
          slackEnabled: true,
          telegramEnabled: true,
        }),
      ),
    );
    config.agents.list = [{ id: "default" }];
    config.bots.slack.defaults.enabled = true;
    config.bots.slack.default.enabled = true;
    config.bots.slack.default.appToken = "app-token";
    config.bots.slack.default.botToken = "bot-token";
    config.bots.telegram.defaults.enabled = true;
    config.bots.telegram.default.enabled = true;
    config.bots.telegram.default.botToken = "telegram-token";
    await writeEditableConfig(process.env.CLISBOT_CONFIG_PATH!, config);
  }

  test("Slack wildcard audience flows through effective route resolution with the new canonical ids", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-shared-route-audience-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;
    await seedConfig();

    await runRoutesCli([
      "add",
      "--channel",
      "slack",
      "group:C123",
      "--bot",
      "default",
      "--policy",
      "open",
    ]);
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
      "add-allow-user",
      "--channel",
      "slack",
      "group:C123",
      "--bot",
      "default",
      "--user",
      "U_DEVOPS",
    ]);

    const loadedConfig = await loadConfigWithoutEnvResolution(process.env.CLISBOT_CONFIG_PATH!);
    const resolvedRoute = resolveSlackConversationRoute(
      loadedConfig,
      { channel_type: "channel", channel: "C123" },
      { botId: "default" },
    );

    expect(resolvedRoute.route?.allowUsers).toEqual(["U_OWNER", "U_DEVOPS"]);
    expect(resolvedRoute.status).toBe("admitted");
  });

  test("Telegram wildcard audience flows through effective topic resolution with the new canonical ids", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-shared-route-audience-"));
    previousConfigPath = process.env.CLISBOT_CONFIG_PATH;
    process.env.CLISBOT_CONFIG_PATH = join(tempDir, "clisbot.json");
    console.log = (() => {}) as typeof console.log;
    await seedConfig();

    await runRoutesCli([
      "add",
      "--channel",
      "telegram",
      "group:-1001",
      "--bot",
      "default",
      "--policy",
      "open",
    ]);
    await runRoutesCli([
      "add",
      "--channel",
      "telegram",
      "topic:-1001:4",
      "--bot",
      "default",
      "--policy",
      "open",
    ]);
    await runRoutesCli([
      "add-allow-user",
      "--channel",
      "telegram",
      "group:*",
      "--bot",
      "default",
      "--user",
      "100",
    ]);
    await runRoutesCli([
      "add-allow-user",
      "--channel",
      "telegram",
      "group:-1001",
      "--bot",
      "default",
      "--user",
      "200",
    ]);
    await runRoutesCli([
      "add-block-user",
      "--channel",
      "telegram",
      "topic:-1001:4",
      "--bot",
      "default",
      "--user",
      "300",
    ]);

    const loadedConfig = await loadConfigWithoutEnvResolution(process.env.CLISBOT_CONFIG_PATH!);
    const resolvedRoute = resolveTelegramConversationRoute({
      loadedConfig,
      chatType: "supergroup",
      chatId: -1001,
      topicId: 4,
      isForum: true,
      botId: "default",
    });

    expect(resolvedRoute.route?.allowUsers).toEqual(["100", "200"]);
    expect(resolvedRoute.route?.blockUsers).toEqual(["300"]);
    expect(resolvedRoute.status).toBe("admitted");
  });
});
