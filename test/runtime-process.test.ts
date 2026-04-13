import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getRuntimeStatus,
  readRuntimeLog,
  readRuntimePid,
  stopDetachedRuntime,
} from "../src/control/runtime-process.ts";

const tempDirs: string[] = [];
const originalClisbotConfigPath = process.env.CLISBOT_CONFIG_PATH;
const originalClisbotHome = process.env.CLISBOT_HOME;
const originalClisbotPidPath = process.env.CLISBOT_PID_PATH;
const originalClisbotLogPath = process.env.CLISBOT_LOG_PATH;

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
  process.env.CLISBOT_CONFIG_PATH = originalClisbotConfigPath;
  process.env.CLISBOT_HOME = originalClisbotHome;
  process.env.CLISBOT_PID_PATH = originalClisbotPidPath;
  process.env.CLISBOT_LOG_PATH = originalClisbotLogPath;
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
      dmScope: "main",
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
        privilegeCommands: { enabled: false, allowUsers: [] },
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
        privilegeCommands: { enabled: false, allowUsers: [] },
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

    expect(await readRuntimePid()).toBe(12345);

    const status = await getRuntimeStatus();
    expect(status.configPath).toBe(configPath);
    expect(status.pidPath).toBe(pidPath);
    expect(status.logPath).toBe(logPath);
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
});
