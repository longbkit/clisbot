import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../src/config/load-config.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { RuntimeSupervisor } from "../src/control/runtime-supervisor.ts";
import { RuntimeHealthStore } from "../src/control/runtime-health-store.ts";
import {
  resetConfigReloadSuppressionForTests,
  suppressConfigReload,
} from "../src/control/config-reload-suppression.ts";
import type { ChannelPlugin } from "../src/channels/channel-plugin.ts";

function createLoadedConfig(): LoadedConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: true,
        telegramEnabled: true,
      }),
    ),
  );
  config.app.session.storePath = "/tmp/sessions.json";
  config.app.control.configReload.watch = false;
  config.agents.defaults.workspace = "/tmp/{agentId}";
  config.agents.defaults.runner.defaults.tmux.socketPath = "/tmp/clisbot.sock";
  config.agents.defaults.runner.defaults.startupDelayMs = 1;
  config.agents.defaults.runner.defaults.startupRetryCount = 2;
  config.agents.defaults.runner.defaults.startupRetryDelayMs = 0;
  config.agents.defaults.runner.defaults.promptSubmitDelayMs = 1;
  config.agents.defaults.runner.codex.sessionId = {
    create: { mode: "runner", args: [] },
    capture: {
      mode: "off",
      statusCommand: "/status",
      pattern: "id",
      timeoutMs: 1,
      pollIntervalMs: 1,
    },
    resume: { mode: "off", args: [] },
  };
  config.agents.defaults.runner.defaults.stream.captureLines = 10;
  config.agents.defaults.runner.defaults.stream.updateIntervalMs = 10;
  config.agents.defaults.runner.defaults.stream.idleTimeoutMs = 10;
  config.agents.defaults.runner.defaults.stream.noOutputTimeoutMs = 10;
  config.agents.defaults.runner.defaults.stream.maxRuntimeSec = 10;
  config.agents.defaults.runner.defaults.stream.maxRuntimeMin = undefined;
  config.agents.defaults.runner.defaults.stream.maxMessageChars = 100;
  config.agents.list = [{ id: "default" }];
  config.bots.defaults.dmScope = "per-channel-peer";
  config.bots.slack.defaults.enabled = true;
  config.bots.slack.default.enabled = true;
  config.bots.slack.default.appToken = "xapp";
  config.bots.slack.default.botToken = "xoxb";
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.default.enabled = true;
  config.bots.telegram.default.botToken = "telegram-token";

  return {
    configPath: "/tmp/clisbot.json",
    processedEventsPath: "/tmp/processed-events.json",
    stateDir: "/tmp/clisbot-state",
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

function createLoadedConfigAt(configPath: string): LoadedConfig {
  const loaded = createLoadedConfig();
  return {
    ...loaded,
    configPath,
  };
}

describe("RuntimeSupervisor", () => {
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
        markStartupFailure: (store, error) => store.markSlackFailure(error),
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
        resolveMessageReplyTarget: () => null,
      },
      {
        id: "telegram",
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
        markStartupFailure: (store, error) => store.markTelegramFailure(error),
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
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
        markStartupFailure: (store, error) => store.markSlackFailure(error),
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
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
        markStartupFailure: (store, error) => store.markTelegramFailure(error),
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
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
    await Bun.sleep(80);
    expect(sentMessages).toHaveLength(2);
    await Bun.sleep(80);
    expect(sentMessages).toHaveLength(2);
    await reportRecovery();
    await Bun.sleep(20);

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

  test("marks enabled channels as failed when the runtime hits a fatal error", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));

    const plugins: ChannelPlugin[] = [
      {
        id: "slack",
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
        markStartupFailure: (store, error) => store.markSlackFailure(error),
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
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
        markStartupFailure: (store, error) => store.markTelegramFailure(error),
        runMessageCommand: async () => ({ botId: "default", result: { ok: true } }),
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
  });
});
