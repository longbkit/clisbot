import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { LoadedConfig } from "../src/config/load-config.ts";
import { serveMonitor, type RuntimeMonitorState } from "../src/control/runtime-monitor.ts";
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
      app: {
        auth: {
          ownerClaimWindowMinutes: 30,
          defaultRole: "member",
          roles: {
            owner: { allow: ["configManage"], users: ["telegram:1276408333"] },
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
            startupRetryCount: 2,
            startupRetryDelayMs: 0,
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
            fastRetry: {
              delaySeconds: 5,
              maxRestarts: 1,
            },
            stages: [{ delayMinutes: 1, maxRestarts: 1 }],
          },
          ownerAlerts: {
            enabled: true,
            minIntervalMinutes: 30,
          },
        },
      },
      channels: {
        slack: {
          enabled: false,
          mode: "socket",
          appToken: "",
          botToken: "",
          defaultAccount: "default",
          accounts: {},
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
          commandPrefixes: { slash: ["::"], bash: ["!"] },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          verbose: "minimal",
          followUp: { mode: "auto", participationTtlMin: 5 },
          channels: {},
          groups: {},
          directMessages: { enabled: true, policy: "pairing", allowFrom: [], requireMention: false },
        },
        telegram: {
          enabled: true,
          mode: "polling",
          botToken: "",
          defaultAccount: "alerts",
          accounts: {
            alerts: {
              botToken: "telegram-token",
            },
          },
          agentPrompt: {
            enabled: true,
            maxProgressMessages: 3,
            requireFinalResponse: true,
          },
          allowBots: false,
          groupPolicy: "allowlist",
          defaultAgentId: "default",
          commandPrefixes: { slash: ["::"], bash: ["!"] },
          streaming: "off",
          response: "final",
          responseMode: "message-tool",
          additionalMessageMode: "steer",
          verbose: "minimal",
          followUp: { mode: "auto", participationTtlMin: 5 },
          polling: { timeoutSeconds: 20, retryDelayMs: 1000 },
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

describe("serveMonitor", () => {
  test("restarts with backoff and alerts owners before exhausting the configured budget", async () => {
    const states: RuntimeMonitorState[] = [];
    const sentMessages: string[] = [];
    let now = Date.parse("2026-04-15T00:00:00.000Z");
    const removed = {
      pid: false,
      runtimeCredentials: false,
    };
    let spawnCount = 0;

    const plugin: ChannelPlugin = {
      id: "telegram",
      isEnabled: () => true,
      listAccounts: () => [{ accountId: "alerts", config: {} }],
      createRuntimeService: () => {
        throw new Error("not used");
      },
      renderHealthSummary: () => "unused",
      renderActiveHealthSummary: () => "unused",
      markStartupFailure: async () => undefined,
      runMessageCommand: async (_loadedConfig, command) => {
        sentMessages.push(command.message ?? "");
        return { accountId: command.account ?? "alerts", result: { ok: true } };
      },
      resolveMessageReplyTarget: () => null,
    };

    await serveMonitor(
      {
        scriptPath: "/tmp/clisbot.js",
        configPath: "/tmp/clisbot.json",
        pidPath: "/tmp/clisbot-monitor.pid",
        statePath: "/tmp/clisbot-monitor-state.json",
        runtimeCredentialsPath: "/tmp/clisbot-runtime-credentials.json",
      },
      {
        loadConfig: async () => createLoadedConfig(),
        listChannelPlugins: () => [plugin],
        writePid: async () => undefined,
        readState: async () => null,
        writeState: async (_statePath, state) => {
          states.push(state);
        },
        removePid: () => {
          removed.pid = true;
        },
        removeRuntimeCredentials: () => {
          removed.runtimeCredentials = true;
        },
        sleep: async (ms) => {
          now += ms;
        },
        now: () => now,
        spawnChild: () => {
          spawnCount += 1;
          const child = new EventEmitter() as unknown as ChildProcess;
          (child as { pid?: number }).pid = 999000 + spawnCount;
          queueMicrotask(() => {
            (child as unknown as EventEmitter).emit("exit", 1, null);
          });
          return child;
        },
        sendSignal: (() => true) as typeof process.kill,
      },
    );

    expect(spawnCount).toBe(3);
    expect(states.some((state) => state.phase === "backoff")).toBe(true);
    expect(states.some((state) => state.restart?.mode === "fast-retry")).toBe(true);
    expect(states.some((state) => state.restart?.mode === "backoff")).toBe(true);
    expect(states.at(-1)?.phase).toBe("stopped");
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toContain("entered restart backoff");
    expect(sentMessages[1]).toContain("stopped after exhausting the configured restart budget");
    expect(removed.pid).toBe(true);
    expect(removed.runtimeCredentials).toBe(true);
  });
});
