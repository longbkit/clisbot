import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../../src/config/core/load-config.ts";
import { clisbotConfigSchema } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import { RuntimeSupervisor } from "../../src/control/runtime/runtime-supervisor.ts";
import { describeSlackStartupFailure } from "../../src/channels/slack/startup-failure.ts";
import { describeTelegramStartupFailure } from "../../src/channels/telegram/startup-failure.ts";
import { RuntimeHealthStore } from "../../src/control/runtime/runtime-health-store.ts";
import {
  resetConfigReloadSuppressionForTests,
  suppressConfigReload,
} from "../../src/control/runtime/config-reload-suppression.ts";
import type { ChannelPlugin } from "../../src/channels/integration/channel-plugin.ts";
import { createLoadedConfig, createLoadedConfigAt } from "./runtime-supervisor-support.ts";

describe("RuntimeSupervisor lifecycle", () => {
  let tempDir = "";

  afterEach(() => {
    resetConfigReloadSuppressionForTests();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("ignores suppressed watch reloads triggered by internal owner-claim writes", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));
    let createdAgentServices = 0;
    let stoppedAgentServices = 0;

    const supervisor = new RuntimeSupervisor(configPath, {
      loadConfig: async () => createLoadedConfigAt(configPath),
      listChannelPlugins: () => [],
      runtimeHealthStore,
      createAgentService: () => {
        createdAgentServices += 1;
        return {
          start: async () => undefined,
          stop: async () => {
            stoppedAgentServices += 1;
          },
        } as any;
      },
      createProcessedEventsStore: () => ({}) as any,
      createActivityStore: () => ({}) as any,
    });

    await supervisor.start();
    suppressConfigReload(configPath, statSync(configPath).mtimeMs);

    await (supervisor as any).reload("watch");

    expect(createdAgentServices).toBe(1);
    expect(stoppedAgentServices).toBe(0);
    expect((await runtimeHealthStore.read()).reload?.status).toBe("success");
  });

  test("marks already-started channels as stopped when a later plugin fails during startup", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));
    const stopCalls: string[] = [];

    const plugins: ChannelPlugin[] = [
      {
        id: "slack",
        capabilities: {
          surfaceKinds: ["dm", "group"],
          messageActions: ["send"],
        },
        isEnabled: () => true,
        listBots: () => [{ botId: "default", config: {} }],
        createRuntimeService: () => ({
          start: async () => undefined,
          stop: async () => {
            stopCalls.push("slack");
          },
        }),
        renderHealthSummary: (state) =>
          state === "starting"
            ? "Slack channel is starting."
            : state === "disabled"
              ? "Slack channel is disabled in config."
              : "Slack channel is stopped.",
        renderActiveHealthSummary: () => "Slack Socket Mode connected for 1 bot(s).",
        describeStartupFailure: describeSlackStartupFailure,
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
        resolveMessageSurface: () => null,
        resolveMessageReplyTarget: () => null,
      },
      {
        id: "telegram",
        capabilities: {
          surfaceKinds: ["dm", "group", "topic"],
          messageActions: ["send"],
        },
        isEnabled: () => true,
        listBots: () => [{ botId: "default", config: {} }],
        createRuntimeService: () => ({
          start: async () => {
            throw new Error("telegram startup boom");
          },
          stop: async () => {
            stopCalls.push("telegram");
          },
        }),
        renderHealthSummary: (state) =>
          state === "starting"
            ? "Telegram channel is starting."
            : state === "disabled"
              ? "Telegram channel is disabled in config."
              : "Telegram channel is stopped.",
        renderActiveHealthSummary: () => "Telegram polling connected for 1 bot(s).",
        describeStartupFailure: describeTelegramStartupFailure,
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
        resolveMessageSurface: () => null,
        resolveMessageReplyTarget: () => null,
      },
    ];

    const supervisor = new RuntimeSupervisor(configPath, {
      loadConfig: async () => createLoadedConfigAt(configPath),
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

    await expect(supervisor.start()).rejects.toThrow("telegram startup boom");

    const document = await runtimeHealthStore.read();
    expect(document.channels.slack?.connection).toBe("stopped");
    expect(document.channels.slack?.summary).toBe("Slack channel is stopped.");
    expect(document.channels.telegram?.connection).toBe("failed");
    expect(document.channels.telegram?.summary).toBe("Telegram channel failed to start.");
    expect(stopCalls).toEqual(["slack", "telegram"]);
  });

  test("records runtime bot identity for active channel services", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));

    const plugins: ChannelPlugin[] = [
      {
        id: "slack",
        capabilities: {
          surfaceKinds: ["dm", "group"],
          messageActions: ["send"],
        },
        isEnabled: () => true,
        listBots: () => [{ botId: "default", config: {} }],
        createRuntimeService: () => ({
          start: async () => undefined,
          stop: async () => undefined,
          getRuntimeIdentity: () => ({
            botId: "default",
            label: "bot=@longluong2bot",
            appLabel: "app=A123",
            tokenHint: "deadbeef",
          }),
        }),
        renderHealthSummary: (state) =>
          state === "starting"
            ? "Slack channel is starting."
            : state === "disabled"
              ? "Slack channel is disabled in config."
              : "Slack channel is stopped.",
        renderActiveHealthSummary: () => "Slack Socket Mode connected for 1 bot(s).",
        describeStartupFailure: describeSlackStartupFailure,
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
        resolveMessageSurface: () => null,
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    const supervisor = new RuntimeSupervisor(undefined, {
      loadConfig: async () => createLoadedConfigAt(configPath),
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

    const document = await runtimeHealthStore.read();
    expect(document.channels.slack?.connection).toBe("active");
    expect(document.channels.slack?.instances).toEqual([
      {
        botId: "default",
        label: "bot=@longluong2bot",
        appLabel: "app=A123",
        tokenHint: "deadbeef",
      },
    ]);
  });

  test("records a failed channel when a started service reports post-start failure", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));
    let reportFailure!: (error?: unknown) => Promise<void>;

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
          reportFailure = async (error?: unknown) =>
            await context.reportLifecycle({
              connection: "failed",
              summary: "Telegram polling stopped because another instance is already using this bot token.",
              detail: error instanceof Error ? error.message : String(error ?? "conflict"),
              actions: ["stop the other poller"],
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
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
        resolveMessageSurface: () => null,
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    const supervisor = new RuntimeSupervisor(undefined, {
      loadConfig: async () => createLoadedConfigAt(configPath),
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
    await reportFailure(new Error("Conflict: terminated by other getUpdates request"));

    const document = await runtimeHealthStore.read();
    expect(document.channels.telegram?.connection).toBe("failed");
    expect(document.channels.telegram?.summary).toBe(
      "Telegram polling stopped because another instance is already using this bot token.",
    );
    expect(document.channels.telegram?.detail).toContain("bot=default");
    expect(document.channels.telegram?.detail).toContain("Conflict: terminated by other getUpdates request");
    expect(document.channels.telegram?.instances).toEqual([
      {
        botId: "default",
        label: "bot=@longluong2bot",
      },
    ]);
  });

  test("marks enabled channels as failed when the runtime hits a fatal error", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));

    const plugins: ChannelPlugin[] = [
      {
        id: "slack",
        capabilities: {
          surfaceKinds: ["dm", "group"],
          messageActions: ["send"],
        },
        isEnabled: () => true,
        listBots: () => [{ botId: "default", config: {} }],
        createRuntimeService: () => ({
          start: async () => undefined,
          stop: async () => undefined,
          getRuntimeIdentity: () => ({
            botId: "default",
            label: "bot=@longluong2bot",
          }),
        }),
        renderHealthSummary: (state) =>
          state === "starting"
            ? "Slack channel is starting."
            : state === "disabled"
              ? "Slack channel is disabled in config."
              : "Slack channel is stopped.",
        renderActiveHealthSummary: () => "Slack Socket Mode connected for 1 bot(s).",
        describeStartupFailure: describeSlackStartupFailure,
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
        resolveMessageSurface: () => null,
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    const supervisor = new RuntimeSupervisor(undefined, {
      loadConfig: async () => createLoadedConfigAt(configPath),
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
    await supervisor.markFatalFailure(new Error("fatal unhandledRejection: session cleanup failed"));

    const document = await runtimeHealthStore.read();
    expect(document.channels.slack?.connection).toBe("failed");
    expect(document.channels.slack?.summary).toBe("Runtime crashed due to a fatal error.");
    expect(document.channels.slack?.detail).toBe(
      "fatal unhandledRejection: session cleanup failed",
    );
    expect(document.channels.slack?.instances).toEqual([
      {
        botId: "default",
        label: "bot=@longluong2bot",
      },
    ]);
  });

  test("ignores stale lifecycle events from an older runtime after reload", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));
    const lifecycleReports: Array<(detail: string) => Promise<void>> = [];

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
          lifecycleReports.push(async (detail: string) =>
            await context.reportLifecycle({
              connection: "failed",
              summary: "Telegram polling stopped because another instance is already using this bot token.",
              detail,
            }));
          return {
            start: async () => undefined,
            stop: async () => undefined,
            getRuntimeIdentity: () => ({
              botId: "default",
              label: `bot=@longluong2bot-${lifecycleReports.length}`,
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
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
        resolveMessageSurface: () => null,
        resolveMessageReplyTarget: () => null,
      },
    ];

    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, "{}\n");

    const supervisor = new RuntimeSupervisor(undefined, {
      loadConfig: async () => createLoadedConfigAt(configPath),
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
    expect(lifecycleReports).toHaveLength(1);

    await (supervisor as any).reload("watch");
    expect(lifecycleReports).toHaveLength(2);

    const reloadedDocument = await runtimeHealthStore.read();
    expect(reloadedDocument.channels.telegram?.connection).toBe("active");

    await lifecycleReports[0]("stale runtime failure");

    const document = await runtimeHealthStore.read();
    expect(document.channels.telegram?.connection).toBe("active");
    expect(document.channels.telegram?.summary).toBe("Telegram polling connected for 1 bot(s).");
    expect(document.channels.telegram?.instances).toEqual([
      {
        botId: "default",
        label: "bot=@longluong2bot-2",
      },
    ]);
  }, { timeout: 15_000 });
});
