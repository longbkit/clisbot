import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  processChannelInteraction,
  type ChannelInteractionIdentity,
  type ChannelInteractionRoute,
} from "../src/channels/interaction-processing.ts";
import type { AgentSessionTarget } from "../src/agents/agent-service.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";
import { sleep } from "../src/shared/process.ts";

let previousCliName: string | undefined;

beforeEach(() => {
  previousCliName = process.env.CLISBOT_CLI_NAME;
  delete process.env.CLISBOT_CLI_NAME;
});

afterEach(() => {
  process.env.CLISBOT_CLI_NAME = previousCliName;
});

function createRoute(
  overrides: Partial<ChannelInteractionRoute> = {},
): ChannelInteractionRoute {
  return {
    agentId: "default",
    commandPrefixes: {
      slash: ["::", "\\"],
      bash: ["!"],
    },
    streaming: "all",
    response: "final",
    responseMode: "capture-pane",
    additionalMessageMode: "steer",
    surfaceNotifications: {
      queueStart: "brief",
      loopStart: "brief",
    },
    verbose: "minimal",
    followUp: {
      mode: "auto",
      participationTtlMs: 24 * 60 * 60 * 1000,
    },
    ...overrides,
  };
}

function createTarget(): AgentSessionTarget {
  return {
    agentId: "default",
    sessionKey: "agent:default:slack:channel:c123:thread:1.2",
  };
}

function createIdentity(
  overrides: Partial<ChannelInteractionIdentity> = {},
): ChannelInteractionIdentity {
  return {
    platform: "slack",
    conversationKind: "channel",
    senderId: "U123",
    channelId: "C123",
    threadTs: "1.2",
    ...overrides,
  };
}

function createTelegramTopicIdentity(
  overrides: Partial<ChannelInteractionIdentity> = {},
): ChannelInteractionIdentity {
  return {
    platform: "telegram",
    conversationKind: "topic",
    senderId: "123",
    chatId: "-1001",
    topicId: "4",
    ...overrides,
  };
}

function createTelegramTopicTarget(): AgentSessionTarget {
  return {
    agentId: "default",
    sessionKey: "agent:default:telegram:group:-1001:topic:4",
  };
}

describe("processChannelInteraction sensitive command gating", () => {
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

  test("renders whoami for Slack routes", async () => {
    const posted: string[] = [];
    let replyCalls = 0;

    await processChannelInteraction({
      agentService: {
        getSessionDiagnostics: async () => ({
          sessionId: "11111111-1111-1111-1111-111111111111",
          resumeCommand:
            "codex resume 11111111-1111-1111-1111-111111111111 --dangerously-bypass-approvals-and-sandbox --no-alt-screen",
        }),
        recordConversationReply: async () => {
          replyCalls += 1;
        },
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/whoami",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(replyCalls).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("platform: `slack`");
    expect(posted[0]).toContain("senderId: `U123`");
    expect(posted[0]).toContain("channelId: `C123`");
    expect(posted[0]).toContain("threadTs: `1.2`");
    expect(posted[0]).toContain("storedSessionId: `11111111-1111-1111-1111-111111111111`");
    expect(posted[0]).toContain(
      "resumeCommand: `codex resume 11111111-1111-1111-1111-111111111111 --dangerously-bypass-approvals-and-sandbox --no-alt-screen`",
    );
    expect(posted[0]).toContain("principal: `slack:U123`");
    expect(posted[0]).toContain("principalFormat: `slack:<nativeUserId>`");
    expect(posted[0]).toContain("principalExample: `slack:U123`");
    expect(posted[0]).toContain("appRole: `member`");
    expect(posted[0]).toContain("agentRole: `member`");
    expect(posted[0]).toContain("mayBypassSharedSenderPolicy: `false`");
    expect(posted[0]).toContain("canUseShell: `false`");
    expect(posted[0]).toContain("verbose: `minimal`");
  });

  test("renders whoami for Telegram routes", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getSessionDiagnostics: async () => ({
          sessionId: "22222222-2222-2222-2222-222222222222",
          resumeCommand:
            "codex resume 22222222-2222-2222-2222-222222222222 --dangerously-bypass-approvals-and-sandbox --no-alt-screen",
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: {
        agentId: "default",
        sessionKey: "agent:default:telegram:group:-1001:topic:4",
      },
      identity: {
        platform: "telegram",
        conversationKind: "topic",
        senderId: "123",
        chatId: "-1001",
        topicId: "4",
      },
      senderId: "123",
      text: "/whoami",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("platform: `telegram`");
    expect(posted[0]).toContain("conversationKind: `topic`");
    expect(posted[0]).toContain("chatId: `-1001`");
    expect(posted[0]).toContain("topicId: `4`");
    expect(posted[0]).toContain("storedSessionId: `22222222-2222-2222-2222-222222222222`");
    expect(posted[0]).toContain(
      "resumeCommand: `codex resume 22222222-2222-2222-2222-222222222222 --dangerously-bypass-approvals-and-sandbox --no-alt-screen`",
    );
    expect(posted[0]).toContain("principal: `telegram:123`");
    expect(posted[0]).toContain("principalFormat: `telegram:<nativeUserId>`");
    expect(posted[0]).toContain("principalExample: `telegram:123`");
    expect(posted[0]).toContain("appRole: `member`");
    expect(posted[0]).toContain("agentRole: `member`");
    expect(posted[0]).toContain("mayBypassSharedSenderPolicy: `false`");
    expect(posted[0]).toContain("verbose: `minimal`");
  });

  test("renders status with resolved auth details for routed conversations", async () => {
    const posted: string[] = [];
    const startedAt = 1_700_000_000_000;
    const detachedAt = 1_700_000_060_000;

    await processChannelInteraction({
      agentService: {
        getConversationFollowUpState: async () => ({
          lastBotReplyAt: Date.now(),
        }),
        getSessionDiagnostics: async () => ({
          sessionId: "33333333-3333-3333-3333-333333333333",
          resumeCommand:
            "codex resume 33333333-3333-3333-3333-333333333333 --dangerously-bypass-approvals-and-sandbox --no-alt-screen",
        }),
        getSessionRuntime: async () => ({
          state: "detached",
          startedAt,
          detachedAt,
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/status",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Status");
    expect(posted[0]).toContain("storedSessionId: `33333333-3333-3333-3333-333333333333`");
    expect(posted[0]).toContain(
      "resumeCommand: `codex resume 33333333-3333-3333-3333-333333333333 --dangerously-bypass-approvals-and-sandbox --no-alt-screen`",
    );
    expect(posted[0]).toContain("responseMode: `capture-pane`");
    expect(posted[0]).toContain("additionalMessageMode: `steer`");
    expect(posted[0]).toContain("verbose: `minimal`");
    expect(posted[0]).toContain("principal: `slack:U123`");
    expect(posted[0]).toContain("principalFormat: `slack:<nativeUserId>`");
    expect(posted[0]).toContain("principalExample: `slack:U123`");
    expect(posted[0]).toContain("run.state: `detached`");
    expect(posted[0]).toContain(`run.startedAt: \`${new Date(startedAt).toISOString()}\``);
    expect(posted[0]).toContain(`run.detachedAt: \`${new Date(detachedAt).toISOString()}\``);
    expect(posted[0]).toContain("appRole: `member`");
    expect(posted[0]).toContain("agentRole: `member`");
    expect(posted[0]).toContain("mayBypassSharedSenderPolicy: `false`");
    expect(posted[0]).toContain("canUseShell: `false`");
    expect(posted[0]).toContain("/attach`, `/detach`, `/watch every <duration>`");
    expect(posted[0]).toContain("/transcript` enabled on this route (`verbose: minimal`)");
    expect(posted[0]).toContain("/bash` requires `shellExecute`");
  });

  test("renders start with principal details for routed conversations", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getConversationFollowUpState: async () => ({}),
        getSessionRuntime: async () => ({
          state: "idle",
        }),
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/start",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Status");
    expect(posted[0]).toContain("principal: `slack:U123`");
    expect(posted[0]).toContain("principalFormat: `slack:<nativeUserId>`");
    expect(posted[0]).toContain("principalExample: `slack:U123`");
  });

  test("shows persisted response mode for the current route", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...JSON.parse(renderDefaultConfigTemplate()),
          bots: {
            ...JSON.parse(renderDefaultConfigTemplate()).bots,
            slack: {
              ...JSON.parse(renderDefaultConfigTemplate()).bots.slack,
              default: {
                ...JSON.parse(renderDefaultConfigTemplate()).bots.slack.default,
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    responseMode: "message-tool",
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/responsemode status",
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
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Response mode");
    expect(posted[0]).toContain("activeRoute.responseMode: `message-tool`");
    expect(posted[0]).toContain("config.responseMode: `message-tool`");
  });

  test("updates mention-only for the current conversation via /mention", async () => {
    const posted: string[] = [];
    let setModeCalls = 0;
    let replyCalls = 0;

    await processChannelInteraction({
      agentService: {
        setConversationFollowUpMode: async (_target: AgentSessionTarget, mode: string) => {
          setModeCalls += 1;
          expect(mode).toBe("mention-only");
        },
        recordConversationReply: async () => {
          replyCalls += 1;
        },
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/mention",
      route: createRoute(),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(setModeCalls).toBe(1);
    expect(replyCalls).toBe(1);
    expect(posted[0]).toContain("Follow-up mode set to `mention-only` for this conversation.");
  });

  test("updates mention-only for the current Slack channel via /mention channel", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());
    let setModeCalls = 0;

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            slack: {
              ...template.bots.slack,
              default: {
                ...template.bots.slack.default,
                followUp: {
                  ...template.bots.slack.default.followUp,
                  mode: "auto",
                },
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    followUp: {
                      mode: "auto",
                    },
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          setConversationFollowUpMode: async (_target: AgentSessionTarget, mode: string) => {
            setModeCalls += 1;
            expect(mode).toBe("mention-only");
          },
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/mention channel",
        route: createRoute(),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });

      const updated = JSON.parse(readFileSync(configPath, "utf8"));
      expect(updated.bots.slack.default.groups.C123.followUp.mode).toBe("mention-only");
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(setModeCalls).toBe(1);
    expect(posted[0]).toContain("Updated follow-up mode for `slack group:C123`.");
    expect(posted[0]).toContain("config.followUp.mode: `mention-only`");
    expect(posted[0]).toContain("currentConversation.overrideMode: `mention-only`");
  });

  test("updates mention-only for the current Telegram group via /mention channel from a topic", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            telegram: {
              ...template.bots.telegram,
              default: {
                ...template.bots.telegram.default,
                followUp: {
                  ...template.bots.telegram.default.followUp,
                  mode: "auto",
                },
                groups: {
                  "-1001": {
                    requireMention: true,
                    allowUsers: [],
                    blockUsers: [],
                    topics: {
                      "4": {
                        enabled: true,
                        allowUsers: [],
                        blockUsers: [],
                      },
                    },
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          setConversationFollowUpMode: async () => undefined,
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTelegramTopicTarget(),
        identity: createTelegramTopicIdentity(),
        senderId: "123",
        text: "/mention channel",
        route: createRoute(),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });

      const updated = JSON.parse(readFileSync(configPath, "utf8"));
      expect(updated.bots.telegram.default.groups["-1001"].followUp.mode).toBe("mention-only");
      expect(updated.bots.telegram.default.groups["-1001"].topics["4"].followUp).toBeUndefined();
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated follow-up mode for `telegram group:-1001`.");
  });

  test("updates mention-only for the current bot via /mention all", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            slack: {
              ...template.bots.slack,
              default: {
                ...template.bots.slack.default,
                followUp: {
                  ...template.bots.slack.default.followUp,
                  mode: "auto",
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          setConversationFollowUpMode: async () => undefined,
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/mention all",
        route: createRoute(),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });

      const updated = JSON.parse(readFileSync(configPath, "utf8"));
      expect(updated.bots.slack.default.followUp.mode).toBe("mention-only");
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated follow-up mode for `slack bot default`.");
    expect(posted[0]).toContain("bot-wide default");
  });

  test("shows persisted streaming mode for the current route", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            slack: {
              ...template.bots.slack,
              default: {
                ...template.bots.slack.default,
                groups: {
                  C123: {
                    requireMention: true,
                    streaming: "all",
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/streaming status",
        route: createRoute({
          streaming: "latest",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Streaming mode: `latest`");
    expect(posted[0]).toContain("config.target: `slack group:C123`");
    expect(posted[0]).not.toContain("activeRoute.streaming:");
    expect(posted[0]).not.toContain("config.streaming:");
  });

  test("updates persisted streaming mode for the current route", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            slack: {
              ...template.bots.slack,
              default: {
                ...template.bots.slack.default,
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    streaming: "off",
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/streaming on",
        route: createRoute({
          streaming: "off",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated streaming mode");
    expect(posted[0]).toContain("config.streaming: `all`");
    expect(posted[0]).toContain("persists as `all`");
  });

  test("shows persisted streaming mode for a telegram topic that inherits from its group route", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            telegram: {
              ...template.bots.telegram,
              default: {
                ...template.bots.telegram.default,
                groups: {
                  "-1001": {
                    requireMention: true,
                    streaming: "all",
                    topics: {},
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTelegramTopicTarget(),
        identity: createTelegramTopicIdentity(),
        senderId: "123",
        text: "/streaming status",
        route: createRoute({
          streaming: "all",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Streaming mode: `all`");
    expect(posted[0]).toContain("config.target: `telegram topic:-1001:4`");
  });

  test("updates persisted streaming mode for a telegram topic by materializing a topic override", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            telegram: {
              ...template.bots.telegram,
              default: {
                ...template.bots.telegram.default,
                groups: {
                  "-1001": {
                    requireMention: true,
                    streaming: "all",
                    topics: {},
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTelegramTopicTarget(),
        identity: createTelegramTopicIdentity(),
        senderId: "123",
        text: "/streaming off",
        route: createRoute({
          streaming: "all",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });

      const updated = JSON.parse(readFileSync(configPath, "utf8"));
      expect(updated.bots.telegram.default.groups["-1001"].topics["4"].streaming).toBe("off");
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated streaming mode");
    expect(posted[0]).toContain("`telegram topic:-1001:4`");
  });

  test("updates persisted response mode for the current route", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...JSON.parse(renderDefaultConfigTemplate()),
          bots: {
            ...JSON.parse(renderDefaultConfigTemplate()).bots,
            slack: {
              ...JSON.parse(renderDefaultConfigTemplate()).bots.slack,
              default: {
                ...JSON.parse(renderDefaultConfigTemplate()).bots.slack.default,
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    responseMode: "message-tool",
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/responsemode capture-pane",
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
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated response mode");
    expect(posted[0]).toContain("config.responseMode: `capture-pane`");
  });

  test("shows persisted additional message mode for the current route", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            slack: {
              ...template.bots.slack,
              default: {
                ...template.bots.slack.default,
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    additionalMessageMode: "queue",
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/additionalmessagemode status",
        route: createRoute({
          additionalMessageMode: "queue",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Additional message mode");
    expect(posted[0]).toContain("activeRoute.additionalMessageMode: `queue`");
    expect(posted[0]).toContain("config.additionalMessageMode: `queue`");
  });

  test("updates persisted additional message mode for the current route", async () => {
    const posted: string[] = [];
    const originalConfigPath = process.env.CLISBOT_CONFIG_PATH;
    const configDir = mkdtempSync(join(tmpdir(), "clisbot-interaction-config-"));
    const configPath = join(configDir, "clisbot.json");
    const template = JSON.parse(renderDefaultConfigTemplate());

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...template,
          bots: {
            ...template.bots,
            slack: {
              ...template.bots.slack,
              default: {
                ...template.bots.slack.default,
                groups: {
                  "channel:C123": {
                    requireMention: true,
                    additionalMessageMode: "steer",
                  },
                },
              },
            },
          },
        }, null, 2),
      );
      process.env.CLISBOT_CONFIG_PATH = configPath;

      await processChannelInteraction({
        agentService: {
          recordConversationReply: async () => undefined,
        } as any,
        sessionTarget: createTarget(),
        identity: createIdentity(),
        senderId: "U123",
        text: "/additionalmessagemode queue",
        route: createRoute({
          additionalMessageMode: "steer",
        }),
        maxChars: 4000,
        postText: async (text) => {
          posted.push(text);
          return [text];
        },
        reconcileText: async (_chunks, text) => [text],
      });
    } finally {
      process.env.CLISBOT_CONFIG_PATH = originalConfigPath;
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(posted[0]).toContain("Updated additional message mode");
    expect(posted[0]).toContain("config.additionalMessageMode: `queue`");
  });

  test("passes the protected control rule into created loops", async () => {
    const posted: string[] = [];
    let observedProtectedRule: string | undefined;

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
          defaultTimezone: "UTC",
        }),
        createIntervalLoop: async (params: { protectedControlMutationRule?: string }) => {
          observedProtectedRule = params.protectedControlMutationRule;
          return {
            id: "loop1",
            maxRuns: 20,
          };
        },
        listIntervalLoops: () => [],
        getActiveIntervalLoopCount: () => 1,
        recordConversationReply: async () => undefined,
      } as any,
      sessionTarget: createTarget(),
      identity: createIdentity(),
      senderId: "U123",
      text: "/loop 5m review the queue",
      protectedControlMutationRule: "Refuse protected control changes.",
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

    expect(observedProtectedRule).toBe("Refuse protected control changes.");
    expect(posted[0]).toContain("Started loop");
  });
});

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

describe("processChannelInteraction agent prompt text", () => {
  test("uses agentPromptText for the agent-bound prompt while keeping slash parsing on raw text", async () => {
    let observedPrompt = "";

    await processChannelInteraction({
      agentService: {
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          observedPrompt = prompt;
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

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          observedPrompt = prompt;
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
    expect(reconciled).toContain("working draft");
    expect(reconciled.at(-1)).toContain("working draft");
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
    expect(reconciled).toContain("draft one");
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
    expect(reconciled).toContain("draft one");
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
    expect(reconciled).toContain("draft before final");
    expect(reconciled.at(-1)).toBe("");
  });

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
          observedPrompt = prompt;
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

  test("queue command forces clisbot-managed delivery even in message-tool mode", async () => {
    const posted: string[] = [];
    const reconciled: string[] = [];
    let observedPrompt = "";

    await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        enqueuePrompt: (_target: AgentSessionTarget, prompt: string) => {
          observedPrompt = prompt;
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
          observedPrompt = prompt;
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
          observedPrompt = prompt;
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
          observedPrompt = prompt;
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
          observedPrompt = prompt;
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
          enqueued.push(prompt);
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
          enqueued.push(prompt);
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
          enqueued.push(prompt);
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
          enqueued.push(prompt);
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
        }: {
          promptText: string;
          intervalMs: number;
          maxRuns: number;
        }) => {
          enqueued.push(promptText);
          scheduledIntervalMs = intervalMs;
          createdMaxRuns = maxRuns;
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
          enqueued.push(prompt);
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
    expect(enqueued).toEqual(["wrapped:check deploy"]);
  });

  test("loop calendar mode schedules the first run using route timezone", async () => {
    const posted: string[] = [];
    let observedTimezone = "";
    let observedCadence = "";

    await processChannelInteraction({
      agentService: {
        getLoopConfig: () => ({
          maxRunsPerLoop: 20,
          maxActiveLoops: 10,
          defaultTimezone: "UTC",
        }),
        getWorkspacePath: () => "/tmp/workspace",
        createCalendarLoop: async ({
          cadence,
          timezone,
        }: {
          cadence: string;
          timezone: string;
        }) => {
          observedCadence = cadence;
          observedTimezone = timezone;
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
      text: "/loop every day at 07:00 check deploy",
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
    expect(posted[0]).toContain("Started loop `loopcal1` every day at 07:00.");
    expect(posted[0]).toContain("timezone: `Asia/Ho_Chi_Minh`");
    expect(posted[0]).toContain("The first run is scheduled for `2026-04-13T00:00:00.000Z`.");
  });

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
            enqueued.push(prompt);
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
        cancelIntervalLoop: async (loopId: string) => {
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
        cancelIntervalLoop: async (loopId: string) => {
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
