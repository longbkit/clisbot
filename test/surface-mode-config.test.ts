import { describe, expect, test } from "bun:test";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import {
  buildConfiguredTargetFromIdentity,
  resolveConfiguredSurfaceModeTarget,
  type ConfiguredSurfaceModeTarget,
} from "../src/channels/config/surface-mode-config.ts";
import type { ClisbotConfig } from "../src/config/core/schema.ts";

function createConfig(): ClisbotConfig {
  return JSON.parse(renderDefaultConfigTemplate()) as ClisbotConfig;
}

function createTelegramTopicTarget(chatId: string, topicId: string): ConfiguredSurfaceModeTarget {
  return {
    channel: "telegram",
    target: `topic:${chatId}:${topicId}`,
  };
}

describe("resolveConfiguredSurfaceModeTarget", () => {
  test("exact DM mode targets inherit from wildcard admission and store under raw ids", () => {
    const config = createConfig();
    config.bots.slack.default.directMessages["*"] = {
      enabled: false,
      requireMention: false,
      policy: "allowlist",
      allowUsers: ["U123"],
      blockUsers: ["U999"],
      allowBots: false,
      streaming: "latest",
    };

    const target: ConfiguredSurfaceModeTarget = {
      channel: "slack",
      botId: "default",
      target: "dm:U123",
    };
    const binding = resolveConfiguredSurfaceModeTarget(config, "streaming", target);

    expect(binding.get()).toBe("latest");
    binding.set("off");

    expect(config.bots.slack.default.directMessages["U123"]?.streaming).toBe("off");
    expect(config.bots.slack.default.directMessages["U123"]?.policy).toBe("allowlist");
    expect(config.bots.slack.default.directMessages["U123"]?.enabled).toBe(false);
  });

  test("telegram topic inherits group mode values without requiring an explicit topic override", () => {
    const config = createConfig();
    config.bots.telegram.default.groups["-1001"] = {
      enabled: true,
      requireMention: true,
      allowBots: false,
      allowUsers: [],
      blockUsers: [],
      streaming: "latest",
      responseMode: "message-tool",
      additionalMessageMode: "queue",
      topics: {},
    };

    const target = createTelegramTopicTarget("-1001", "4");

    expect(resolveConfiguredSurfaceModeTarget(config, "streaming", target).get()).toBe("latest");
    expect(resolveConfiguredSurfaceModeTarget(config, "responseMode", target).get()).toBe(
      "message-tool",
    );
    expect(
      resolveConfiguredSurfaceModeTarget(config, "additionalMessageMode", target).get(),
    ).toBe("queue");
  });

  test("telegram topic writes create a topic override even when the topic previously only inherited", () => {
    const config = createConfig();
    config.bots.telegram.default.groups["-1001"] = {
      enabled: true,
      requireMention: false,
      allowBots: true,
      allowUsers: [],
      blockUsers: [],
      streaming: "latest",
      topics: {},
    };

    const target = createTelegramTopicTarget("-1001", "4");
    resolveConfiguredSurfaceModeTarget(config, "streaming", target).set("off");
    resolveConfiguredSurfaceModeTarget(config, "responseMode", target).set("capture-pane");
    resolveConfiguredSurfaceModeTarget(config, "additionalMessageMode", target).set("steer");

    expect(config.bots.telegram.default.groups["-1001"]?.topics?.["4"]?.streaming).toBe("off");
    expect(config.bots.telegram.default.groups["-1001"]?.topics?.["4"]?.responseMode).toBe(
      "capture-pane",
    );
    expect(config.bots.telegram.default.groups["-1001"]?.topics?.["4"]?.requireMention).toBe(false);
    expect(config.bots.telegram.default.groups["-1001"]?.topics?.["4"]?.allowBots).toBe(true);
    expect(
      config.bots.telegram.default.groups["-1001"]?.topics?.["4"]?.additionalMessageMode,
    ).toBe("steer");
  });

  test("zalo-bot targets resolve dm and group mode overrides without falling back to telegram", () => {
    const config = createConfig();
    config.bots.zaloBot.default.directMessages["*"] = {
      enabled: true,
      policy: "allowlist",
      allowUsers: [],
      blockUsers: [],
      streaming: "latest",
    };
    config.bots.zaloBot.default.groups.g123 = {
      enabled: true,
      requireMention: false,
      allowBots: true,
      allowUsers: [],
      blockUsers: [],
      responseMode: "message-tool",
    };

    expect(resolveConfiguredSurfaceModeTarget(config, "streaming", {
      channel: "zalo-bot",
      botId: "default",
      target: "dm:user-123",
    }).get()).toBe("latest");

    resolveConfiguredSurfaceModeTarget(config, "streaming", {
      channel: "zalo-bot",
      botId: "default",
      target: "dm:user-123",
    }).set("off");
    resolveConfiguredSurfaceModeTarget(config, "responseMode", {
      channel: "zalo-bot",
      botId: "default",
      target: "group:g123",
    }).set("capture-pane");

    expect(config.bots.zaloBot.default.directMessages["user-123"]?.streaming).toBe("off");
    expect(config.bots.zaloBot.default.groups.g123?.responseMode).toBe("capture-pane");
  });

  test("buildConfiguredTargetFromIdentity keeps zalo-bot surfaces on zalo-bot targets", () => {
    expect(buildConfiguredTargetFromIdentity({
      platform: "zalo-bot",
      botId: "default",
      conversationKind: "dm",
      senderId: "user-123",
      chatId: "user-123",
    })).toEqual({
      channel: "zalo-bot",
      botId: "default",
      target: "dm:user-123",
    });
  });

  test("buildConfiguredTargetFromIdentity can map telegram topics to the parent group target", () => {
    expect(buildConfiguredTargetFromIdentity({
      platform: "telegram",
      botId: "default",
      conversationKind: "topic",
      chatId: "-1001",
      topicId: "4",
    }, {
      scope: "channel",
    })).toEqual({
      channel: "telegram",
      botId: "default",
      target: "group:-1001",
    });
  });
});
