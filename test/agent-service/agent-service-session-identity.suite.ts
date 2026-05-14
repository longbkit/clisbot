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

describe("AgentService session identity continuity", () => {
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
            streamOverrides: {
              noOutputTimeoutMs: 10_000,
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

  test("new session command triggers the runner and stores the captured session id", async () => {
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
        sessionKey: "agent:default:slack:channel:c1:thread:new",
      };

      await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);

      const rotated = await service.triggerNewSession(target);

      expect(rotated.command).toBe("/new");
      expect(rotated.sessionId).toBe(ROTATED_RUNNER_ID);
      expect(readSessionId(storePath, target.sessionKey)).toBe(ROTATED_RUNNER_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("new session command retries capture without re-submitting the command", async () => {
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
        sessionKey: "agent:default:slack:channel:c1:thread:new-retry",
      };
      const sessionName = "agent-default-slack-channel-c1-thread-new-retry";

      await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      fakeTmux.ignoreNextEnter(sessionName);

      const rotated = await service.triggerNewSession(target);

      expect(rotated.command).toBe("/new");
      expect(rotated.sessionId).toBe(ROTATED_RUNNER_ID);
      expect(readSessionId(storePath, target.sessionKey)).toBe(ROTATED_RUNNER_ID);
      expect(fakeTmux.literalInputs.filter((entry) => entry.text === "/new")).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("new session command preserves the previous stored session id when rotation capture fails", async () => {
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
        sessionKey: "agent:default:slack:channel:c1:thread:new-preserve-on-failure",
      };

      const firstRun = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;
      fakeTmux.setStatusResponseMode(firstRun.sessionName, "no-session-id");

      const receivedError = await service.triggerNewSession(target).catch((error) => error);

      expect(receivedError).toBeInstanceOf(Error);
      expect((receivedError as Error).message).toBe(
        "/new completed, but clisbot could not confirm the rotated session id. The previous stored session id was preserved instead of being cleared automatically.",
      );
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("new session command uses clear for Gemini", async () => {
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
        sessionKey: "agent:default:slack:channel:c1:thread:gemini-new",
      };

      await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      const rotated = await service.triggerNewSession(target);

      expect(rotated.command).toBe("/clear");
      expect(rotated.sessionId).toBe(ROTATED_RUNNER_ID);
      expect(readSessionId(storePath, target.sessionKey)).toBe(ROTATED_RUNNER_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("session diagnostics prefer the live session id when it is newer than persistence", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));

    try {
      const socketPath = join(tempDir, "clisbot.sock");
      const configPath = join(tempDir, "clisbot.json");
      const storePath = join(tempDir, "sessions.json");
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c1:thread:diagnostics-runtime-first",
      };
      const storedSessionId = "33333333-3333-3333-3333-333333333333";
      const liveSessionId = "44444444-4444-4444-4444-444444444444";

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
      await Bun.write(
        storePath,
        JSON.stringify(
          {
            [target.sessionKey]: {
              agentId: target.agentId,
              sessionKey: target.sessionKey,
              sessionId: storedSessionId,
              workspacePath: join(tempDir, "default"),
              runnerCommand: "fake-cli",
              runtime: { state: "running" },
              updatedAt: Date.now(),
            },
          },
          null,
          2,
        ),
      );

      const loaded = await loadConfig(configPath);
      const service = new AgentService(loaded, {
        tmux: new FakeTmuxClient() as unknown as TmuxClient,
      });
      (service as any).activeRuns.getLiveSessionId = () => liveSessionId;

      const diagnostics = await service.getSessionDiagnostics(target);

      expect(diagnostics.sessionId).toBe(liveSessionId);
      expect(diagnostics.sessionIdPersistence).toBe("not-persisted-yet");
      expect(diagnostics.storedSessionId).toBe(storedSessionId);
      expect(diagnostics.resumeCommand).toContain(liveSessionId);
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
            streamOverrides: {
              noOutputTimeoutMs: 10_000,
            },
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
  }, { timeout: 12_000 });

});
