import { describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../../src/agents/agent-service.ts";
import { ClearedQueuedTaskError } from "../../src/agents/job-queue.ts";
import { createStoredIntervalLoop } from "../../src/agents/loop-control-shared.ts";
import { createStoredQueueItem } from "../../src/agents/queue-state.ts";
import { resolveAgentTarget } from "../../src/agents/resolved-target.ts";
import { loadConfig, resolveSessionStorePath } from "../../src/config/load-config.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "../../src/config/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/template.ts";
import { AgentSessionState } from "../../src/agents/session-state.ts";
import { SessionStore } from "../../src/agents/session-store.ts";
import { RunnerService } from "../../src/agents/runner-service.ts";
import { MID_RUN_RECOVERY_CONTINUE_PROMPT } from "../../src/agents/run-recovery.ts";
import type { TmuxClient } from "../../src/runners/tmux/client.ts";
import { recordSurfaceDirectoryIdentity } from "../../src/channels/surface-directory.ts";
import {
  type FakeSession,
  FakeTmuxClient,
  ROTATED_RUNNER_ID,
  RUNNER_GENERATED_ID,
  buildConfig,
  readSessionEntry,
  readSessionId,
} from "./agent-service-support.ts";

describe("AgentService trust and startup blockers", () => {
  test("starts normally when no startup continue prompt appears", async () => {
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
            runnerCommand: "codex",
            runnerArgs: ["-C", "{workspace}"],
            trustWorkspace: true,
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
        sessionKey: "agent:default:telegram:dm:no-startup-prompt",
      };

      const result = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      expect(result.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(fakeTmux.sessionCommands).toHaveLength(1);
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("retries the first prompt after restarting the runner with the stored session id", async () => {
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
      fakeTmux.dropPromptLiteralOnNextSession(3);
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:6a",
      };
      const updates: Array<{ note?: string; forceVisible?: boolean }> = [];

      const result = await service.enqueuePrompt(target, "ping", {
        onUpdate: (update) => {
          updates.push({
            note: update.note,
            forceVisible: update.forceVisible,
          });
        },
      }).result;

      const sessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof sessionId).toBe("string");
      expect(result.status).toBe("completed");
      expect(result.snapshot).toContain(`PONG ${sessionId ?? ""}`);
      expect(fakeTmux.sessionCommands).toHaveLength(2);
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${sessionId ?? ""}`);
      expect(updates.some((update) => update.forceVisible)).toBe(false);
      expect(updates.some((update) => update.note?.includes("fresh runner session"))).toBe(false);
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

  test("auto-confirms a Codex update prompt and relaunches after the runner exits during self-update", async () => {
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
      fakeTmux.setTrustPromptOnNextSessionCapture(0, "codex-update");
      fakeTmux.setNoServerAfterTrustDismissOnNextSession();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:C07U0LDK6ER:thread:update-notice",
      };

      const result = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      expect(result.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(fakeTmux.sessionCommands).toHaveLength(2);
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("survives a Codex update prompt followed by a trust prompt on the relaunched runner", async () => {
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
            runnerCommand: "codex",
            runnerArgs: ["-C", "{workspace}"],
            trustWorkspace: true,
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
      fakeTmux.queueStartupPromptScriptForNextSession([
        { captureCount: 0, variant: "codex-update" },
      ]);
      fakeTmux.setNoServerAfterTrustDismissOnNextSession();
      fakeTmux.queueStartupPromptScriptForNextSession([
        { captureCount: 0, variant: "codex" },
      ]);
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:C07U0LDK6ER:thread:update-then-trust",
      };

      const result = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      expect(result.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(fakeTmux.sessionCommands).toHaveLength(2);
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("recreates the runner session when tmux dies while dismissing a trust prompt", async () => {
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
                args: ["--resume", "{sessionId}", "--approval-mode=yolo", "--sandbox=false"],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      fakeTmux.setTrustPromptOnNextSessionCapture(0, "gemini");
      fakeTmux.setNoServerAfterTrustDismissOnNextSession();
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:dm:99",
      };

      const result = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      const storedSessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof storedSessionId).toBe("string");
      expect(result.snapshot).toContain(`PONG ${storedSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands).toHaveLength(2);
      expect(fakeTmux.sessionCommands[0]).toContain("--session-id");
      expect(fakeTmux.sessionCommands[1]).toContain(`--session-id ${storedSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[0]).not.toContain(`--session-id ${storedSessionId ?? ""}`);
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
      loaded.raw.agents.defaults.runner.codex.startupReadyPattern =
        "Type your message or @path/to/file";
      loaded.raw.agents.defaults.runner.codex.startupBlockers = [
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

      const runnerSessions = new RunnerService(
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
      loaded.raw.agents.defaults.runner.defaults.startupDelayMs = 50;
      loaded.raw.agents.defaults.runner.codex.startupDelayMs = 50;
      loaded.raw.agents.defaults.runner.codex.startupReadyPattern =
        "Type your message or @path/to/file";
      const tmux = new FakeTmuxClient();
      let newSessionCount = 0;
      const originalNewSession = tmux.newSession.bind(tmux);
      tmux.newSession = async (params) => {
        newSessionCount += 1;
        await originalNewSession(params);
        const session = (tmux as unknown as { sessions: Map<string, FakeSession> }).sessions.get(
          params.sessionName,
        );
        if (session) {
          session.snapshot = "Still booting...";
          session.cursorX = session.snapshot.length;
        }
      };

      const runnerSessions = new RunnerService(
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
      expect(newSessionCount).toBe(3);
      expect(await tmux.hasSession("default-main")).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("survives a slow ready banner after bounded startup retries", async () => {
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
            startupDelayMs: 20,
            startupRetryCount: 2,
            startupRetryDelayMs: 1,
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
      loaded.raw.agents.defaults.runner.codex.startupReadyPattern =
        "Type your message or @path/to/file";
      const tmux = new FakeTmuxClient();
      let newSessionCount = 0;
      const originalNewSession = tmux.newSession.bind(tmux);
      tmux.newSession = async (params) => {
        newSessionCount += 1;
        await originalNewSession(params);
        const session = (tmux as unknown as { sessions: Map<string, FakeSession> }).sessions.get(
          params.sessionName,
        );
        if (!session) {
          return;
        }
        session.snapshot =
          newSessionCount >= 3 ? "Type your message or @path/to/file" : "Still booting...";
        session.cursorX = session.snapshot.length;
      };

      const runnerSessions = new RunnerService(
        loaded,
        tmux as unknown as TmuxClient,
        new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded))),
        (target) => resolveAgentTarget(loaded, target),
      );

      const resolved = await runnerSessions.ensureSessionReady({
        agentId: "default",
        sessionKey: "main",
      });

      expect(resolved.sessionName).toMatch(/^main-[0-9a-f]{8}$/);
      expect(newSessionCount).toBe(3);
      expect(await tmux.hasSession(resolved.sessionName)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

});
