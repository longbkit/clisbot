import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCanonicalTelegramBotTokenPath } from "../src/config/channel-credentials.ts";

describe("fast start e2e", () => {
  let tempDir = "";

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("init persists a literal telegram token into the canonical credential file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-fast-start-e2e-"));
    const configPath = join(tempDir, "clisbot.json");

    const subprocess = Bun.spawn([
      "bun",
      "src/main.ts",
      "init",
      "--cli",
      "codex",
      "--bootstrap",
      "personal-assistant",
      "--telegram-bot-token",
      "123456:telegram-dev-token",
      "--persist",
    ], {
      cwd: "/home/node/projects/clisbot",
      env: {
        ...process.env,
        CLISBOT_HOME: tempDir,
        CLISBOT_CONFIG_PATH: configPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await subprocess.exited;
    const stderr = await new Response(subprocess.stderr).text();
    const stdout = await new Response(subprocess.stdout).text();

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.channels.telegram.enabled).toBe(true);
    expect(config.channels.telegram.accounts.default.credentialType).toBe("tokenFile");
    expect(config.channels.telegram.accounts.default.botToken ?? "").toBe("");
    expect(readFileSync(getCanonicalTelegramBotTokenPath("default", {
      ...process.env,
      CLISBOT_HOME: tempDir,
    }), "utf8").trim()).toBe("123456:telegram-dev-token");
    expect(stdout).toContain("Persisted telegram/default");
  });

  test("stop disables stale mem-backed accounts in config", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "clisbot-fast-start-e2e-"));
    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(configPath, `${JSON.stringify({
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
    }, null, 2)}\n`);

    const subprocess = Bun.spawn([
      "bun",
      "src/main.ts",
      "stop",
    ], {
      cwd: "/home/node/projects/clisbot",
      env: {
        ...process.env,
        CLISBOT_HOME: tempDir,
        CLISBOT_CONFIG_PATH: configPath,
        CLISBOT_PID_PATH: join(tempDir, "state", "clisbot.pid"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await subprocess.exited;
    const stderr = await new Response(subprocess.stderr).text();

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.channels.telegram.enabled).toBe(false);
    expect(config.channels.telegram.accounts.default.enabled).toBe(false);
  });
});
