import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getProcessLiveness,
  getRuntimeStatus,
  type ProcessLiveness,
  readRuntimeLog,
  readRuntimePid,
  stopDetachedRuntime,
} from "../src/control/runtime-process.ts";

const tempDirs: string[] = [];
const originalClisbotConfigPath = process.env.CLISBOT_CONFIG_PATH;
const originalClisbotHome = process.env.CLISBOT_HOME;
const originalClisbotPidPath = process.env.CLISBOT_PID_PATH;
const originalClisbotLogPath = process.env.CLISBOT_LOG_PATH;
const originalClisbotRuntimeMonitorStatePath = process.env.CLISBOT_RUNTIME_MONITOR_STATE_PATH;

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
  process.env.CLISBOT_CONFIG_PATH = originalClisbotConfigPath;
  process.env.CLISBOT_HOME = originalClisbotHome;
  process.env.CLISBOT_PID_PATH = originalClisbotPidPath;
  process.env.CLISBOT_LOG_PATH = originalClisbotLogPath;
  process.env.CLISBOT_RUNTIME_MONITOR_STATE_PATH = originalClisbotRuntimeMonitorStatePath;
});

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "clisbot-runtime-process-test-"));
  tempDirs.push(dir);
  return dir;
}

function createConfig() {
  return {
    meta: { schemaVersion: 1 },
    tmux: { socketPath: "~/.clisbot/state/clisbot.sock" },
    session: {
      mainKey: "main",
      dmScope: "per-channel-peer",
      identityLinks: {},
      storePath: "~/.clisbot/state/sessions.json",
    },
    agents: {
      defaults: {
        workspace: "~/.clisbot/workspaces/{agentId}",
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
              pattern: "x",
              timeoutMs: 1,
              pollIntervalMs: 1,
            },
            resume: { mode: "off", args: [] },
          },
        },
        stream: {
          captureLines: 1,
          updateIntervalMs: 1,
          idleTimeoutMs: 1,
          noOutputTimeoutMs: 1,
          maxRuntimeMin: 1,
          maxMessageChars: 100,
        },
        session: {
          createIfMissing: true,
          staleAfterMinutes: 60,
          name: "{sessionKey}",
        },
      },
      list: [],
    },
    bindings: [],
    control: {
      configReload: { watch: false, watchDebounceMs: 250 },
      sessionCleanup: { enabled: true, intervalMinutes: 5 },
      loop: { maxRunsPerLoop: 20, maxActiveLoops: 10 },
      runtimeMonitor: {
        restartBackoff: {
          fastRetry: {
            delaySeconds: 10,
            maxRestarts: 3,
          },
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
        enabled: false,
        mode: "socket",
        appToken: "",
        botToken: "",
        defaultAccount: "default",
        accounts: {},
        agentPrompt: { enabled: true, maxProgressMessages: 3, requireFinalResponse: true },
        ackReaction: "",
        typingReaction: "",
        processingStatus: { enabled: true, status: "Working...", loadingMessages: [] },
        allowBots: false,
        replyToMode: "thread",
        channelPolicy: "allowlist",
        groupPolicy: "allowlist",
        defaultAgentId: "default",
        commandPrefixes: { slash: ["::"], bash: ["!"] },
        streaming: "all",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
        followUp: { mode: "auto", participationTtlMin: 5 },
        channels: {},
        groups: {},
        directMessages: { enabled: true, policy: "pairing", allowFrom: [], requireMention: false },
      },
      telegram: {
        enabled: true,
        mode: "polling",
        botToken: "",
        defaultAccount: "default",
        accounts: {
          default: {
            enabled: true,
            credentialType: "mem",
            botToken: "",
          },
        },
        agentPrompt: { enabled: true, maxProgressMessages: 3, requireFinalResponse: true },
        allowBots: false,
        groupPolicy: "allowlist",
        defaultAgentId: "default",
        commandPrefixes: { slash: ["::"], bash: ["!"] },
        streaming: "all",
        response: "final",
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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
  };
}

describe("readRuntimeLog", () => {
  test("limits output to text written after the provided start offset", async () => {
    const dir = createTempDir();
    const logPath = join(dir, "clisbot.log");
    writeFileSync(logPath, "old stack line\nold stack line 2\n");
    const startOffset = Bun.file(logPath).size;
    writeFileSync(logPath, "fresh line 1\nfresh line 2\n", { flag: "a" });

    const result = await readRuntimeLog({
      logPath,
      startOffset,
      lines: 40,
    });

    expect(result.text).toBe("fresh line 1\nfresh line 2");
  });
});

describe("runtime path defaults", () => {
  test("uses CLISBOT_* env vars when explicit paths are omitted", async () => {
    const dir = createTempDir();
    const configPath = join(dir, "custom-config.json");
    const pidPath = join(dir, "custom.pid");
    const logPath = join(dir, "custom.log");

    writeFileSync(configPath, "{}\n");
    writeFileSync(pidPath, "12345\n");
    writeFileSync(logPath, "runtime log\n");

    process.env.CLISBOT_CONFIG_PATH = configPath;
    process.env.CLISBOT_PID_PATH = pidPath;
    process.env.CLISBOT_LOG_PATH = logPath;
    process.env.CLISBOT_RUNTIME_MONITOR_STATE_PATH = join(dir, "custom-monitor.json");

    expect(await readRuntimePid()).toBe(12345);

    const status = await getRuntimeStatus();
    expect(status.configPath).toBe(configPath);
    expect(status.pidPath).toBe(pidPath);
    expect(status.logPath).toBe(logPath);
    expect(status.monitorStatePath).toBe(join(dir, "custom-monitor.json"));
  });

  test("uses CLISBOT_HOME for default runtime paths", async () => {
    const dir = createTempDir();
    const clisbotHome = join(dir, ".clisbot-dev");
    const pidPath = join(clisbotHome, "state", "clisbot.pid");

    mkdirSync(join(clisbotHome, "state"), { recursive: true });
    writeFileSync(pidPath, "12345\n", { flag: "w" });
    delete process.env.CLISBOT_CONFIG_PATH;
    delete process.env.CLISBOT_PID_PATH;
    delete process.env.CLISBOT_LOG_PATH;
    process.env.CLISBOT_HOME = clisbotHome;

    expect(await readRuntimePid()).toBe(12345);

    const status = await getRuntimeStatus();
    expect(status.configPath).toBe(join(clisbotHome, "clisbot.json"));
    expect(status.pidPath).toBe(pidPath);
    expect(status.logPath).toBe(join(clisbotHome, "state", "clisbot.log"));
    expect(status.tmuxSocketPath).toBe(join(clisbotHome, "state", "clisbot.sock"));
  });
});

describe("runtime monitor state", () => {
  test("surfaces monitor backoff details through runtime status", async () => {
    const dir = createTempDir();
    const monitorStatePath = join(dir, "clisbot-monitor.json");
    writeFileSync(
      monitorStatePath,
      `${JSON.stringify({
        monitorPid: 12345,
        phase: "backoff",
        startedAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:01:00.000Z",
        restart: {
          mode: "backoff",
          stageIndex: 1,
          restartNumber: 5,
          restartAttemptInStage: 1,
          restartsRemaining: 3,
          nextRestartAt: "2026-04-15T00:15:00.000Z",
        },
        stopReason: "restart-budget-exhausted",
      }, null, 2)}\n`,
    );

    const status = await getRuntimeStatus({
      monitorStatePath,
      pidPath: join(dir, "missing.pid"),
      logPath: join(dir, "clisbot.log"),
      configPath: join(dir, "clisbot.json"),
    });

    expect(status.running).toBe(false);
    expect(status.serviceState).toBe("backoff");
    expect(status.restartNumber).toBe(5);
    expect(status.restartMode).toBe("backoff");
    expect(status.restartStageIndex).toBe(1);
    expect(status.nextRestartAt).toBe("2026-04-15T00:15:00.000Z");
    expect(status.stopReason).toBe("restart-budget-exhausted");
  });
});

describe("getProcessLiveness", () => {
  test("treats zombie processes as not running on posix", () => {
    const liveness = getProcessLiveness(12345, {
      platform: "linux",
      signalCheck: () => true,
      readLinuxProcStat: () => "zombie",
      readPsStat: () => "unknown",
    });

    expect(liveness).toBe("zombie");
  });

  test("falls back to ps state when linux proc state is unavailable", () => {
    const liveness = getProcessLiveness(12345, {
      platform: "darwin",
      signalCheck: () => true,
      readLinuxProcStat: () => "unknown",
      readPsStat: () => "running",
    });

    expect(liveness).toBe("running");
  });

  test("returns missing when the pid no longer exists", () => {
    const liveness = getProcessLiveness(12345, {
      platform: "linux",
      signalCheck: () => false,
      readLinuxProcStat: () => "running",
      readPsStat: () => "running",
    });

    expect(liveness).toBe("missing");
  });
});

describe("stopDetachedRuntime", () => {
  test("deactivates persisted mem accounts in config even when the runtime is already gone", async () => {
    const dir = createTempDir();
    const configPath = join(dir, "clisbot.json");
    writeFileSync(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`);

    await stopDetachedRuntime({
      configPath,
      pidPath: join(dir, "missing.pid"),
      runtimeCredentialsPath: join(dir, "state", "runtime-credentials.json"),
    });

    const updated = JSON.parse(await Bun.file(configPath).text());
    expect(updated.channels.telegram.enabled).toBe(false);
    expect(updated.channels.telegram.accounts.default.enabled).toBe(false);
  });

  test("treats a zombie pid as already stopped and still cleans up state", async () => {
    const dir = createTempDir();
    const configPath = join(dir, "clisbot.json");
    const pidPath = join(dir, "clisbot.pid");
    const runtimeCredentialsPath = join(dir, "state", "runtime-credentials.json");
    writeFileSync(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`);
    writeFileSync(pidPath, "424242\n");
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(runtimeCredentialsPath, "{\n  \"telegram\": \"token\"\n}\n");
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];

    const result = await stopDetachedRuntime(
      {
        configPath,
        pidPath,
        runtimeCredentialsPath,
      },
      {
        processLiveness: () => "zombie",
        sendSignal: ((pid: number, signal: NodeJS.Signals) => {
          signals.push({ pid, signal });
          return true;
        }) as typeof process.kill,
        sleep: async () => undefined,
      },
    );

    expect(result.stopped).toBe(true);
    expect(signals).toEqual([]);
    expect(await readRuntimePid(pidPath)).toBeNull();
    expect(existsSync(runtimeCredentialsPath)).toBe(false);
    const updated = JSON.parse(await Bun.file(configPath).text());
    expect(updated.channels.telegram.enabled).toBe(false);
    expect(updated.channels.telegram.accounts.default.enabled).toBe(false);
  });

  test("accepts a post-sigterm zombie transition as a clean stop", async () => {
    const dir = createTempDir();
    const configPath = join(dir, "clisbot.json");
    const pidPath = join(dir, "clisbot.pid");
    writeFileSync(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`);
    writeFileSync(pidPath, "424242\n");

    const livenessStates: ProcessLiveness[] = ["running", "zombie"];
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];

    const result = await stopDetachedRuntime(
      {
        configPath,
        pidPath,
        runtimeCredentialsPath: join(dir, "state", "runtime-credentials.json"),
      },
      {
        processLiveness: () => livenessStates.shift() ?? "zombie",
        sendSignal: ((pid: number, signal: NodeJS.Signals) => {
          signals.push({ pid, signal });
          return true;
        }) as typeof process.kill,
        sleep: async () => undefined,
      },
    );

    expect(result.stopped).toBe(true);
    expect(signals).toEqual([{ pid: 424242, signal: "SIGTERM" }]);
  });

  test("stops an orphaned runtime worker recorded in monitor state when the monitor pid is gone", async () => {
    const dir = createTempDir();
    const configPath = join(dir, "clisbot.json");
    const monitorStatePath = join(dir, "clisbot-monitor.json");
    writeFileSync(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`);
    writeFileSync(
      monitorStatePath,
      `${JSON.stringify({
        monitorPid: 424242,
        phase: "active",
        runtimePid: 434343,
        startedAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
      }, null, 2)}\n`,
    );
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let workerRunning = true;

    const result = await stopDetachedRuntime(
      {
        configPath,
        pidPath: join(dir, "missing.pid"),
        monitorStatePath,
        runtimeCredentialsPath: join(dir, "state", "runtime-credentials.json"),
      },
      {
        processLiveness: (pid) => {
          if (pid === 434343) {
            return workerRunning ? "running" : "missing";
          }
          return "missing";
        },
        sendSignal: ((pid: number, signal: NodeJS.Signals) => {
          signals.push({ pid, signal });
          if (pid === 434343 && signal === "SIGTERM") {
            workerRunning = false;
          }
          return true;
        }) as typeof process.kill,
        sleep: async () => undefined,
      },
    );

    expect(result.stopped).toBe(true);
    expect(signals).toEqual([{ pid: 434343, signal: "SIGTERM" }]);
  });
});
