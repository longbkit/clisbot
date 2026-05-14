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

describe("processChannelInteraction run observer commands", () => {
  test("attach resumes the latest active run state", async () => {
    const posted: string[] = [];
    let observedMode = "";

    await processChannelInteraction({
      agentService: {
        observeActiveRun: async (_target: AgentSessionTarget, observer: any) => {
          observedMode = observer.mode;
          return {
            active: true,
            update: {
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "Still working through the repository.",
              fullSnapshot: "Still working through the repository.",
              initialSnapshot: "",
            },
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/attach",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(observedMode).toBe("live");
    expect(posted[0]).toContain("Still working through the repository.");
  });

  test("attach resumes live updates for a detached run", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        observeActiveRun: async (_target: AgentSessionTarget, _observer: any, options: any) => {
          expect(options).toEqual({
            resumeLive: true,
          });
          return {
            active: true,
            update: {
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "Back on live updates.",
              fullSnapshot: "Back on live updates.",
              initialSnapshot: "",
            },
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/attach",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted[0]).toContain("Back on live updates.");
  });

  test("attach reports when there is no active run", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        observeActiveRun: async () => ({
          active: false,
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/attach",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted[0]).toContain("does not have an active run to attach to");
  });

  test("detach stops live updates for the current thread", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        detachRunObserver: async () => ({
          detached: true,
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/detach",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted[0]).toContain("Detached this thread from live updates");
    expect(posted[0]).toContain("final result");
  });

  test("watch registers a polling observer", async () => {
    let observedMode = "";
    let observedInterval = 0;

    await processChannelInteraction({
      agentService: {
        observeActiveRun: async (_target: AgentSessionTarget, observer: any) => {
          observedMode = observer.mode;
          observedInterval = observer.intervalMs;
          return {
            active: true,
            update: {
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "Polling state.",
              fullSnapshot: "Polling state.",
              initialSnapshot: "",
            },
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/watch every 30s for 10m",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => [text],
      reconcileText: async (_chunks, text) => [text],
    });

    expect(observedMode).toBe("poll");
    expect(observedInterval).toBe(30_000);
  });

  test("watch reports when there is no active run", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        observeActiveRun: async () => ({
          active: false,
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/watch every 30s",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted[0]).toContain("does not have an active run to watch");
  });
});
