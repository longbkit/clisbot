import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActiveRunInProgressError, AgentService } from "../src/agents/agent-service.ts";
import { resolveAgentTarget } from "../src/agents/resolved-target.ts";
import { loadConfig, resolveSessionStorePath } from "../src/config/load-config.ts";
import { AgentSessionState } from "../src/agents/session-state.ts";
import { SessionStore } from "../src/agents/session-store.ts";
import { RunnerSessionService } from "../src/agents/runner-session.ts";
import type { TmuxClient } from "../src/runners/tmux/client.ts";

const RUNNER_GENERATED_ID = "11111111-1111-1111-1111-111111111111";

type FakeSession = {
  command: string;
  pendingInput: string;
  sessionId: string;
  snapshot: string;
  cursorX: number;
  cursorY: number;
  historySize: number;
  longRunning: boolean;
  longRunningStep: number;
  trustPromptOnCapture?: number;
  trustPromptVariant?: "codex" | "claude" | "gemini";
  ignoreNextEnter?: boolean;
};

class FakeTmuxClient {
  readonly sessionCommands: string[] = [];
  private sessions = new Map<string, FakeSession>();
  private readonly invalidResumeSessionIds = new Set<string>();
  private readonly disappearingOnCaptureSessionIds = new Set<string>();
  private readonly noServerOnCaptureSessionIds = new Set<string>();
  private readonly duplicateOnNewSession = new Set<string>();
  private serverRunning = true;
  private nextTrustPromptCaptureCount: number | null = null;
  private nextTrustPromptVariant: "codex" | "claude" | "gemini" = "codex";
  private ignoreNextEnterSessionNames = new Set<string>();

  markInvalidResumeSessionId(sessionId: string) {
    this.invalidResumeSessionIds.add(sessionId);
  }

  markSessionIdDisappearOnCapture(sessionId: string) {
    this.disappearingOnCaptureSessionIds.add(sessionId);
  }

  markNoServerOnCapture(sessionId: string) {
    this.noServerOnCaptureSessionIds.add(sessionId);
  }

  markDuplicateOnNewSession(sessionName: string) {
    this.duplicateOnNewSession.add(sessionName);
  }

  setServerRunning(value: boolean) {
    this.serverRunning = value;
  }

  setTrustPromptOnNextSessionCapture(
    captureCount: number,
    variant: "codex" | "claude" | "gemini" = "codex",
  ) {
    this.nextTrustPromptCaptureCount = captureCount;
    this.nextTrustPromptVariant = variant;
  }

  ignoreNextEnter(sessionName: string) {
    this.ignoreNextEnterSessionNames.add(sessionName);
  }

  async isServerRunning() {
    return this.serverRunning;
  }

  async hasSession(sessionName: string) {
    if (!this.serverRunning) {
      return false;
    }
    return this.sessions.has(sessionName);
  }

  async newSession(params: {
    sessionName: string;
    cwd: string;
    command: string;
  }) {
    const sessionId = this.extractSessionId(params.command);
    this.sessionCommands.push(params.command);
    if (this.duplicateOnNewSession.has(params.sessionName)) {
      this.duplicateOnNewSession.delete(params.sessionName);
      this.sessions.set(params.sessionName, {
        command: params.command,
        pendingInput: "",
        sessionId,
        snapshot: `READY ${sessionId}`,
        cursorX: `READY ${sessionId}`.length,
        cursorY: 0,
        historySize: 0,
        longRunning: false,
        longRunningStep: 0,
        trustPromptOnCapture: this.nextTrustPromptCaptureCount ?? undefined,
        trustPromptVariant: this.nextTrustPromptVariant,
        ignoreNextEnter: this.ignoreNextEnterSessionNames.delete(params.sessionName),
      });
      this.nextTrustPromptCaptureCount = null;
      this.nextTrustPromptVariant = "codex";
      throw new Error(`duplicate session: ${params.sessionName}`);
    }
    if (
      params.command.includes("resume ") &&
      this.invalidResumeSessionIds.has(sessionId)
    ) {
      return;
    }
    this.sessions.set(params.sessionName, {
      command: params.command,
      pendingInput: "",
      sessionId,
      snapshot: `READY ${sessionId}`,
      cursorX: `READY ${sessionId}`.length,
      cursorY: 0,
      historySize: 0,
      longRunning: false,
      longRunningStep: 0,
      trustPromptOnCapture: this.nextTrustPromptCaptureCount ?? undefined,
      trustPromptVariant: this.nextTrustPromptVariant,
      ignoreNextEnter: this.ignoreNextEnterSessionNames.delete(params.sessionName),
    });
    this.nextTrustPromptCaptureCount = null;
    this.nextTrustPromptVariant = "codex";
    this.serverRunning = true;
  }

  async sendLiteral(sessionName: string, text: string) {
    const session = this.requireSession(sessionName);
    session.pendingInput = text;
    session.cursorX += text.length;
  }

  async sendKey(sessionName: string, key: string) {
    if (key !== "Enter") {
      return;
    }
    const session = this.requireSession(sessionName);
    if (
      session.snapshot.includes("Do you trust the contents of this directory?") ||
      session.snapshot.includes("Press enter to continue") ||
      session.snapshot.includes("Enter to confirm · Esc to cancel") ||
      session.snapshot.includes("Do you trust the files in this folder?") ||
      session.snapshot.includes("Trust folder (default)")
    ) {
      session.snapshot = `READY ${session.sessionId}`;
      session.cursorX = session.snapshot.length;
      session.cursorY = 0;
      return;
    }
    if (session.ignoreNextEnter) {
      session.ignoreNextEnter = false;
      return;
    }
    if (session.pendingInput === "/status") {
      session.snapshot = `${session.snapshot}\nSTATUS session id: ${session.sessionId}`;
    } else if (session.pendingInput === "crash") {
      session.snapshot = `${session.snapshot}\nCRASH`;
      this.sessions.delete(sessionName);
      return;
    } else if (session.pendingInput === "ping") {
      session.snapshot = `${session.snapshot}\nPONG ${session.sessionId}`;
    } else if (session.pendingInput === "stream-forever") {
      session.longRunning = true;
      session.longRunningStep = 0;
      session.snapshot = `${session.snapshot}\nSTEP 0 ${session.sessionId}`;
    } else if (session.pendingInput) {
      session.snapshot = `${session.snapshot}\nECHO ${session.pendingInput}`;
    }
    session.pendingInput = "";
    session.cursorX = 0;
    session.cursorY += 1;
    session.historySize += 1;
  }

  async capturePane(sessionName: string, _lines: number) {
    const session = this.requireSession(sessionName);
    if (this.disappearingOnCaptureSessionIds.has(session.sessionId)) {
      this.disappearingOnCaptureSessionIds.delete(session.sessionId);
      this.sessions.delete(sessionName);
      throw new Error(`can't find session: ${sessionName}`);
    }
    if (this.noServerOnCaptureSessionIds.has(session.sessionId)) {
      this.noServerOnCaptureSessionIds.delete(session.sessionId);
      this.sessions.clear();
      this.serverRunning = false;
      throw new Error("no server running on /tmp/clisbot.sock");
    }
    if (session.trustPromptOnCapture != null) {
      if (session.trustPromptOnCapture <= 0) {
      session.snapshot =
          session.trustPromptVariant === "claude"
            ? [
                "Quick safety check:",
                "❯ 1. Yes, I trust this folder",
                "  2. No, exit",
                "Enter to confirm · Esc to cancel",
              ].join("\n")
            : session.trustPromptVariant === "gemini"
              ? [
                  "Skipping project agents due to untrusted folder. To enable, ensure that the project root is trusted.",
                  "",
                  "Do you trust the files in this folder?",
                  "",
                  "Trusting a folder allows Gemini CLI to load its local configurations, including custom commands, hooks, MCP servers, agent skills, and settings. These configurations could execute code on your behalf or change the behavior of the CLI.",
                  "",
                  "1. Trust folder (default)",
                  "2. Trust parent folder (workspaces)",
                  "3. Don't trust",
                ].join("\n")
            : "Do you trust the contents of this directory?\nPress enter to continue";
        session.trustPromptOnCapture = undefined;
      } else {
        session.trustPromptOnCapture -= 1;
      }
    }
    if (session.longRunning) {
      session.longRunningStep += 1;
      session.snapshot = `${session.snapshot}\nSTEP ${session.longRunningStep} ${session.sessionId}`;
    }
    return session.snapshot;
  }

  async getPaneState(sessionName: string) {
    const session = this.requireSession(sessionName);
    return {
      cursorX: session.cursorX,
      cursorY: session.cursorY,
      historySize: session.historySize,
    };
  }

  async killSession(sessionName: string) {
    this.sessions.delete(sessionName);
    if (this.sessions.size === 0) {
      this.serverRunning = false;
    }
  }

  private extractSessionId(command: string) {
    const explicitMatch = command.match(
      /--session-id\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    if (explicitMatch?.[1]) {
      return explicitMatch[1];
    }

    const resumeMatch = command.match(
      /\bresume\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    if (resumeMatch?.[1]) {
      return resumeMatch[1];
    }

    const flagResumeMatch = command.match(
      /--resume\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    if (flagResumeMatch?.[1]) {
      return flagResumeMatch[1];
    }

    return RUNNER_GENERATED_ID;
  }

  private requireSession(sessionName: string) {
    const session = this.sessions.get(sessionName);
    if (!session) {
      throw new Error(`can't find session: ${sessionName}`);
    }
    return session;
  }
}

function readSessionId(storePath: string, sessionKey: string) {
  const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<
    string,
    { sessionId?: string }
  >;
  return store[sessionKey]?.sessionId ?? null;
}

function readSessionEntry(storePath: string, sessionKey: string) {
  const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<
    string,
    { sessionId?: string; runtime?: { state: string }; updatedAt: number }
  >;
  return store[sessionKey] ?? null;
}

function buildConfig(params: {
  socketPath: string;
  storePath: string;
  workspaceTemplate: string;
  runnerCommand: string;
  runnerArgs: string[];
  sessionId: object;
  trustWorkspace?: boolean;
  startupDelayMs?: number;
  startupReadyPattern?: string;
  staleAfterMinutes?: number;
  cleanupEnabled?: boolean;
  cleanupIntervalMinutes?: number;
  streamOverrides?: Partial<{
    captureLines: number;
    updateIntervalMs: number;
    idleTimeoutMs: number;
    noOutputTimeoutMs: number;
    maxRuntimeSec: number;
    maxMessageChars: number;
  }>;
}) {
  return {
    tmux: {
      socketPath: params.socketPath,
    },
    session: {
      mainKey: "main",
      dmScope: "main",
      identityLinks: {},
      storePath: params.storePath,
    },
    agents: {
      defaults: {
        workspace: params.workspaceTemplate,
        runner: {
          command: params.runnerCommand,
          args: params.runnerArgs,
          trustWorkspace: params.trustWorkspace ?? false,
          startupDelayMs: params.startupDelayMs ?? 1,
          promptSubmitDelayMs: 1,
          ...(params.startupReadyPattern
            ? { startupReadyPattern: params.startupReadyPattern }
            : {}),
          sessionId: params.sessionId,
        },
        stream: {
          captureLines: 80,
          updateIntervalMs: 1,
          idleTimeoutMs: 5,
          noOutputTimeoutMs: 100,
          maxRuntimeSec: 1,
          maxMessageChars: 2000,
          ...(params.streamOverrides ?? {}),
        },
        session: {
          createIfMissing: true,
          staleAfterMinutes: params.staleAfterMinutes ?? 60,
          name: "{sessionKey}",
        },
      },
      list: [{ id: "default" }],
    },
    control: {
      configReload: {
        watch: false,
        watchDebounceMs: 250,
      },
      sessionCleanup: {
        enabled: params.cleanupEnabled ?? true,
        intervalMinutes: params.cleanupIntervalMinutes ?? 5,
      },
    },
    channels: {
      slack: {
        enabled: false,
        mode: "socket",
        appToken: "app-token",
        botToken: "bot-token",
        ackReaction: ":heavy_check_mark:",
        typingReaction: "",
        processingStatus: {
          enabled: true,
          status: "Working...",
          loadingMessages: [],
        },
        channels: {},
        groups: {},
        directMessages: {
          enabled: true,
          requireMention: false,
          agentId: "default",
        },
      },
      telegram: {
        enabled: false,
        mode: "polling",
        botToken: "telegram-token",
        allowBots: false,
        groupPolicy: "allowlist",
        defaultAgentId: "default",
        commandPrefixes: {
          slash: ["::", "\\"],
          bash: ["!"],
        },
        streaming: "all",
        response: "final",
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
          requireMention: false,
          allowBots: false,
          agentId: "default",
        },
      },
    },
  };
}

describe("AgentService session identity", () => {
  test("captures runner-generated session id from status output and reuses it on resume", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c1:thread:100.200",
      };

      const firstRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      expect(firstRun.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(readSessionId(storePath, target.sessionKey)).toBe(
        RUNNER_GENERATED_ID,
      );
      expect(fakeTmux.sessionCommands[0]).toContain("export PATH=");
      expect(fakeTmux.sessionCommands[0]).toContain("export CLISBOT_BIN=");
      expect(fakeTmux.sessionCommands[0]).toContain("fake-cli -C");
      expect(fakeTmux.sessionCommands[0]).not.toContain("resume");

      await fakeTmux.killSession(firstRun.sessionName);

      const secondRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      expect(secondRun.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(readSessionId(storePath, target.sessionKey)).toBe(
        RUNNER_GENERATED_ID,
      );
      expect(fakeTmux.sessionCommands[1]).toContain(
        `resume ${RUNNER_GENERATED_ID}`,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("passes explicit session ids to the runner and reuses them after restart", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "explicit",
                args: ["--session-id", "{sessionId}"],
              },
              capture: {
                mode: "off",
                statusCommand: "/status",
                pattern: "[0-9a-fA-F-]{36}",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "off",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c2:thread:300.400",
      };

      const firstRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      const storedSessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof storedSessionId).toBe("string");
      expect(firstRun.snapshot).toContain(`PONG ${storedSessionId}`);
      expect(fakeTmux.sessionCommands[0]).toContain(
        `--session-id ${storedSessionId}`,
      );
      expect(fakeTmux.sessionCommands[0]).not.toContain("resume");

      await fakeTmux.killSession(firstRun.sessionName);

      const secondRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      expect(secondRun.snapshot).toContain(`PONG ${storedSessionId}`);
      expect(readSessionId(storePath, target.sessionKey)).toBe(storedSessionId);
      expect(fakeTmux.sessionCommands[1]).toContain(
        `--session-id ${storedSessionId}`,
      );
      expect(fakeTmux.sessionCommands[1]).not.toContain("resume");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("falls back to a fresh runner session when resume startup dies immediately", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "explicit",
                args: ["--session-id", "{sessionId}"],
              },
              capture: {
                mode: "off",
                statusCommand: "/status",
                pattern: "[0-9a-fA-F-]{36}",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:4",
      };

      const firstRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      const firstSessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof firstSessionId).toBe("string");
      expect(firstRun.snapshot).toContain(`PONG ${firstSessionId ?? ""}`);

      await fakeTmux.killSession(firstRun.sessionName);
      fakeTmux.markInvalidResumeSessionId(firstSessionId ?? "");

      const secondRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      const nextSessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof nextSessionId).toBe("string");
      expect(nextSessionId).not.toBe(firstSessionId);
      expect(secondRun.snapshot).toContain(`PONG ${nextSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${firstSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[2]).toContain(`--session-id ${nextSessionId ?? ""}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("falls back to a fresh runner session when the resumed runner disappears before prompt submission", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "explicit",
                args: ["--session-id", "{sessionId}"],
              },
              capture: {
                mode: "off",
                statusCommand: "/status",
                pattern: "[0-9a-fA-F-]{36}",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:5",
      };

      const firstRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      const firstSessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof firstSessionId).toBe("string");
      expect(firstRun.snapshot).toContain(`PONG ${firstSessionId ?? ""}`);

      await fakeTmux.killSession(firstRun.sessionName);
      fakeTmux.markSessionIdDisappearOnCapture(firstSessionId ?? "");

      const secondRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      const nextSessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof nextSessionId).toBe("string");
      expect(nextSessionId).not.toBe(firstSessionId);
      expect(secondRun.snapshot).toContain(`PONG ${nextSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${firstSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[2]).toContain(`--session-id ${nextSessionId ?? ""}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("falls back to a fresh runner session when tmux reports no server running before prompt submission", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "explicit",
                args: ["--session-id", "{sessionId}"],
              },
              capture: {
                mode: "off",
                statusCommand: "/status",
                pattern: "[0-9a-fA-F-]{36}",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:6",
      };

      const firstRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      const firstSessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof firstSessionId).toBe("string");
      expect(firstRun.snapshot).toContain(`PONG ${firstSessionId ?? ""}`);

      await fakeTmux.killSession(firstRun.sessionName);
      fakeTmux.markNoServerOnCapture(firstSessionId ?? "");

      const secondRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      const nextSessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof nextSessionId).toBe("string");
      expect(nextSessionId).not.toBe(firstSessionId);
      expect(secondRun.snapshot).toContain(`PONG ${nextSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${firstSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[2]).toContain(`--session-id ${nextSessionId ?? ""}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("waits for a delayed trust prompt on first startup", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:dm:42",
      };

      fakeTmux.setTrustPromptOnNextSessionCapture(1);

      const result = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      expect(result.snapshot).not.toContain("Do you trust the contents of this directory?");
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("waits for a delayed Claude trust prompt on first startup", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c123:thread:1",
      };

      fakeTmux.setTrustPromptOnNextSessionCapture(1, "claude");

      const result = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      expect(result.snapshot).not.toContain("Quick safety check:");
      expect(result.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("waits for a delayed Gemini trust prompt on first startup when readiness requires a ready banner", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "gemini",
            runnerArgs: ["--approval-mode=yolo", "--sandbox=false"],
            trustWorkspace: true,
            startupDelayMs: 100,
            startupReadyPattern: "READY",
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["--resume", "{sessionId}", "--approval-mode=yolo", "--sandbox=false"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:main",
      };

      fakeTmux.setTrustPromptOnNextSessionCapture(1, "gemini");

      const result = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      expect(result.snapshot).not.toContain("Do you trust the files in this folder?");
      expect(result.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("fails fast when a configured startup blocker appears before Gemini ready state", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: [],
            sessionId: {
              create: { mode: "runner", args: [] },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern: "\\b[0-9a-fA-F-]{36}\\b",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: { mode: "off", args: [] },
            },
          }),
        ),
      );
      const loaded = await loadConfig(configPath);
      loaded.raw.agents.defaults.runner.startupReadyPattern =
        "Type your message or @path/to/file";
      loaded.raw.agents.defaults.runner.startupBlockers = [
        {
          pattern: "Please visit the following URL to authorize the application",
          message: "Gemini auth required before clisbot can drive the session.",
        },
      ];
      const tmux = new FakeTmuxClient();
      await tmux.newSession({
        sessionName: "placeholder",
        cwd: tempDir,
        command: "fake-cli",
      });
      await tmux.killSession("placeholder");
      const originalNewSession = tmux.newSession.bind(tmux);
      tmux.newSession = async (params) => {
        await originalNewSession(params);
        const session = (tmux as unknown as { sessions: Map<string, FakeSession> }).sessions.get(
          params.sessionName,
        );
        if (session) {
          session.snapshot = "Please visit the following URL to authorize the application:";
          session.cursorX = session.snapshot.length;
        }
      };

      const runnerSessions = new RunnerSessionService(
        loaded,
        tmux as unknown as TmuxClient,
        new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded))),
        (target) => resolveAgentTarget(loaded, target),
      );

      await expect(
        runnerSessions.ensureSessionReady({
          agentId: "default",
          sessionKey: "main",
        }),
      ).rejects.toThrow(
        "Gemini auth required before clisbot can drive the session.",
      );
      expect(await tmux.hasSession("default-main")).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("fails truthfully when ready pattern never appears before startup deadline", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: [],
            sessionId: {
              create: { mode: "runner", args: [] },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern: "\\b[0-9a-fA-F-]{36}\\b",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: { mode: "off", args: [] },
            },
          }),
        ),
      );
      const loaded = await loadConfig(configPath);
      loaded.raw.agents.defaults.runner.startupDelayMs = 50;
      loaded.raw.agents.defaults.runner.startupReadyPattern = "Type your message or @path/to/file";
      const tmux = new FakeTmuxClient();
      const originalNewSession = tmux.newSession.bind(tmux);
      tmux.newSession = async (params) => {
        await originalNewSession(params);
        const session = (tmux as unknown as { sessions: Map<string, FakeSession> }).sessions.get(
          params.sessionName,
        );
        if (session) {
          session.snapshot = "Still booting...";
          session.cursorX = session.snapshot.length;
        }
      };

      const runnerSessions = new RunnerSessionService(
        loaded,
        tmux as unknown as TmuxClient,
        new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded))),
        (target) => resolveAgentTarget(loaded, target),
      );

      await expect(
        runnerSessions.ensureSessionReady({
          agentId: "default",
          sessionKey: "main",
        }),
      ).rejects.toThrow(
        "did not reach the configured ready state",
      );
      expect(await tmux.hasSession("default-main")).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("recovers when the tmux socket exists but the server is not running", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      fakeTmux.setServerRunning(false);
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001",
      };

      const result = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      expect(result.snapshot).toContain("PONG");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("persists and restores managed interval loops across service restart", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-loops-"));
    const storePath = join(tempDir, "sessions.json");
    const socketPath = join(tempDir, "clisbot.sock");
    const workspaceTemplate = join(tempDir, "workspaces", "{agentId}");
    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        buildConfig({
          socketPath,
          storePath,
          workspaceTemplate,
          runnerCommand: "codex",
        runnerArgs: ["-C", "{workspace}"],
        sessionId: {
          create: { mode: "runner", args: [] },
          capture: {
            mode: "status-command",
            statusCommand: "/status",
            pattern: RUNNER_GENERATED_ID,
            timeoutMs: 10,
            pollIntervalMs: 1,
          },
          resume: { mode: "command", args: ["resume", "{sessionId}"] },
        },
        cleanupEnabled: false,
        }),
        null,
        2,
      ),
    );
    const loadedConfig = await loadConfig(configPath);
    const tmux = new FakeTmuxClient() as unknown as TmuxClient;
    const firstService = new AgentService(loadedConfig, { tmux });
    const target = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c4:thread:loop-persist",
    };

    await firstService.createIntervalLoop({
      target,
      promptText: "check deploy",
      promptSummary: "check deploy",
      promptSource: "custom",
      intervalMs: 60_000,
      maxRuns: 3,
      createdBy: "U123",
      force: true,
    });

    expect(firstService.listIntervalLoops({ sessionKey: target.sessionKey })).toHaveLength(1);
    const persistedBeforeStop = readFileSync(storePath, "utf8");
    expect(persistedBeforeStop).toContain("\"intervalLoops\"");
    await firstService.stop();

    const secondService = new AgentService(loadedConfig, { tmux });
    await secondService.start();

    const restoredLoops = secondService.listIntervalLoops({ sessionKey: target.sessionKey });
    expect(restoredLoops).toHaveLength(1);
    expect(restoredLoops[0]?.promptSummary).toBe("check deploy");
    expect(restoredLoops[0]?.kind).not.toBe("calendar");
    if (restoredLoops[0]?.kind === "calendar") {
      throw new Error("expected interval loop");
    }
    expect(restoredLoops[0]?.intervalMs).toBe(60_000);

    const cancelled = await secondService.cancelIntervalLoopsForSession(target);
    expect(cancelled).toBe(1);
    expect(secondService.listIntervalLoops({ sessionKey: target.sessionKey })).toHaveLength(0);
    await secondService.stop();
  });

  test("persists and restores managed calendar loops across service restart", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-calendar-loops-"));
    const storePath = join(tempDir, "sessions.json");
    const socketPath = join(tempDir, "clisbot.sock");
    const workspaceTemplate = join(tempDir, "workspaces", "{agentId}");
    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        buildConfig({
          socketPath,
          storePath,
          workspaceTemplate,
          runnerCommand: "codex",
          runnerArgs: ["-C", "{workspace}"],
          sessionId: {
            create: { mode: "runner", args: [] },
            capture: {
              mode: "status-command",
              statusCommand: "/status",
              pattern: RUNNER_GENERATED_ID,
              timeoutMs: 10,
              pollIntervalMs: 1,
            },
            resume: { mode: "command", args: ["resume", "{sessionId}"] },
          },
          cleanupEnabled: false,
        }),
        null,
        2,
      ),
    );
    const loadedConfig = await loadConfig(configPath);
    const tmux = new FakeTmuxClient() as unknown as TmuxClient;
    const firstService = new AgentService(loadedConfig, { tmux });
    const target = {
      agentId: "default",
      sessionKey: "agent:default:telegram:topic:-1001:4",
    };

    await firstService.createCalendarLoop({
      target,
      promptText: "daily summary",
      promptSummary: "daily summary",
      promptSource: "custom",
      cadence: "weekday",
      localTime: "07:00",
      hour: 7,
      minute: 0,
      timezone: "Asia/Ho_Chi_Minh",
      maxRuns: 3,
      createdBy: "U123",
    });

    expect(firstService.listIntervalLoops({ sessionKey: target.sessionKey })).toHaveLength(1);
    const persistedBeforeStop = readFileSync(storePath, "utf8");
    expect(persistedBeforeStop).toContain("\"kind\": \"calendar\"");
    await firstService.stop();

    const secondService = new AgentService(loadedConfig, { tmux });
    await secondService.start();

    const restoredLoops = secondService.listIntervalLoops({ sessionKey: target.sessionKey });
    expect(restoredLoops).toHaveLength(1);
    expect(restoredLoops[0]?.kind).toBe("calendar");
    if (restoredLoops[0]?.kind !== "calendar") {
      throw new Error("expected calendar loop");
    }
    expect(restoredLoops[0].timezone).toBe("Asia/Ho_Chi_Minh");
    expect(restoredLoops[0].localTime).toBe("07:00");

    const cancelled = await secondService.cancelIntervalLoopsForSession(target);
    expect(cancelled).toBe(1);
    expect(secondService.listIntervalLoops({ sessionKey: target.sessionKey })).toHaveLength(0);
    await secondService.stop();
  });

  test("drops a persisted loop after operator state cancellation before the next tick", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-loop-cancel-"));
    const storePath = join(tempDir, "sessions.json");
    const socketPath = join(tempDir, "clisbot.sock");
    const workspaceTemplate = join(tempDir, "workspaces", "{agentId}");
    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        buildConfig({
          socketPath,
          storePath,
          workspaceTemplate,
          runnerCommand: "codex",
          runnerArgs: ["-C", "{workspace}"],
          sessionId: {
            create: { mode: "runner", args: [] },
            capture: {
              mode: "status-command",
              statusCommand: "/status",
              pattern: RUNNER_GENERATED_ID,
              timeoutMs: 10,
              pollIntervalMs: 1,
            },
            resume: { mode: "command", args: ["resume", "{sessionId}"] },
          },
          cleanupEnabled: false,
        }),
        null,
        2,
      ),
    );
    const loadedConfig = await loadConfig(configPath);
    const tmux = new FakeTmuxClient() as unknown as TmuxClient;
    const service = new AgentService(loadedConfig, { tmux });
    const state = new AgentSessionState(new SessionStore(storePath));
    const target = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c4:thread:loop-drop",
    };

    const created = await service.createIntervalLoop({
      target,
      promptText: "check deploy",
      promptSummary: "check deploy",
      promptSource: "custom",
      intervalMs: 20,
      maxRuns: 3,
      createdBy: "U123",
      force: true,
    });

    expect(created?.id).toBeTruthy();
    expect(service.listIntervalLoops({ sessionKey: target.sessionKey })).toHaveLength(1);

    await state.removeIntervalLoopById(created!.id);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(service.listIntervalLoops({ sessionKey: target.sessionKey })).toHaveLength(0);
    await service.stop();
  });

  test("does not rewrite a cancelled loop when a stale runtime update arrives later", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-loop-race-"));
    const storePath = join(tempDir, "sessions.json");
    const socketPath = join(tempDir, "clisbot.sock");
    const workspaceTemplate = join(tempDir, "workspaces", "{agentId}");
    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        buildConfig({
          socketPath,
          storePath,
          workspaceTemplate,
          runnerCommand: "codex",
          runnerArgs: ["-C", "{workspace}"],
          sessionId: {
            create: { mode: "runner", args: [] },
            capture: {
              mode: "status-command",
              statusCommand: "/status",
              pattern: RUNNER_GENERATED_ID,
              timeoutMs: 10,
              pollIntervalMs: 1,
            },
            resume: { mode: "command", args: ["resume", "{sessionId}"] },
          },
          cleanupEnabled: false,
        }),
        null,
        2,
      ),
    );
    const loadedConfig = await loadConfig(configPath);
    const resolved = resolveAgentTarget(loadedConfig, {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c4:thread:loop-race",
    });
    const state = new AgentSessionState(new SessionStore(storePath));
    const originalLoop = {
      id: "loop-race",
      intervalMs: 60_000,
      maxRuns: 3,
      attemptedRuns: 0,
      executedRuns: 0,
      skippedRuns: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nextRunAt: Date.now(),
      promptText: "check deploy",
      promptSummary: "check deploy",
      promptSource: "custom" as const,
      createdBy: "U123",
      force: true,
    };

    await state.setIntervalLoop(resolved, originalLoop);
    await state.removeIntervalLoopById(originalLoop.id);

    const replaced = await state.replaceIntervalLoopIfPresent(resolved, {
      ...originalLoop,
      attemptedRuns: 1,
      executedRuns: 1,
      updatedAt: Date.now(),
      nextRunAt: Date.now() + 60_000,
    });

    expect(replaced).toBe(false);
    expect(
      await state.listIntervalLoops({
        sessionKey: resolved.sessionKey,
      }),
    ).toHaveLength(0);
  });

  test("persists conversation follow-up overrides and bot participation timestamps", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "off",
                statusCommand: "/status",
                pattern: "[0-9a-fA-F-]{36}",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "off",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: new FakeTmuxClient() as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c3:thread:500.600",
      };

      await service.setConversationFollowUpMode(target, "mention-only");
      await service.recordConversationReply(target);
      const updated = await service.getConversationFollowUpState(target);
      expect(updated.overrideMode).toBe("mention-only");
      expect(typeof updated.lastBotReplyAt).toBe("number");

      await service.resetConversationFollowUpMode(target);
      const reset = await service.getConversationFollowUpState(target);
      expect(reset.overrideMode).toBeUndefined();
      expect(typeof reset.lastBotReplyAt).toBe("number");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("sunsets stale tmux sessions without discarding the stored session id", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            staleAfterMinutes: 1,
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c4:thread:700.800",
      };

      const firstRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      const firstSessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof firstSessionId).toBe("string");
      expect(firstRun.snapshot).toContain(`PONG ${firstSessionId ?? ""}`);
      expect(await fakeTmux.hasSession(firstRun.sessionName)).toBe(true);

      const staleEntry = readSessionEntry(storePath, target.sessionKey);
      expect(staleEntry?.sessionId).toBe(firstSessionId ?? undefined);
      await Bun.write(
        storePath,
        JSON.stringify(
          {
            [target.sessionKey]: {
              ...staleEntry,
              updatedAt: Date.now() - 2 * 60_000,
            },
          },
          null,
          2,
        ),
      );

      await service.cleanupStaleSessions();
      expect(await fakeTmux.hasSession(firstRun.sessionName)).toBe(false);
      expect(readSessionId(storePath, target.sessionKey)).toBe(firstSessionId);

      const secondRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      expect(typeof firstSessionId).toBe("string");
      expect(secondRun.snapshot).toContain(`PONG ${firstSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${firstSessionId ?? ""}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("detaches long-running prompts instead of timing them out and protects them from stale cleanup", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            staleAfterMinutes: 1,
            streamOverrides: {
              updateIntervalMs: 5,
              idleTimeoutMs: 5000,
              noOutputTimeoutMs: 5000,
              maxRuntimeSec: 1,
            },
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c5:thread:900.1000",
      };

      const execution = await service.enqueuePrompt(target, "stream-forever", {
        onUpdate: () => undefined,
      }).result;

      expect(execution.status).toBe("detached");
      expect(execution.snapshot).toContain("STEP");
      expect(execution.note).toContain("over 1 second");
      expect(execution.note).toContain("/attach");
      expect(execution.note).toContain("/watch every 30s");
      expect(await fakeTmux.hasSession(execution.sessionName)).toBe(true);

      const staleEntry = readSessionEntry(storePath, target.sessionKey);
      expect(staleEntry?.runtime?.state).toBe("detached");
      await Bun.write(
        storePath,
        JSON.stringify(
          {
            [target.sessionKey]: {
              ...staleEntry,
              updatedAt: Date.now() - 2 * 60_000,
            },
          },
          null,
          2,
        ),
      );

      await service.cleanupStaleSessions();
      expect(await fakeTmux.hasSession(execution.sessionName)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects a new prompt while a detached active run is still being monitored", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            streamOverrides: {
              updateIntervalMs: 5,
              idleTimeoutMs: 5000,
              noOutputTimeoutMs: 5000,
              maxRuntimeSec: 1,
            },
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c6:thread:901.1001",
      };

      const first = await service.enqueuePrompt(target, "stream-forever", {
        onUpdate: () => undefined,
      }).result;
      expect(first.status).toBe("detached");

      const second = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result.catch((error) => error);

      expect(second).toBeInstanceOf(ActiveRunInProgressError);
      expect((second as Error).message).toContain("/attach");
      expect((second as Error).message).toContain("/watch every 30s");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reconciles persisted detached runtime state on service start", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            streamOverrides: {
              updateIntervalMs: 5,
              idleTimeoutMs: 5000,
              noOutputTimeoutMs: 5000,
              maxRuntimeSec: 1,
            },
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const firstService = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c7:thread:902.1002",
      };

      const first = await firstService.enqueuePrompt(target, "stream-forever", {
        onUpdate: () => undefined,
      }).result;
      expect(first.status).toBe("detached");

      const recoveredService = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      await recoveredService.start();

      const observed = await recoveredService.observeRun(target, {
        id: "recovered-thread",
        mode: "live",
        onUpdate: () => undefined,
      });
      expect(observed.active).toBe(true);
      expect(observed.update.status).toBe("detached");

      const second = await recoveredService.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result.catch((error) => error);
      expect(second).toBeInstanceOf(ActiveRunInProgressError);
      await recoveredService.stop();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("clears persisted active run state on graceful stop", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            streamOverrides: {
              updateIntervalMs: 5,
              idleTimeoutMs: 5000,
              noOutputTimeoutMs: 5000,
              maxRuntimeSec: 1,
            },
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c8:thread:903.1003",
      };

      const first = await service.enqueuePrompt(target, "stream-forever", {
        onUpdate: () => undefined,
      }).result;
      expect(first.status).toBe("detached");
      expect(readSessionEntry(storePath, target.sessionKey)?.runtime?.state).toBe("detached");
      expect((await service.listActiveSessionRuntimes()).length).toBe(1);

      await service.stop();

      expect(readSessionEntry(storePath, target.sessionKey)?.runtime?.state).toBe("idle");
      expect(await service.listActiveSessionRuntimes()).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("surfaces a clean error when the tmux session disappears mid-prompt", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "off",
                statusCommand: "/status",
                pattern: "[0-9a-fA-F-]{36}",
                timeoutMs: 100,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "off",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: new FakeTmuxClient() as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:4",
      };

      const queued = service.enqueuePrompt(target, "crash", {
        onUpdate: () => undefined,
      });
      const receivedError = await queued.result.catch((error) => error);

      expect(receivedError).toBeInstanceOf(Error);
      expect((receivedError as Error).message).toBe(
        'Runner session "agent-default-telegram-group-1001-topic-4" disappeared while the prompt was running.',
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("recovers when tmux reports duplicate session during concurrent startup", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
            runnerCommand: "codex",
            runnerArgs: ["-C", "{workspace}"],
            sessionId: {
              create: {
                mode: "runner",
                args: [],
              },
              capture: {
                mode: "status-command",
                statusCommand: "/status",
                pattern:
                  "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
                timeoutMs: 1000,
                pollIntervalMs: 1,
              },
              resume: {
                mode: "command",
                args: ["resume", "{sessionId}", "-C", "{workspace}"],
              },
            },
          }),
        ),
      );

      const loadedConfig = await loadConfig(configPath);
      const service = new AgentService(loadedConfig);
      const fakeTmux = new FakeTmuxClient();
      const sessionKey = "agent:default:slack:channel:C0AQW4DUSDC:thread:1775651807.119499";
      const sessionName = "agent-default-slack-channel-c0aqw4dusdc-thread-1775651807-119499";
      fakeTmux.markDuplicateOnNewSession(sessionName);
      (service as any).tmux = fakeTmux as unknown as TmuxClient;

      const { result } = service.enqueuePrompt(
        {
          agentId: "default",
          sessionKey,
        },
        "ping",
        {
          onUpdate: () => undefined,
        },
      );
      const execution = await result;

      expect(execution.status).toBe("completed");
      expect(execution.snapshot).toContain("PONG");
      expect(readSessionId(storePath, sessionKey)).toBe(RUNNER_GENERATED_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
