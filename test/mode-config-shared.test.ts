import { describe, expect, test } from "bun:test";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import {
  resolveConfiguredSurfaceModeTarget,
  type ConfiguredSurfaceModeTarget,
} from "../src/channels/mode-config-shared.ts";
import type { ClisbotConfig } from "../src/config/schema.ts";

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
  test("exact DM mode targets inherit from dm:* and materialize behavior-only overrides on write", () => {
    const config = createConfig();
    config.bots.slack.default.directMessages["dm:*"] = {
      enabled: true,
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

    expect(config.bots.slack.default.directMessages["dm:U123"]?.streaming).toBe("off");
    expect(config.bots.slack.default.directMessages["dm:U123"]?.policy).toBeUndefined();
    expect(config.bots.slack.default.directMessages["dm:U123"]?.allowUsers).toEqual([]);
    expect(config.bots.slack.default.directMessages["dm:U123"]?.blockUsers).toEqual([]);
  });

  test("telegram topic inherits group mode values without requiring an explicit topic override", () => {
    const config = createConfig();
    config.bots.telegram.default.groups["-1001"] = {
      ...config.bots.telegram.default.groups["-1001"],
      requireMention: true,
      allowBots: false,
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
      ...config.bots.telegram.default.groups["-1001"],
      requireMention: true,
      allowBots: false,
      streaming: "latest",
      topics: {},
    };

    const target = createTelegramTopicTarget("-1001", "4");
    resolveConfiguredSurfaceModeTarget(config, "streaming", target).set("off");
    resolveConfiguredSurfaceModeTarget(config, "responseMode", target).set("capture-pane");
    resolveConfiguredSurfaceModeTarget(config, "additionalMessageMode", target).set("steer");

    expect(config.bots.telegram.default.groups["-1001"]?.topics["4"]?.streaming).toBe("off");
    expect(config.bots.telegram.default.groups["-1001"]?.topics["4"]?.responseMode).toBe(
      "capture-pane",
    );
    expect(
      config.bots.telegram.default.groups["-1001"]?.topics["4"]?.additionalMessageMode,
    ).toBe(
      "steer",
    );
  });

  test("telegram open-group topic can read from channel defaults and materialize a topic override on write", () => {
    const config = createConfig();
    config.bots.telegram.defaults.groupPolicy = "open";
    config.bots.telegram.default.streaming = "all";

    const target = createTelegramTopicTarget("-1009", "7");
    const binding = resolveConfiguredSurfaceModeTarget(config, "streaming", target);

    expect(binding.get()).toBe("all");
    binding.set("off");

    expect(config.bots.telegram.default.groups["-1009"]?.topics["7"]?.streaming).toBe("off");
  });
});
