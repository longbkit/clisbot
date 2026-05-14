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

describe("AgentService calendar loops and follow-up", () => {
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

    const deadline = Date.now() + 1_000;
    while (
      service.listIntervalLoops({ sessionKey: target.sessionKey }).length > 0 &&
      Date.now() < deadline
    ) {
      await Bun.sleep(20);
    }

    expect(service.listIntervalLoops({ sessionKey: target.sessionKey })).toHaveLength(0);
    await service.stop();
  });

  test("reconciles a loop persisted after runtime start", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-loop-reconcile-"));
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
      sessionKey: "agent:default:slack:channel:c4:thread:loop-reconcile",
    };

    await service.start();

    const resolved = resolveAgentTarget(loadedConfig, target);
    await state.setIntervalLoop(
      resolved,
      createStoredIntervalLoop({
        promptText: "check deploy",
        promptSummary: "check deploy",
        promptSource: "custom",
        intervalMs: 300,
        maxRuns: 3,
        createdBy: "U123",
        force: true,
      }),
    );

    const deadline = Date.now() + 2_000;
    let loop = service.listIntervalLoops({ sessionKey: target.sessionKey })[0];
    while (!loop && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      loop = service.listIntervalLoops({ sessionKey: target.sessionKey })[0];
    }

    expect(loop?.promptSummary).toBe("check deploy");

    while ((loop?.attemptedRuns ?? 0) === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      loop = service.listIntervalLoops({ sessionKey: target.sessionKey })[0];
    }

    expect(loop?.attemptedRuns ?? 0).toBeGreaterThan(0);
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
});
