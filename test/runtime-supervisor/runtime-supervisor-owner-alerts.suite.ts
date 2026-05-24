import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeSupervisor } from "../../src/control/runtime/runtime-supervisor.ts";
import { describeTelegramStartupFailure } from "../../src/channels/telegram/startup-failure.ts";
import { RuntimeHealthStore } from "../../src/control/runtime/runtime-health-store.ts";
import type { ChannelPlugin } from "../../src/channels/integration/channel-plugin.ts";
import { createLoadedConfigAt } from "./runtime-supervisor-support.ts";
import { sendOwnerAlert } from "../../src/control/runtime/owner-alerts.ts";

async function waitForMessageCount(
  sentMessages: string[],
  expectedCount: number,
  timeoutMs = 2_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (sentMessages.length < expectedCount && Date.now() < deadline) {
    await Bun.sleep(20);
  }
}

describe("RuntimeSupervisor owner alerts", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("sends one initial owner alert, one follow-up reminder, and one resolved alert", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));
    const sentMessages: string[] = [];
    let reportFailure!: () => Promise<void>;
    let reportRecovery!: () => Promise<void>;
    let supervisor: RuntimeSupervisor | undefined;

    const plugins: ChannelPlugin[] = [
      {
        id: "telegram",
        capabilities: {
          surfaceKinds: ["dm", "group", "topic"],
          messageActions: ["send"],
        },
        isEnabled: () => true,
        listBots: () => [{ botId: "default", config: {} }],
        createRuntimeService: (context) => {
          reportFailure = async () =>
            await context.reportLifecycle({
              connection: "failed",
              summary: "Telegram polling is temporarily blocked because another poller is already using this bot token.",
              detail: "Conflict: terminated by other getUpdates request",
              ownerAlertAfterMs: 20,
              ownerAlertRepeatMs: 30,
            });
          reportRecovery = async () =>
            await context.reportLifecycle({
              connection: "active",
              detail: "Telegram polling recovered after a polling-conflict retry.",
            });
          return {
            start: async () => undefined,
            stop: async () => undefined,
            getRuntimeIdentity: () => ({
              botId: "default",
              label: "bot=@longluong2bot",
            }),
          };
        },
        renderHealthSummary: (state) =>
          state === "starting"
            ? "Telegram channel is starting."
            : state === "disabled"
              ? "Telegram channel is disabled in config."
              : "Telegram channel is stopped.",
        renderActiveHealthSummary: () => "Telegram polling connected for 1 bot(s).",
        describeStartupFailure: describeTelegramStartupFailure,
        runMessageCommand: async (_loadedConfig, command) => {
          sentMessages.push(command.message ?? "");
          return { botId: "default", result: { ok: true } };
        },
        resolveMessageSurface: () => null,
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    try {
      supervisor = new RuntimeSupervisor(undefined, {
        loadConfig: async () => {
          const loaded = createLoadedConfigAt(configPath);
          loaded.raw.app.auth.roles.owner.users = ["telegram:1276408333"];
          return loaded;
        },
        listChannelPlugins: () => plugins,
        runtimeHealthStore,
        createAgentService: () =>
          ({
            start: async () => undefined,
            stop: async () => undefined,
          }) as any,
        createProcessedEventsStore: () => ({}) as any,
        createActivityStore: () => ({}) as any,
      });

      await supervisor.start();
      await reportFailure();
      await waitForMessageCount(sentMessages, 2);
      expect(sentMessages).toHaveLength(2);
      await Bun.sleep(80);
      expect(sentMessages).toHaveLength(2);
      await reportRecovery();
      await waitForMessageCount(sentMessages, 3);

      expect(sentMessages).toHaveLength(3);
      expect(sentMessages[0]).toContain("clisbot channel alert");
      expect(sentMessages[0]).toContain("telegram/default");
      expect(sentMessages[0]).toContain("has remained failed");
      expect(sentMessages[1]).toContain("is still failing");
      expect(sentMessages[2]).toContain("channel recovered");
      expect(sentMessages[2]).toContain("Telegram polling recovered after a polling-conflict retry.");
    } finally {
      await supervisor?.stop().catch(() => undefined);
    }
  }, 12_000);

  test("cancels a delayed owner alert when the channel recovers before the threshold", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));
    const sentMessages: string[] = [];
    let reportFailure!: () => Promise<void>;
    let reportRecovery!: () => Promise<void>;
    let supervisor: RuntimeSupervisor | undefined;

    const plugins: ChannelPlugin[] = [
      {
        id: "telegram",
        capabilities: {
          surfaceKinds: ["dm", "group", "topic"],
          messageActions: ["send"],
        },
        isEnabled: () => true,
        listBots: () => [{ botId: "default", config: {} }],
        createRuntimeService: (context) => {
          reportFailure = async () =>
            await context.reportLifecycle({
              connection: "failed",
              summary: "Telegram polling is temporarily blocked because another poller is already using this bot token.",
              detail: "Conflict: terminated by other getUpdates request",
              ownerAlertAfterMs: 50,
            });
          reportRecovery = async () =>
            await context.reportLifecycle({
              connection: "active",
              detail: "Telegram polling recovered after a polling-conflict retry.",
            });
          return {
            start: async () => undefined,
            stop: async () => undefined,
          };
        },
        renderHealthSummary: (state) =>
          state === "starting"
            ? "Telegram channel is starting."
            : state === "disabled"
              ? "Telegram channel is disabled in config."
              : "Telegram channel is stopped.",
        renderActiveHealthSummary: () => "Telegram polling connected for 1 bot(s).",
        describeStartupFailure: describeTelegramStartupFailure,
        runMessageCommand: async (_loadedConfig, command) => {
          sentMessages.push(command.message ?? "");
          return { botId: "default", result: { ok: true } };
        },
        resolveMessageSurface: () => null,
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    try {
      supervisor = new RuntimeSupervisor(undefined, {
        loadConfig: async () => {
          const loaded = createLoadedConfigAt(configPath);
          loaded.raw.app.auth.roles.owner.users = ["telegram:1276408333"];
          return loaded;
        },
        listChannelPlugins: () => plugins,
        runtimeHealthStore,
        createAgentService: () =>
          ({
            start: async () => undefined,
            stop: async () => undefined,
          }) as any,
        createProcessedEventsStore: () => ({}) as any,
        createActivityStore: () => ({}) as any,
      });

      await supervisor.start();
      await reportFailure();
      await Bun.sleep(10);
      await reportRecovery();
      await Bun.sleep(120);

      expect(sentMessages).toHaveLength(0);
    } finally {
      await supervisor?.stop().catch(() => undefined);
    }
  }, 8_000);

  test("can deliver owner alerts to a zalo-bot owner principal", async () => {
    const sentCommands: Array<{ channel: string; target?: string; account?: string; message?: string }> = [];
    const loadedConfig = createLoadedConfigAt("/tmp/clisbot-owner-alerts-zalo.json");
    loadedConfig.raw.app.auth.roles.owner.users = ["zalo-bot:user-123"];
    const plugins: ChannelPlugin[] = [
      {
        id: "zalo-bot",
        capabilities: {
          surfaceKinds: ["dm"],
          messageActions: ["send"],
        },
        isEnabled: () => true,
        listBots: () => [{ botId: "default", config: {} }],
        createRuntimeService: () => ({
          start: async () => undefined,
          stop: async () => undefined,
        }),
        renderHealthSummary: () => "",
        renderActiveHealthSummary: () => "",
        resolveMessageReplyTarget: () => null,
        resolveMessageSurface: () => null,
        runMessageCommand: async (_loadedConfig, command) => {
          sentCommands.push({
            channel: command.channel,
            target: command.target,
            account: command.account,
            message: command.message,
          });
          return { botId: "default", result: { ok: true } };
        },
      },
    ];

    const result = await sendOwnerAlert({
      loadedConfig,
      message: "zalo-bot channel alert",
      listChannelPlugins: () => plugins,
    });

    expect(result.failed).toEqual([]);
    expect(result.delivered).toEqual(["zalo-bot:user-123 via zalo-bot/default"]);
    expect(sentCommands).toEqual([
      {
        channel: "zalo-bot",
        target: "user-123",
        account: "default",
        message: "zalo-bot channel alert",
      },
    ]);
  });

  test("uses channel-owned dm target syntax for slack owner alerts", async () => {
    const sentCommands: Array<{ channel: string; target?: string; account?: string; message?: string }> = [];
    const loadedConfig = createLoadedConfigAt("/tmp/clisbot-owner-alerts-slack.json");
    loadedConfig.raw.app.auth.roles.owner.users = ["slack:u123abc"];
    const plugins: ChannelPlugin[] = [
      {
        id: "slack",
        capabilities: {
          surfaceKinds: ["dm", "group"],
          messageActions: ["send"],
        },
        isEnabled: () => true,
        listBots: () => [{ botId: "default", config: {} }],
        buildDefaultDirectMessageTarget: (providerUserId) => `user:${providerUserId.trim().toUpperCase()}`,
        createRuntimeService: () => ({
          start: async () => undefined,
          stop: async () => undefined,
        }),
        renderHealthSummary: () => "",
        renderActiveHealthSummary: () => "",
        resolveMessageReplyTarget: () => null,
        resolveMessageSurface: () => null,
        runMessageCommand: async (_loadedConfig, command) => {
          sentCommands.push({
            channel: command.channel,
            target: command.target,
            account: command.account,
            message: command.message,
          });
          return { botId: "default", result: { ok: true } };
        },
      },
    ];

    const result = await sendOwnerAlert({
      loadedConfig,
      message: "slack channel alert",
      listChannelPlugins: () => plugins,
    });

    expect(result.failed).toEqual([]);
    expect(result.delivered).toEqual(["slack:u123abc via slack/default"]);
    expect(sentCommands).toEqual([
      {
        channel: "slack",
        target: "user:U123ABC",
        account: "default",
        message: "slack channel alert",
      },
    ]);
  });

  test("keeps resolved alerts correct even when the bot id contains separators", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));
    const sentMessages: string[] = [];
    let reportFailure!: () => Promise<void>;
    let reportRecovery!: () => Promise<void>;
    let supervisor: RuntimeSupervisor | undefined;

    const plugins: ChannelPlugin[] = [
      {
        id: "telegram",
        capabilities: {
          surfaceKinds: ["dm", "group", "topic"],
          messageActions: ["send"],
        },
        isEnabled: () => true,
        listBots: () => [{ botId: "alerts:primary", config: {} }],
        createRuntimeService: (context) => {
          reportFailure = async () =>
            await context.reportLifecycle({
              connection: "failed",
              summary: "Telegram polling is temporarily blocked because another poller is already using this bot token.",
              detail: "Conflict: terminated by other getUpdates request",
              ownerAlertAfterMs: 20,
              ownerAlertRepeatMs: 60,
            });
          reportRecovery = async () =>
            await context.reportLifecycle({
              connection: "active",
              detail: "Telegram polling recovered after a polling-conflict retry.",
            });
          return {
            start: async () => undefined,
            stop: async () => undefined,
          };
        },
        renderHealthSummary: (state) =>
          state === "starting"
            ? "Telegram channel is starting."
            : state === "disabled"
              ? "Telegram channel is disabled in config."
              : "Telegram channel is stopped.",
        renderActiveHealthSummary: () => "Telegram polling connected for 1 bot(s).",
        describeStartupFailure: describeTelegramStartupFailure,
        runMessageCommand: async (_loadedConfig, command) => {
          sentMessages.push(command.message ?? "");
          return { botId: "alerts:primary", result: { ok: true } };
        },
        resolveMessageSurface: () => null,
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    try {
      supervisor = new RuntimeSupervisor(undefined, {
        loadConfig: async () => {
          const loaded = createLoadedConfigAt(configPath);
          loaded.raw.app.auth.roles.owner.users = ["telegram:1276408333"];
          return loaded;
        },
        listChannelPlugins: () => plugins,
        runtimeHealthStore,
        createAgentService: () =>
          ({
            start: async () => undefined,
            stop: async () => undefined,
          }) as any,
        createProcessedEventsStore: () => ({}) as any,
        createActivityStore: () => ({}) as any,
      });

      await supervisor.start();
      await reportFailure();
      await waitForMessageCount(sentMessages, 1);
      await reportRecovery();
      await waitForMessageCount(sentMessages, 2);

      expect(sentMessages).toHaveLength(2);
      expect(sentMessages[0]).toContain("telegram/alerts:primary");
      expect(sentMessages[1]).toContain("telegram/alerts:primary");
      expect(sentMessages[1]).toContain("channel recovered");
    } finally {
      await supervisor?.stop().catch(() => undefined);
    }
  }, 8_000);
});
