import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../src/config/load-config.ts";
import { RuntimeSupervisor } from "../src/control/runtime-supervisor.ts";
import { RuntimeHealthStore } from "../src/control/runtime-health-store.ts";
import {
  resetConfigReloadSuppressionForTests,
  suppressConfigReload,
} from "../src/control/config-reload-suppression.ts";
import type { ChannelPlugin } from "../src/channels/channel-plugin.ts";

function createLoadedConfig(): LoadedConfig {
  return {
    configPath: "/tmp/clisbot.json",
    processedEventsPath: "/tmp/processed-events.json",
    stateDir: "/tmp/clisbot-state",
    raw: {
      meta: {
        schemaVersion: 1,
      },
      session: {
        mainKey: "main",
        dmScope: "per-channel-peer",
        identityLinks: {},
        storePath: "/tmp/sessions.json",
      },
      app: {
        auth: {
          ownerClaimWindowMinutes: 30,
          defaultRole: "member",
          roles: {
            owner: { allow: ["configManage"], users: [] },
            admin: { allow: ["configManage"], users: [] },
            member: { allow: [], users: [] },
          },
        },
      },
      tmux: {
        socketPath: "/tmp/clisbot.sock",
      },
      agents: {
        defaults: {
          workspace: "/tmp/{agentId}",
          auth: {
            defaultRole: "member",
            roles: {
              admin: { allow: ["shellExecute"], users: [] },
              member: { allow: ["sendMessage"], users: [] },
            },
          },
          runner: {
            command: "codex",
            args: ["-C", "{workspace}"],
            trustWorkspace: true,
            startupDelayMs: 1,
            promptSubmitDelayMs: 1,
            sessionId: {
              create: { mode: "runner", args: [] },
              capture: {
                mode: "off",
                statusCommand: "/status",
                pattern: "id",
                timeoutMs: 1,
                pollIntervalMs: 1,
              },
              resume: { mode: "off", args: [] },
            },
          },
          stream: {
            captureLines: 10,
            updateIntervalMs: 10,
            idleTimeoutMs: 10,
            noOutputTimeoutMs: 10,
            maxRuntimeSec: 10,
            maxMessageChars: 100,
          },
          session: {
            createIfMissing: true,
            staleAfterMinutes: 60,
            name: "{sessionKey}",
          },
        },
        list: [{ id: "default" }],
      },
      bindings: [],
      control: {
        configReload: { watch: false, watchDebounceMs: 250 },
        sessionCleanup: { enabled: true, intervalMinutes: 5 },
        loop: { maxRunsPerLoop: 20, maxActiveLoops: 10 },
        runtimeMonitor: {
          restartBackoff: {
            fastRetry: { delaySeconds: 10, maxRestarts: 3 },
            stages: [
              { delayMinutes: 15, maxRestarts: 4 },
              { delayMinutes: 30, maxRestarts: 4 },
            ],
          },
          ownerAlerts: { enabled: true, minIntervalMinutes: 30 },
        },
      },
      channels: {
        slack: {
          defaultAccount: "default",
          accounts: {},
          enabled: true,
          mode: "socket",
          appToken: "xapp",
          botToken: "xoxb",
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
          ackReaction: "",
          typingReaction: "",
          processingStatus: {
            enabled: true,
            status: "Working...",
            loadingMessages: [],
          },
          allowBots: false,
          replyToMode: "thread",
          channelPolicy: "allowlist",
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          verbose: "minimal",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
          channels: {},
          groups: {},
          directMessages: {
            enabled: true,
            policy: "pairing",
            allowFrom: [],
            requireMention: false,
          },
        },
        telegram: {
          defaultAccount: "default",
          accounts: {},
          enabled: true,
          mode: "polling",
          botToken: "telegram-token",
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
          allowBots: false,
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          verbose: "minimal",
          followUp: {
            mode: "auto",
            participationTtlMin: 5,
          },
          polling: {
            timeoutSeconds: 20,
            retryDelayMs: 1000,
          },
          groups: {},
          directMessages: {
            enabled: true,
            policy: "pairing",
            allowFrom: [],
            requireMention: false,
            allowBots: false,
          },
        },
      },
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
        listAccounts: () => [{ accountId: "default", config: {} }],
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
        renderActiveHealthSummary: () => "Slack Socket Mode connected for 1 account(s).",
        markStartupFailure: (store, error) => store.markSlackFailure(error),
        runMessageCommand: async () => ({ accountId: "default", result: { ok: true } }),
        resolveMessageReplyTarget: () => null,
      },
      {
        id: "telegram",
        isEnabled: () => true,
        listAccounts: () => [{ accountId: "default", config: {} }],
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
        renderActiveHealthSummary: () => "Telegram polling connected for 1 account(s).",
        markStartupFailure: (store, error) => store.markTelegramFailure(error),
        runMessageCommand: async () => ({ accountId: "default", result: { ok: true } }),
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

  test("records runtime account identity for active channel services", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
    const runtimeHealthStore = new RuntimeHealthStore(join(tempDir, "runtime-health.json"));

    const plugins: ChannelPlugin[] = [
      {
        id: "slack",
        isEnabled: () => true,
        listAccounts: () => [{ accountId: "default", config: {} }],
        createRuntimeService: () => ({
          start: async () => undefined,
          stop: async () => undefined,
          getRuntimeIdentity: () => ({
            accountId: "default",
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
        renderActiveHealthSummary: () => "Slack Socket Mode connected for 1 account(s).",
        markStartupFailure: (store, error) => store.markSlackFailure(error),
        runMessageCommand: async () => ({ accountId: "default", result: { ok: true } }),
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
        accountId: "default",
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
        listAccounts: () => [{ accountId: "default", config: {} }],
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
              accountId: "default",
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
        renderActiveHealthSummary: () => "Telegram polling connected for 1 account(s).",
        markStartupFailure: (store, error) => store.markTelegramFailure(error),
        runMessageCommand: async () => ({ accountId: "default", result: { ok: true } }),
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
    expect(document.channels.telegram?.detail).toContain("account=default");
    expect(document.channels.telegram?.detail).toContain("Conflict: terminated by other getUpdates request");
    expect(document.channels.telegram?.instances).toEqual([
      {
        accountId: "default",
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
        isEnabled: () => true,
        listAccounts: () => [{ accountId: "default", config: {} }],
        createRuntimeService: () => ({
          start: async () => undefined,
          stop: async () => undefined,
          getRuntimeIdentity: () => ({
            accountId: "default",
            label: "bot=@longluong2bot",
          }),
        }),
        renderHealthSummary: (state) =>
          state === "starting"
            ? "Slack channel is starting."
            : state === "disabled"
              ? "Slack channel is disabled in config."
              : "Slack channel is stopped.",
        renderActiveHealthSummary: () => "Slack Socket Mode connected for 1 account(s).",
        markStartupFailure: (store, error) => store.markSlackFailure(error),
        runMessageCommand: async () => ({ accountId: "default", result: { ok: true } }),
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
        accountId: "default",
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
        listAccounts: () => [{ accountId: "default", config: {} }],
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
              accountId: "default",
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
        renderActiveHealthSummary: () => "Telegram polling connected for 1 account(s).",
        markStartupFailure: (store, error) => store.markTelegramFailure(error),
        runMessageCommand: async () => ({ accountId: "default", result: { ok: true } }),
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
    expect(document.channels.telegram?.summary).toBe("Telegram polling connected for 1 account(s).");
    expect(document.channels.telegram?.instances).toEqual([
      {
        accountId: "default",
        label: "bot=@longluong2bot-2",
      },
    ]);
  });
});
