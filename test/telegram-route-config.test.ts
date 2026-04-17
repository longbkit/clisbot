import { describe, expect, test } from "bun:test";
import { resolveTelegramConversationRoute } from "../src/channels/telegram/route-config.ts";
import { resolveTelegramConversationTarget } from "../src/channels/telegram/session-routing.ts";
import type { LoadedConfig } from "../src/config/load-config.ts";

function createLoadedConfig(): LoadedConfig {
  return {
    configPath: "/tmp/clisbot.json",
    processedEventsPath: "/tmp/processed.json",
    stateDir: "/tmp",
    raw: {
      meta: {
        schemaVersion: 1,
      },
      tmux: {
        socketPath: "~/.clisbot/state/clisbot.sock",
      },
      session: {
        mainKey: "main",
        dmScope: "per-channel-peer",
        identityLinks: {},
        storePath: "/tmp/sessions.json",
      },
      app: {
        auth: {
          ownerClaimWindowMinutes: 30,
          defaultRole: "member",
          roles: {
            owner: { allow: ["configManage"], users: [] },
            admin: { allow: ["configManage"], users: [] },
            member: { allow: [], users: [] },
          },
        },
      },
      agents: {
        defaults: {
          workspace: "~/.clisbot/workspaces/{agentId}",
          auth: {
            defaultRole: "member",
            roles: {
              admin: { allow: ["shellExecute"], users: [] },
              member: { allow: ["sendMessage"], users: [] },
            },
          },
          runner: {
            command: "codex",
            args: ["-C", "{workspace}"],
            trustWorkspace: true,
            startupDelayMs: 1,
            startupRetryCount: 2,
            startupRetryDelayMs: 0,
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
        list: [{ id: "default" }, { id: "claude" }],
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
        loop: {
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        },
        runtimeMonitor: {
          restartBackoff: {
            fastRetry: { delaySeconds: 10, maxRestarts: 3 },
            stages: [
              { delayMinutes: 15, maxRestarts: 4 },
              { delayMinutes: 30, maxRestarts: 4 },
            ],
          },
          ownerAlerts: { enabled: true, minIntervalMinutes: 30 },
        },
      },
      channels: {
        slack: {
          enabled: false,
          mode: "socket",
          appToken: "app-token",
          botToken: "bot-token",
          defaultAccount: "default",
          accounts: {
            default: {
              appToken: "app-token",
              botToken: "bot-token",
            },
          },
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
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
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "all",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          verbose: "minimal",
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
          enabled: true,
          mode: "polling",
          botToken: "telegram-token",
          defaultAccount: "default",
          accounts: {
            default: {
              botToken: "telegram-token",
            },
          },
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
          allowBots: false,
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "all",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          verbose: "minimal",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
          timezone: "UTC",
          polling: {
            timeoutSeconds: 20,
            retryDelayMs: 1000,
          },
          groups: {
            "-1001": {
              requireMention: true,
              allowBots: false,
              agentId: "default",
              topics: {
                "4": {
                  requireMention: false,
                  agentId: "claude",
                  verbose: "off",
                  timezone: "Asia/Ho_Chi_Minh",
                },
              },
            },
          },
          directMessages: {
            enabled: true,
            policy: "open",
            allowFrom: [],
            requireMention: false,
            allowBots: false,
            agentId: "default",
          },
        },
      },
    },
  };
}

describe("Telegram route resolution", () => {
  test("resolves forum topic overrides from parent group config", () => {
    const resolved = resolveTelegramConversationRoute({
      loadedConfig: createLoadedConfig(),
      chatType: "supergroup",
      chatId: -1001,
      topicId: 4,
      isForum: true,
    });

    expect(resolved.conversationKind).toBe("topic");
    expect(resolved.route?.agentId).toBe("claude");
    expect(resolved.route?.requireMention).toBe(false);
    expect(resolved.route?.verbose).toBe("off");
    expect(resolved.route?.timezone).toBe("Asia/Ho_Chi_Minh");
    expect("privilegeCommands" in (resolved.route ?? {})).toBe(false);
  });

  test("uses agent additionalMessageMode when the route does not override it", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.channels.telegram.groupPolicy = "open";
    loadedConfig.raw.agents.list = [
      {
        id: "default",
        additionalMessageMode: "queue",
      },
    ];

    const resolved = resolveTelegramConversationRoute({
      loadedConfig,
      chatType: "supergroup",
      chatId: -2001,
      isForum: false,
    });

    expect(resolved.route?.additionalMessageMode).toBe("queue");
  });

  test("inherits telegram route verbose from channel defaults", () => {
    const resolved = resolveTelegramConversationRoute({
      loadedConfig: createLoadedConfig(),
      chatType: "private",
      chatId: 123,
    });

    expect(resolved.route?.verbose).toBe("minimal");
  });

  test("isolates forum topics by topic id", () => {
    const target = resolveTelegramConversationTarget({
      loadedConfig: createLoadedConfig(),
      agentId: "claude",
      chatId: -1001,
      userId: 123,
      conversationKind: "topic",
      topicId: 4,
    });

    expect(target.sessionKey).toBe("agent:claude:telegram:group:-1001:topic:4");
  });

  test("isolates direct messages by peer by default", () => {
    const target = resolveTelegramConversationTarget({
      loadedConfig: createLoadedConfig(),
      agentId: "default",
      chatId: 12345,
      userId: 12345,
      conversationKind: "dm",
    });

    expect(target.sessionKey).toBe("agent:default:telegram:dm:12345");
  });

  test("does not expose route-local privilege commands anymore", () => {
    const resolved = resolveTelegramConversationRoute({
      loadedConfig: createLoadedConfig(),
      chatType: "private",
      chatId: 12345,
      isForum: false,
    });

    expect("privilegeCommands" in (resolved.route ?? {})).toBe(false);
  });

  test("uses top-level telegram binding when route agent is not overridden", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.channels.telegram.directMessages.agentId = undefined;
    loadedConfig.raw.bindings = [
      {
        match: {
          channel: "telegram",
        },
        agentId: "bound-agent",
      },
    ];

    const resolved = resolveTelegramConversationRoute({
      loadedConfig,
      chatType: "private",
      chatId: 12345,
      isForum: false,
    });

    expect(resolved.route?.agentId).toBe("bound-agent");
  });

  test("uses account-specific telegram binding when the bound account id is provided", () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.channels.telegram.directMessages.agentId = undefined;
    loadedConfig.raw.bindings = [
      {
        match: {
          channel: "telegram",
          accountId: "ops",
        },
        agentId: "ops-agent",
      },
    ];

    const resolved = resolveTelegramConversationRoute({
      loadedConfig,
      chatType: "private",
      chatId: 12345,
      isForum: false,
      accountId: "ops",
    });

    expect(resolved.route?.agentId).toBe("ops-agent");
  });
});
