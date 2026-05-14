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

describe("processChannelInteraction feedback and guards", () => {
  test("renders force-visible running updates even when message-tool streaming is off", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _promptText: string, params: any) => {
          const updatePromise = params.onUpdate({
            status: "running",
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot: "",
            fullSnapshot: "",
            initialSnapshot: "",
            note: "Recovery succeeded. Continuing the current run.",
            forceVisible: true,
          });
          return {
            positionAhead: 0,
            result: Promise.resolve(updatePromise).then(() => ({
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "",
              fullSnapshot: "",
              initialSnapshot: "",
            })),
          };
        },
        recordConversationReply: async () => undefined,
        getConversationFollowUpState: async () => ({}),
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "continue",
      route: createRoute({
        responseMode: "message-tool",
        streaming: "off",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Recovery succeeded. Continuing the current run.");
  });

  test("keeps the working placeholder for silent prompt retries", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _promptText: string, params: any) => {
          const updatePromise = params.onUpdate({
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
            positionAhead: 0,
            result: Promise.resolve(updatePromise).then(() => ({
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "completed after retry",
              fullSnapshot: "completed after retry",
              initialSnapshot: "",
            })),
          };
        },
        recordConversationReply: async () => undefined,
        getConversationFollowUpState: async () => ({}),
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "continue",
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
    expect(reconciled.join("\n")).not.toContain("Retrying");
    expect(reconciled.join("\n")).not.toContain("truthfully");
  });

  test("renders force-visible running updates even after message-tool preview handoff", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    let runtimeChecks = 0;

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _promptText: string, params: any) => {
          const result = (async () => {
            await params.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "preview output",
              fullSnapshot: "preview output",
              initialSnapshot: "",
            });
            await params.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "post-boundary output",
              fullSnapshot: "post-boundary output",
              initialSnapshot: "",
            });
            await params.onUpdate({
              status: "running",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "",
              fullSnapshot: "post-boundary output",
              initialSnapshot: "",
              note: "Recovery succeeded. Continuing the current run.",
              forceVisible: true,
            });
            return {
              status: "completed",
              agentId: "default",
              sessionKey: createTarget().sessionKey,
              sessionName: "session",
              workspacePath: "/tmp/workspace",
              snapshot: "",
              fullSnapshot: "post-boundary output",
              initialSnapshot: "",
            };
          })();
          return {
            positionAhead: 0,
            result,
          };
        },
        getSessionRuntime: async () => {
          runtimeChecks += 1;
          return runtimeChecks >= 2
            ? { lastMessageToolReplyAt: Date.now(), messageToolFinalReplyAt: undefined }
            : {};
        },
        recordConversationReply: async () => undefined,
        getConversationFollowUpState: async () => ({}),
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "continue",
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
        return [text];
      },
    });

    expect(posted[0]).toContain("Working");
    expect(reconciled.some((text) => text.includes("preview output"))).toBe(true);
    expect(reconciled).toContain("");
    expect(reconciled[reconciled.length - 1]).toContain("Recovery succeeded. Continuing the current run.");
  });

  test("refuses to render runner output from another session into the current topic", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, _promptText: string, params: any) => ({
          positionAhead: 0,
          result: Promise.resolve()
            .then(() =>
              params.onUpdate({
                status: "running",
                agentId: "default",
                sessionKey: "agent:default:telegram:group:-1001:topic:5",
                sessionName: "foreign-session",
                workspacePath: "/tmp/workspace",
                snapshot: "foreign output",
                fullSnapshot: "foreign output",
                initialSnapshot: "",
              })
            )
            .then(() => ({
              status: "completed",
              agentId: "default",
              sessionKey: "agent:default:telegram:group:-1001:topic:5",
              sessionName: "foreign-session",
              workspacePath: "/tmp/workspace",
              snapshot: "foreign output",
              fullSnapshot: "foreign output",
              initialSnapshot: "",
            })),
        }),
        recordConversationReply: async () => undefined,
        getConversationFollowUpState: async () => ({}),
      } as any,
      sessionTarget: createTelegramTopicTarget(),
      identity: createTelegramTopicIdentity(),
      senderId: "123",
      text: "continue",
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

    expect(posted[0]).toContain("Working");
    expect(reconciled.join("\n")).not.toContain("foreign output");
    expect(reconciled.join("\n")).toContain(
      "Refusing to render runner output for sessionKey agent:default:telegram:group:-1001:topic:5 into agent:default:telegram:group:-1001:topic:4.",
    );
  });

  test("blocks transcript requests when route verbose is off", async () => {
    const posted: string[] = [];
    let transcriptCalls = 0;
    let replyCalls = 0;

    await processChannelInteraction({
      agentService: {
        captureTranscript: async () => {
          transcriptCalls += 1;
          return {
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot: "secret",
          };
        },
        recordConversationReply: async () => {
          replyCalls += 1;
        },
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/transcript",
      route: createRoute({
        verbose: "off",
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(transcriptCalls).toBe(0);
    expect(replyCalls).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Transcript inspection is disabled");
    expect(posted[0]).toContain('verbose: "minimal"');
  });

  test("blocks bash commands when shell execution is not allowed", async () => {
    const posted: string[] = [];
    let bashCalls = 0;

    await processChannelInteraction({
      agentService: {
        runShellCommand: async () => {
          bashCalls += 1;
          return {
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            command: "pwd",
            output: "/tmp/workspace",
            exitCode: 0,
            timedOut: false,
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "!pwd",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(bashCalls).toBe(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Shell execution is not allowed");
    expect(posted[0]).toContain("grant `shellExecute`");
  });

  test("allows transcript requests when route verbose is minimal", async () => {
    const posted: string[] = [];
    let transcriptCalls = 0;
    const snapshot = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");

    await processChannelInteraction({
      agentService: {
        captureTranscript: async () => {
          transcriptCalls += 1;
          return {
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot,
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "::transcript",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(transcriptCalls).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Recent session snapshot:");
    expect(posted[0]).toContain("line 80");
    expect(posted[0]).toContain("/transcript full");
    expect(posted[0]).not.toContain("agent: default");
  });

  test("uses configured slash-style prefixes for transcript requests", async () => {
    const posted: string[] = [];
    let transcriptCalls = 0;

    await processChannelInteraction({
      agentService: {
        captureTranscript: async () => {
          transcriptCalls += 1;
          return {
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            snapshot: "runner output",
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "\\transcript",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(transcriptCalls).toBe(1);
    expect(posted[0]).toContain("Recent session snapshot:");
  });

  test("renders the expanded transcript view when the user asks for transcript full", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        captureTranscript: async () => ({
          agentId: "default",
          sessionKey: createTarget().sessionKey,
          sessionName: "session",
          workspacePath: "/tmp/workspace",
          snapshot: "runner output",
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/transcript full",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("agent: default");
    expect(posted[0]).toContain("workspace: /tmp/workspace");
    expect(posted[0]).toContain("runner output");
  });

  test("uses configured bash shortcut prefixes", async () => {
    const posted: string[] = [];
    let bashCalls = 0;

    await processChannelInteraction({
      agentService: {
        runShellCommand: async () => {
          bashCalls += 1;
          return {
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            command: "pwd",
            output: "/tmp/workspace",
            exitCode: 0,
            timedOut: false,
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "$pwd",
      auth: {
        appRole: "member",
        agentRole: "admin",
        mayBypassPairing: false,
        mayBypassSharedSenderPolicy: false,
        mayManageProtectedResources: false,
        canUseShell: true,
      },
      route: createRoute({
        commandPrefixes: {
          slash: ["::"],
          bash: ["$"],
        },
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(bashCalls).toBe(1);
    expect(posted[0]).toContain("command: `pwd`");
  });

  test("still blocks bash when shellExecute is missing even if the sender differs", async () => {
    const posted: string[] = [];
    let bashCalls = 0;

    await processChannelInteraction({
      agentService: {
        runShellCommand: async () => {
          bashCalls += 1;
          return {
            agentId: "default",
            sessionKey: createTarget().sessionKey,
            sessionName: "session",
            workspacePath: "/tmp/workspace",
            command: "pwd",
            output: "/tmp/workspace",
            exitCode: 0,
            timedOut: false,
          };
        },
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U999",
      text: "!pwd",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(bashCalls).toBe(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Shell execution is not allowed");
  });

});
