import { describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../../src/agents/runtime/agent-service.ts";
import { ClearedQueuedTaskError } from "../../src/agents/queue/job-queue.ts";
import { createStoredIntervalLoop } from "../../src/agents/loops/loop-definition.ts";
import { createStoredQueueItem } from "../../src/agents/queue/queue-state.ts";
import { resolveAgentTarget } from "../../src/agents/routing/resolved-target.ts";
import { loadConfig, resolveSessionStorePath } from "../../src/config/core/load-config.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "../../src/config/core/schema.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import { AgentSessionState } from "../../src/agents/session/session-state.ts";
import { SessionMapping } from "../../src/agents/session/session-mapping.ts";
import { SessionStore } from "../../src/agents/session/session-store.ts";
import { RunnerService } from "../../src/agents/runtime/runner-service.ts";
import { MID_RUN_RECOVERY_CONTINUE_PROMPT } from "../../src/agents/session/run-recovery.ts";
import type { TmuxClient } from "../../src/runners/tmux/client.ts";
import { recordSurfaceDirectoryIdentity } from "../../src/channels/surface/surface-directory.ts";
import {
  FakeTmuxClient,
  ROTATED_RUNNER_ID,
  RUNNER_GENERATED_ID,
  buildConfig,
  readSessionEntry,
  readSessionId,
} from "./agent-service-support.ts";

describe("AgentService reuse and resume", () => {
  test("preserves the stored session id instead of falling back fresh after stale resume startup failure", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c2:thread:preserve-session-id",
      };
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
            runnerArgs: ["-C", "{workspace}"],
            startupDelayMs: 50,
            startupRetryCount: 1,
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
      const staleResumeSessionId = "33333333-3333-3333-3333-333333333333";
      await Bun.write(
        storePath,
        JSON.stringify(
          {
            [target.sessionKey]: {
              agentId: target.agentId,
              sessionKey: target.sessionKey,
              sessionId: staleResumeSessionId,
              workspacePath: join(tempDir, "default"),
              runnerCommand: "fake-cli",
              runtime: { state: "idle" },
              updatedAt: Date.now(),
            },
          },
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      fakeTmux.markInvalidResumeSessionId(staleResumeSessionId);
      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });

      const receivedError = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result.catch((error) => error);

      expect(receivedError).toBeInstanceOf(Error);
      expect((receivedError as Error).message).toBe(
        "The previous runner session could not be resumed. clisbot preserved the stored session id instead of opening a new conversation automatically. Use `/new` if you want to trigger a new runner conversation, then resend the prompt.",
      );
      expect(readSessionId(storePath, target.sessionKey)).toBe(staleResumeSessionId);
      expect(fakeTmux.sessionCommands[0]).toContain(`resume ${staleResumeSessionId}`);
      expect(fakeTmux.sessionCommands).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reuses an existing tmux session without forcing another server-defaults preflight", async () => {
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
                args: [],
              },
            },
          }),
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c3:thread:500.600",
      };
      const resolved = resolveAgentTarget(loaded, target);
      await fakeTmux.newSession({
        sessionName: resolved.sessionName,
        cwd: resolved.workspacePath,
        command: "fake-cli -C /tmp",
      });

      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });

      const run = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      expect(run.snapshot).toContain("PONG");
      expect(fakeTmux.serverDefaultsEnsured).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("accepts the workspace trust prompt before submitting a user prompt into a reused tmux session", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:trust-reuse",
      };
      await Bun.write(
        configPath,
        JSON.stringify(
          buildConfig({
            socketPath,
            storePath,
            workspaceTemplate: join(tempDir, "{agentId}"),
            runnerCommand: "fake-cli",
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
      await Bun.write(
        storePath,
        JSON.stringify(
          {
            [target.sessionKey]: {
              agentId: target.agentId,
              sessionKey: target.sessionKey,
              sessionId: RUNNER_GENERATED_ID,
              workspacePath: join(tempDir, "default"),
              runnerCommand: "fake-cli",
              updatedAt: Date.now(),
            },
          },
          null,
          2,
        ),
      );

      const fakeTmux = new FakeTmuxClient();
      fakeTmux.setTrustPromptOnNextSessionCapture(0);
      const loaded = await loadConfig(configPath);
      const resolved = resolveAgentTarget(loaded, target);
      await fakeTmux.newSession({
        sessionName: resolved.sessionName,
        cwd: resolved.workspacePath,
        command: "fake-cli -C /tmp",
      });

      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const run = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      expect(run.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(fakeTmux.literalInputs.filter((input) => input.text === "/status")).toHaveLength(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("captures a missing stored session id before reusing an existing tmux session", async () => {
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
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:4335",
      };
      const resolved = resolveAgentTarget(loaded, target);
      await fakeTmux.newSession({
        sessionName: resolved.sessionName,
        cwd: resolved.workspacePath,
        command: "fake-cli -C /tmp",
      });

      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });

      const run = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      expect(run.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(run.snapshot).toContain(`STATUS session id: ${RUNNER_GENERATED_ID}`);
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
      expect(fakeTmux.sessionCommands).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("retries missing stored session id capture during fresh startup", async () => {
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

      const loaded = await loadConfig(configPath);
      const fakeTmux = new FakeTmuxClient();
      fakeTmux.setStatusResponseModeOnNextSession("first-miss-then-session-id");
      const runnerSessions = new RunnerService(
        loaded,
        fakeTmux as unknown as TmuxClient,
        (target) => resolveAgentTarget(loaded, target),
        new SessionMapping(new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded)))),
      );
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:2963",
      };

      await runnerSessions.ensureSessionReady(target);
      const transcript = await runnerSessions.captureTranscript(target);

      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
      expect(transcript.snapshot).toContain("STATUS pending");
      expect(transcript.snapshot).toContain(`STATUS session id: ${RUNNER_GENERATED_ID}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("preserves stored session id when resume startup dies immediately", async () => {
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

      const error = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result.catch((caught) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(readSessionId(storePath, target.sessionKey)).toBe(firstSessionId);
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${firstSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands.every((command) =>
        command.includes(`resume ${firstSessionId ?? ""}`) ||
        command.includes(`--session-id ${firstSessionId ?? ""}`),
      )).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("retries resume without rotating when the resumed runner disappears before prompt submission", async () => {
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
      expect(nextSessionId).toBe(firstSessionId);
      expect(secondRun.snapshot).toContain(`PONG ${nextSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${firstSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[2]).toContain(`resume ${firstSessionId ?? ""}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("retries resume without rotating session id when tmux reports no server before prompt submission", async () => {
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
      expect(nextSessionId).toBe(firstSessionId);
      expect(secondRun.snapshot).toContain(`PONG ${nextSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${firstSessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[2]).toContain(`resume ${firstSessionId ?? ""}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

});
