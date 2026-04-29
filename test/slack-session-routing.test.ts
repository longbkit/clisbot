import { describe, expect, test } from "bun:test";
import { resolveSlackConversationRoute } from "../src/channels/slack/route-config.ts";
import { resolveSlackConversationTarget } from "../src/channels/slack/session-routing.ts";
import { normalizeSlackSurfaceTarget } from "../src/channels/slack/target-normalization.ts";
import type { LoadedConfig } from "../src/config/load-config.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

function createLoadedConfig(): LoadedConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: false,
      }),
    ),
  );
  config.bots.defaults.dmScope = "per-channel-peer";
  config.bots.slack.defaults.allowBots = false;
  config.bots.slack.defaults.streaming = "all";
  config.bots.slack.defaults.response = "final";
  config.bots.slack.defaults.responseMode = "message-tool";
  config.bots.slack.defaults.additionalMessageMode = "steer";
  config.bots.slack.defaults.verbose = "minimal";
  config.bots.slack.defaults.followUp = {
    mode: "auto",
    participationTtlMin: 5,
  };
  config.bots.slack.defaults.timezone = "UTC";
  config.bots.slack.defaults.ackReaction = ":heavy_check_mark:";
  config.bots.slack.defaults.processingStatus = {
    enabled: true,
    status: "Working...",
    loadingMessages: [],
  };
  config.bots.slack.default = {
    ...config.bots.slack.default,
    enabled: true,
    appToken: "app-token",
    botToken: "bot-token",
    directMessages: {
      "*": {
        enabled: true,
        policy: "open",
        allowUsers: [],
        blockUsers: [],
        requireMention: false,
        allowBots: false,
        timezone: "America/Los_Angeles",
      },
    },
    groups: {
      "*": {
        enabled: false,
        requireMention: true,
        allowBots: false,
        allowUsers: ["U_OWNER"],
        blockUsers: ["U_BLOCKED"],
      },
      C123: {
        enabled: true,
        policy: "open",
        requireMention: false,
        allowBots: false,
        allowUsers: ["U_EXTRA"],
        blockUsers: ["U_MUTED"],
        timezone: "Asia/Ho_Chi_Minh",
        verbose: "off",
      },
    },
  };

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

describe("Slack conversation target routing", () => {
  test("isolates direct messages by peer by default", () => {
    const target = resolveSlackConversationTarget({
      loadedConfig: createLoadedConfig(),
      agentId: "default",
      channelId: "D123",
      userId: "U123",
      messageTs: "1775291908.430139",
      threadTs: "1775291908.430139",
      conversationKind: "dm",
      replyToMode: "thread",
    });

    expect(target.sessionKey).toBe("agent:default:slack:dm:u123");
    expect(target.mainSessionKey).toBe("agent:default:main");
  });

  test("resolves shared-route overrides from raw stored ids", () => {
    const resolved = resolveSlackConversationRoute(
      createLoadedConfig(),
      { channel_type: "channel", channel: "C123" },
    );

    expect(resolved.status).toBe("admitted");
    expect(resolved.route?.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(resolved.route?.verbose).toBe("off");
    expect(resolved.route?.requireMention).toBe(false);
    expect(resolved.route?.allowUsers).toEqual(["U_OWNER", "U_EXTRA"]);
    expect(resolved.route?.blockUsers).toEqual(["U_BLOCKED", "U_MUTED"]);
  });

  test("requires an exact shared route when group admission is allowlist", () => {
    const resolved = resolveSlackConversationRoute(
      createLoadedConfig(),
      { channel_type: "channel", channel: "C999" },
    );

    expect(resolved.status).toBe("missing");
    expect(resolved.route).toBeNull();
  });

  test("marks shared surfaces disabled when channel admission is disabled", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.slack.default.channelPolicy = "disabled";
    const resolved = resolveSlackConversationRoute(
      loadedConfig,
      { channel_type: "channel", channel: "C123" },
    );

    expect(resolved.status).toBe("disabled");
    expect(resolved.route).toBeNull();
  });

  test("inherits route verbose from provider defaults in DMs", () => {
    const resolved = resolveSlackConversationRoute(
      createLoadedConfig(),
      { channel_type: "im", channel: "D123", user: "U123" },
    );

    expect(resolved.route?.verbose).toBe("minimal");
  });

  test("isolates Slack channel conversations by root thread id", () => {
    const target = resolveSlackConversationTarget({
      loadedConfig: createLoadedConfig(),
      agentId: "default",
      channelId: "C123",
      userId: "U123",
      messageTs: "1775291908.430139",
      threadTs: "1775291908.430139",
      conversationKind: "channel",
      replyToMode: "thread",
    });

    expect(target.parentSessionKey).toBe("agent:default:slack:channel:c123");
    expect(target.sessionKey).toBe(
      "agent:default:slack:channel:c123:thread:1775291908.430139",
    );
  });

  test("supports explicit main-scope dm collapsing when requested", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.session.dmScope = "main";

    const target = resolveSlackConversationTarget({
      loadedConfig,
      agentId: "default",
      channelId: "D123",
      userId: "U123",
      messageTs: "1775291908.430139",
      threadTs: "1775291908.430139",
      conversationKind: "dm",
      replyToMode: "thread",
    });

    expect(target.sessionKey).toBe("agent:default:main");
  });

  test("rejects malformed slack dm operator targets early", () => {
    expect(() => normalizeSlackSurfaceTarget("dm:")).toThrow("Missing Slack dm target");
    expect(() => normalizeSlackSurfaceTarget("user:")).toThrow("Missing Slack user target");
  });
});
