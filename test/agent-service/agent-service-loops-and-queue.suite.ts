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

describe("AgentService loops and queue", () => {
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
    expect(persistedBeforeStop).toContain("\"loops\"");
    expect(persistedBeforeStop).not.toContain("\"intervalLoops\"");
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

  test("managed loop execution rebuilds prompt instructions from current streaming-off route policy", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-loop-policy-"));
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
    loadedConfig.raw.bots.slack.defaults.agentPrompt.enabled = true;
    loadedConfig.raw.bots.slack.default.groups.c4 = {
      enabled: true,
      requireMention: true,
      allowBots: false,
      allowUsers: [],
      blockUsers: [],
      responseMode: "message-tool",
      streaming: "off",
    };

    const tmux = new FakeTmuxClient() as unknown as TmuxClient;
    const service = new AgentService(loadedConfig, { tmux });
    const target = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c4:thread:loop-policy",
    };
    await recordSurfaceDirectoryIdentity({
      stateDir: loadedConfig.stateDir,
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
        senderName: "Alice Smith",
        senderHandle: "alice",
        channelId: "c4",
        channelName: "release-ops",
        threadTs: "loop-policy",
      },
    });

    await service.createIntervalLoop({
      target,
      promptText: "check deploy",
      promptSummary: "check deploy",
      promptSource: "custom",
      surfaceBinding: {
        platform: "slack",
        conversationKind: "channel",
        channelId: "c4",
        threadTs: "loop-policy",
      },
      intervalMs: 60_000,
      maxRuns: 1,
      createdBy: "U123",
      force: true,
    });

    let transcript = await service.captureTranscript(target);
    for (let attempt = 0; attempt < 10 && !transcript.snapshot.includes("check deploy"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      transcript = await service.captureTranscript(target);
    }

    expect(transcript.snapshot).toContain("check deploy");
    expect(transcript.snapshot).toContain("- sender: Alice Smith [slack:U123, @alice]");
    expect(transcript.snapshot).toContain(
      '- surface: Slack channel "release-ops", thread loop-policy [slack:channel:c4:thread:loop-policy]',
    );
    expect(transcript.snapshot).toContain("- message: scheduled loop ");
    expect(transcript.snapshot).toContain("To send a user-visible progress update or final reply, use the following CLI command:");
    expect(transcript.snapshot).toContain("use that command to send progress updates and the final reply back to the conversation");
    expect(transcript.snapshot).not.toContain("legacy wrapped prompt with progress instructions");
    expect(transcript.snapshot).toContain(
      "send at most 3 short, meaningful progress updates; skip trivial internal steps",
    );

    await service.stop();
  });

  test("managed loop execution lets a stored loop progress override disable progress instructions", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-loop-progress-"));
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
    loadedConfig.raw.bots.slack.defaults.agentPrompt.enabled = true;
    loadedConfig.raw.bots.slack.default.groups.c4 = {
      enabled: true,
      requireMention: true,
      allowBots: false,
      allowUsers: [],
      blockUsers: [],
      responseMode: "message-tool",
      streaming: "off",
    };

    const tmux = new FakeTmuxClient() as unknown as TmuxClient;
    const service = new AgentService(loadedConfig, { tmux });
    const target = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c4:thread:loop-progress",
    };
    await recordSurfaceDirectoryIdentity({
      stateDir: loadedConfig.stateDir,
      identity: {
        platform: "slack",
        conversationKind: "channel",
        senderId: "U123",
        senderName: "Alice Smith",
        senderHandle: "alice",
        channelId: "c4",
        channelName: "release-ops",
        threadTs: "loop-progress",
      },
    });

    await service.createIntervalLoop({
      target,
      promptText: "check deploy",
      promptSummary: "check deploy",
      promptSource: "custom",
      surfaceBinding: {
        platform: "slack",
        conversationKind: "channel",
        channelId: "c4",
        threadTs: "loop-progress",
      },
      intervalMs: 60_000,
      maxRuns: 1,
      createdBy: "U123",
      force: true,
      progressMessages: 0,
    });

    let transcript = await service.captureTranscript(target);
    for (let attempt = 0; attempt < 10 && !transcript.snapshot.includes("check deploy"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      transcript = await service.captureTranscript(target);
    }

    expect(transcript.snapshot).toContain("check deploy");
    expect(transcript.snapshot).toContain("To send a user-visible final reply, use the following CLI command:");
    expect(transcript.snapshot).toContain("  --final \\");
    expect(transcript.snapshot).not.toContain("--final|progress");
    expect(transcript.snapshot).not.toContain("use that command to send progress updates and the final reply back to the conversation");
    expect(transcript.snapshot).not.toContain(
      "send at most 3 short, meaningful progress updates; skip trivial internal steps",
    );

    await service.stop();
  });

  test("managed interval loops post loop-start notifications for scheduled ticks", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-loop-notify-"));
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
    loadedConfig.raw.bots.slack.default.responseMode = "capture-pane";
    loadedConfig.raw.bots.slack.default.groups["channel:c4"] = {
      enabled: true,
      requireMention: true,
      allowBots: false,
      allowUsers: [],
      blockUsers: [],
      surfaceNotifications: {
        queueStart: "brief",
        loopStart: "brief",
      },
    };

    const tmux = new FakeTmuxClient() as unknown as TmuxClient;
    const service = new AgentService(loadedConfig, { tmux });
    const notifications: string[] = [];
    service.registerSurfaceNotificationHandler({
      platform: "slack",
      botId: "default",
      handler: async ({ text }) => {
        notifications.push(text);
      },
    });
    const target = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c4:thread:loop-notify",
    };

    await service.createIntervalLoop({
      target,
      promptText: "check deploy",
      promptSummary: "check deploy",
      promptSource: "custom",
      surfaceBinding: {
        platform: "slack",
        accountId: "default",
        conversationKind: "channel",
        channelId: "c4",
        threadTs: "loop-notify",
      },
      intervalMs: 300,
      maxRuns: 3,
      createdBy: "U123",
      force: true,
    });

    const deadline = Date.now() + 2_000;
    while (notifications.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0]).toContain("Loop `");
    expect(notifications[0]).toContain("`check deploy`");
    expect(notifications[0]).toContain("remaining `");

    await service.stop();
  });

  test("managed interval loops can override loop-start notifications per loop", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-loop-notify-"));
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
    loadedConfig.raw.bots.slack.default.responseMode = "capture-pane";
    loadedConfig.raw.bots.slack.default.groups["channel:c4"] = {
      enabled: true,
      requireMention: true,
      allowBots: false,
      allowUsers: [],
      blockUsers: [],
      surfaceNotifications: {
        queueStart: "brief",
        loopStart: "brief",
      },
    };

    const tmux = new FakeTmuxClient() as unknown as TmuxClient;
    const service = new AgentService(loadedConfig, { tmux });
    const notifications: string[] = [];
    service.registerSurfaceNotificationHandler({
      platform: "slack",
      botId: "default",
      handler: async ({ text }) => {
        notifications.push(text);
      },
    });
    const target = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c4:thread:loop-notify-override",
    };

    await service.createIntervalLoop({
      target,
      promptText: "check deploy",
      promptSummary: "check deploy",
      promptSource: "custom",
      loopStart: "none",
      surfaceBinding: {
        platform: "slack",
        accountId: "default",
        conversationKind: "channel",
        channelId: "c4",
        threadTs: "loop-notify-override",
      },
      intervalMs: 300,
      maxRuns: 2,
      createdBy: "U123",
      force: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(notifications).toEqual([]);
    await service.stop();
  });

  test("persisted queue items post surface start and capture-pane settlement notifications", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-queue-notify-"));
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
    loadedConfig.raw.bots.slack.default.groups["channel:c4"] = {
      enabled: true,
      requireMention: true,
      allowBots: false,
      allowUsers: [],
      blockUsers: [],
      responseMode: "capture-pane",
      surfaceNotifications: {
        queueStart: "brief",
        loopStart: "brief",
      },
    };

    const target = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c4:thread:queue-notify",
    };
    const state = new AgentSessionState(new SessionStore(storePath));
    await state.setQueuedItem(
      resolveAgentTarget(loadedConfig, target),
      createStoredQueueItem({
        promptText: "ping",
        promptSummary: "ping",
        createdBy: "U123",
        sender: {
          providerId: "U123",
        },
        surfaceBinding: {
          platform: "slack",
          accountId: "default",
          conversationKind: "channel",
          channelId: "c4",
          threadTs: "queue-notify",
        },
      }),
    );

    const tmux = new FakeTmuxClient() as unknown as TmuxClient;
    const service = new AgentService(loadedConfig, { tmux });
    const notifications: string[] = [];
    service.registerSurfaceNotificationHandler({
      platform: "slack",
      botId: "default",
      handler: async ({ text }) => {
        notifications.push(text);
      },
    });

    try {
      await service.start();
      const deadline = Date.now() + 5_000;
      while (notifications.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(notifications[0]).toContain("Queued message is now running");
      expect(notifications[0]).toContain("`ping`");
      expect(notifications.length).toBeGreaterThanOrEqual(2);
      expect(notifications.at(-1)).toContain("ping");
      expect(await service.listQueuedPrompts(target)).toEqual([]);
    } finally {
      await service.stop();
    }
  });

  test("does not let a new prompt jump ahead of an earlier persisted queue item", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-agent-service-queue-order-"));
    const storePath = join(tempDir, "sessions.json");
    const socketPath = join(tempDir, "clisbot.sock");
    const configPath = join(tempDir, "clisbot.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        buildConfig({
          socketPath,
          storePath,
          workspaceTemplate: join(tempDir, "workspaces", "{agentId}"),
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
    const target = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c4:thread:queue-order",
    };
    const state = new AgentSessionState(new SessionStore(storePath));
    await state.setQueuedItem(
      resolveAgentTarget(loadedConfig, target),
      createStoredQueueItem({
        promptText: "old persisted prompt",
        promptSummary: "old persisted prompt",
      }),
    );

    const service = new AgentService(loadedConfig, {
      tmux: new FakeTmuxClient() as unknown as TmuxClient,
    });
    const newer = service.enqueuePrompt(target, "new prompt", {
      onUpdate: () => undefined,
    });

    const result = await newer.result;
    const oldIndex = result.snapshot.indexOf("ECHO old persisted prompt");
    const newIndex = result.snapshot.indexOf("ECHO new prompt");

    expect(oldIndex).toBeGreaterThanOrEqual(0);
    expect(newIndex).toBeGreaterThan(oldIndex);
    expect(await service.listQueuedPrompts(target)).toEqual([]);
  });

});
