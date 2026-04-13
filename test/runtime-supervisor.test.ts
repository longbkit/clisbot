import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../src/config/load-config.ts";
import { RuntimeSupervisor } from "../src/control/runtime-supervisor.ts";
import { RuntimeHealthStore } from "../src/control/runtime-health-store.ts";
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
        dmScope: "main",
        identityLinks: {},
        storePath: "/tmp/sessions.json",
      },
      tmux: {
        socketPath: "/tmp/clisbot.sock",
      },
      agents: {
        defaults: {
          workspace: "/tmp/{agentId}",
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
          privilegeCommands: {
            enabled: false,
            allowUsers: [],
          },
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
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
          privilegeCommands: {
            enabled: false,
            allowUsers: [],
          },
          commandPrefixes: {
            slash: ["::", "\\"],
            bash: ["!"],
          },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
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
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("marks already-started channels as stopped when a later plugin fails during startup", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-runtime-supervisor-"));
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

    const supervisor = new RuntimeSupervisor(undefined, {
      loadConfig: async () => createLoadedConfig(),
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
});
