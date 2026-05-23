import { describe, expect, test } from "bun:test";
import { resolveLoopCliContext } from "../../src/control/commands/loop-cli-context.ts";
import { resolveZaloPersonalControlSurfaceContext } from "../../src/channels/zalo-personal/control-surface.ts";
import type { LoadedConfig } from "../../src/config/core/load-config.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";

function createLoadedConfig(): LoadedConfig {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.bots.defaults.dmScope = "per-channel-peer";
  config.bots.zaloPersonal.defaults.enabled = true;
  config.bots.zaloPersonal.defaults.groupPolicy = "allowlist";
  config.bots.zaloPersonal.default = {
    ...config.bots.zaloPersonal.default,
    enabled: true,
    agentId: "zalo-agent",
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
      },
    },
  };
  config.agents.list = [{ id: "default" }, { id: "zalo-agent" }];

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

describe("Zalo Personal control surface", () => {
  test("resolves DM targets for queue and loop addressing", () => {
    const context = resolveLoopCliContext({
      loadedConfig: createLoadedConfig(),
      channel: "zalo-personal",
      target: "dm:user-123",
      botId: "default",
    });

    expect(context.channel).toBe("zalo-personal");
    expect(context.botId).toBe("default");
    expect(context.identity).toMatchObject({
      platform: "zalo-personal",
      conversationKind: "dm",
      chatId: "user-123",
      senderId: "user-123",
    });
    expect(context.sessionTarget).toMatchObject({
      agentId: "zalo-agent",
      sessionKey: "agent:zalo-agent:zalo-personal:dm:user-123",
    });
  });

  test("requires configured group admission before queue and loop addressing", () => {
    expect(() =>
      resolveZaloPersonalControlSurfaceContext({
        loadedConfig: createLoadedConfig(),
        target: "group:missing-group",
        botId: "default",
      }),
    ).toThrow("Route not configured or not admitted");
  });
});
