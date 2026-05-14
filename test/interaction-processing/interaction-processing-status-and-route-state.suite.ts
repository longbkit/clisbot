import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  processChannelInteraction,
  type ChannelInteractionIdentity,
  type ChannelInteractionRoute,
} from "../../src/channels/message/interaction-processing.ts";
import type { AgentSessionTarget } from "../../src/agents/runtime/agent-service.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import { sleep } from "../../src/infra/process.ts";
import {
  createIdentity,
  createRoute,
  createTarget,
  createTelegramTopicIdentity,
  createTelegramTopicTarget,
  registerCliNameIsolation,
  renderCapturedPrompt,
} from "./interaction-processing-support.ts";

registerCliNameIsolation();

describe("processChannelInteraction status and route state", () => {
  test("renders whoami for Slack routes", async () => {
    const posted: string[] = [];
    let replyCalls = 0;

    await processChannelInteraction({
      agentService: {
        getSessionDiagnostics: async () => ({
          sessionName: "agent-default-slack-channel-c123-thread-1-2",
          sessionId: "11111111-1111-1111-1111-111111111111",
          sessionIdPersistence: "persisted",
          storedSessionId: "11111111-1111-1111-1111-111111111111",
          resumeCommand:
            "codex resume 11111111-1111-1111-1111-111111111111 --dangerously-bypass-approvals-and-sandbox --no-alt-screen",
        }),
        recordConversationReply: async () => {
          replyCalls += 1;
        },
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/whoami",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(replyCalls).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("platform: `slack`");
    expect(posted[0]).toContain("senderId: `U123`");
    expect(posted[0]).toContain("channelId: `C123`");
    expect(posted[0]).toContain("threadTs: `1.2`");
    expect(posted[0]).toContain("sessionName: `agent-default-slack-channel-c123-thread-1-2`");
    expect(posted[0]).not.toContain("sessionKey:");
    expect(posted[0]).toContain("sessionId: `11111111-1111-1111-1111-111111111111`");
    expect(posted[0]).toContain("sessionIdPersistence: `persisted`");
    expect(posted[0]).toContain(
      "resumeCommand: `codex resume 11111111-1111-1111-1111-111111111111 --dangerously-bypass-approvals-and-sandbox --no-alt-screen`",
    );
    expect(posted[0]).toContain("principal: `slack:U123`");
    expect(posted[0]).not.toContain("principalFormat:");
    expect(posted[0]).not.toContain("principalExample:");
    expect(posted[0]).toContain("appRole: `member`");
    expect(posted[0]).toContain("agentRole: `member`");
    expect(posted[0]).toContain("mayBypassSharedSenderPolicy: `false`");
    expect(posted[0]).toContain("canUseShell: `false`");
    expect(posted[0]).toContain("verbose: `minimal`");
  });

  test("renders whoami for Telegram routes", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getSessionDiagnostics: async () => ({
          sessionName: "agent-default-telegram-group-1001-topic-4",
          sessionId: "22222222-2222-2222-2222-222222222222",
          sessionIdPersistence: "persisted",
          storedSessionId: "22222222-2222-2222-2222-222222222222",
          resumeCommand:
            "codex resume 22222222-2222-2222-2222-222222222222 --dangerously-bypass-approvals-and-sandbox --no-alt-screen",
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:4",
      },
      identity: {
        platform: "telegram",
        conversationKind: "topic",
        senderId: "123",
        chatId: "-1001",
        topicId: "4",
      },
      senderId: "123",
      text: "/whoami",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("platform: `telegram`");
    expect(posted[0]).toContain("conversationKind: `topic`");
    expect(posted[0]).toContain("chatId: `-1001`");
    expect(posted[0]).toContain("topicId: `4`");
    expect(posted[0]).toContain("sessionName: `agent-default-telegram-group-1001-topic-4`");
    expect(posted[0]).not.toContain("sessionKey:");
    expect(posted[0]).toContain("sessionId: `22222222-2222-2222-2222-222222222222`");
    expect(posted[0]).toContain("sessionIdPersistence: `persisted`");
    expect(posted[0]).toContain(
      "resumeCommand: `codex resume 22222222-2222-2222-2222-222222222222 --dangerously-bypass-approvals-and-sandbox --no-alt-screen`",
    );
    expect(posted[0]).toContain("principal: `telegram:123`");
    expect(posted[0]).not.toContain("principalFormat:");
    expect(posted[0]).not.toContain("principalExample:");
    expect(posted[0]).toContain("appRole: `member`");
    expect(posted[0]).toContain("agentRole: `member`");
    expect(posted[0]).toContain("mayBypassSharedSenderPolicy: `false`");
    expect(posted[0]).toContain("verbose: `minimal`");
  });

  test("renders whoami without runtime session probing", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getSessionDiagnostics: async () => ({
          sessionName: "agent-default-slack-channel-c123-thread-1-2",
          sessionId: "33333333-3333-3333-3333-333333333333",
          sessionIdPersistence: "persisted",
          storedSessionId: "33333333-3333-3333-3333-333333333333",
          resumeCommand:
            "codex resume 33333333-3333-3333-3333-333333333333 --dangerously-bypass-approvals-and-sandbox --no-alt-screen",
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/whoami",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("sessionName: `agent-default-slack-channel-c123-thread-1-2`");
    expect(posted[0]).not.toContain("sessionKey:");
    expect(posted[0]).toContain("sessionId: `33333333-3333-3333-3333-333333333333`");
    expect(posted[0]).toContain("sessionIdPersistence: `persisted`");
  });

  test("renders whoami with unstored session id wording when persistence is empty", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getSessionDiagnostics: async () => ({
          sessionName: "agent-default-slack-channel-c123-thread-1-2",
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/whoami",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("sessionId: `(not available yet)`");
    expect(posted[0]).toContain("sessionIdPersistence: `not stored yet`");
  });

  test("renders status with resolved auth details for routed conversations", async () => {
    const posted: string[] = [];
    const startedAt = 1_700_000_000_000;
    const detachedAt = 1_700_000_060_000;

    await processChannelInteraction({
      agentService: {
        getConversationFollowUpState: async () => ({
          lastBotReplyAt: Date.now(),
        }),
        getSessionDiagnostics: async () => ({
          sessionName: "agent-default-slack-channel-c123-thread-1-2",
          sessionId: "33333333-3333-3333-3333-333333333333",
          sessionIdPersistence: "persisted",
          storedSessionId: "33333333-3333-3333-3333-333333333333",
          resumeCommand:
            "codex resume 33333333-3333-3333-3333-333333333333 --dangerously-bypass-approvals-and-sandbox --no-alt-screen",
        }),
        getSessionRuntime: async () => ({
          state: "detached",
          startedAt,
          detachedAt,
        }),
        resolveEffectiveTimezone: () => ({
          timezone: "America/Los_Angeles",
          source: "agent",
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/status",
      route: createRoute({
        timezone: "Asia/Ho_Chi_Minh",
        botTimezone: "UTC",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Status");
    expect(posted[0]).toContain("sessionName: `agent-default-slack-channel-c123-thread-1-2`");
    expect(posted[0]).not.toContain("sessionKey:");
    expect(posted[0]).toContain("sessionId: `33333333-3333-3333-3333-333333333333`");
    expect(posted[0]).toContain("sessionIdPersistence: `persisted`");
    expect(posted[0]).toContain(
      "resumeCommand: `codex resume 33333333-3333-3333-3333-333333333333 --dangerously-bypass-approvals-and-sandbox --no-alt-screen`",
    );
    expect(posted[0]).not.toContain("responseMode:");
    expect(posted[0]).toContain("additionalMessageMode: `steer`");
    expect(posted[0]).toContain("verbose: `minimal`");
    expect(posted[0]).toContain("principal: `slack:U123`");
    expect(posted[0]).not.toContain("principalFormat:");
    expect(posted[0]).not.toContain("principalExample:");
    expect(posted[0]).toContain("run.state: `detached`");
    expect(posted[0]).toContain("timezone.effective: `America/Los_Angeles`");
    expect(posted[0]).toContain("timezone.route: `Asia/Ho_Chi_Minh`");
    expect(posted[0]).toContain("timezone.bot: `UTC`");
    expect(posted[0]).toContain(`run.startedAt: \`${new Date(startedAt).toISOString()}\``);
    expect(posted[0]).toContain(`run.detachedAt: \`${new Date(detachedAt).toISOString()}\``);
    expect(posted[0]).toContain("appRole: `member`");
    expect(posted[0]).toContain("agentRole: `member`");
    expect(posted[0]).toContain("mayBypassSharedSenderPolicy: `false`");
    expect(posted[0]).toContain("canUseShell: `false`");
    expect(posted[0]).toContain("/attach`, `/detach`, `/watch every <duration>`");
    expect(posted[0]).toContain("/transcript` enabled on this route (`verbose: minimal`)");
    expect(posted[0]).toContain("/bash` requires `shellExecute`");
  });

  test("renders status with unstored session id wording when persistence is empty", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getConversationFollowUpState: async () => ({}),
        getSessionDiagnostics: async () => ({
          sessionName: "agent-default-slack-channel-c123-thread-1-2",
        }),
        getSessionRuntime: async () => ({
          state: "idle",
        }),
        resolveEffectiveTimezone: () => ({
          timezone: "UTC",
          source: "agent",
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/status",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("sessionId: `(not available yet)`");
    expect(posted[0]).toContain("sessionIdPersistence: `not stored yet`");
  });

  test("renders start with principal details for routed conversations", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getSessionDiagnostics: async () => ({
          sessionName: "agent-default-slack-channel-c123-thread-1-2",
        }),
        getConversationFollowUpState: async () => ({}),
        getSessionRuntime: async () => ({
          state: "idle",
        }),
        resolveEffectiveTimezone: () => ({
          timezone: "UTC",
          source: "app",
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/start",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Status");
    expect(posted[0]).toContain("sessionName: `agent-default-slack-channel-c123-thread-1-2`");
    expect(posted[0]).not.toContain("sessionKey:");
    expect(posted[0]).toContain("principal: `slack:U123`");
    expect(posted[0]).not.toContain("principalFormat:");
    expect(posted[0]).not.toContain("principalExample:");
    expect(posted[0]).not.toContain("responseMode:");
  });

  test("shows persisted response mode for the current route", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...JSON.parse(renderDefaultConfigTemplate()),
          bots: {
            ...JSON.parse(renderDefaultConfigTemplate()).bots,
            slack: {
              ...JSON.parse(renderDefaultConfigTemplate()).bots.slack,
              default: {
                ...JSON.parse(renderDefaultConfigTemplate()).bots.slack.default,
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    responseMode: "message-tool",
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/responsemode status",
        route: createRoute({
          responseMode: "message-tool",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Response mode");
    expect(posted[0]).toContain("activeRoute.responseMode: `message-tool`");
    expect(posted[0]).toContain("config.responseMode: `message-tool`");
  });

});
