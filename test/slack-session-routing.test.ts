import { describe, expect, test } from "bun:test";
import { resolveSlackConversationRoute } from "../src/channels/slack/route-config.ts";
import { resolveSlackConversationTarget } from "../src/channels/slack/session-routing.ts";
import type { LoadedConfig } from "../src/config/load-config.ts";

function createLoadedConfig(): LoadedConfig {
  return {
    configPath: "/tmp/muxbot.json",
    processedEventsPath: "/tmp/processed.json",
    stateDir: "/tmp",
    raw: {
      meta: {
        schemaVersion: 1,
      },
      tmux: {
        socketPath: "~/.muxbot/state/muxbot.sock",
      },
      session: {
        mainKey: "main",
        dmScope: "main",
        identityLinks: {},
        storePath: "/tmp/sessions.json",
      },
      agents: {
        defaults: {
          workspace: "~/.muxbot/workspaces/{agentId}",
          runner: {
            command: "codex",
            args: ["-C", "{workspace}"],
            trustWorkspace: true,
            startupDelayMs: 1,
            promptSubmitDelayMs: 1,
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "off",
                statusCommand: "/status",
                pattern:
                  "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
                timeoutMs: 1000,
                pollIntervalMs: 100,
              },
              resume: {
                mode: "off",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          },
          stream: {
            captureLines: 10,
            updateIntervalMs: 10,
            idleTimeoutMs: 10,
            noOutputTimeoutMs: 10,
            maxRuntimeSec: 10,
            maxMessageChars: 100,
          },
          session: {
            createIfMissing: true,
            staleAfterMinutes: 60,
            name: "{sessionKey}",
          },
        },
        list: [{ id: "default" }],
      },
      bindings: [],
      control: {
        configReload: {
          watch: false,
          watchDebounceMs: 250,
        },
        sessionCleanup: {
          enabled: true,
          intervalMinutes: 5,
        },
      },
      channels: {
        slack: {
          enabled: true,
          mode: "socket",
          appToken: "app-token",
          botToken: "bot-token",
          ackReaction: ":heavy_check_mark:",
          typingReaction: "",
          processingStatus: {
            enabled: true,
            status: "Working...",
            loadingMessages: [],
          },
          allowBots: false,
          replyToMode: "thread",
          channelPolicy: "allowlist",
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          privilegeCommands: {
            enabled: false,
            allowUsers: [],
          },
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "all",
          response: "final",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
          channels: {},
          groups: {},
          directMessages: {
            enabled: true,
            policy: "open",
            allowFrom: [],
            requireMention: false,
          },
        },
        telegram: {
          enabled: false,
          mode: "polling",
          botToken: "telegram-token",
          allowBots: false,
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          privilegeCommands: {
            enabled: false,
            allowUsers: [],
          },
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "all",
          response: "final",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
          polling: {
            timeoutSeconds: 20,
            retryDelayMs: 1000,
          },
          groups: {},
          directMessages: {
            enabled: true,
            policy: "open",
            allowFrom: [],
            requireMention: false,
            allowBots: false,
          },
        },
      },
    },
  };
}

describe("Slack conversation target routing", () => {
  test("collapses direct messages to the main session by default", () => {
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

    expect(target.sessionKey).toBe("agent:default:main");
    expect(target.mainSessionKey).toBe("agent:default:main");
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

  test("supports OpenClaw-style per-channel-peer dm scoping", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.session.dmScope = "per-channel-peer";

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

    expect(target.sessionKey).toBe("agent:default:slack:dm:u123");
  });

  test("isolates Slack multi-person direct groups as group sessions", () => {
    const target = resolveSlackConversationTarget({
      loadedConfig: createLoadedConfig(),
      agentId: "default",
      channelId: "G123",
      userId: "U123",
      messageTs: "1775291908.430139",
      threadTs: "1775291908.430139",
      conversationKind: "group",
      replyToMode: "thread",
    });

    expect(target.sessionKey).toBe("agent:default:slack:group:g123");
    expect(target.parentSessionKey).toBeUndefined();
  });

  test("inherits privilege command defaults and route overrides", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.channels.slack.channels.C123 = {
      requireMention: true,
      allowBots: false,
      privilegeCommands: {
        enabled: true,
        allowUsers: ["u123"],
      },
    };

    const channelRoute = resolveSlackConversationRoute(loadedConfig, {
      channel_type: "channel",
      channel: "C123",
    });
    const dmRoute = resolveSlackConversationRoute(loadedConfig, {
      channel_type: "im",
      channel: "D123",
    });

    expect(channelRoute.route?.privilegeCommands).toEqual({
      enabled: true,
      allowUsers: ["U123"],
    });
    expect(dmRoute.route?.privilegeCommands).toEqual({
      enabled: false,
      allowUsers: [],
    });
  });

  test("uses top-level slack binding when route agent is not overridden", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.channels.slack.channelPolicy = "open";
    loadedConfig.raw.bindings = [
      {
        match: {
          channel: "slack",
        },
        agentId: "bound-agent",
      },
    ];

    const channelRoute = resolveSlackConversationRoute(loadedConfig, {
      channel_type: "channel",
      channel: "C123",
    });

    expect(channelRoute.route?.agentId).toBe("bound-agent");
  });

  test("uses account-specific slack binding when the bound account id is provided", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.channels.slack.channelPolicy = "open";
    loadedConfig.raw.bindings = [
      {
        match: {
          channel: "slack",
          accountId: "ops",
        },
        agentId: "ops-agent",
      },
    ];

    const channelRoute = resolveSlackConversationRoute(
      loadedConfig,
      {
        channel_type: "channel",
        channel: "C123",
      },
      {
        accountId: "ops",
      },
    );

    expect(channelRoute.route?.agentId).toBe("ops-agent");
  });
});
