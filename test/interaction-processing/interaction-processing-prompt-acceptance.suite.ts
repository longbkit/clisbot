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

describe("processChannelInteraction prompt acceptance hooks", () => {
  test("marks a normal prompt only after enqueue acceptance", async () => {
    let accepted = 0;

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
            snapshot: "done",
            fullSnapshot: "done",
            initialSnapshot: "",
          }),
        }),
        recordConversationReply: async () => undefined,
        getConversationFollowUpState: async () => ({}),
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "continue",
      route: createRoute(),
      maxChars: 4000,
      onPromptAccepted: async () => {
        accepted += 1;
      },
      postText: async (text) => [text],
      reconcileText: async (_chunks, text) => [text],
    });

    expect(accepted).toBe(1);
  });

  test("marks steer delivery only after submitSessionInput succeeds", async () => {
    let accepted = 0;
    let submittedText = "";

    const result = await processChannelInteraction({
      agentService: {
        hasActiveRun: () => true,
        canSteerActiveRun: () => true,
        submitSessionInput: async (_target: AgentSessionTarget, text: string) => {
          submittedText = text;
        },
        recordConversationReply: async () => undefined,
        getConversationFollowUpState: async () => ({}),
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "\\steer finish the review",
      route: createRoute(),
      maxChars: 4000,
      transformSessionInputText: (text) => `wrapped: ${text}`,
      onPromptAccepted: async () => {
        accepted += 1;
      },
      postText: async (text) => [text],
      reconcileText: async (_chunks, text) => [text],
    });

    expect(submittedText).toContain("wrapped: finish the review");
    expect(accepted).toBe(1);
    expect(result.processingIndicatorLifecycle).toBe("active-run");
  });
});
