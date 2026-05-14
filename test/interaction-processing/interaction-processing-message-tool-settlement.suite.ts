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

describe("processChannelInteraction message-tool settlement", () => {
  test("clears the live draft as soon as a delayed message-tool final arrives even without another pane update", async () => {
    const posted: string[] = [];
    const reconciled: Array<{ text: string; resultResolved: boolean }> = [];
    let resolveResult!: (value: any) => void;
    let resultResolved = false;
    const runtime = {
      state: "running" as const,
      startedAt: Date.now(),
      lastMessageToolReplyAt: undefined as number | undefined,
      messageToolFinalReplyAt: undefined as number | undefined,
    };

    const interaction = processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 0,
          result: new Promise((resolve) => {
            resolveResult = (value) => {
              resultResolved = true;
              resolve(value);
            };
            void callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "draft before delayed final",
              fullSnapshot: "draft before delayed final",
              initialSnapshot: "",
            });
          }),
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
        reconciled.push({
          text,
          resultResolved,
        });
        return text ? [text] : [];
      },
    });

    await sleep(20);
    runtime.lastMessageToolReplyAt = Date.now();
    runtime.messageToolFinalReplyAt = runtime.lastMessageToolReplyAt;
    await sleep(160);
    resolveResult({
      status: "completed",
      agentId: "default",
      sessionKey: createTarget().sessionKey,
      sessionName: "session",
      workspacePath: "/tmp/workspace",
      snapshot: "final pane output",
      fullSnapshot: "final pane output",
      initialSnapshot: "",
    });
    await interaction;

    expect(posted).toHaveLength(1);
    expect(reconciled.some((entry) => entry.text === "" && entry.resultResolved === false)).toBe(
      true,
    );
    expect(reconciled.map((entry) => entry.text).join("\n")).not.toContain("final pane output");
  });

  test("stops waiting for runner settlement once a message-tool final reply is observed", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    let resolveResult!: (value: any) => void;
    let interactionResolved = false;
    let resultResolved = false;
    const runtime = {
      state: "running" as const,
      startedAt: Date.now(),
      lastMessageToolReplyAt: undefined as number | undefined,
      messageToolFinalReplyAt: undefined as number | undefined,
    };

    const interactionPromise = processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _prompt: string, callbacks: any) => ({
          positionAhead: 0,
          result: new Promise((resolve) => {
            resolveResult = (value) => {
              resultResolved = true;
              resolve(value);
            };
            void callbacks.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "draft before early tool final",
              fullSnapshot: "draft before early tool final",
              initialSnapshot: "",
            });
          }),
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
    }).then(() => {
      interactionResolved = true;
    });

    await sleep(20);
    runtime.lastMessageToolReplyAt = Date.now();
    runtime.messageToolFinalReplyAt = runtime.lastMessageToolReplyAt;
    await interactionPromise;

    expect(interactionResolved).toBe(true);
    expect(resultResolved).toBe(false);
    expect(posted).toHaveLength(1);
    expect(reconciled).toContain("");

    resolveResult({
      status: "completed",
      agentId: "default",
      sessionKey: createTarget().sessionKey,
      sessionName: "session",
      workspacePath: "/tmp/workspace",
      snapshot: "final pane output",
      fullSnapshot: "final pane output",
      initialSnapshot: "",
    });
    await sleep(0);
  });

  test("does not post fallback settlement when a delayed message-tool final arrives with streaming off", async () => {
    const posted: string[] = [];
    let runtimeReads = 0;

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
        getSessionRuntime: async () => {
          runtimeReads += 1;
          return {
            state: "running" as const,
            startedAt: Date.now(),
            messageToolFinalReplyAt: runtimeReads >= 2 ? Date.now() : undefined,
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "investigate this",
      route: createRoute({
        responseMode: "message-tool",
        streaming: "off",
        response: "final",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(0);
  });

  test("does not post pane timeout settlement when message-tool mode has streaming off and no tool final arrives", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: () => ({
          positionAhead: 0,
          result: Promise.resolve({
            status: "timeout",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot: "timeout pane output",
            fullSnapshot: "timeout pane output",
            initialSnapshot: "",
          }),
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "investigate this",
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

  test("still posts a fallback error when message-tool mode fails before the agent can reply", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: () => ({
          positionAhead: 0,
          result: Promise.reject(new Error("runner crashed")),
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
    expect(posted[0]).toContain("Working");
    expect(reconciled.at(-1)).toContain("runner crashed");
    expect(reconciled.at(-1)).not.toContain("\n\n_Error._");
  });

});
