import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildTelegramCommandRegistrations,
  dispatchTelegramUpdates,
  renderTelegramUnroutedRouteMessage,
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
  config.bots.telegram.default.directMessages["dm:*"] = {
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
  config.bots.telegram.defaults.groupPolicy = "allowlist";
  config.bots.telegram.default.enabled = true;
  config.bots.telegram.default.botToken = "telegram-token";
  config.bots.telegram.default.groups = {};
  config.bots.telegram.default.directMessages["dm:*"] = {
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
      createLoadedConfig(),
      {
        registerSurfaceNotificationHandler() {},
        unregisterSurfaceNotificationHandler() {},
      } as any,
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

  test("isolates update handler errors so later updates still run", async () => {
    const order: string[] = [];
    const errors: number[] = [];

    const { tasks } = dispatchTelegramUpdates({
      updates: [makeUpdate(10), makeUpdate(11)],
      handleUpdate: async (update) => {
        order.push(`start:${update.update_id}`);
        if (update.update_id === 10) {
          throw new Error("boom");
        }
        order.push(`end:${update.update_id}`);
      },
      onUnhandledError: (_error, update) => {
        errors.push(update.update_id);
      },
    });

    await Promise.all(tasks);

    expect(order).toEqual(["start:10", "start:11", "end:11"]);
    expect(errors).toEqual([10]);
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

  test("renders onboarding guidance for unrouted start in groups", () => {
    const text = renderTelegramUnroutedRouteMessage({
      mode: "start",
      chatId: -1003455688247,
      chatType: "supergroup",
      topicId: 3,
      isForum: true,
    });

    expect(text).toContain("clisbot: this Telegram topic is not configured yet.");
    expect(text).toContain("Ask the bot owner to choose one of these:");
    expect(text).toContain("Add the whole group to the allowlist:");
    expect(text).toContain(
      "`clisbot routes add --channel telegram group:-1003455688247 --bot default`",
    );
    expect(text).toContain("Bind the whole group to a specific agent:");
    expect(text).toContain(
      "`clisbot routes set-agent --channel telegram group:-1003455688247 --bot default --agent <id>`",
    );
    expect(text).toContain("Or bind only this topic to a specific agent:");
    expect(text).toContain(
      "`clisbot routes add --channel telegram topic:-1003455688247:3 --bot default`",
    );
    expect(text).toContain(
      "`clisbot routes set-agent --channel telegram topic:-1003455688247:3 --bot default --agent <id>`",
    );
    expect(text).toContain("After that, routed commands such as `/status`, `/stop`, `/nudge`, `/followup`, and `/bash` will work here.");
  });

  test("renders onboarding guidance for unrouted help in groups", () => {
    const text = renderTelegramUnroutedRouteMessage({
      mode: "help",
      chatId: -1003455688247,
      chatType: "supergroup",
      topicId: 3,
      isForum: true,
    });

    expect(text).toContain("clisbot: this Telegram topic is not configured yet.");
    expect(text).toContain("Ask the bot owner to choose one of these:");
    expect(text).toContain("After that, routed commands such as `/status`, `/stop`, `/nudge`, `/followup`, and `/bash` will work here.");
  });

  test("renders onboarding guidance for unrouted status in groups", () => {
    const text = renderTelegramUnroutedRouteMessage({
      mode: "status",
      chatId: -1003455688247,
      chatType: "supergroup",
      topicId: 3,
      isForum: true,
    });

    expect(text).toContain("clisbot: this Telegram topic is not configured yet.");
    expect(text).toContain("After that, routed commands such as `/status`, `/stop`, `/nudge`, `/followup`, and `/bash` will work here.");
  });
});

describe("buildTelegramCommandRegistrations", () => {
  test("registers minimal defaults and richer commands for private chats and allowed groups", () => {
    const registrations = buildTelegramCommandRegistrations(createTelegramConfig());

    expect(registrations).toHaveLength(3);
    expect(registrations[0]?.scope).toBeUndefined();
    expect(registrations[0]?.commands.map((item) => item.command)).toEqual([
      "start",
      "status",
      "help",
      "whoami",
    ]);
    expect(registrations[1]?.scope).toEqual({
      type: "all_private_chats",
    });
    expect(registrations[1]?.commands.map((item) => item.command)).toEqual([
      "start",
      "status",
      "help",
      "whoami",
      "transcript",
      "attach",
      "detach",
      "watch",
      "stop",
      "nudge",
      "followup",
      "pause",
      "resume",
      "streaming",
      "responsemode",
      "additionalmessagemode",
      "queue",
      "steer",
      "loop",
      "bash",
    ]);
    expect(registrations[2]?.scope).toEqual({
      type: "chat",
      chat_id: -1003455688247,
    });
  });
});

describe("TelegramPollingService", () => {
  test("retries polling conflict with backoff and reports recovery instead of stopping the service", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-telegram-service-"));
    const previousFetch = globalThis.fetch;
    const lifecycleEvents: Array<{
      connection: "active" | "failed";
      summary?: string;
      detail?: string;
      actions?: string[];
      ownerAlertAfterMs?: number;
    }> = [];
    let getUpdatesCalls = 0;
    let service: TelegramPollingService | undefined;
    let resolveRecovered!: () => void;
    const recovered = new Promise<void>((resolve) => {
      resolveRecovered = resolve;
    });

    const loadedConfig = createLoadedConfig();
    loadedConfig.raw.bots.telegram.default.polling = {
      timeoutSeconds: 1,
      retryDelayMs: 1,
    };

    globalThis.fetch = (async (input) => {
      const method = String(input).split("/").pop() ?? "";
      if (method === "getMe") {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            id: 1,
            username: "mybot",
          },
        }));
      }

      if (method === "setMyCommands") {
        return new Response(JSON.stringify({
          ok: true,
          result: true,
        }));
      }

      if (method === "getUpdates") {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return new Response(JSON.stringify({
            ok: true,
            result: [],
          }));
        }

        if (getUpdatesCalls === 2) {
          return new Response(JSON.stringify({
            ok: false,
            error_code: 409,
            description:
              "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
          }));
        }

        return new Response(JSON.stringify({
          ok: true,
          result: [],
        }));
      }

      throw new Error(`unexpected method ${method}`);
    }) as typeof fetch;

    try {
      service = new TelegramPollingService(
        loadedConfig,
        {
          registerSurfaceNotificationHandler() {},
          unregisterSurfaceNotificationHandler() {},
        } as any,
        new ProcessedEventsStore(join(tempDir, "processed-events.json")),
        new ActivityStore(join(tempDir, "activity.json")),
        "default",
        { botToken: "telegram-token" },
        async (event) => {
          lifecycleEvents.push(event);
          if (event.connection === "active" && lifecycleEvents.some((entry) => entry.connection === "failed")) {
            resolveRecovered();
          }
        },
      );

      await service.start();
      await recovered;
      await service.stop();

      expect(getUpdatesCalls).toBeGreaterThanOrEqual(3);
      expect(lifecycleEvents.map((event) => event.connection)).toEqual(["failed", "active"]);
      expect(lifecycleEvents[0]?.summary).toBe(
        "Telegram polling is temporarily blocked because another poller is already using this bot token.",
      );
      expect(lifecycleEvents[0]?.actions).toContain(
        "clisbot will keep retrying automatically with backoff until Telegram polling can recover",
      );
      expect(lifecycleEvents[0]?.ownerAlertAfterMs).toBe(5 * 60_000);
      expect(lifecycleEvents[1]?.detail).toBe(
        "Telegram polling recovered after a polling-conflict retry.",
      );
    } finally {
      if (service) {
        await service.stop().catch(() => undefined);
      }
      globalThis.fetch = previousFetch;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("posts unrouted mention guidance for forum topics through the service handler", async () => {
    const apiCalls = await runTelegramServiceUpdate({
      update: {
        update_id: 42,
        message: {
          message_id: 42,
          message_thread_id: 7,
          text: "@mybot hello",
          from: {
            id: 123,
          },
          chat: {
            id: -1003455688248,
            type: "supergroup",
            is_forum: true,
          },
        },
      } satisfies TelegramUpdate,
    });

    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0]?.method).toBe("sendMessage");
    expect(apiCalls[0]?.payload.chat_id).toBe(-1003455688248);
    expect(apiCalls[0]?.payload.message_thread_id).toBe(7);
    expect(String(apiCalls[0]?.payload.text ?? "")).toContain(
      "clisbot: this Telegram topic is not configured yet.",
    );
    expect(String(apiCalls[0]?.payload.text ?? "")).toContain(
      "`clisbot routes add --channel telegram group:-1003455688248 --bot default`",
    );
  });

  test("posts unrouted mention guidance for non-forum groups through the service handler", async () => {
    const apiCalls = await runTelegramServiceUpdate({
      update: {
        update_id: 43,
        message: {
          message_id: 43,
          text: "@mybot hello",
          from: {
            id: 123,
          },
          chat: {
            id: -1003455688249,
            type: "supergroup",
            is_forum: false,
          },
        },
      } satisfies TelegramUpdate,
    });

    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0]?.method).toBe("sendMessage");
    expect(apiCalls[0]?.payload.chat_id).toBe(-1003455688249);
    expect(apiCalls[0]?.payload.message_thread_id).toBeUndefined();
    expect(String(apiCalls[0]?.payload.text ?? "")).toContain(
      "clisbot: this Telegram group is not configured yet.",
    );
  });

  test("keeps plain unrouted group messages silent", async () => {
    const apiCalls = await runTelegramServiceUpdate({
      update: {
        update_id: 44,
        message: {
          message_id: 44,
          text: "hello there",
          from: {
            id: 123,
          },
          chat: {
            id: -1003455688250,
            type: "supergroup",
            is_forum: false,
          },
        },
      } satisfies TelegramUpdate,
    });

    expect(apiCalls).toHaveLength(0);
  });
});
