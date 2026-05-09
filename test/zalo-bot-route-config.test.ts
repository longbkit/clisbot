import { describe, expect, test } from "bun:test";
import { resolveZaloBotConversationRoute } from "../src/channels/zalo-bot/route-config.ts";
import { resolveZaloBotConversationTarget } from "../src/channels/zalo-bot/session-routing.ts";
import type { LoadedConfig } from "../src/config/load-config.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

function createLoadedConfig(): LoadedConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: false,
        telegramEnabled: false,
        zaloBotEnabled: true,
      }),
    ),
  );
  config.bots.defaults.dmScope = "per-channel-peer";
  config.bots.zaloBot.defaults.allowBots = false;
  config.bots.zaloBot.defaults.streaming = "all";
  config.bots.zaloBot.defaults.response = "final";
  config.bots.zaloBot.defaults.responseMode = "message-tool";
  config.bots.zaloBot.defaults.additionalMessageMode = "steer";
  config.bots.zaloBot.defaults.verbose = "minimal";
  config.bots.zaloBot.defaults.followUp = {
    mode: "auto",
    participationTtlMin: 5,
  };
  config.bots.zaloBot.defaults.timezone = "UTC";
  config.bots.zaloBot.default = {
    ...config.bots.zaloBot.default,
    enabled: true,
    botToken: "zalo-bot-token",
    groups: {
      "*": {
        enabled: false,
        requireMention: true,
        allowBots: false,
        allowUsers: ["100"],
        blockUsers: ["200"],
      },
      "group-1": {
        enabled: true,
        policy: "open",
        requireMention: true,
        allowBots: false,
        agentId: "claude",
        allowUsers: ["500"],
        blockUsers: ["600"],
        verbose: "off",
        timezone: "Asia/Ho_Chi_Minh",
      },
    },
    directMessages: {
      "*": {
        enabled: true,
        policy: "open",
        allowUsers: [],
        blockUsers: [],
        requireMention: false,
        allowBots: false,
        agentId: "default",
      },
    },
  };
  config.agents.list = [{ id: "default" }, { id: "claude" }, { id: "bound-agent" }];

  return {
    configPath: "/tmp/clisbot.json",
    processedEventsPath: "/tmp/processed.json",
    stateDir: "/tmp",
    raw: {
      ...config,
      session: {
        ...config.app.session,
        dmScope: config.bots.defaults.dmScope,
      },
      control: config.app.control,
      tmux: config.agents.defaults.runner.defaults.tmux,
    },
  };
}

describe("Zalo Bot route resolution", () => {
  test("resolves exact group overrides from parent config", () => {
    const resolved = resolveZaloBotConversationRoute({
      loadedConfig: createLoadedConfig(),
      chatType: "GROUP",
      chatId: "group-1",
      senderId: "user-1",
    });

    expect(resolved.conversationKind).toBe("group");
    expect(resolved.status).toBe("admitted");
    expect(resolved.route?.agentId).toBe("claude");
    expect(resolved.route?.requireMention).toBe(true);
    expect(resolved.route?.verbose).toBe("off");
    expect(resolved.route?.timezone).toBe("Asia/Ho_Chi_Minh");
  });

  test("merges wildcard group audience into exact Zalo Bot group routes", () => {
    const resolved = resolveZaloBotConversationRoute({
      loadedConfig: createLoadedConfig(),
      chatType: "GROUP",
      chatId: "group-1",
      senderId: "user-1",
    });

    expect(resolved.route?.allowUsers).toEqual(["100", "500"]);
    expect(resolved.route?.blockUsers).toEqual(["200", "600"]);
  });

  test("requires an exact shared route when group admission is allowlist", () => {
    const loadedConfig = createLoadedConfig();
    delete loadedConfig.raw.bots.zaloBot.default.groups["group-1"];

    const resolved = resolveZaloBotConversationRoute({
      loadedConfig,
      chatType: "GROUP",
      chatId: "group-2",
      senderId: "user-1",
    });

    expect(resolved.status).toBe("missing");
    expect(resolved.route).toBeNull();
  });

  test("isolates direct messages by peer by default", () => {
    const target = resolveZaloBotConversationTarget({
      loadedConfig: createLoadedConfig(),
      agentId: "default",
      chatId: "user-12345",
      userId: "user-12345",
      conversationKind: "dm",
    });

    expect(target.sessionKey).toBe("agent:default:zalo-bot:dm:user-12345");
  });

  test("uses bot fallback agent when DM route agent is not overridden", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.zaloBot.default.directMessages["*"]!.agentId = undefined;
    loadedConfig.raw.bots.zaloBot.default.agentId = "bound-agent";

    const resolved = resolveZaloBotConversationRoute({
      loadedConfig,
      chatType: "PRIVATE",
      chatId: "user-12345",
      senderId: "user-12345",
    });

    expect(resolved.route?.agentId).toBe("bound-agent");
  });
});
