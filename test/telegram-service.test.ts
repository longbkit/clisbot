import { describe, expect, test } from "bun:test";
import {
  buildTelegramCommandRegistrations,
  dispatchTelegramUpdates,
  renderTelegramUnroutedRouteMessage,
} from "../src/channels/telegram/service.ts";
import type { TelegramUpdate } from "../src/channels/telegram/message.ts";
import type { LoadedConfig } from "../src/config/load-config.ts";

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

function createTelegramConfig(): LoadedConfig["raw"]["channels"]["telegram"] {
  return {
    enabled: true,
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
    groups: {
      "-1003455688247": {
        agentId: "default",
        requireMention: true,
        allowBots: false,
        topics: {
          "3": {
            agentId: "default",
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
  };
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
      "`bun run src/main.ts channels add telegram-group -1003455688247 --topic 3`",
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

    expect(text).toContain("muxbot: this Telegram topic is not configured yet.");
    expect(text).toContain("Ask the bot owner to add this route with:");
    expect(text).toContain("After that, group commands such as `/transcript`, `/stop`, `/followup`, and `/bash` will work here.");
  });

  test("renders onboarding guidance for unrouted help in groups", () => {
    const text = renderTelegramUnroutedRouteMessage({
      mode: "help",
      chatId: -1003455688247,
      chatType: "supergroup",
      topicId: 3,
      isForum: true,
    });

    expect(text).toContain("muxbot: this Telegram topic is not configured yet.");
    expect(text).toContain("Ask the bot owner to add this route with:");
    expect(text).toContain("After that, group commands such as `/transcript`, `/stop`, `/followup`, and `/bash` will work here.");
  });

  test("renders onboarding guidance for unrouted status in groups", () => {
    const text = renderTelegramUnroutedRouteMessage({
      mode: "status",
      chatId: -1003455688247,
      chatType: "supergroup",
      topicId: 3,
      isForum: true,
    });

    expect(text).toContain("muxbot: this Telegram topic is not configured yet.");
    expect(text).toContain("After that, group commands such as `/transcript`, `/stop`, `/followup`, and `/bash` will work here.");
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
      "stop",
      "followup",
      "bash",
    ]);
    expect(registrations[2]?.scope).toEqual({
      type: "chat",
      chat_id: -1003455688247,
    });
  });
});
