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

describe("processChannelInteraction message-tool streaming", () => {
  test("uses agentPromptText for the agent-bound prompt while keeping slash parsing on raw text", async () => {
    let observedPrompt = "";

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          observedPrompt = renderCapturedPrompt(prompt);
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
      text: "investigate this",
      agentPromptText: "<system>\nuse wrapper\n</system>\n\n<user>\ninvestigate this\n</user>",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => [text],
      reconcileText: async (_chunks, text) => [text],
    });

    expect(observedPrompt).toContain("use wrapper");
    expect(observedPrompt).toContain("<user>");
  });

  test("wraps explicit queue messages with the protected control rule when a builder is provided", async () => {
    let observedPrompt = "";
    let observedQueueItem: any;

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string, callbacks: any) => {
          observedPrompt = renderCapturedPrompt(prompt);
          observedQueueItem = callbacks.queueItem;
          return {
            positionAhead: 0,
            persisted: Promise.resolve(),
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
      text: "/queue update clisbot.json",
      protectedControlMutationRule: "Refuse protected control changes.",
      agentPromptBuilder: (text) => `<system>\nRefuse protected control changes.\n</system>\n\n<user>\n${text}\n</user>`,
      route: createRoute({
        responseMode: "message-tool",
      }),
      maxChars: 4000,
      postText: async (text) => [text],
      reconcileText: async (_chunks, text) => [text],
    });

    expect(observedPrompt).toContain("Refuse protected control changes.");
    expect(observedPrompt).toContain("<user>\nupdate clisbot.json\n</user>");
    expect(observedQueueItem.promptText).toBe("update clisbot.json");
    expect(observedQueueItem.promptSummary).toBe("update clisbot.json");
    expect(observedQueueItem.sender.senderId).toBe("slack:U123");
    expect(observedQueueItem.surfaceBinding.platform).toBe("slack");
  });

  test("rebuilds route-queued prompt envelopes when the queued item starts", async () => {
    let observedPrompt = "";
    let buildCount = 0;

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string | (() => string)) => {
          observedPrompt = renderCapturedPrompt(prompt);
          return {
            positionAhead: 1,
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
      text: "follow up after the active run",
      agentPromptText: "stale prompt envelope",
      agentPromptBuilder: (text) => {
        buildCount += 1;
        return `fresh prompt envelope ${buildCount}: ${text}`;
      },
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "queue",
        streaming: "off",
      }),
      maxChars: 4000,
      postText: async (text) => [text],
      reconcileText: async (_chunks, text) => [text],
    });

    expect(buildCount).toBe(1);
    expect(observedPrompt).toBe(
      "fresh prompt envelope 1: follow up after the active run",
    );
    expect(observedPrompt).not.toBe("stale prompt envelope");
  });

  test("does not post a pane final settlement when message-tool mode has streaming off and no tool final arrives", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: () => ({
          positionAhead: 0,
          result: Promise.resolve({
            status: "completed",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot: "final pane output",
            fullSnapshot: "final pane output",
            initialSnapshot: "",
          }),
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "investigate this",
      agentPromptText: "<system>\nuse wrapper\n</system>\n\n<user>\ninvestigate this\n</user>",
      route: createRoute({
        responseMode: "message-tool",
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

    expect(posted).toHaveLength(0);
    expect(reconciled).toEqual([]);
  });

  test("streams one live preview and leaves it unchanged when no tool final arrives", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    const runtime = {
      state: "running" as const,
      startedAt: Date.now(),
    };

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 0,
          result: (async () => {
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "working draft",
              fullSnapshot: "working draft",
              initialSnapshot: "",
            });
            return {
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "final pane output",
              fullSnapshot: "final pane output",
              initialSnapshot: "",
            };
          })(),
        }),
        getSessionRuntime: async () => runtime,
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "investigate this",
      route: createRoute({
        responseMode: "message-tool",
        streaming: "all",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => {
        reconciled.push(text);
        return text ? [text] : [];
      },
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Working");
    expect(reconciled.at(-1)).toContain("working draft");
    expect(reconciled.at(-1)).not.toContain("Working...");
  });

  test("hands off the live draft after a message-tool reply boundary", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    const runtime = {
      state: "running" as const,
      startedAt: Date.now(),
      lastMessageToolReplyAt: undefined as number | undefined,
    };

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 0,
          result: (async () => {
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "draft one",
              fullSnapshot: "draft one",
              initialSnapshot: "",
            });
            runtime.lastMessageToolReplyAt = Date.now();
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "draft two",
              fullSnapshot: "draft two",
              initialSnapshot: "",
            });
            return {
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "final pane output",
              fullSnapshot: "final pane output",
              initialSnapshot: "",
            };
          })(),
        }),
        getSessionRuntime: async () => runtime,
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "investigate this",
      route: createRoute({
        responseMode: "message-tool",
        streaming: "all",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => {
        reconciled.push(text);
        return text ? [text] : [];
      },
    });

    expect(posted).toHaveLength(1);
    expect(reconciled.some((text) => text.includes("draft one"))).toBe(true);
    expect(reconciled.at(-1)).toBe("");
    expect(posted.join("\n")).not.toContain("draft two");
    expect(reconciled.join("\n")).not.toContain("draft two");
    expect(posted.join("\n")).not.toContain("final pane output");
    expect(reconciled.join("\n")).not.toContain("final pane output");
  });

  test("does not resume the live draft after a message-tool boundary was already handed off", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    const runtime = {
      state: "running" as const,
      startedAt: Date.now(),
      lastMessageToolReplyAt: undefined as number | undefined,
      messageToolFinalReplyAt: undefined as number | undefined,
    };

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 0,
          result: (async () => {
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "draft one",
              fullSnapshot: "draft one",
              initialSnapshot: "",
            });
            runtime.lastMessageToolReplyAt = Date.now();
            runtime.messageToolFinalReplyAt = runtime.lastMessageToolReplyAt;
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "draft two",
              fullSnapshot: "draft two",
              initialSnapshot: "",
            });
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "draft three",
              fullSnapshot: "draft three",
              initialSnapshot: "",
            });
            return {
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "final pane output",
              fullSnapshot: "final pane output",
              initialSnapshot: "",
            };
          })(),
        }),
        getSessionRuntime: async () => runtime,
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "investigate this",
      route: createRoute({
        responseMode: "message-tool",
        streaming: "all",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => {
        reconciled.push(text);
        return text ? [text] : [];
      },
    });

    expect(posted).toHaveLength(1);
    expect(reconciled.some((text) => text.includes("draft one"))).toBe(true);
    expect(reconciled.filter((text) => text === "")).toHaveLength(1);
    expect(posted.join("\n")).not.toContain("draft two");
    expect(posted.join("\n")).not.toContain("draft three");
    expect(reconciled.join("\n")).not.toContain("draft two");
    expect(reconciled.join("\n")).not.toContain("draft three");
  });

  test("does not start pane streaming after a message-tool final reply already arrived", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    const runtime = {
      state: "running" as const,
      startedAt: Date.now(),
      lastMessageToolReplyAt: undefined as number | undefined,
      messageToolFinalReplyAt: undefined as number | undefined,
    };

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 0,
          result: (async () => {
            await sleep(0);
            runtime.lastMessageToolReplyAt = Date.now();
            runtime.messageToolFinalReplyAt = runtime.lastMessageToolReplyAt;
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "late pane draft after final",
              fullSnapshot: "late pane draft after final",
              initialSnapshot: "",
            });
            return {
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "final pane output",
              fullSnapshot: "final pane output",
              initialSnapshot: "",
            };
          })(),
        }),
        getSessionRuntime: async () => runtime,
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "investigate this",
      route: createRoute({
        responseMode: "message-tool",
        streaming: "all",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => {
        reconciled.push(text);
        return text ? [text] : [];
      },
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Working");
    expect(reconciled).toContain("");
    expect(reconciled.join("\n")).not.toContain("late pane draft after final");
    expect(reconciled.join("\n")).not.toContain("final pane output");
  });

  test("cleans up the live draft after a message-tool final reply when response is final", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    const runtime = {
      state: "running" as const,
      startedAt: Date.now(),
      lastMessageToolReplyAt: undefined as number | undefined,
      messageToolFinalReplyAt: undefined as number | undefined,
    };

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 0,
          result: (async () => {
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "draft before final",
              fullSnapshot: "draft before final",
              initialSnapshot: "",
            });
            runtime.lastMessageToolReplyAt = Date.now();
            runtime.messageToolFinalReplyAt = runtime.lastMessageToolReplyAt;
            return {
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "final pane output",
              fullSnapshot: "final pane output",
              initialSnapshot: "",
            };
          })(),
        }),
        getSessionRuntime: async () => runtime,
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "investigate this",
      route: createRoute({
        responseMode: "message-tool",
        streaming: "all",
        response: "final",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => {
        reconciled.push(text);
        return text ? [text] : [];
      },
    });

    expect(posted).toHaveLength(1);
    expect(reconciled.some((text) => text.includes("draft before final"))).toBe(true);
    expect(reconciled.at(-1)).toBe("");
  });

});
