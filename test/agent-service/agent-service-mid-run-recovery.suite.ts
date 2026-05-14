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

describe("AgentService mid-run recovery", () => {
  test("interruptSession clears a detached active run and unblocks the next queued prompt", async () => {
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
              idleTimeoutMs: 100,
              noOutputTimeoutMs: 5000,
              maxRuntimeSec: 10,
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

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c11:thread:906.1006",
      };

      const first = await service.enqueuePrompt(target, "stream-forever", {
        onUpdate: () => undefined,
      }).result;
      expect(first.status).toBe("detached");

      const second = service.enqueuePrompt(target, "ping", {
        queueItem: createStoredQueueItem({
          promptText: "ping",
          promptSummary: "ping",
        }),
        onUpdate: () => undefined,
      });
      const queuedDeadline = Date.now() + 5_000;
      let queuedTexts = (await service.listQueuedPrompts(target)).map((item) => item.text);
      while (queuedTexts.length === 0 && Date.now() < queuedDeadline) {
        await Bun.sleep(25);
        queuedTexts = (await service.listQueuedPrompts(target)).map((item) => item.text);
      }
      expect(queuedTexts).toEqual(["ping"]);

      const stopped = await service.interruptSession(target);
      expect(stopped.interrupted).toBe(true);
      expect(readSessionEntry(storePath, target.sessionKey)?.runtime?.state).toBe("idle");
      expect(await service.listLiveSessionRuntimes()).toEqual([]);

      const secondResult = await Promise.race([
        second.result,
        Bun.sleep(20_000).then(() => {
          throw new Error("queued prompt stayed blocked after /stop");
        }),
      ]);
      expect(secondResult.status).toBe("completed");
      expect(secondResult.snapshot).toContain("PONG");
      expect(await service.listQueuedPrompts(target)).toEqual([]);
    } finally {
      await service?.stop().catch(() => undefined);
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  test("opens a fresh session when mid-prompt loss has no resumable context", async () => {
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
      service = new AgentService(loaded, {
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
        "The previous runner session could not be resumed. clisbot opened a new fresh session, but did not replay your prompt because the prior conversation context is no longer guaranteed. Please resend the full prompt/context to continue.",
      );
    } finally {
      await service?.stop().catch(() => undefined);
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  test("reopens the same conversation context and preserves resumed output after mid-prompt loss", async () => {
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
      fakeTmux.setResumeCaptureScript(RUNNER_GENERATED_ID, [
        `RESUME BOOT ${RUNNER_GENERATED_ID}`,
        `RESUME READY ${RUNNER_GENERATED_ID}`,
        `RESUME SYNC ${RUNNER_GENERATED_ID}`,
        `RESUMED ANSWER 1 ${RUNNER_GENERATED_ID}`,
        `RESUMED ANSWER ${RUNNER_GENERATED_ID}`,
      ]);
      const updates: Array<{ note?: string; forceVisible?: boolean; snapshot: string }> = [];
      const loaded = await loadConfig(configPath);
      service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:4",
      };

      const result = await service.enqueuePrompt(target, "recover-mid-run", {
        onUpdate: (update) => {
          updates.push({
            note: update.note,
            forceVisible: update.forceVisible,
            snapshot: update.snapshot,
          });
        },
      }).result;

      expect(["completed", "timeout", "detached"]).toContain(result.status);
      if (result.status === "detached") {
        expect(result.snapshot).toContain(`RESUME`);
      } else {
        expect(result.snapshot).toContain(`RESUMED ANSWER 1 ${RUNNER_GENERATED_ID}`);
      }
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${RUNNER_GENERATED_ID}`);
      expect(updates.some((update) => update.note?.includes("Attempting recovery 1/2"))).toBe(true);
      expect(
        updates.some((update) =>
          update.note?.includes("continue exactly where it left off"),
        ),
      ).toBe(true);
      expect(result.snapshot).toContain(`CONTINUE ${RUNNER_GENERATED_ID}`);
      if (result.status !== "detached") {
        expect(
          updates.some((update) =>
            update.snapshot.includes(`RESUMED ANSWER 1 ${RUNNER_GENERATED_ID}`),
          ),
        ).toBe(true);
      }
      expect(updates.filter((update) => update.forceVisible).length).toBeGreaterThanOrEqual(2);
    } finally {
      await service?.stop().catch(() => undefined);
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  test("reopens an explicit session id context after mid-prompt loss", async () => {
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
              maxRuntimeSec: 10,
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
      service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:4-explicit",
      };

      const result = await service.enqueuePrompt(target, "recover-mid-run", {
        onUpdate: () => undefined,
      }).result;

      const sessionId = readSessionId(storePath, target.sessionKey);
      expect(typeof sessionId).toBe("string");
      expect(result.snapshot).toContain(`CONTINUE ${sessionId ?? ""}`);
      expect(readSessionId(storePath, target.sessionKey)).toBe(sessionId);
      expect(fakeTmux.sessionCommands).toHaveLength(2);
      expect(fakeTmux.sessionCommands[0]).toContain(`--session-id ${sessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[1]).toContain(`--session-id ${sessionId ?? ""}`);
      expect(fakeTmux.sessionCommands[1]).not.toContain("resume");
    } finally {
      await service?.stop().catch(() => undefined);
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, { timeout: 12_000 });

  test("preserves stored session id when same-context recovery fails", async () => {
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
              maxRuntimeSec: 10,
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
      fakeTmux.markInvalidResumeSessionId(RUNNER_GENERATED_ID);
      const updates: Array<{ note?: string; forceVisible?: boolean }> = [];
      const loaded = await loadConfig(configPath);
      service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:4",
      };

      const receivedError = await service.enqueuePrompt(target, "recover-mid-run", {
        onUpdate: (update) => {
          updates.push({
            note: update.note,
            forceVisible: update.forceVisible,
          });
        },
      }).result.catch((error) => error);

      expect(receivedError).toBeInstanceOf(Error);
      expect((receivedError as Error).message).toBe(
        "The previous runner session could not be resumed. clisbot preserved the stored session id instead of opening a new conversation automatically. Use `/new` if you want to trigger a new runner conversation, then resend the prompt.",
      );
      expect(fakeTmux.sessionCommands[1]).toContain(`resume ${RUNNER_GENERATED_ID}`);
      expect(fakeTmux.sessionCommands).toHaveLength(2);
      expect(readSessionId(storePath, target.sessionKey)).toBe(RUNNER_GENERATED_ID);
      expect(
        updates.some((update) => update.note?.includes("stored session id was preserved")),
      ).toBe(true);
      expect(updates.filter((update) => update.forceVisible).length).toBeGreaterThanOrEqual(2);
    } finally {
      await service?.stop().catch(() => undefined);
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, { timeout: 12_000 });

  test("recovers when tmux reports duplicate session during concurrent startup", async () => {
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
            workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
            runnerCommand: "codex",
            runnerArgs: ["-C", "{workspace}"],
            streamOverrides: {
              maxRuntimeSec: 10,
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
      service = new AgentService(loadedConfig);
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
      await service?.stop().catch(() => undefined);
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, { timeout: 12_000 });

  test("ignores stale run callbacks after a new run has started for the same session key", async () => {
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

      const fakeTmux = new FakeTmuxClient();
      const loaded = await loadConfig(configPath);
      service = new AgentService(loaded, {
        tmux: fakeTmux as unknown as TmuxClient,
      });
      const target = {
        agentId: "default",
        sessionKey: "agent:default:slack:channel:c10:thread:905.1005",
      };

      const first = await service.enqueuePrompt(target, "stream-forever", {
        onUpdate: () => undefined,
      }).result;
      expect(first.status).toBe("detached");

      const sessionService = (service as any).activeRuns;
      const previousRun = sessionService.activeRuns.get(target.sessionKey);
      expect(previousRun?.runId).toBeDefined();

      await sessionService.failActiveRun(
        target.sessionKey,
        previousRun.runId,
        new Error("cleanup detached run"),
      );
      const resolved = resolveAgentTarget(loaded, target);
      await fakeTmux.killSession(resolved.sessionName);

      const second = {
        result: sessionService.executePrompt(target, "stream-forever", {
          id: "stale-callback-observer",
          mode: "live",
          onUpdate: () => undefined,
        }),
      };
      const deadline = Date.now() + 1_000;
      let currentRun = sessionService.activeRuns.get(target.sessionKey);
      while (
        (!currentRun || currentRun.runId === previousRun.runId) &&
        Date.now() < deadline
      ) {
        await Bun.sleep(20);
        currentRun = sessionService.activeRuns.get(target.sessionKey);
      }
      expect(currentRun?.runId).toBeDefined();
      expect(currentRun?.runId).not.toBe(previousRun.runId);

      await sessionService.failActiveRun(
        target.sessionKey,
        previousRun.runId,
        new Error("stale callback should be ignored"),
      );
      expect(sessionService.activeRuns.get(target.sessionKey)?.runId).toBe(currentRun?.runId);

      const result = await second.result;
      expect(result.status).toBe("detached");
    } finally {
      await service?.stop().catch(() => undefined);
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, { timeout: 20_000 });
});
