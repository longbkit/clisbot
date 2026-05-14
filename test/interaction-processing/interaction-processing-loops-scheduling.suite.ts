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

describe("processChannelInteraction loop scheduling", () => {
  test("loop calendar mode schedules the first run using route timezone", async () => {
    const posted: string[] = [];
    let observedTimezone = "";
    let observedCadence = "";
    let observedLoopStart: string | undefined;

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        }),
        getWorkspacePath: () => "/tmp/workspace",
        resolveEffectiveTimezone: ({ routeTimezone }: { routeTimezone?: string }) => ({
          timezone: routeTimezone ?? "UTC",
          source: routeTimezone ? "route" : "app",
        }),
        createCalendarLoop: async ({
          cadence,
          timezone,
          loopStart,
        }: {
          cadence: string;
          timezone: string;
          loopStart?: string;
        }) => {
          observedCadence = cadence;
          observedTimezone = timezone;
          observedLoopStart = loopStart;
          return {
            id: "loopcal1",
            kind: "calendar" as const,
            cadence: "daily" as const,
            localTime: "07:00",
            hour: 7,
            minute: 0,
            timezone,
            maxRuns: 20,
            attemptedRuns: 0,
            executedRuns: 0,
            skippedRuns: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nextRunAt: Date.parse("2026-04-13T00:00:00.000Z"),
            promptText: "wrapped:check deploy",
            promptSummary: "check deploy",
            promptSource: "custom" as const,
            createdBy: "U123",
            force: false as const,
          };
        },
        listIntervalLoops: () => [
          {
            id: "loopcal1",
            kind: "calendar" as const,
            cadence: "daily" as const,
            localTime: "07:00",
            hour: 7,
            minute: 0,
            timezone: "Asia/Ho_Chi_Minh",
            maxRuns: 20,
            attemptedRuns: 0,
            executedRuns: 0,
            skippedRuns: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nextRunAt: Date.parse("2026-04-13T00:00:00.000Z"),
            promptText: "wrapped:check deploy",
            promptSummary: "check deploy",
            promptSource: "custom" as const,
            createdBy: "U123",
            force: false as const,
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            remainingRuns: 20,
          },
        ],
        getActiveIntervalLoopCount: () => 1,
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop every day at 07:00 --loop-start full check deploy",
      agentPromptBuilder: (text) => `wrapped:${text}`,
      route: createRoute({
        responseMode: "message-tool",
        timezone: "Asia/Ho_Chi_Minh",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(observedCadence).toBe("daily");
    expect(observedTimezone).toBe("Asia/Ho_Chi_Minh");
    expect(observedLoopStart).toBe("full");
    expect(posted[0]).toContain("Started loop `loopcal1` every day at 07:00.");
    expect(posted[0]).toContain("timezone: `Asia/Ho_Chi_Minh`");
    expect(posted[0]).toContain("next run: `2026-04-13 07:00 Asia/Ho_Chi_Minh` (2026-04-13T00:00:00.000Z)");
    expect(posted[0]).toContain("cancel: `/loop cancel loopcal1`");
    expect(posted[0]).toContain("If timezone is wrong: cancel with `/loop cancel loopcal1`");
  });

  test("loop times mode queues all iterations immediately and wraps prompts", async () => {
    const posted: string[] = [];
    const enqueued: string[] = [];

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        }),
        getWorkspacePath: () => "/tmp/workspace",
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          enqueued.push(renderCapturedPrompt(prompt));
          return {
            positionAhead: enqueued.length - 1,
            result: Promise.resolve({
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
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
      text: "/loop 3 /codereview",
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

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(posted[0]).toContain("Started loop for 3 iterations.");
    expect(enqueued).toEqual([
      "wrapped:/codereview",
      "wrapped:/codereview",
      "wrapped:/codereview",
    ]);
  });

  test("loop times mode does not emit queued placeholders when streaming is off", async () => {
    const posted: string[] = [];
    const enqueued: string[] = [];

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        }),
        getWorkspacePath: () => "/tmp/workspace",
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          enqueued.push(renderCapturedPrompt(prompt));
          return {
            positionAhead: enqueued.length - 1,
            result: Promise.resolve({
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: `done ${enqueued.length}`,
              fullSnapshot: `done ${enqueued.length}`,
              initialSnapshot: "",
            }),
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop 3 /codereview",
      agentPromptBuilder: (text) => `wrapped:${text}`,
      route: createRoute({
        responseMode: "capture-pane",
        streaming: "off",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(posted[0]).toContain("Started loop for 3 iterations.");
    expect(posted.some((text) => text.includes("Queued:"))).toBe(false);
    expect(posted.some((text) => text.includes("Working"))).toBe(false);
    expect(enqueued).toHaveLength(3);
  });

  test("loop times mode does not leak pane timeout settlements in message-tool mode when streaming is off", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    const enqueued: string[] = [];

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        }),
        getWorkspacePath: () => "/tmp/workspace",
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          enqueued.push(renderCapturedPrompt(prompt));
          return {
            positionAhead: enqueued.length - 1,
            result: Promise.resolve({
              status: "timeout",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: `timed out pane ${enqueued.length}`,
              fullSnapshot: `timed out pane ${enqueued.length}`,
              initialSnapshot: "",
            }),
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop 3 /codereview",
      agentPromptBuilder: (text) => `wrapped:${text}`,
      route: createRoute({
        responseMode: "message-tool",
        streaming: "off",
        surfaceNotifications: {
          queueStart: "none",
          loopStart: "brief",
        },
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => {
        reconciled.push(text);
        return [text];
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Started loop for 3 iterations.");
    expect(posted.some((text) => text.includes("Timed out waiting for more output"))).toBe(false);
    expect(posted.some((text) => text.includes("timed out pane"))).toBe(false);
    expect(reconciled).toEqual([]);
    expect(enqueued).toHaveLength(3);
  });

  test("loop times mode suppresses repeated detached settlements", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    const enqueued: string[] = [];

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        }),
        getWorkspacePath: () => "/tmp/workspace",
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          enqueued.push(renderCapturedPrompt(prompt));
          return {
            positionAhead: enqueued.length - 1,
            result: Promise.resolve({
              status: "detached",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: `still running ${enqueued.length}`,
              fullSnapshot: `still running ${enqueued.length}`,
              initialSnapshot: "",
              note:
                "This session has been running for over 15 minutes. clisbot left it running as-is. Use `/attach`, `/watch every 30s`, or `/stop` to manage it.",
            }),
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop 3 /codereview",
      agentPromptBuilder: (text) => `wrapped:${text}`,
      route: createRoute({
        responseMode: "capture-pane",
        streaming: "off",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => {
        reconciled.push(text);
        return [text];
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(posted[0]).toContain("Started loop for 3 iterations.");
    expect(posted.some((text) => text.includes("This session has been running for over 15 minutes"))).toBe(false);
    expect(reconciled).toEqual([]);
    expect(enqueued).toHaveLength(3);
  });

  test("loop interval mode starts immediately and passes the configured interval to the scheduler", async () => {
    const posted: string[] = [];
    const enqueued: string[] = [];
    let scheduledIntervalMs = 0;
    let createdMaxRuns = 0;
    let observedLoopStart: string | undefined;

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        }),
        getWorkspacePath: () => "/tmp/workspace",
        createIntervalLoop: async ({
          promptText,
          intervalMs,
          maxRuns,
          loopStart,
        }: {
          promptText: string;
          intervalMs: number;
          maxRuns: number;
          loopStart?: string;
        }) => {
          enqueued.push(renderCapturedPrompt(promptText));
          scheduledIntervalMs = intervalMs;
          createdMaxRuns = maxRuns;
          observedLoopStart = loopStart;
          return {
            id: "loop123",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            intervalMs,
            maxRuns,
            attemptedRuns: 1,
            executedRuns: 1,
            skippedRuns: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nextRunAt: Date.now() + intervalMs,
            promptText,
            promptSummary: "check deploy",
            promptSource: "custom" as const,
            createdBy: "U123",
            force: false,
            remainingRuns: maxRuns - 1,
          };
        },
        listIntervalLoops: () => [
          {
            id: "loop123",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            intervalMs: 7_200_000,
            maxRuns: 20,
            attemptedRuns: 1,
            executedRuns: 1,
            skippedRuns: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nextRunAt: Date.now() + 7_200_000,
            promptText: "wrapped:check deploy",
            promptSummary: "check deploy",
            promptSource: "custom" as const,
            createdBy: "U123",
            force: false,
            remainingRuns: 19,
          },
        ],
        getActiveIntervalLoopCount: () => 1,
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          enqueued.push(renderCapturedPrompt(prompt));
          return {
            positionAhead: 0,
            result: Promise.resolve({
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
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
      text: "/loop check deploy every 2 hours",
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

    expect(posted[0]).toContain("Started loop `loop123` every 2h.");
    expect(scheduledIntervalMs).toBe(7_200_000);
    expect(createdMaxRuns).toBe(20);
    expect(observedLoopStart).toBeUndefined();
    expect(enqueued).toEqual(["check deploy"]);
  });

  test("loop interval mode passes a per-loop loop-start override to the scheduler", async () => {
    let observedLoopStart: string | undefined;

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
        }),
        getWorkspacePath: () => "/tmp/workspace",
        createIntervalLoop: async ({ loopStart }: { loopStart?: string }) => {
          observedLoopStart = loopStart;
          return {
            id: "loop123",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            intervalMs: 7_200_000,
            maxRuns: 20,
            attemptedRuns: 1,
            executedRuns: 1,
            skippedRuns: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nextRunAt: Date.now() + 7_200_000,
            promptText: "check deploy",
            promptSummary: "check deploy",
            promptSource: "custom" as const,
            createdBy: "U123",
            force: false,
            remainingRuns: 19,
          };
        },
        listIntervalLoops: () => [],
        getActiveIntervalLoopCount: () => 1,
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop check deploy every 2 hours --loop-start none",
      agentPromptBuilder: (text) => `wrapped:${text}`,
      route: createRoute({
        responseMode: "message-tool",
      }),
      maxChars: 4000,
      postText: async (text) => [text],
      reconcileText: async (_chunks, text) => [text],
    });

    expect(observedLoopStart).toBe("none");
  });

});
