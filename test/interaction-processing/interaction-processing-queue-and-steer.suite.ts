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

describe("processChannelInteraction queue and steer", () => {
  test("steers additional user messages into the active run by default", async () => {
    const posted: string[] = [];
    const submitted: string[] = [];
    let replyCalls = 0;

    const result = await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        hasActiveRun: () => true,
        canSteerActiveRun: () => true,
        submitSessionInput: async (_target: AgentSessionTarget, text: string) => {
          submitted.push(text);
        },
        recordConversationReply: async () => {
          replyCalls += 1;
        },
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "please focus on the regression first",
      protectedControlMutationRule: "Refuse protected control changes.",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(submitted[0]).toContain("<system>");
    expect(submitted[0]).toContain("A new user message arrived while you were still working.");
    expect(submitted[0]).toContain("Refuse protected control changes.");
    expect(submitted[0]).toContain("</system>");
    expect(submitted[0]).toContain("<user>");
    expect(submitted[0]).toContain("please focus on the regression first");
    expect(submitted[0]).toContain("</user>");
    expect(posted).toEqual([]);
    expect(replyCalls).toBe(0);
    expect(result.processingIndicatorLifecycle).toBe("active-run");
  });

  test("does not auto-steer follow-up messages while the first run is still starting", async () => {
    const posted: string[] = [];
    let observedPrompt = "";
    let submitCalls = 0;

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        hasActiveRun: () => true,
        canSteerActiveRun: () => false,
        submitSessionInput: async () => {
          submitCalls += 1;
        },
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          observedPrompt = renderCapturedPrompt(prompt);
          return {
            positionAhead: 1,
            result: Promise.resolve({
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "second message stayed queued",
              fullSnapshot: "second message stayed queued",
              initialSnapshot: "",
            }),
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "please check one more thing",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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
      reconcileText: async (_chunks, text) => [text],
    });

    expect(submitCalls).toBe(0);
    expect(observedPrompt).toBe("please check one more thing");
    expect(posted).toEqual([]);
  });

  test("explicit steer command injects a steering message into the active run", async () => {
    const posted: string[] = [];
    const submitted: string[] = [];

    const result = await processChannelInteraction({
      agentService: {
        hasActiveRun: () => true,
        canSteerActiveRun: () => true,
        submitSessionInput: async (_target: AgentSessionTarget, text: string) => {
          submitted.push(text);
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "\\s focus on the failing test first",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(submitted[0]).toContain("<system>");
    expect(submitted[0]).toContain("A new user message arrived while you were still working.");
    expect(submitted[0]).toContain("</system>");
    expect(submitted[0]).toContain("<user>");
    expect(submitted[0]).toContain("focus on the failing test first");
    expect(submitted[0]).toContain("</user>");
    expect(posted[0]).toBe("Steered.");
    expect(result.processingIndicatorLifecycle).toBe("active-run");
  });

  test("explicit steer is blocked while the active run is still starting", async () => {
    const posted: string[] = [];
    let submitCalls = 0;

    await processChannelInteraction({
      agentService: {
        hasActiveRun: () => true,
        canSteerActiveRun: () => false,
        submitSessionInput: async () => {
          submitCalls += 1;
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/steer check one more thing",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(submitCalls).toBe(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("still starting");
    expect(posted[0]).toContain("ordered behind the first prompt");
  });

  test("does not auto-steer after a final reply was already delivered", async () => {
    const posted: string[] = [];
    let observedPrompt = "";

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => false,
        hasActiveRun: () => true,
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
              snapshot: "new turn reply",
              fullSnapshot: "new turn reply",
              initialSnapshot: "",
            }),
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "1+1",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(observedPrompt).toBe("1+1");
    expect(posted).not.toContain("Steered.");
    expect(posted[0]).toContain("Working");
  });

  test("queue command forces clisbot-managed delivery even in message-tool mode", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    let observedPrompt = "";

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          observedPrompt = renderCapturedPrompt(prompt);
          return {
            positionAhead: 1,
            result: Promise.resolve({
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "queued reply complete",
              fullSnapshot: "queued reply complete",
              initialSnapshot: "",
            }),
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue send the short summary after the current run",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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

    expect(observedPrompt).toBe("send the short summary after the current run");
    expect(posted[0]).toContain("Queued: 1 ahead.");
    expect(reconciled.at(-1)).toContain("queued reply complete");
  });

  test("queue start notifications can promote the initial queued placeholder when running begins immediately", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 1,
          result: (async () => {
            await sleep(0);
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "",
              fullSnapshot: "",
              initialSnapshot: "",
            });
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "working through the queued task",
              fullSnapshot: "working through the queued task",
              initialSnapshot: "",
            });
            return {
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "queued reply complete",
              fullSnapshot: "queued reply complete",
              initialSnapshot: "",
            };
          })(),
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue send the short summary after the current run",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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

    expect(posted.some((text) => text.includes("Queued: 1 ahead."))).toBe(true);
    expect(reconciled[0]).toContain("Queued message is now running");
    expect(reconciled.at(-1)).toContain("queued reply complete");
  });

  test("queue mode acknowledges queued work while streaming is off", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    let observedPrompt = "";

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          observedPrompt = renderCapturedPrompt(prompt);
          return {
            positionAhead: 1,
            result: Promise.resolve({
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "queued mode final",
              fullSnapshot: "queued mode final",
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
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "queue",
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

    expect(observedPrompt).toBe("follow up after the active run");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Queued: 1 ahead.");
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toContain("queued mode final");
  });

  test("explicit queue command acknowledges queue acceptance while streaming is off", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    let observedPrompt = "";

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          observedPrompt = renderCapturedPrompt(prompt);
          return {
            positionAhead: 1,
            result: Promise.resolve({
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "queued final only",
              fullSnapshot: "queued final only",
              initialSnapshot: "",
            }),
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue send the short summary after the current run",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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

    expect(observedPrompt).toBe("send the short summary after the current run");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Queued: 1 ahead.");
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toContain("queued final only");
  });

  test("explicit queue command renders queue start immediately when the queue is empty and streaming is off", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    let observedPrompt = "";

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => false,
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
              snapshot: "empty queue final",
              fullSnapshot: "empty queue final",
              initialSnapshot: "",
            }),
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue send the short summary now",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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

    expect(observedPrompt).toBe("send the short summary now");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Queued message is now running");
    expect(posted[0]).not.toContain("Queued: 0 ahead.");
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toContain("empty queue final");
  });

  test("explicit queue command uses queue start as the initial preview when the queue is empty", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => false,
        enqueuePrompt: () => ({
          positionAhead: 0,
          result: Promise.resolve({
            status: "completed",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot: "empty queue streaming final",
            fullSnapshot: "empty queue streaming final",
            initialSnapshot: "",
          }),
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue send the short summary now",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Queued message is now running");
    expect(posted[0]).not.toContain("Working");
    expect(reconciled.at(-1)).toContain("empty queue streaming final");
  });

  test("queue start notification is rendered on running updates even when message-tool streaming is off", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 1,
          result: (async () => {
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "",
              fullSnapshot: "",
              initialSnapshot: "",
            });
            return {
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "queued final after running",
              fullSnapshot: "queued final after running",
              initialSnapshot: "",
            };
          })(),
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue send the short summary after the current run",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Queued: 1 ahead.");
    expect(reconciled).toHaveLength(2);
    expect(reconciled[0]).toContain("Queued message is now running");
    expect(reconciled[1]).toContain("queued final after running");
  });

  async function runExplicitQueuedMessageToolFinalScenario(params: {
    getMessageToolFinalReplyAt: () => number | undefined;
    beforeComplete?: () => void;
    finalSnapshot: string;
  }) {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        getSessionRuntime: async () => ({
          state: "running",
          messageToolFinalReplyAt: params.getMessageToolFinalReplyAt(),
        }),
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 1,
          result: (async () => {
            await callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "",
              fullSnapshot: "",
              initialSnapshot: "",
            });
            params.beforeComplete?.();
            return {
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: params.finalSnapshot,
              fullSnapshot: params.finalSnapshot,
              initialSnapshot: "",
            };
          })(),
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue 1+1",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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

    return { posted, reconciled };
  }

  test("explicit queue command suppresses pane settlement after a message-tool final reply", async () => {
    let messageToolFinalSent = false;
    const { posted, reconciled } = await runExplicitQueuedMessageToolFinalScenario({
      getMessageToolFinalReplyAt: () => (messageToolFinalSent ? Date.now() : undefined),
      beforeComplete: () => {
        messageToolFinalSent = true;
      },
      finalSnapshot: "Done.",
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Queued: 1 ahead.");
    expect(reconciled[0]).toContain("Queued message is now running");
    expect(reconciled.join("\n")).not.toContain("Done");
  });

  test("explicit queue command ignores stale message-tool final markers before queue start", async () => {
    const { posted, reconciled } = await runExplicitQueuedMessageToolFinalScenario({
      getMessageToolFinalReplyAt: () => 1,
      finalSnapshot: "pane fallback final",
    });

    expect(posted[0]).toContain("Queued: 1 ahead.");
    expect(reconciled[0]).toContain("Queued message is now running");
    expect(reconciled.at(-1)).toContain("pane fallback final");
  });

  test("queue start notifications can be disabled per route", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: () => ({
          positionAhead: 1,
          result: Promise.resolve({
            status: "completed",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot: "queued final only",
            fullSnapshot: "queued final only",
            initialSnapshot: "",
          }),
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue send the short summary after the current run",
      route: createRoute({
        responseMode: "message-tool",
        additionalMessageMode: "steer",
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

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Queued: 1 ahead.");
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toContain("queued final only");
    expect(reconciled[0]).not.toContain("Queued message is now running");
  });

});
