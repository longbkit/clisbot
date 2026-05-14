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

describe("AgentService runtime reconciliation", () => {
  test("keeps queued prompts pending behind a detached run until the session is truly idle", async () => {
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
        sessionKey: "agent:default:slack:channel:c9:thread:904.1004",
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

      let secondSettled = false;
      const second = recoveredService.enqueuePrompt(target, "ping", {
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
      expect((await recoveredService.listQueuedPrompts(target)).map((item) => item.text)).toEqual(["ping"]);

      const cleared = await recoveredService.clearQueuedPrompts(target);
      expect(cleared).toBe(1);
      const queuedError = await second.result.catch((error) => error);
      expect(queuedError).toBeInstanceOf(ClearedQueuedTaskError);
      await recoveredService.stop();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("service start reports only rehydrated live runs and resets stale running queued items", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-"));
    let service: AgentService | undefined;

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

      const loaded = await loadConfig(configPath);
      const liveTarget = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:live:thread:1",
      };
      const staleTarget = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:stale:thread:2",
      };
      const liveResolved = resolveAgentTarget(loaded, liveTarget);
      const staleResolved = resolveAgentTarget(loaded, staleTarget);
      const fakeTmux = new FakeTmuxClient();
      await fakeTmux.newSession({
        sessionName: liveResolved.sessionName,
        cwd: liveResolved.workspacePath,
        command: "fake-cli -C /tmp",
      });
      await fakeTmux.sendLiteral(liveResolved.sessionName, "stream-forever");
      await fakeTmux.sendKey(liveResolved.sessionName, "Enter");

      writeFileSync(
        storePath,
        JSON.stringify(
          {
            [liveTarget.sessionKey]: {
              agentId: liveTarget.agentId,
              sessionKey: liveTarget.sessionKey,
              workspacePath: liveResolved.workspacePath,
              runnerCommand: "fake-cli",
              runtime: {
                state: "running",
                startedAt: 111,
              },
              updatedAt: Date.now(),
            },
            [staleTarget.sessionKey]: {
              agentId: staleTarget.agentId,
              sessionKey: staleTarget.sessionKey,
              workspacePath: staleResolved.workspacePath,
              runnerCommand: "fake-cli",
              runtime: {
                state: "running",
                startedAt: 222,
              },
              queues: [
                {
                  ...createStoredQueueItem({
                    promptText: "stale queued prompt",
                    promptSummary: "stale queued prompt",
                  }),
                  id: "stale-running",
                  status: "running" as const,
                  startedAt: 222,
                },
              ],
              updatedAt: Date.now(),
            },
          },
          null,
          2,
        ),
      );

      service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      (service as any).managedQueues.reconcilePersistedQueueItems = mock(async () => undefined);
      await service.start();

      const liveRuns = await service.listLiveSessionRuntimes();
      expect(liveRuns).toHaveLength(1);
      expect(liveRuns[0]?.sessionKey).toBe(liveTarget.sessionKey);
      expect(["running", "detached"]).toContain(liveRuns[0]?.state);

      const staleEntry = readSessionEntry(storePath, staleTarget.sessionKey);
      expect(staleEntry?.runtime?.state).toBe("idle");
      expect(staleEntry?.queues?.[0]?.status).toBe("pending");

      await service.stop();
    } finally {
      await service?.stop().catch(() => undefined);
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
      expect((await service.listLiveSessionRuntimes()).length).toBe(1);

      await service.stop();

      expect(readSessionEntry(storePath, target.sessionKey)?.runtime?.state).toBe("idle");
      expect(await service.listLiveSessionRuntimes()).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

});
