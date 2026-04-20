import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { LoadedConfig } from "../src/config/load-config.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import {
  getConfiguredRuntimeMonitorRestartBudget,
  getRuntimeMonitorRestartPlan,
  normalizeRuntimeMonitorRestartBackoff,
} from "../src/config/runtime-monitor-backoff.ts";
import { serveMonitor, type RuntimeMonitorState } from "../src/control/runtime-monitor.ts";
import type { ChannelPlugin } from "../src/channels/channel-plugin.ts";

function createLoadedConfig(): LoadedConfig {
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: false,
        telegramEnabled: true,
      }),
    ),
  );
  config.app.session.storePath = "/tmp/sessions.json";
  config.app.control.configReload.watch = false;
  config.app.control.runtimeMonitor.restartBackoff.fastRetry = {
    delaySeconds: 5,
    maxRestarts: 1,
  };
  config.app.control.runtimeMonitor.restartBackoff.stages = [{ delayMinutes: 1, maxRestarts: 1 }];
  config.app.auth.roles.owner.users = ["telegram:1276408333"];
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
  config.bots.defaults.dmScope = "main";
  config.bots.telegram.defaults.enabled = true;
  config.bots.telegram.defaults.defaultBotId = "alerts";
  config.bots.telegram.alerts = {
    ...config.bots.telegram.default,
    enabled: true,
    name: "alerts",
    botToken: "telegram-token",
  };
  delete config.bots.telegram.default;

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

describe("serveMonitor", () => {
  test("normalizes the legacy default restart backoff into the smoother ladder", () => {
    const normalized = normalizeRuntimeMonitorRestartBackoff({
      fastRetry: {
        delaySeconds: 10,
        maxRestarts: 3,
      },
      stages: [
        {
          delayMinutes: 15,
          maxRestarts: 4,
        },
        {
          delayMinutes: 30,
          maxRestarts: 4,
        },
      ],
    });

    expect(normalized.stages).toEqual([
      { delayMinutes: 1, maxRestarts: 2 },
      { delayMinutes: 3, maxRestarts: 2 },
      { delayMinutes: 5, maxRestarts: 2 },
      { delayMinutes: 10, maxRestarts: 3 },
      { delayMinutes: 15, maxRestarts: 4 },
      { delayMinutes: 30, maxRestarts: 4 },
    ]);
  });

  test("repeats the final stage instead of exhausting the configured restart budget", () => {
    const restartBackoff = {
      fastRetry: {
        delaySeconds: 5,
        maxRestarts: 1,
      },
      stages: [
        {
          delayMinutes: 1,
          maxRestarts: 1,
        },
      ],
    };

    const configuredBudget = getConfiguredRuntimeMonitorRestartBudget(restartBackoff);
    const repeatingPlan = getRuntimeMonitorRestartPlan(restartBackoff, configuredBudget + 1);

    expect(repeatingPlan).not.toBeNull();
    expect(repeatingPlan?.repeatingFinalStage).toBe(true);
    expect(repeatingPlan?.delayMs).toBe(60_000);
    expect(repeatingPlan?.restartsRemaining).toBe(0);
  });

  test("keeps restarting on the final stage instead of stopping after the configured ladder", async () => {
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
      listBots: () => [{ botId: "alerts", config: {} }],
      createRuntimeService: () => {
        throw new Error("not used");
      },
      renderHealthSummary: () => "unused",
      renderActiveHealthSummary: () => "unused",
      markStartupFailure: async () => undefined,
      runMessageCommand: async (_loadedConfig, command) => {
        sentMessages.push(command.message ?? "");
        return { botId: command.account ?? "alerts", result: { ok: true } };
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
          if (spawnCount >= 4) {
            queueMicrotask(() => {
              process.emit("SIGTERM");
              (child as unknown as EventEmitter).emit("exit", 0, "SIGTERM");
            });
          } else {
            queueMicrotask(() => {
              (child as unknown as EventEmitter).emit("exit", 1, null);
            });
          }
          return child;
        },
        sendSignal: (() => true) as typeof process.kill,
      },
    );

    expect(spawnCount).toBe(4);
    expect(states.some((state) => state.phase === "backoff")).toBe(true);
    expect(states.some((state) => state.restart?.mode === "fast-retry")).toBe(true);
    expect(states.some((state) => state.restart?.mode === "backoff")).toBe(true);
    expect(states.at(-1)?.phase).toBe("stopped");
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("entered restart backoff");
    expect(removed.pid).toBe(true);
    expect(removed.runtimeCredentials).toBe(true);
  });
});
