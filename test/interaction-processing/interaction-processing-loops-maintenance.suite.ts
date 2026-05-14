import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  processChannelInteraction,
  type ChannelInteractionIdentity,
  type ChannelInteractionRoute,
} from "../../src/channels/message/interaction-processing.ts";
import type { AgentSessionTarget } from "../../src/agents/runtime/agent-service.ts";
import { renderDefaultConfigTemplate } from "../../src/config/core/template.ts";
import { sleep } from "../../src/infra/process.ts";
import {
  createIdentity,
  createRoute,
  createTarget,
  createTelegramTopicIdentity,
  createTelegramTopicTarget,
  registerCliNameIsolation,
  renderCapturedPrompt,
} from "./interaction-processing-support.ts";

registerCliNameIsolation();

describe("processChannelInteraction loop maintenance", () => {
  test("loop maintenance mode reads LOOP.md when no prompt is provided", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "clisbot-loop-"));
    const posted: string[] = [];
    const enqueued: string[] = [];
    writeFileSync(join(workspacePath, "LOOP.md"), "maintenance prompt from file\n");

    try {
      await processChannelInteraction({
        agentService: {
          getLoopConfig: () => ({
            maxRunsPerLoop: 20,
            maxActiveLoops: 10,
          }),
          getWorkspacePath: () => workspacePath,
          enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
            enqueued.push(renderCapturedPrompt(prompt));
            return {
              positionAhead: enqueued.length - 1,
              result: Promise.resolve({
                status: "completed",
                agentId: "default",
                sessionKey: createTarget().sessionKey,
                sessionName: "session",
                workspacePath,
                snapshot: "done",
                fullSnapshot: "done",
                initialSnapshot: "",
              }),
            };
          },
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/loop 3",
        agentPromptBuilder: (text) => `wrapped:${text}`,
        route: createRoute({
          responseMode: "message-tool",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("prompt: `LOOP.md`");
    expect(enqueued).toEqual([
      "wrapped:maintenance prompt from file",
      "wrapped:maintenance prompt from file",
      "wrapped:maintenance prompt from file",
    ]);
  });

  test("loop errors when maintenance mode has no LOOP.md", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "clisbot-loop-missing-"));
    const posted: string[] = [];

    try {
      await processChannelInteraction({
        agentService: {
          getLoopConfig: () => ({
            maxRunsPerLoop: 20,
            maxActiveLoops: 10,
          }),
          getWorkspacePath: () => workspacePath,
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/loop 3",
        route: createRoute({
          responseMode: "message-tool",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("LOOP.md");
    expect(posted[0]).toContain("Create LOOP.md");
  });

  test("loop rejects counts above the configured max", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 2,
          maxActiveLoops: 10,
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop 3 check CI",
      route: createRoute({
        responseMode: "message-tool",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted[0]).toContain("max of `2`");
  });

  test("loop rejects intervals below 5 minutes without force", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop 1m check CI",
      route: createRoute({
        responseMode: "message-tool",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted[0]).toContain("below `5m` require `--force`");
  });

  test("loop status and cancel operate on managed interval loops", async () => {
    const posted: string[] = [];
    let cancelledLoopId = "";

    let cancelledSessionKey = "";

    await processChannelInteraction({
      agentService: {
        listIntervalLoops: () => [
          {
            id: "loop123",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            intervalMs: 300_000,
            maxRuns: 20,
            attemptedRuns: 1,
            executedRuns: 1,
            skippedRuns: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nextRunAt: Date.now() + 300_000,
            promptText: "wrapped:check ci",
            promptSummary: "check ci",
            promptSource: "custom" as const,
            createdBy: "U123",
            force: false,
            remainingRuns: 19,
          },
        ],
        getActiveIntervalLoopCount: () => 1,
        cancelIntervalLoop: async (target: AgentSessionTarget, loopId: string) => {
          cancelledSessionKey = target.sessionKey;
          cancelledLoopId = loopId;
          return true;
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop status",
      route: createRoute({
        responseMode: "message-tool",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted[0]).toContain("Active loops");
    expect(posted[0]).toContain("loop123");
    posted.length = 0;

    await processChannelInteraction({
      agentService: {
        listIntervalLoops: () => [
          {
            id: "loop123",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            intervalMs: 300_000,
            maxRuns: 20,
            attemptedRuns: 1,
            executedRuns: 1,
            skippedRuns: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nextRunAt: Date.now() + 300_000,
            promptText: "wrapped:check ci",
            promptSummary: "check ci",
            promptSource: "custom" as const,
            createdBy: "U123",
            force: false,
            remainingRuns: 19,
          },
        ],
        getActiveIntervalLoopCount: () => 1,
        cancelIntervalLoop: async (target: AgentSessionTarget, loopId: string) => {
          cancelledSessionKey = target.sessionKey;
          cancelledLoopId = loopId;
          return true;
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop cancel",
      route: createRoute({
        responseMode: "message-tool",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(cancelledLoopId).toBe("loop123");
    expect(cancelledSessionKey).toBe(createTarget().sessionKey);
    expect(posted[0]).toContain("Cancelled loop `loop123`.");
  });

  test("loop cancel --all --app cancels loops across the whole app", async () => {
    const posted: string[] = [];
    let cancelledCount = 0;

    await processChannelInteraction({
      agentService: {
        listIntervalLoops: () => [],
        cancelAllIntervalLoops: async () => {
          cancelledCount += 2;
          return 2;
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop cancel --all --app",
      route: createRoute({
        responseMode: "message-tool",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(cancelledCount).toBe(2);
    expect(posted[0]).toContain("Cancelled 2 active loops across the whole app.");
  });
});
