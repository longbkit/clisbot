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

describe("processChannelInteraction queue inspect and new session", () => {
  test("queue list shows pending queued messages for the current session", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        listQueuedPrompts: () => [
          {
            id: "1",
            text: "summarize the regression",
            createdAt: Date.parse("2026-04-10T12:00:00.000Z"),
          },
          {
            id: "2",
            text: "prepare the follow-up note",
            createdAt: Date.parse("2026-04-10T12:01:00.000Z"),
          },
        ],
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue list",
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

    expect(posted[0]).toContain("Queued messages");
    expect(posted[0]).toContain("1. summarize the regression");
    expect(posted[0]).toContain("2. prepare the follow-up note");
  });

  test("queue clear removes pending queued messages for the current session", async () => {
    const posted: string[] = [];
    let clearedTarget = "";

    await processChannelInteraction({
      agentService: {
        clearQueuedPrompts: (target: AgentSessionTarget) => {
          clearedTarget = target.sessionKey;
          return 2;
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/queue clear",
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

    expect(clearedTarget).toBe(createTarget().sessionKey);
    expect(posted[0]).toBe("Cleared 2 queued messages.");
  });

  test("nudge sends one extra Enter to an existing session", async () => {
    const posted: string[] = [];
    let nudgedTarget = "";

    await processChannelInteraction({
      agentService: {
        nudgeSession: async (target: AgentSessionTarget) => {
          nudgedTarget = target.sessionKey;
          return {
            agentId: target.agentId,
            sessionKey: target.sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            nudged: true,
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/nudge",
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

    expect(nudgedTarget).toBe(createTarget().sessionKey);
    expect(posted[0]).toBe("Sent one extra Enter to agent `default` session `session`.");
  });

  test("nudge reports when no session is available", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        nudgeSession: async (target: AgentSessionTarget) => ({
          agentId: target.agentId,
          sessionKey: target.sessionKey,
          sessionName: "session",
          workspacePath: "/tmp/workspace",
          nudged: false,
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/nudge",
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

    expect(posted[0]).toBe("No active or resumable session to nudge for agent `default`.");
  });

  test("new triggers a new runner conversation for the current session", async () => {
    const posted: string[] = [];
    let rotatedTarget = "";

    await processChannelInteraction({
      agentService: {
        isSessionBusy: async () => false,
        triggerNewSession: async (target: AgentSessionTarget) => {
          rotatedTarget = target.sessionKey;
          return {
            agentId: target.agentId,
            sessionKey: target.sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            command: "/new",
            sessionId: "11111111-1111-1111-1111-111111111111",
            restartedRunner: false,
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/new",
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

    expect(rotatedTarget).toBe(createTarget().sessionKey);
    expect(posted[0]).toContain("Triggered a new runner conversation");
    expect(posted[0]).toContain("sessionId: `11111111-1111-1111-1111-111111111111`");
    expect(posted[0]).toContain("triggerCommand: `/new`");
  });

  test("new rejects while the session is busy", async () => {
    const posted: string[] = [];
    let rotated = false;

    await processChannelInteraction({
      agentService: {
        isSessionBusy: async () => true,
        triggerNewSession: async () => {
          rotated = true;
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/new",
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

    expect(rotated).toBe(false);
    expect(posted[0]).toContain("This session is busy.");
  });

  test("new reports runner rotation failures back to the chat surface", async () => {
    const posted: string[] = [];
    let replyCount = 0;

    await processChannelInteraction({
      agentService: {
        isSessionBusy: async () => false,
        triggerNewSession: async () => {
          throw new Error(
            "/new completed and clisbot captured session id 22222222-2222-2222-2222-222222222222, but could not persist it. The durable session mapping was left unchanged. Persist error: disk full",
          );
        },
        recordConversationReply: async () => {
          replyCount += 1;
        },
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/new",
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

    expect(replyCount).toBe(1);
    expect(posted).toEqual([
      [
        "Could not finish opening a new runner conversation.",
        "/new completed and clisbot captured session id 22222222-2222-2222-2222-222222222222, but could not persist it. The durable session mapping was left unchanged. Persist error: disk full",
      ].join("\n"),
    ]);
  });

});
