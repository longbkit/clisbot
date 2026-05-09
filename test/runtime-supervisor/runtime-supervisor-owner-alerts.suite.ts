import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeSupervisor } from "../../src/control/runtime-supervisor.ts";
import { RuntimeHealthStore } from "../../src/control/runtime-health-store.ts";
import type { ChannelPlugin } from "../../src/channels/channel-plugin.ts";
import { createLoadedConfigAt } from "./runtime-supervisor-support.ts";
import { sendOwnerAlert } from "../../src/control/owner-alerts.ts";

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

    const plugins: ChannelPlugin[] = [
      {
        id: "telegram",
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
        markStartupFailure: (store, error) => store.markTelegramFailure(error),
        runMessageCommand: async (_loadedConfig, command) => {
          sentMessages.push(command.message ?? "");
          return { botId: "default", result: { ok: true } };
        },
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    const supervisor = new RuntimeSupervisor(undefined, {
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
    const reminderDeadline = Date.now() + 500;
    while (sentMessages.length < 2 && Date.now() < reminderDeadline) {
      await Bun.sleep(20);
    }
    expect(sentMessages).toHaveLength(2);
    await Bun.sleep(80);
    expect(sentMessages).toHaveLength(2);
    await reportRecovery();
    const recoveryDeadline = Date.now() + 500;
    while (sentMessages.length < 3 && Date.now() < recoveryDeadline) {
      await Bun.sleep(20);
    }

    expect(sentMessages).toHaveLength(3);
    expect(sentMessages[0]).toContain("clisbot channel alert");
    expect(sentMessages[0]).toContain("telegram/default");
    expect(sentMessages[0]).toContain("has remained failed");
    expect(sentMessages[1]).toContain("is still failing");
    expect(sentMessages[2]).toContain("channel recovered");
    expect(sentMessages[2]).toContain("Telegram polling recovered after a polling-conflict retry.");
  });

  test("cancels a delayed owner alert when the channel recovers before the threshold", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));
    const sentMessages: string[] = [];
    let reportFailure!: () => Promise<void>;
    let reportRecovery!: () => Promise<void>;

    const plugins: ChannelPlugin[] = [
      {
        id: "telegram",
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
        markStartupFailure: (store, error) => store.markTelegramFailure(error),
        runMessageCommand: async (_loadedConfig, command) => {
          sentMessages.push(command.message ?? "");
          return { botId: "default", result: { ok: true } };
        },
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    const supervisor = new RuntimeSupervisor(undefined, {
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
    await Bun.sleep(80);

    expect(sentMessages).toHaveLength(0);
  });

  test("can deliver owner alerts to a zalo-bot owner principal", async () => {
    const sentCommands: Array<{ channel: string; target?: string; account?: string; message?: string }> = [];
    const loadedConfig = createLoadedConfigAt("/tmp/clisbot-owner-alerts-zalo.json");
    loadedConfig.raw.app.auth.roles.owner.users = ["zalo-bot:user-123"];
    const plugins: ChannelPlugin[] = [
      {
        id: "zalo-bot",
        isEnabled: () => true,
        listBots: () => [{ botId: "default", config: {} }],
        createRuntimeService: () => ({
          start: async () => undefined,
          stop: async () => undefined,
        }),
        renderHealthSummary: () => "",
        renderActiveHealthSummary: () => "",
        markStartupFailure: async () => undefined,
        resolveMessageReplyTarget: () => null,
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

  test("keeps resolved alerts correct even when the bot id contains separators", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));
    const sentMessages: string[] = [];
    let reportFailure!: () => Promise<void>;
    let reportRecovery!: () => Promise<void>;

    const plugins: ChannelPlugin[] = [
      {
        id: "telegram",
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
        markStartupFailure: (store, error) => store.markTelegramFailure(error),
        runMessageCommand: async (_loadedConfig, command) => {
          sentMessages.push(command.message ?? "");
          return { botId: "alerts:primary", result: { ok: true } };
        },
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    const supervisor = new RuntimeSupervisor(undefined, {
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
    await Bun.sleep(30);
    await reportRecovery();
    await Bun.sleep(20);

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toContain("telegram/alerts:primary");
    expect(sentMessages[1]).toContain("telegram/alerts:primary");
    expect(sentMessages[1]).toContain("channel recovered");
  });
});
