import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  getProcessLiveness,
  getRuntimeStatus,
  type ProcessLiveness,
  readRuntimeLog,
  readRuntimePid,
  startDetachedRuntime,
  stopDetachedRuntime,
} from "../src/control/runtime-process.ts";
import { clisbotConfigSchema } from "../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

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
  const config = clisbotConfigSchema.parse(
    JSON.parse(
      renderDefaultConfigTemplate({
        slackEnabled: false,
        telegramEnabled: true,
      }),
    ),
  );
  config.bots.telegram.default = {
    ...config.bots.telegram.default,
    enabled: true,
    credentialType: "mem",
    botToken: "",
  };
  return config;
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

  test("prefers a live monitor pid from monitor state when the pid file is missing", async () => {
    const dir = createTempDir();
    const monitorStatePath = join(dir, "clisbot-monitor.json");
    writeFileSync(
      monitorStatePath,
      `${JSON.stringify({
        monitorPid: process.pid,
        phase: "active",
        startedAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:01:00.000Z",
      }, null, 2)}\n`,
    );

    const status = await getRuntimeStatus({
      monitorStatePath,
      pidPath: join(dir, "missing.pid"),
      logPath: join(dir, "clisbot.log"),
      configPath: join(dir, "clisbot.json"),
    });

    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);
    expect(status.serviceState).toBe("active");
  });
});

describe("startDetachedRuntime", () => {
  test("does not spawn a second monitor when monitor state already points to a live service", async () => {
    const dir = createTempDir();
    const configPath = join(dir, "clisbot.json");
    const pidPath = join(dir, "clisbot.pid");
    const monitorStatePath = join(dir, "clisbot-monitor.json");
    writeFileSync(configPath, "{}\n");
    writeFileSync(
      monitorStatePath,
      `${JSON.stringify({
        monitorPid: process.pid,
        phase: "active",
        startedAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:01:00.000Z",
      }, null, 2)}\n`,
    );

    const result = await startDetachedRuntime({
      scriptPath: join(dir, "should-not-run.js"),
      configPath,
      pidPath,
      monitorStatePath,
      logPath: join(dir, "clisbot.log"),
      runtimeCredentialsPath: join(dir, "runtime-credentials.json"),
    });

    expect(result.alreadyRunning).toBe(true);
    expect(result.pid).toBe(process.pid);
    expect(await readRuntimePid(pidPath)).toBe(process.pid);
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
  test("deactivates persisted mem bots in config even when the runtime is already gone", async () => {
    const dir = createTempDir();
    const configPath = join(dir, "clisbot.json");
    writeFileSync(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`);

    await stopDetachedRuntime({
      configPath,
      pidPath: join(dir, "missing.pid"),
      runtimeCredentialsPath: join(dir, "state", "runtime-credentials.json"),
    });

    const updated = JSON.parse(await Bun.file(configPath).text());
    expect(updated.bots.telegram.defaults.enabled).toBe(false);
    expect(updated.bots.telegram.default.enabled).toBe(false);
  });

  test("scopes stop cleanup to the explicit configPath instead of shell-level runtime env paths", async () => {
    const dir = createTempDir();
    const externalDir = createTempDir();
    const configPath = join(dir, "clisbot.json");
    const siblingRuntimeCredentialsPath = join(dir, "state", "runtime-credentials.json");
    const externalRuntimeCredentialsPath = join(
      externalDir,
      "state",
      "runtime-credentials.json",
    );
    const externalMonitorStatePath = join(externalDir, "state", "clisbot-monitor.json");

    writeFileSync(configPath, `${JSON.stringify(createConfig(), null, 2)}\n`);
    mkdirSync(dirname(siblingRuntimeCredentialsPath), { recursive: true });
    mkdirSync(dirname(externalRuntimeCredentialsPath), { recursive: true });
    writeFileSync(siblingRuntimeCredentialsPath, "{\n  \"telegram\": \"local\"\n}\n");
    writeFileSync(externalRuntimeCredentialsPath, "{\n  \"telegram\": \"external\"\n}\n");
    writeFileSync(
      externalMonitorStatePath,
      `${JSON.stringify({
        monitorPid: 424242,
        phase: "active",
        runtimePid: 434343,
        startedAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
      }, null, 2)}\n`,
    );

    process.env.CLISBOT_RUNTIME_MONITOR_STATE_PATH = externalMonitorStatePath;
    process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH = externalRuntimeCredentialsPath;

    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];

    const result = await stopDetachedRuntime(
      {
        configPath,
        pidPath: join(dir, "missing.pid"),
      },
      {
        processLiveness: () => "running",
        sendSignal: ((pid: number, signal: NodeJS.Signals) => {
          signals.push({ pid, signal });
          return true;
        }) as typeof process.kill,
        sleep: async () => undefined,
      },
    );

    expect(result.stopped).toBe(false);
    expect(signals).toEqual([]);
    expect(existsSync(siblingRuntimeCredentialsPath)).toBe(false);
    expect(existsSync(externalRuntimeCredentialsPath)).toBe(true);
    const updated = JSON.parse(await Bun.file(configPath).text());
    expect(updated.bots.telegram.defaults.enabled).toBe(false);
    expect(updated.bots.telegram.default.enabled).toBe(false);
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
    expect(updated.bots.telegram.defaults.enabled).toBe(false);
    expect(updated.bots.telegram.default.enabled).toBe(false);
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

  test("stops a live monitor recorded only in monitor state when the pid file is missing", async () => {
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
    let monitorRunning = true;

    const result = await stopDetachedRuntime(
      {
        configPath,
        pidPath: join(dir, "missing.pid"),
        monitorStatePath,
        runtimeCredentialsPath: join(dir, "state", "runtime-credentials.json"),
      },
      {
        processLiveness: (pid) => {
          if (pid === 424242) {
            return monitorRunning ? "running" : "missing";
          }
          return "missing";
        },
        sendSignal: ((pid: number, signal: NodeJS.Signals) => {
          signals.push({ pid, signal });
          if (pid === 424242 && signal === "SIGTERM") {
            monitorRunning = false;
          }
          return true;
        }) as typeof process.kill,
        sleep: async () => undefined,
      },
    );

    expect(result.stopped).toBe(true);
    expect(signals).toEqual([{ pid: 424242, signal: "SIGTERM" }]);
  });
});
