import { describe, expect, test } from "bun:test";
import { resolveZaloPersonalConversationRoute } from "../../src/channels/zalo-personal/route-config.ts";
import { resolveZaloPersonalConversationTarget } from "../../src/channels/zalo-personal/session-routing.ts";
import type { LoadedConfig } from "../../src/config/core/load-config.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";

function createLoadedConfig(): LoadedConfig {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.bots.defaults.dmScope = "per-channel-peer";
  config.bots.zaloPersonal.defaults.enabled = true;
  config.bots.zaloPersonal.defaults.groupPolicy = "allowlist";
  config.bots.zaloPersonal.defaults.followUp.mode = "mention-only";
  config.bots.zaloPersonal.default = {
    ...config.bots.zaloPersonal.default,
    enabled: true,
    agentId: "bound-agent",
    groupPolicy: "allowlist",
    directMessages: {
      "*": {
        enabled: true,
        policy: "pairing",
        requireMention: false,
        allowUsers: [],
        blockUsers: [],
        allowBots: false,
      },
    },
    groups: {
      "group-1": {
        enabled: true,
        policy: "allowlist",
        requireMention: true,
        allowUsers: ["user-1"],
        blockUsers: [],
        allowBots: false,
        agentId: "group-agent",
      },
    },
  };
  config.agents.list = [{ id: "default" }, { id: "bound-agent" }, { id: "group-agent" }];

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

describe("Zalo Personal route resolution", () => {
  test("does not admit every direct message from template defaults", () => {
    const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
    config.bots.zaloPersonal.defaults.enabled = true;
    config.bots.zaloPersonal.default.enabled = true;
    const loadedConfig: LoadedConfig = {
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

    const resolved = resolveZaloPersonalConversationRoute({
      loadedConfig,
      conversationKind: "dm",
      chatId: "friend-1",
      senderId: "friend-1",
    });

    expect(resolved.route).toBeNull();
    expect(resolved.status).toBe("disabled");
  });

  test("requires an exact group route when group admission is allowlist", () => {
    const resolved = resolveZaloPersonalConversationRoute({
      loadedConfig: createLoadedConfig(),
      conversationKind: "group",
      chatId: "unconfigured-group",
      senderId: "user-1",
    });

    expect(resolved.status).toBe("missing");
    expect(resolved.route).toBeNull();
  });

  test("uses group wildcard only as sender policy fallback after exact admission", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.zaloPersonal.defaults.groups["*"]!.policy = "open";

    const resolved = resolveZaloPersonalConversationRoute({
      loadedConfig,
      conversationKind: "group",
      chatId: "group-1",
      senderId: "user-1",
    });

    expect(resolved.status).toBe("admitted");
    expect(resolved.route?.policy).toBe("allowlist");
    expect(resolved.route?.requireMention).toBe(true);
    expect(resolved.route?.agentId).toBe("group-agent");
  });

  test("uses bot fallback agent when DM route agent is not overridden", () => {
    const resolved = resolveZaloPersonalConversationRoute({
      loadedConfig: createLoadedConfig(),
      conversationKind: "dm",
      chatId: "user-123",
      senderId: "user-123",
    });

    expect(resolved.route?.agentId).toBe("bound-agent");
  });

  test("isolates direct messages by peer by default", () => {
    const target = resolveZaloPersonalConversationTarget({
      loadedConfig: createLoadedConfig(),
      agentId: "bound-agent",
      botId: "default",
      chatId: "user-123",
      userId: "user-123",
      conversationKind: "dm",
    });

    expect(target.sessionKey).toBe("agent:bound-agent:zalo-personal:dm:user-123");
  });
});
