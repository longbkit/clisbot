import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetOwnerClaimRuntimeForTests } from "../src/auth/owner-claim.ts";
import type { OrderedIngressDispatcher } from "../src/channels/message/ordered-ingress-dispatcher.ts";
import { ProcessedEventsStore } from "../src/channels/message/processed-events-store.ts";
import type { ZaloBotUpdate } from "../src/channels/zalo-bot/api.ts";
import {
  dispatchZaloBotUpdates,
  ZaloBotPollingService,
} from "../src/channels/zalo-bot/service.ts";
import type { LoadedConfig } from "../src/config/core/load-config.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import { ActivityStore } from "../src/control/runtime/activity-store.ts";

type TestRunResult = {
  status: "completed";
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  snapshot: string;
  fullSnapshot: string;
  initialSnapshot: string;
};

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

function buildZaloTextUpdate(messageId: string, text: string): ZaloBotUpdate {
  return {
    event_name: "message.text.received",
    message: {
      message_id: messageId,
      date: 1_778_831_907,
      text,
      from: {
        id: "user-123",
        display_name: "User 123",
      },
      chat: {
        id: "user-123",
        chat_type: "PRIVATE",
      },
    },
  };
}

function buildCompletedRunResult(params: {
  agentId?: string;
  sessionKey?: string;
  workspacePath?: string;
  snapshot: string;
}): TestRunResult {
  return {
    status: "completed",
    agentId: params.agentId ?? "default",
    sessionKey: params.sessionKey ?? "agent:default:zalo-bot:dm:user-123",
    sessionName: "test-session",
    workspacePath: params.workspacePath ?? "/tmp",
    snapshot: params.snapshot,
    fullSnapshot: params.snapshot,
    initialSnapshot: "",
  };
}

function installZaloFetchMock() {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      ok: true,
      result: {
        message_id: "zalo-message-1",
      },
    }))) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

function createBlockedRun() {
  let release!: () => void;
  const result = new Promise<TestRunResult>((resolve) => {
    release = () => resolve(buildCompletedRunResult({
      snapshot: "first final",
    }));
  });
  return { result, release };
}

function createReleaseGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function createZaloBotServiceForTest(params: {
  loadedConfig?: LoadedConfig;
  agentService?: unknown;
  tempDir?: string;
}) {
  const tempDir = params.tempDir ?? mkdtempSync(join(tmpdir(), "clisbot-zalo-bot-service-"));
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
  return service;
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
    const service = await createZaloBotServiceForTest({
      loadedConfig: params.loadedConfig,
      agentService: params.agentService,
      tempDir,
    });
    await (service as any).handleUpdate(params.update);

    return apiCalls;
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function createQueueDispatchAgentService(params: {
  tempDir: string;
  firstRunResult: Promise<TestRunResult>;
  firstFollowUpGate?: Promise<void>;
  queuedPrompts: string[];
  queuePositions?: number[];
}) {
  let activeRun = false;
  let followUpChecks = 0;
  return {
    getWorkspacePath: () => params.tempDir,
    async getConversationFollowUpState() {
      followUpChecks += 1;
      if (followUpChecks === 1) {
        await params.firstFollowUpGate;
      }
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
      _prompt: string | (() => string),
      callbacks?: { queueItem?: { promptText?: string } },
    ) {
      const isExplicitQueue = Boolean(callbacks?.queueItem);
      const positionAhead = activeRun ? 1 : 0;
      if (isExplicitQueue) {
        params.queuedPrompts.push(callbacks?.queueItem?.promptText ?? "");
        params.queuePositions?.push(positionAhead);
      } else {
        activeRun = true;
        void params.firstRunResult.finally(() => {
          activeRun = false;
        });
      }
      return {
        positionAhead,
        persisted: Promise.resolve(),
        result: isExplicitQueue
          ? params.firstRunResult.then(() => buildCompletedRunResult({
            agentId: target.agentId,
            sessionKey: target.sessionKey,
            workspacePath: params.tempDir,
            snapshot: "queued final",
          }))
          : params.firstRunResult,
      };
    },
    async recordConversationReply() {},
    async markRecentConversationProcessed() {},
  };
}

describe("ZaloBotPollingService DM pairing enforcement", () => {
  test("dispatches queue messages without waiting for an earlier DM run to finish", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-zalo-bot-service-"));
    const restoreFetch = installZaloFetchMock();

    const loadedConfig = createLoadedConfig();
    const directRoute = loadedConfig.raw.bots.zaloBot.default.directMessages["user-123"]!;
    directRoute.requireMention = false;
    directRoute.responseMode = "capture-pane";
    directRoute.streaming = "off";

    const firstRun = createBlockedRun();
    const firstFollowUpGate = createReleaseGate();
    const queuedPrompts: string[] = [];
    const queuePositions: number[] = [];
    let tasks: Promise<void>[] = [];

    try {
      const service = await createZaloBotServiceForTest({
        loadedConfig,
        tempDir,
        agentService: createQueueDispatchAgentService({
          tempDir,
          firstRunResult: firstRun.result,
          firstFollowUpGate: firstFollowUpGate.promise,
          queuedPrompts,
          queuePositions,
        }),
      });

      tasks = dispatchZaloBotUpdates({
        updates: [
          buildZaloTextUpdate("msg-running", "hi"),
          buildZaloTextUpdate("msg-queue", "/queue 1+1"),
        ],
        dispatcher: (service as unknown as {
          ingressDispatcher: OrderedIngressDispatcher<ZaloBotUpdate>;
        }).ingressDispatcher,
      });

      await Bun.sleep(20);
      expect(queuedPrompts).toEqual([]);

      firstFollowUpGate.release();
      for (let attempt = 0; attempt < 20 && queuedPrompts.length === 0; attempt += 1) {
        await Bun.sleep(10);
      }
      expect(queuedPrompts).toEqual(["1+1"]);
      expect(queuePositions).toEqual([1]);
    } finally {
      firstRun.release();
      await Promise.allSettled(tasks);
      restoreFetch();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

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
