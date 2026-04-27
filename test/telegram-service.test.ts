import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTelegramCommandRegistrations,
  dispatchTelegramUpdates,
  renderTelegramUnroutedRouteMessage,
  resolveTelegramMessageTopicId,
  TelegramPollingService,
} from "../src/channels/telegram/service.ts";
import { resolveTelegramBotConfig } from "../src/config/channel-bots.ts";
import type { TelegramUpdate } from "../src/channels/telegram/message.ts";
import { ProcessedEventsStore } from "../src/channels/processed-events-store.ts";
import type { LoadedConfig } from "../src/config/load-config.ts";
import { ActivityStore } from "../src/control/activity-store.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

let previousCliName: string | undefined;

beforeEach(() => {
  previousCliName = process.env.CLISBOT_CLI_NAME;
  delete process.env.CLISBOT_CLI_NAME;
});

afterEach(() => {
  process.env.CLISBOT_CLI_NAME = previousCliName;
});

function makeUpdate(updateId: number): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      text: `message ${updateId}`,
      from: {
        id: updateId,
      },
      chat: {
        id: -1000,
        type: "supergroup",
      },
    },
  };
}

function createTelegramConfig() {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: false,
        telegramEnabled: true,
      }),
    ),
  );
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.default.enabled = true;
  config.bots.telegram.default.botToken = "telegram-token";
  config.bots.telegram.default.groups["-1003455688247"] = {
    enabled: true,
    agentId: "default",
    requireMention: true,
    allowBots: false,
    allowUsers: [],
    blockUsers: [],
    topics: {
      "3": {
        enabled: true,
        agentId: "default",
        allowUsers: [],
        blockUsers: [],
      },
    },
  };
  config.bots.telegram.default.directMessages["*"] = {
    enabled: true,
    policy: "open",
    allowUsers: [],
    blockUsers: [],
    requireMention: false,
    allowBots: false,
    agentId: "default",
  };
  return resolveTelegramBotConfig(config.bots.telegram, "default");
}

function createLoadedConfig(): LoadedConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: false,
        telegramEnabled: true,
      }),
    ),
  );
  config.bots.defaults.dmScope = "per-channel-peer";
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.default.enabled = true;
  config.bots.telegram.default.botToken = "telegram-token";
  config.bots.telegram.default.groups = {
    "*": {
      enabled: false,
      requireMention: true,
      allowBots: false,
      allowUsers: [],
      blockUsers: [],
      topics: {},
    },
  };
  config.bots.telegram.default.directMessages["*"] = {
    enabled: true,
    policy: "open",
    allowUsers: [],
    blockUsers: [],
    requireMention: false,
    allowBots: false,
    agentId: "default",
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

async function runTelegramServiceUpdate(params: {
  update: TelegramUpdate;
  botUsername?: string;
  loadedConfig?: LoadedConfig;
  agentService?: unknown;
}) {
  const tempDir = mkdtempSync(join(tmpdir(), "clisbot-telegram-service-"));
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
        message_id: 9001,
      },
    }));
  }) as typeof fetch;

  try {
    const service = new TelegramPollingService(
      params.loadedConfig ?? createLoadedConfig(),
      (params.agentService ?? {
        registerSurfaceNotificationHandler() {},
        unregisterSurfaceNotificationHandler() {},
      }) as any,
      new ProcessedEventsStore(join(tempDir, "processed-events.json")),
      new ActivityStore(join(tempDir, "activity.json")),
      "default",
      { botToken: "telegram-token" },
    );

    (service as any).botUsername = params.botUsername ?? "mybot";
    await (service as any).handleUpdate(params.update);

    return apiCalls;
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("dispatchTelegramUpdates", () => {
  test("dispatches later updates without waiting for earlier ones to finish", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const { nextUpdateId, tasks } = dispatchTelegramUpdates({
      updates: [makeUpdate(1), makeUpdate(2)],
      handleUpdate: async (update) => {
        order.push(`start:${update.update_id}`);
        if (update.update_id === 1) {
          await firstGate;
        }
        order.push(`end:${update.update_id}`);
      },
    });

    await Bun.sleep(0);
    expect(nextUpdateId).toBe(3);
    expect(order).toEqual(["start:1", "start:2", "end:2"]);

    releaseFirst();
    await Promise.all(tasks);

    expect(order).toEqual(["start:1", "start:2", "end:2", "end:1"]);
  });
});

describe("renderTelegramUnroutedRouteMessage", () => {
  test("includes the exact add-route command for forum topics", () => {
    expect(
      renderTelegramUnroutedRouteMessage({
        mode: "whoami",
        chatId: -1003455688247,
        chatType: "supergroup",
        topicId: 3,
        isForum: true,
      }),
    ).toContain(
      "`clisbot routes set-agent --channel telegram topic:-1003455688247:3 --bot default --agent <id>`",
    );
  });
});

describe("resolveTelegramMessageTopicId", () => {
  test("treats supergroup message_thread_id as a topic even when chat.is_forum is absent", () => {
    expect(
      resolveTelegramMessageTopicId({
        message_id: 10,
        text: "topic message",
        chat: {
          id: -1003455688247,
          type: "supergroup",
        },
        message_thread_id: 4,
      }),
    ).toBe(4);
  });

  test("falls back to the general topic only for known forum supergroups", () => {
    expect(
      resolveTelegramMessageTopicId({
        message_id: 10,
        text: "general topic message",
        chat: {
          id: -1003455688247,
          type: "supergroup",
          is_forum: true,
        },
      }),
    ).toBe(1);
  });
});

describe("buildTelegramCommandRegistrations", () => {
  test("registers full commands for configured shared chats", () => {
    const config = createTelegramConfig();
    const registrations = buildTelegramCommandRegistrations(config);

    expect(registrations.some((entry) => entry.scope?.type === "all_private_chats")).toBe(true);
    expect(
      registrations.some((entry) => entry.scope?.type === "chat" && entry.scope.chat_id === -1003455688247),
    ).toBe(true);
  });
});

describe("TelegramPollingService shared audience enforcement", () => {
  test("replies with an explicit deny message for unauthorized group senders", async () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.telegram.default.groups["-1001"] = {
      enabled: true,
      policy: "open",
      requireMention: true,
      allowBots: false,
      allowUsers: ["100"],
      blockUsers: [],
      topics: {},
    };

    const apiCalls = await runTelegramServiceUpdate({
      loadedConfig,
      update: {
        update_id: 42,
        message: {
          message_id: 42,
          text: "@mybot hello",
          from: {
            id: 9999,
            username: "denied_user",
          },
          chat: {
            id: -1001,
            type: "supergroup",
          },
        },
      },
    });

    expect(apiCalls.some((call) => call.method === "sendMessage")).toBe(true);
    expect(apiCalls[0]?.payload.text).toBe(
      "You are not allowed to use this bot in this group. Ask a bot owner or admin to add you to `allowUsers` for this surface.",
    );
  });

  test("stays completely silent for disabled shared surfaces", async () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.telegram.default.groupPolicy = "disabled";

    const apiCalls = await runTelegramServiceUpdate({
      loadedConfig,
      update: {
        update_id: 43,
        message: {
          message_id: 43,
          text: "@mybot hello",
          from: {
            id: 9999,
          },
          chat: {
            id: -1001,
            type: "supergroup",
          },
        },
      },
    });

    expect(apiCalls).toEqual([]);
  });

  test("does not collapse a disabled topic message into the parent group route", async () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.telegram.default.groupPolicy = "allowlist";
    loadedConfig.raw.bots.telegram.default.groups["-1001"] = {
      enabled: true,
      policy: "open",
      requireMention: false,
      allowBots: false,
      allowUsers: [],
      blockUsers: [],
      topics: {
        "4": {
          enabled: true,
          policy: "disabled",
          requireMention: true,
          allowBots: false,
          allowUsers: [],
          blockUsers: [],
        },
      },
    };
    let routedPromptCount = 0;

    const apiCalls = await runTelegramServiceUpdate({
      loadedConfig,
      agentService: {
        registerSurfaceNotificationHandler() {},
        unregisterSurfaceNotificationHandler() {},
        async getConversationFollowUpState() {
          routedPromptCount += 1;
          return {};
        },
      },
      update: {
        update_id: 44,
        message: {
          message_id: 44,
          message_thread_id: 4,
          text: "hello from disabled topic",
          from: {
            id: 9999,
          },
          chat: {
            id: -1001,
            type: "supergroup",
          },
        },
      },
    });

    expect(apiCalls).toEqual([]);
    expect(routedPromptCount).toBe(0);
  });
});
