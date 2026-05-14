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

describe("processChannelInteraction detached long-running settlement", () => {
  test("renders detached guidance instead of a timeout when max runtime is exceeded", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: () => ({
          positionAhead: 0,
          result: Promise.resolve({
            status: "detached",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot: "Still working through the repository.",
            fullSnapshot: "Still working through the repository.",
            initialSnapshot: "",
            note:
              "This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it.",
          }),
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "keep going",
      route: createRoute(),
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

    expect(posted[0]).toContain("Working...");
    expect(reconciled.at(-1)).toContain("Still working through the repository.");
    expect(reconciled.at(-1)).toContain("You can also use `/transcript` to inspect the current session snapshot.");
    expect(reconciled.at(-1)).not.toContain("Timed out waiting");
  });

  test("keeps detached guidance transcript-free when route verbose is off", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: () => ({
          positionAhead: 0,
          result: Promise.resolve({
            status: "detached",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot: "Still working through the repository.",
            fullSnapshot: "Still working through the repository.",
            initialSnapshot: "",
            note:
              "This session has been running for over 15 minutes. clisbot left it running and will post the final result here when it completes. Use `/attach` for live updates, `/watch every <duration>` for periodic updates, or `/stop` to interrupt it.",
          }),
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "keep going",
      route: createRoute({
        verbose: "off",
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

    expect(posted[0]).toContain("Working...");
    expect(reconciled.at(-1)).toContain("Still working through the repository.");
    expect(reconciled.at(-1)).not.toContain("/transcript");
    expect(reconciled.at(-1)).not.toContain("Timed out waiting");
  });
});
