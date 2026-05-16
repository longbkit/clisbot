import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTelegramCommandRegistrations,
  coalesceTelegramMediaGroupUpdates,
  dispatchTelegramUpdates,
  renderTelegramUnroutedRouteMessage,
  resolveTelegramMessageTopicId,
  TelegramMediaGroupDispatcher,
  TelegramPollingService,
} from "../src/channels/telegram/service.ts";
import { OrderedIngressDispatcher } from "../src/channels/message/ordered-ingress-dispatcher.ts";
import { resolveTelegramBotConfig } from "../src/channels/telegram/config.ts";
import type { TelegramUpdate } from "../src/channels/telegram/message.ts";
import { ProcessedEventsStore } from "../src/channels/message/processed-events-store.ts";
import type { LoadedConfig } from "../src/config/core/load-config.ts";
import { ActivityStore } from "../src/control/runtime/activity-store.ts";
import { clisbotConfigSchema } from "../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/core/template.ts";
import { setRenderedCliName } from "../src/control/commands/cli-name.ts";

let previousCliName: string | undefined;

beforeEach(() => {
  previousCliName = process.env.CLISBOT_CLI_NAME;
  delete process.env.CLISBOT_CLI_NAME;
  setRenderedCliName();
});

afterEach(() => {
  process.env.CLISBOT_CLI_NAME = previousCliName;
  setRenderedCliName(previousCliName);
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
        channels: {
          slack: { enabled: false },
          telegram: { enabled: true },
        },
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
        channels: {
          slack: { enabled: false },
          telegram: { enabled: true },
        },
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
  test("keeps same-chat updates ordered until the earlier update is accepted", async () => {
    const order: string[] = [];
    let acceptFirst!: () => void;
    let finishFirst!: () => void;
    const firstAccepted = new Promise<void>((resolve) => {
      acceptFirst = resolve;
    });
    const firstFinished = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const dispatcher = new OrderedIngressDispatcher<TelegramUpdate>(
      (update) => String(update.message?.chat.id),
      async (update, controls) => {
        order.push(`start:${update.update_id}`);
        if (update.update_id === 1) {
          await firstAccepted;
          controls.markAccepted();
          order.push(`accepted:${update.update_id}`);
          await firstFinished;
        } else {
          controls.markAccepted();
          order.push(`accepted:${update.update_id}`);
        }
        order.push(`end:${update.update_id}`);
      },
    );

    const { nextUpdateId, tasks } = dispatchTelegramUpdates({
      updates: [makeUpdate(1), makeUpdate(2)],
      dispatcher,
    });

    await Bun.sleep(0);
    expect(nextUpdateId).toBe(3);
    expect(order).toEqual(["start:1"]);

    acceptFirst();
    for (let attempt = 0; attempt < 20 && !order.includes("end:2"); attempt += 1) {
      await Bun.sleep(10);
    }
    expect(order).toEqual(["start:1", "accepted:1", "start:2", "accepted:2", "end:2"]);

    finishFirst();
    await Promise.all(tasks);

    expect(order).toEqual(["start:1", "accepted:1", "start:2", "accepted:2", "end:2", "end:1"]);
  });
});

describe("coalesceTelegramMediaGroupUpdates", () => {
  test("coalesces Telegram album messages into one interaction update", () => {
    const updates = coalesceTelegramMediaGroupUpdates([
      {
        update_id: 10,
        message: {
          message_id: 70,
          media_group_id: "album-1",
          caption: "read these",
          from: { id: 127 },
          chat: { id: 127, type: "private" },
          photo: [{ file_id: "photo-a", file_size: 10 }],
        },
      },
      {
        update_id: 11,
        message: {
          message_id: 71,
          media_group_id: "album-1",
          from: { id: 127 },
          chat: { id: 127, type: "private" },
          photo: [{ file_id: "photo-b", file_size: 10 }],
        },
      },
    ]);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.update_id).toBe(10);
    expect(updates[0]?.message?.caption).toBe("read these");
    expect(updates[0]?.message?.media_group_messages?.map((message) => message.message_id)).toEqual([70, 71]);
  });

  test("keeps media groups separate by sender and surface", () => {
    const updates = coalesceTelegramMediaGroupUpdates([
      {
        update_id: 10,
        message: {
          message_id: 70,
          media_group_id: "album-1",
          from: { id: 127 },
          chat: { id: 127, type: "private" },
          photo: [{ file_id: "photo-a" }],
        },
      },
      {
        update_id: 11,
        message: {
          message_id: 71,
          media_group_id: "album-1",
          from: { id: 128 },
          chat: { id: 128, type: "private" },
          photo: [{ file_id: "photo-b" }],
        },
      },
    ]);

    expect(updates).toHaveLength(2);
  });
});

describe("TelegramMediaGroupDispatcher", () => {
  test("buffers Telegram album updates across polling batches before dispatching one interaction", async () => {
    const handled: TelegramUpdate[] = [];
    const dispatcher = new OrderedIngressDispatcher<TelegramUpdate>(
      (update) => String(update.message?.chat.id),
      async (update) => {
        handled.push(update);
      },
    );
    const mediaGroups = new TelegramMediaGroupDispatcher(dispatcher, 10);

    const firstTasks = mediaGroups.dispatch([
      {
        update_id: 10,
        message: {
          message_id: 70,
          media_group_id: "album-1",
          from: { id: 127 },
          chat: { id: 127, type: "private" },
          photo: [{ file_id: "photo-a" }],
        },
      },
    ]);
    const secondTasks = mediaGroups.dispatch([
      {
        update_id: 11,
        message: {
          message_id: 71,
          media_group_id: "album-1",
          from: { id: 127 },
          chat: { id: 127, type: "private" },
          photo: [{ file_id: "photo-b" }],
        },
      },
    ]);

    await Promise.all([...firstTasks, ...secondTasks]);

    expect(handled).toHaveLength(1);
    expect(handled[0]?.message?.media_group_messages?.map((message) => message.message_id)).toEqual([70, 71]);
  });

  test("keeps later normal messages behind a pending media group on the same surface", async () => {
    const handled: string[] = [];
    const dispatcher = new OrderedIngressDispatcher<TelegramUpdate>(
      (update) => String(update.message?.chat.id),
      async (update) => {
        handled.push(
          update.message?.media_group_messages
            ? `album:${update.message.media_group_messages.map((message) => message.message_id).join(",")}`
            : `message:${update.message?.message_id}`,
        );
      },
    );
    const mediaGroups = new TelegramMediaGroupDispatcher(dispatcher, 10);

    const firstTasks = mediaGroups.dispatch([
      {
        update_id: 10,
        message: {
          message_id: 70,
          media_group_id: "album-1",
          from: { id: 127 },
          chat: { id: 127, type: "private" },
          photo: [{ file_id: "photo-a" }],
        },
      },
    ]);
    const secondTasks = mediaGroups.dispatch([
      {
        update_id: 11,
        message: {
          message_id: 71,
          text: "after album",
          from: { id: 127 },
          chat: { id: 127, type: "private" },
        },
      },
    ]);

    await Promise.all([...firstTasks, ...secondTasks]);

    expect(handled).toEqual(["message:70", "message:71"]);
  });
});

describe("renderTelegramUnroutedRouteMessage", () => {
  test("includes the exact add-route command for forum topics", () => {
    const text = renderTelegramUnroutedRouteMessage({
      mode: "whoami",
      chatId: -1003455688247,
      chatType: "supergroup",
      topicId: 3,
      isForum: true,
    });

    expect(text).toContain("That group will use the agent currently assigned to that bot by default.");
    expect(text).toContain("Only if this topic should use a different agent than the one currently assigned to that bot by default:");
    expect(text).toContain("`clisbot routes set-agent --channel telegram topic:-1003455688247:3 --bot default --agent <id>`");
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

    const privateCommands = registrations.find((entry) => entry.scope?.type === "all_private_chats")
      ?.commands;
    const sharedChatCommands = registrations.find(
      (entry) => entry.scope?.type === "chat" && entry.scope.chat_id === -1003455688247,
    )?.commands;

    expect(privateCommands).toContainEqual({
      command: "new",
      description: "Start new session",
    });
    expect(
      sharedChatCommands,
    ).toContainEqual({
      command: "new",
      description: "Start new session",
    });
    const minimalCommandNames =
      registrations.find((entry) => !entry.scope)?.commands.map((command) => command.command) ?? [];
    expect(minimalCommandNames).not.toContain("new");
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

  test("uses the sender-specific DM route before asking for pairing", async () => {
    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.app.auth.roles.owner.users = ["telegram:999999"];
    loadedConfig.raw.bots.telegram.default.directMessages["*"] = {
      enabled: true,
      policy: "pairing",
      allowUsers: [],
      blockUsers: [],
      requireMention: false,
      allowBots: false,
      agentId: "default",
    };
    loadedConfig.raw.bots.telegram.default.directMessages["1001"] = {
      enabled: true,
      policy: "allowlist",
      allowUsers: ["1001"],
      blockUsers: [],
      requireMention: true,
      allowBots: false,
      agentId: "default",
    };
    let followUpChecks = 0;

    const apiCalls = await runTelegramServiceUpdate({
      loadedConfig,
      agentService: {
        registerSurfaceNotificationHandler() {},
        unregisterSurfaceNotificationHandler() {},
        appendRecentConversationMessage: async () => undefined,
        async getConversationFollowUpState() {
          followUpChecks += 1;
          return {};
        },
      },
      update: {
        update_id: 45,
        message: {
          message_id: 45,
          text: "hello",
          from: {
            id: 1001,
            username: "allowed_user",
          },
          chat: {
            id: 1001,
            type: "private",
          },
        },
      },
    });

    expect(apiCalls).toEqual([]);
    expect(followUpChecks).toBe(1);
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
