import { describe, expect, test } from "bun:test";
import { SlackSocketService } from "../src/channels/slack/service.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";

function createLoadedConfig() {
  const config = clisbotConfigSchema.parse(JSON.parse(renderDefaultConfigTemplate()));
  config.app.auth.roles.admin.users = ["slack:UADMIN"];
  config.bots.slack.defaults.enabled = true;
  config.bots.slack.default.enabled = true;
  config.bots.slack.default.appToken = "app-token";
  config.bots.slack.default.botToken = "bot-token";
  config.bots.slack.default.directMessages["*"] = {
    enabled: true,
    policy: "open",
    allowUsers: [],
    blockUsers: [],
    requireMention: false,
    allowBots: false,
    agentId: "default",
  };
  const runtimeConfig = {
    ...config,
    session: {
      ...config.app.session,
      dmScope: config.bots.defaults.dmScope,
    },
  };
  return {
    raw: runtimeConfig,
  } as any;
}

describe("SlackSocketService shared audience enforcement", () => {
  test("clears stale assistant statuses for idle Slack thread sessions on startup", async () => {
    const calls: Array<{ channel_id: string; thread_ts: string; status: string }> = [];

    await (SlackSocketService.prototype as any).clearStaleAssistantStatusesOnStart.call({
      agentService: {
        listSessionEntries: async () => [
          {
            sessionKey: "agent:default:slack:channel:c123:thread:1778930330.832089",
            runtime: { state: "idle" },
          },
          {
            sessionKey: "agent:default:slack:channel:c123:thread:1778930330.832089",
            runtime: { state: "idle" },
          },
          {
            sessionKey: "agent:default:slack:channel:c456:thread:1778930331.000000",
            runtime: { state: "running" },
          },
          {
            sessionKey: "agent:default:telegram:group:-1001:topic:4",
            runtime: { state: "idle" },
          },
        ],
      },
      app: {
        client: {
          assistant: {
            threads: {
              setStatus: async (payload: {
                channel_id: string;
                thread_ts: string;
                status: string;
              }) => {
                calls.push(payload);
              },
            },
          },
        },
      },
    });

    expect(calls).toEqual([
      {
        channel_id: "C123",
        thread_ts: "1778930330.832089",
        status: "",
      },
    ]);
  });

  test("drops routed bot-originated messages when allowBots is false", async () => {
    const completed: string[] = [];

    await (SlackSocketService.prototype as any).handleInboundMessage.call(
      {
        shouldDropMismatchedSlackEvent: () => false,
        processedEventsStore: {
          getStatus: async () => null,
          markCompleted: async (eventId: string) => {
            completed.push(eventId);
          },
        },
        loadedConfig: createLoadedConfig(),
        markMessageSeen: () => false,
        botUserId: "U_SELF",
      },
      {
        body: { event_id: "evt-1" },
        event: {
          channel: "C123",
          subtype: "bot_message",
          bot_id: "B_OTHER",
          ts: "111.222",
          text: "hello from another bot",
        },
        conversationKind: "channel",
        route: {
          agentId: "default",
          policy: "open",
          allowBots: false,
        },
        wasMentioned: false,
      },
    );

    expect(completed).toEqual(["evt-1"]);
  });

  test("silently drops unauthorized shared senders before the mention gate", async () => {
    const completed: string[] = [];
    const apiCalls: Array<Record<string, unknown>> = [];

    await (SlackSocketService.prototype as any).handleInboundMessage.call(
      {
        shouldDropMismatchedSlackEvent: () => false,
        processedEventsStore: {
          getStatus: async () => null,
          markCompleted: async (eventId: string) => {
            completed.push(eventId);
          },
        },
        loadedConfig: createLoadedConfig(),
        markMessageSeen: () => false,
        botUserId: "U_SELF",
        botId: "default",
        app: {
          client: {
            chat: {
              postMessage: async (payload: Record<string, unknown>) => {
                apiCalls.push(payload);
                return { ts: "123.456", message: { ts: "123.456" } };
              },
            },
          },
        },
        resolveThreadTs: async () => "111.333",
      },
      {
        body: { event_id: "evt-2" },
        event: {
          channel: "C123",
          user: "U_DENIED",
          ts: "111.333",
          text: "hello",
        },
        conversationKind: "channel",
        route: {
          agentId: "default",
          policy: "allowlist",
          requireMention: true,
          allowBots: false,
          allowUsers: ["U_ALLOWED"],
          blockUsers: [],
        },
        wasMentioned: false,
      },
    );

    expect(completed).toEqual(["evt-2"]);
    expect(apiCalls).toHaveLength(0);
  });

  test("replies with an explicit deny message when unauthorized shared senders mention the bot", async () => {
    const completed: string[] = [];
    const apiCalls: Array<Record<string, unknown>> = [];

    await (SlackSocketService.prototype as any).handleInboundMessage.call(
      {
        shouldDropMismatchedSlackEvent: () => false,
        processedEventsStore: {
          getStatus: async () => null,
          markCompleted: async (eventId: string) => {
            completed.push(eventId);
          },
        },
        loadedConfig: createLoadedConfig(),
        markMessageSeen: () => false,
        botUserId: "U_SELF",
        botId: "default",
        app: {
          client: {
            chat: {
              postMessage: async (payload: Record<string, unknown>) => {
                apiCalls.push(payload);
                return { ts: "123.456", message: { ts: "123.456" } };
              },
            },
          },
        },
        resolveThreadTs: async () => "111.333",
      },
      {
        body: { event_id: "evt-2b" },
        event: {
          channel: "C123",
          user: "U_DENIED",
          ts: "111.333",
          text: "<@U_SELF> hello",
        },
        conversationKind: "channel",
        route: {
          agentId: "default",
          policy: "allowlist",
          requireMention: true,
          allowBots: false,
          allowUsers: ["U_ALLOWED"],
          blockUsers: [],
        },
        wasMentioned: true,
      },
    );

    expect(completed).toEqual(["evt-2b"]);
    expect(apiCalls).toHaveLength(1);
    expect(String(apiCalls[0]?.text ?? "")).toContain("You are not allowed to use this bot in this group.");
  });

  test("drops shared-route senders listed in blockUsers without sending a reply", async () => {
    const completed: string[] = [];
    const apiCalls: Array<Record<string, unknown>> = [];

    await (SlackSocketService.prototype as any).handleInboundMessage.call(
      {
        shouldDropMismatchedSlackEvent: () => false,
        processedEventsStore: {
          getStatus: async () => null,
          markCompleted: async (eventId: string) => {
            completed.push(eventId);
          },
        },
        loadedConfig: createLoadedConfig(),
        markMessageSeen: () => false,
        botUserId: "U_SELF",
      },
      {
        body: { event_id: "evt-3" },
        event: {
          channel: "C123",
          user: "U_BLOCKED",
          ts: "111.444",
          text: "hello",
        },
        conversationKind: "channel",
        route: {
          agentId: "default",
          policy: "open",
          allowBots: false,
          allowUsers: [],
          blockUsers: ["U_BLOCKED"],
        },
        wasMentioned: false,
      },
    );

    expect(completed).toEqual(["evt-3"]);
    expect(apiCalls).toEqual([]);
  });

  test("uses the sender-specific DM route before asking for pairing", async () => {
    const completed: string[] = [];
    const apiCalls: Array<Record<string, unknown>> = [];
    let followUpChecks = 0;
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.slack.default.directMessages["*"] = {
      enabled: true,
      policy: "pairing",
      allowUsers: [],
      blockUsers: [],
      requireMention: false,
      allowBots: false,
      agentId: "default",
    };
    loadedConfig.raw.bots.slack.default.directMessages.U_ALLOWED = {
      enabled: true,
      policy: "allowlist",
      allowUsers: ["U_ALLOWED"],
      blockUsers: [],
      requireMention: true,
      allowBots: false,
      agentId: "default",
    };

    await (SlackSocketService.prototype as any).handleInboundMessage.call(
      {
        shouldDropMismatchedSlackEvent: () => false,
        processedEventsStore: {
          getStatus: async () => null,
          markCompleted: async (eventId: string) => {
            completed.push(eventId);
          },
        },
        loadedConfig,
        markMessageSeen: () => false,
        botUserId: "U_SELF",
        botId: "default",
        botLabel: "clisbot",
        getBotConfig: (SlackSocketService.prototype as any).getBotConfig,
        getDirectMessageConfig: (SlackSocketService.prototype as any).getDirectMessageConfig,
        app: {
          client: {
            chat: {
              postMessage: async (payload: Record<string, unknown>) => {
                apiCalls.push(payload);
                return { ts: "123.456", message: { ts: "123.456" } };
              },
            },
            users: {
              info: async () => ({
                user: {
                  name: "allowed",
                  profile: {
                    real_name: "Allowed User",
                  },
                },
              }),
            },
            conversations: {
              info: async () => ({
                channel: {
                  name: "dm",
                },
              }),
            },
          },
        },
        resolveThreadTs: async () => "111.666",
        agentService: {
          appendRecentConversationMessage: async () => undefined,
          getConversationFollowUpState: async () => {
            followUpChecks += 1;
            return {};
          },
        },
      },
      {
        body: { event_id: "evt-dm-exact" },
        event: {
          channel: "D_ALLOWED",
          channel_type: "im",
          user: "U_ALLOWED",
          ts: "111.666",
          text: "hello",
        },
        conversationKind: "dm",
        route: {
          agentId: "default",
          policy: "allowlist",
          requireMention: true,
          allowBots: false,
          allowUsers: ["U_ALLOWED"],
          blockUsers: [],
          commandPrefixes: {
            slash: ["\\"],
            bash: ["!"],
          },
          followUp: {
            mode: "auto",
            participationTtlMs: 5 * 60 * 1000,
          },
          replyToMode: "thread",
        },
        wasMentioned: false,
      },
    );

    expect(completed).toEqual(["evt-dm-exact"]);
    expect(apiCalls).toEqual([]);
    expect(followUpChecks).toBe(1);
  });

  test("enriches accepted prompts with Slack sender and channel display names", async () => {
    let capturedPrompt = "";

    await (SlackSocketService.prototype as any).handleInboundMessage.call(
      {
        shouldDropMismatchedSlackEvent: () => false,
        processedEventsStore: {
          getStatus: async () => null,
          markProcessing: async () => undefined,
          markCompleted: async () => undefined,
          clear: async () => undefined,
        },
        loadedConfig: createLoadedConfig(),
        markMessageSeen: () => false,
        botUserId: "U_SELF",
        botId: "default",
        botLabel: "clisbot",
        botCredentials: {
          botToken: "bot-token",
        },
        app: {
          client: {
            chat: {
              postMessage: async () => ({
                ts: "123.456",
                message: { ts: "123.456" },
              }),
            },
            users: {
              info: async () => ({
                user: {
                  name: "alice",
                  profile: {
                    real_name: "Alice Smith",
                  },
                },
              }),
            },
            conversations: {
              info: async () => ({
                channel: {
                  name: "release-ops",
                },
              }),
              history: async () => ({
                messages: [],
              }),
            },
          },
        },
        resolveThreadTs: async () => "111.555",
        getBotConfig: () => ({
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
          ackReaction: "",
          typingReaction: "",
          processingStatus: {
            enabled: false,
            status: "Working...",
            loadingMessages: [],
          },
        }),
        getSlackMaxChars: () => 4000,
        processingIndicators: {
          acquire: async () => ({
            setLifecycle: async () => undefined,
            release: async () => undefined,
          }),
        },
        activityStore: {
          record: async () => undefined,
        },
        agentService: {
          appendRecentConversationMessage: async () => undefined,
          getConversationFollowUpState: async () => ({}),
          getWorkspacePath: () => "/tmp",
          getRecentConversationReplayMessages: async () => [],
          getSessionDiagnostics: async () => ({}),
          isAwaitingFollowUpRouting: async () => false,
          canSteerActiveRun: async () => true,
          getSessionRuntime: async () => ({}),
          enqueuePrompt: (_target: unknown, prompt: string | (() => string)) => {
            capturedPrompt = typeof prompt === "function" ? prompt() : prompt;
            return {
              positionAhead: 0,
              result: Promise.resolve({
                status: "completed",
                snapshot: "",
              }),
            };
          },
          markRecentConversationProcessed: async () => undefined,
          recordConversationReply: async () => undefined,
          resolveEffectiveTimezone: () => ({
            timezone: "UTC",
          }),
        },
      },
      {
        body: { event_id: "evt-4" },
        event: {
          channel: "C123",
          user: "U123",
          ts: "111.555",
          text: "hello",
        },
        conversationKind: "channel",
        route: {
          agentId: "default",
          policy: "open",
          requireMention: false,
          allowBots: false,
          allowUsers: [],
          blockUsers: [],
          commandPrefixes: {
            slash: ["\\"],
            bash: ["!"],
          },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          surfaceNotifications: {
            queueStart: "none",
            loopStart: "none",
          },
          verbose: "off",
          followUp: {
            mode: "auto",
            participationTtlMs: 5 * 60 * 1000,
          },
        },
        wasMentioned: false,
      },
    );

    expect(capturedPrompt).toContain("- sender: Alice Smith [slack:U123, @alice]");
    expect(capturedPrompt).toContain(
      '- surface: Slack channel "release-ops", thread 111.555 [slack:channel:C123:thread:111.555]',
    );
  });
});
