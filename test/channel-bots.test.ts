import { describe, expect, test } from "bun:test";
import {
  getChannelBotRecords,
  getChannelManagedProviderDefaults,
  listChannelManagedProviderDefaults,
} from "../src/config/channels/channel-bot-contract.ts";
import {
  listSlackBots,
  resolveSlackBotConfig,
  resolveSlackBotCredentials,
  resolveSlackDirectMessageConfig,
} from "../src/channels/slack/config.ts";
import {
  resolveTelegramBotCredentials,
} from "../src/channels/telegram/config.ts";
import { normalizeConfigDirectMessageRoutes } from "../src/config/channels/direct-message-routes.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";

function createConfig(): ClisbotConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        channels: {
          slack: { enabled: true },
          telegram: { enabled: true },
        },
      }),
    ),
  );
  config.bots.slack.defaults.defaultBotId = "work";
  config.bots.slack.work = {
    ...config.bots.slack.default,
    appToken: "work-app",
    botToken: "work-bot",
  };
  delete config.bots.slack.default;
  config.bots.telegram.defaults.defaultBotId = "alerts";
  config.bots.telegram.alerts = {
    ...config.bots.telegram.default,
    botToken: "alerts-token",
  };
  delete config.bots.telegram.default;
  return config;
}

describe("channel bots", () => {
  test("resolves explicit slack bot credentials", () => {
    const config = createConfig();
    const resolved = resolveSlackBotCredentials(config.bots.slack, "work");
    expect(resolved.botId).toBe("work");
    expect(resolved.config.botToken).toBe("work-bot");
  });

  test("falls back to root slack tokens when no bot map is configured", () => {
    const config = createConfig();
    config.bots.slack.default = {
      ...config.bots.slack.work,
      appToken: "root-app",
      botToken: "root-bot",
    };
    delete config.bots.slack.work;
    config.bots.slack.defaults.defaultBotId = "default";
    const resolved = resolveSlackBotCredentials(config.bots.slack);
    expect(resolved.botId).toBe("default");
    expect(resolved.config.botToken).toBe("root-bot");
  });

  test("resolves telegram default bot credentials", () => {
    const config = createConfig();
    const resolved = resolveTelegramBotCredentials(config.bots.telegram);
    expect(resolved.botId).toBe("alerts");
    expect(resolved.config.botToken).toBe("alerts-token");
  });

  test("lists only valid slack bots", () => {
    const config = createConfig();
    config.bots.slack.empty = { ...config.bots.slack.work, appToken: "", botToken: "" };
    expect(listSlackBots(config.bots.slack).map((entry) => entry.botId)).toEqual([
      "work",
    ]);
  });

  test("reads channel bot records and defaults through the static installation inventory", () => {
    const config = createConfig();
    config.bots.zaloBot.defaults.defaultBotId = "ops";
    config.bots.zaloBot.ops = {
      ...config.bots.zaloBot.default,
      botToken: "ops-token",
    };
    delete config.bots.zaloBot.default;

    expect(Object.keys(getChannelBotRecords(config, "slack"))).toEqual(["work"]);
    expect(Object.keys(getChannelBotRecords(config, "telegram"))).toEqual(["alerts"]);
    expect(Object.keys(getChannelBotRecords(config, "zalo-bot"))).toEqual(["ops"]);

    expect(getChannelManagedProviderDefaults(config, "slack").defaultBotId).toBe("work");
    expect(getChannelManagedProviderDefaults(config, "telegram").defaultBotId).toBe("alerts");
    expect(getChannelManagedProviderDefaults(config, "zalo-bot").defaultBotId).toBe("ops");

    expect(listChannelManagedProviderDefaults(config)).toEqual([
      { channel: "slack", defaults: config.bots.slack.defaults },
      { channel: "telegram", defaults: config.bots.telegram.defaults },
      { channel: "zalo-bot", defaults: config.bots.zaloBot.defaults },
    ]);
  });

  test("allows exact DM routes to carry admission config in the canonical shape", () => {
    const config = createConfig();
    config.bots.slack.work.directMessages = {
      "*": {
        enabled: true,
        policy: "pairing",
        allowUsers: [],
        blockUsers: ["U999"],
        allowBots: false,
        responseMode: "capture-pane",
      },
      U123: {
        enabled: true,
        policy: "allowlist",
        allowUsers: ["U123"],
        blockUsers: ["U555"],
        responseMode: "message-tool",
      },
    };

    const normalized = normalizeConfigDirectMessageRoutes(
      clisbotConfigSchema.parse(config),
    );
    const resolved = resolveSlackDirectMessageConfig(
      resolveSlackBotConfig(normalized.bots.slack, "work"),
      "U123",
    );

    expect(resolved?.policy).toBe("allowlist");
    expect(resolved?.allowUsers).toEqual(["U123"]);
    expect(resolved?.blockUsers).toEqual(["U999", "U555"]);
    expect(resolved?.responseMode).toBe("message-tool");
  });
});
