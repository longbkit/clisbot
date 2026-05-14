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

describe("AgentService detached runs and cleanup", () => {
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

  test("cleans stale sessions with one tmux session listing", async () => {
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
                  "session id:\\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
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
      const service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const staleAt = Date.now() - 2 * 60_000;
      const sessionKeys = [
        "agent:default:slack:channel:c4:thread:700.801",
        "agent:default:slack:channel:c4:thread:700.802",
        "agent:default:slack:channel:c4:thread:700.803",
      ];
      const liveTarget = { agentId: "default", sessionKey: sessionKeys[1]! };
      const liveResolved = resolveAgentTarget(loaded, liveTarget);
      await fakeTmux.newSession({
        sessionName: liveResolved.sessionName,
        cwd: tempDir,
        command: "codex -C .",
      });

      await Bun.write(
        storePath,
        JSON.stringify(
          Object.fromEntries(
            sessionKeys.map((sessionKey) => [
              sessionKey,
              {
                agentId: "default",
                sessionKey,
                sessionId: RUNNER_GENERATED_ID,
                workspacePath: join(tempDir, "workspaces", "default"),
                runnerCommand: "codex",
                runtime: { state: "idle" },
                updatedAt: staleAt,
              },
            ]),
          ),
          null,
          2,
        ),
      );

      await service.cleanupStaleSessions();

      expect(fakeTmux.listSessionsCalls).toBe(1);
      expect(fakeTmux.hasSessionCalls).toBe(0);
      expect(await fakeTmux.listSessions()).toEqual([]);
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
      expect(execution.note).toContain("/watch every <duration>");
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

  test("keeps a new prompt queued while a detached active run is still being monitored", async () => {
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

      let secondSettled = false;
      const second = service.enqueuePrompt(target, "ping", {
        queueItem: createStoredQueueItem({
          promptText: "ping",
          promptSummary: "ping",
        }),
        onUpdate: () => undefined,
      });
      void second.result.then(
        () => {
          secondSettled = true;
        },
        () => {
          secondSettled = true;
        },
      );

      await Bun.sleep(80);
      expect(secondSettled).toBe(false);
      expect((await service.listQueuedPrompts(target)).map((item) => item.text)).toEqual(["ping"]);

      const cleared = await service.clearQueuedPrompts(target);
      expect(cleared).toBe(1);

      const queuedError = await second.result.catch((error) => error);
      expect(queuedError).toBeInstanceOf(ClearedQueuedTaskError);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

});
