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

describe("AgentService startup capture retries", () => {
  test("does not spam status-command recapture immediately after a null session-id capture", async () => {
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
                timeoutMs: 5,
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
      fakeTmux.setStatusResponseModeOnNextSession("no-session-id");
      const runnerSessions = new RunnerService(
        loaded,
        fakeTmux as unknown as TmuxClient,
        (target) => resolveAgentTarget(loaded, target),
        new SessionMapping(new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded)))),
      );
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:dm:U123",
      };

      await runnerSessions.ensureSessionReady(target);
      await runnerSessions.ensureSessionReady(target);
      const transcript = await runnerSessions.captureTranscript(target);

      expect(transcript.snapshot.match(/STATUS pending/g)?.length ?? 0).toBe(3);
      expect(readSessionId(storePath, target.sessionKey)).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("captureTranscript does not create or refresh session state by itself", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-transcript-readonly-"));

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
                timeoutMs: 5,
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
      const runnerSessions = new RunnerService(
        loaded,
        fakeTmux as unknown as TmuxClient,
        (target) => resolveAgentTarget(loaded, target),
        new SessionMapping(new AgentSessionState(new SessionStore(resolveSessionStorePath(loaded)))),
      );
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:dm:U123",
      };
      const resolved = resolveAgentTarget(loaded, target);

      await fakeTmux.newSession({
        sessionName: resolved.sessionName,
        cwd: resolved.workspacePath,
        command: "fake-cli --session-id 33333333-3333-3333-3333-333333333333",
      });

      const transcript = await runnerSessions.captureTranscript(target);

      expect(transcript.snapshot).toContain("READY 33333333-3333-3333-3333-333333333333");
      expect(existsSync(storePath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("retries in one fresh session when startup status-command submit is not confirmed", async () => {
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

      const loaded = await loadConfig(configPath);
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c1:thread:startup-submit-retry",
      };
      const resolved = resolveAgentTarget(loaded, target);
      const fakeTmux = new FakeTmuxClient();
      fakeTmux.ignoreNextEnters(resolved.sessionName, 2);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });

      const run = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      expect(run.snapshot).toContain(`PONG ${RUNNER_GENERATED_ID}`);
      expect(run.snapshot).toContain(`STATUS session id: ${RUNNER_GENERATED_ID}`);
      expect(fakeTmux.sessionCommands).toHaveLength(2);
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("retries a fresh startup when the tmux window disappears during session creation", async () => {
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
            startupRetryCount: 2,
            startupRetryDelayMs: 1,
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
      let newSessionCount = 0;
      const originalNewSession = fakeTmux.newSession.bind(fakeTmux);
      fakeTmux.newSession = async (params) => {
        newSessionCount += 1;
        await originalNewSession(params);
        if (newSessionCount < 3) {
          await fakeTmux.killSession(params.sessionName);
          throw new Error(
            `tmux set-window-option -t ${params.sessionName}:main automatic-rename off failed with code 1: no such window: ${params.sessionName}:main`,
          );
        }
      };

      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c-window:thread:startup-window-loss",
      };

      const run = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      expect(run.snapshot).toContain("PONG");
      expect(newSessionCount).toBe(3);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("retries a fresh startup when pane state is temporarily unavailable during session-id capture", async () => {
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
            startupRetryCount: 2,
            startupRetryDelayMs: 1,
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
      fakeTmux.failNextPaneStateReads(2);
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c-pane:thread:startup-pane-state-loss",
      };

      const run = await service.enqueuePrompt(target, "ping", {
        onUpdate: () => undefined,
      }).result;

      expect(run.snapshot).toContain("PONG");
      expect(fakeTmux.sessionCommands.length).toBe(3);
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

});
