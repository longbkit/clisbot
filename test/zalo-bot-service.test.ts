import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetOwnerClaimRuntimeForTests } from "../src/auth/owner-claim.ts";
import { ProcessedEventsStore } from "../src/channels/message/processed-events-store.ts";
import type { ZaloBotUpdate } from "../src/channels/zalo-bot/api.ts";
import { ZaloBotPollingService } from "../src/channels/zalo-bot/service.ts";
import type { LoadedConfig } from "../src/config/core/load-config.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import { ActivityStore } from "../src/control/runtime/activity-store.ts";

beforeEach(() => {
  resetOwnerClaimRuntimeForTests();
});

afterEach(() => {
  resetOwnerClaimRuntimeForTests();
});

function createLoadedConfig(): LoadedConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        channels: {
          slack: { enabled: false },
          telegram: { enabled: false },
          "zalo-bot": { enabled: true },
        },
      }),
    ),
  );

  config.app.auth.roles.owner.users = ["telegram:1276408333"];
  config.bots.defaults.dmScope = "per-channel-peer";
  config.bots.zaloBot.default = {
    ...config.bots.zaloBot.default,
    enabled: true,
    botToken: "zalo-token",
    directMessages: {
      "*": {
        enabled: true,
        policy: "pairing",
        allowUsers: [],
        blockUsers: [],
        requireMention: false,
        allowBots: false,
        agentId: "default",
      },
      "user-123": {
        enabled: true,
        policy: "allowlist",
        allowUsers: ["user-123"],
        blockUsers: [],
        requireMention: true,
        allowBots: false,
        agentId: "default",
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

async function runZaloBotServiceUpdate(params: {
  loadedConfig?: LoadedConfig;
  update: ZaloBotUpdate;
  agentService?: unknown;
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-bot-service-"));
  const previousFetch = globalThis.fetch;
  const apiCalls: Array<{ method: string; payload: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input, init) => {
    const method = String(input).split("/").pop() ?? "";
    apiCalls.push({
      method,
      payload: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({
      ok: true,
      result: {
        message_id: "zalo-message-1",
      },
    }));
  }) as typeof fetch;

  try {
    const service = new ZaloBotPollingService(
      params.loadedConfig ?? createLoadedConfig(),
      (params.agentService ?? {
        getWorkspacePath: () => tempDir,
        async getConversationFollowUpState() {
          return {};
        },
      }) as any,
      new ProcessedEventsStore(join(tempDir, "processed-events.json")),
      new ActivityStore(join(tempDir, "activity.json")),
      "default",
      { botToken: "zalo-token" },
      async () => undefined,
    );

    (service as any).botUserId = "bot-1";
    (service as any).botName = "clisbot";
    await (service as any).handleUpdate(params.update);

    return apiCalls;
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("ZaloBotPollingService DM pairing enforcement", () => {
  test("uses the sender-specific DM route before asking for pairing", async () => {
    let followUpChecks = 0;
    const apiCalls = await runZaloBotServiceUpdate({
      agentService: {
        getWorkspacePath: () => "/tmp",
        async getConversationFollowUpState() {
          followUpChecks += 1;
          return {};
        },
      },
      update: {
        event_name: "message.text.received",
        message: {
          message_id: "msg-1",
          date: 1_778_831_905,
          text: "hello",
          from: {
            id: "user-123",
            display_name: "User 123",
          },
          chat: {
            id: "user-123",
            chat_type: "PRIVATE",
          },
        },
      },
    });

    expect(apiCalls).toEqual([]);
    expect(followUpChecks).toBe(1);
  });

  test("does not derive a sender handle from Zalo display names", async () => {
    const loadedConfig = createLoadedConfig();
    const directRoute = loadedConfig.raw.bots.zaloBot.default.directMessages["user-123"]!;
    directRoute.requireMention = false;
    directRoute.responseMode = "capture-pane";
    directRoute.streaming = "off";

    const recentMessages: Array<{ senderHandle?: string; senderName?: string }> = [];
    const prompts: string[] = [];
    await runZaloBotServiceUpdate({
      loadedConfig,
      agentService: {
        getWorkspacePath: () => "/tmp",
        async getConversationFollowUpState() {
          return {};
        },
        async appendRecentConversationMessage(_target: unknown, message: { senderHandle?: string; senderName?: string }) {
          recentMessages.push(message);
        },
        async getRecentConversationReplayMessages() {
          return [];
        },
        resolveEffectiveTimezone() {
          return { timezone: "UTC" };
        },
        enqueuePrompt(target: { agentId: string; sessionKey: string }, prompt: string | (() => string)) {
          prompts.push(typeof prompt === "function" ? prompt() : prompt);
          return {
            positionAhead: 0,
            persisted: Promise.resolve(),
            result: Promise.resolve({
              status: "completed",
              agentId: target.agentId,
              sessionKey: target.sessionKey,
              sessionName: "test-session",
              workspacePath: "/tmp",
              snapshot: "ok",
              fullSnapshot: "ok",
              initialSnapshot: "",
            }),
          };
        },
        async recordConversationReply() {},
        async markRecentConversationProcessed() {},
      },
      update: {
        event_name: "message.text.received",
        message: {
          message_id: "msg-2",
          date: 1_778_831_906,
          text: "hello",
          from: {
            id: "user-123",
            display_name: "User 123",
          },
          chat: {
            id: "user-123",
            chat_type: "PRIVATE",
          },
        },
      },
    });

    expect(recentMessages[0]?.senderName).toBe("User 123");
    expect(recentMessages[0]?.senderHandle).toBeUndefined();
    expect(prompts.join("\n")).toContain("User 123 [zalo-bot:user-123]");
    expect(prompts.join("\n")).not.toContain("@user123");
  });

  test("treats slash queue commands as explicit DM control even when mention is required", async () => {
    const loadedConfig = createLoadedConfig();
    const directRoute = loadedConfig.raw.bots.zaloBot.default.directMessages["user-123"]!;
    directRoute.requireMention = true;
    directRoute.responseMode = "capture-pane";
    directRoute.streaming = "off";

    const queued: Array<{
      sessionKey: string;
      prompt: string;
      queueText?: string;
      queueItemPrompt?: string;
    }> = [];
    await runZaloBotServiceUpdate({
      loadedConfig,
      agentService: {
        getWorkspacePath: () => "/tmp",
        async getConversationFollowUpState() {
          return {};
        },
        async appendRecentConversationMessage() {},
        async getRecentConversationReplayMessages() {
          return [];
        },
        resolveEffectiveTimezone() {
          return { timezone: "UTC" };
        },
        enqueuePrompt(
          target: { agentId: string; sessionKey: string },
          prompt: string | (() => string),
          callbacks?: { queueText?: string; queueItem?: { promptText?: string } },
        ) {
          queued.push({
            sessionKey: target.sessionKey,
            prompt: typeof prompt === "function" ? prompt() : prompt,
            queueText: callbacks?.queueText,
            queueItemPrompt: callbacks?.queueItem?.promptText,
          });
          return {
            positionAhead: 0,
            persisted: Promise.resolve(),
            result: Promise.resolve({
              status: "completed",
              agentId: target.agentId,
              sessionKey: target.sessionKey,
              sessionName: "test-session",
              workspacePath: "/tmp",
              snapshot: "queued final",
              fullSnapshot: "queued final",
              initialSnapshot: "",
            }),
          };
        },
        async recordConversationReply() {},
        async markRecentConversationProcessed() {},
      },
      update: {
        event_name: "message.text.received",
        message: {
          message_id: "msg-3",
          date: 1_778_831_907,
          text: "/queue review the Zalo queue path",
          from: {
            id: "user-123",
            display_name: "User 123",
          },
          chat: {
            id: "user-123",
            chat_type: "PRIVATE",
          },
        },
      },
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]?.sessionKey).toBe("agent:default:zalo-bot:dm:user-123");
    expect(queued[0]?.queueText).toBe("review the Zalo queue path");
    expect(queued[0]?.queueItemPrompt).toBe("review the Zalo queue path");
    expect(queued[0]?.prompt).toContain("review the Zalo queue path");
  });
});
