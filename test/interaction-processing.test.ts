import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  processChannelInteraction,
  type ChannelInteractionIdentity,
  type ChannelInteractionRoute,
} from "../src/channels/interaction-processing.ts";
import type { AgentSessionTarget } from "../src/agents/agent-service.ts";
import { renderDefaultConfigTemplate } from "../src/config/template.ts";

function createRoute(
  overrides: Partial<ChannelInteractionRoute> = {},
): ChannelInteractionRoute {
  return {
    agentId: "default",
    privilegeCommands: {
      enabled: false,
      allowUsers: [],
    },
    commandPrefixes: {
      slash: ["::", "\\"],
      bash: ["!"],
    },
    streaming: "all",
    response: "final",
    responseMode: "capture-pane",
    additionalMessageMode: "steer",
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

describe("processChannelInteraction sensitive command gating", () => {
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

  test("blocks bash commands when sensitive commands are disabled", async () => {
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
    expect(posted[0]).toContain("Privilege commands are not allowed");
    expect(posted[0]).toContain("clisbot channels privilege enable slack-channel C123");
    expect(posted[0]).toContain("clisbot channels privilege allow-user slack-channel C123 U123");
  });

  test("allows transcript requests when route verbose is minimal", async () => {
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
    expect(posted[0]).toContain("runner output");
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
      route: createRoute({
        privilegeCommands: {
          enabled: true,
          allowUsers: [],
        },
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

  test("blocks privilege commands when allowUsers excludes the sender", async () => {
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
      route: createRoute({
        privilegeCommands: {
          enabled: true,
          allowUsers: ["U123"],
        },
      }),
      maxChars: 4000,
      postText: async (text) => {
        posted.push(text);
        return [text];
      },
      reconcileText: async (_chunks, text) => [text],
    });

    expect(bashCalls).toBe(0);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Privilege commands are not allowed");
  });

  test("renders whoami for Slack routes", async () => {
    const posted: string[] = [];
    let replyCalls = 0;

    await processChannelInteraction({
      agentService: {
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
    expect(posted[0]).toContain("verbose: `minimal`");
  });

  test("renders whoami for Telegram routes", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
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
    expect(posted[0]).toContain("verbose: `minimal`");
  });

  test("renders status with operator privilege commands for routed conversations", async () => {
    const posted: string[] = [];
    const startedAt = 1_700_000_000_000;
    const detachedAt = 1_700_000_060_000;

    await processChannelInteraction({
      agentService: {
        getConversationFollowUpState: async () => ({
          lastBotReplyAt: Date.now(),
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
    expect(posted[0]).toContain("clisbot status");
    expect(posted[0]).toContain("responseMode: `capture-pane`");
    expect(posted[0]).toContain("additionalMessageMode: `steer`");
    expect(posted[0]).toContain("verbose: `minimal`");
    expect(posted[0]).toContain("run.state: `detached`");
    expect(posted[0]).toContain(`run.startedAt: \`${new Date(startedAt).toISOString()}\``);
    expect(posted[0]).toContain(`run.detachedAt: \`${new Date(detachedAt).toISOString()}\``);
    expect(posted[0]).toContain("/attach`, `/detach`, `/watch every 30s`");
    expect(posted[0]).toContain("/transcript` enabled on this route (`verbose: minimal`)");
    expect(posted[0]).toContain("Operator commands:");
    expect(posted[0]).toContain("clisbot channels privilege enable slack-channel C123");
    expect(posted[0]).toContain("clisbot channels privilege allow-user slack-channel C123 U123");
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
          channels: {
            ...JSON.parse(renderDefaultConfigTemplate()).channels,
            slack: {
              ...JSON.parse(renderDefaultConfigTemplate()).channels.slack,
              channels: {
                C123: {
                  requireMention: true,
                  responseMode: "message-tool",
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

    expect(posted[0]).toContain("clisbot response mode");
    expect(posted[0]).toContain("activeRoute.responseMode: `message-tool`");
    expect(posted[0]).toContain("config.responseMode: `message-tool`");
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
          channels: {
            ...JSON.parse(renderDefaultConfigTemplate()).channels,
            slack: {
              ...JSON.parse(renderDefaultConfigTemplate()).channels.slack,
              channels: {
                C123: {
                  requireMention: true,
                  responseMode: "message-tool",
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
          channels: {
            ...template.channels,
            slack: {
              ...template.channels.slack,
              channels: {
                C123: {
                  requireMention: true,
                  additionalMessageMode: "queue",
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

    expect(posted[0]).toContain("clisbot additional message mode");
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
          channels: {
            ...template.channels,
            slack: {
              ...template.channels.slack,
              channels: {
                C123: {
                  requireMention: true,
                  additionalMessageMode: "steer",
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
              "This session has been running for over 15 minutes. clisbot left it running as-is. Use `/attach`, `/watch every 30s`, or `/stop` to manage it.",
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
              "This session has been running for over 15 minutes. clisbot left it running as-is. Use `/attach`, `/watch every 30s`, or `/stop` to manage it.",
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

  test("suppresses normal channel delivery when message-tool mode is enabled", async () => {
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

    expect(posted).toEqual([]);
    expect(reconciled).toEqual([]);
  });

  test("still posts a fallback error when message-tool mode fails before the agent can reply", async () => {
    const posted: string[] = [];

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
      reconcileText: async (_chunks, text) => [text],
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("runner crashed");
  });

  test("steers additional user messages into the active run by default", async () => {
    const posted: string[] = [];
    const submitted: string[] = [];
    let replyCalls = 0;

    const result = await processChannelInteraction({
      agentService: {
        isAwaitingFollowUpRouting: async () => true,
        hasActiveRun: () => true,
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
    expect(submitted[0]).toContain("please focus on the regression first");
    expect(submitted[0]).toContain("</user>");
    expect(posted).toEqual([]);
    expect(replyCalls).toBe(0);
    expect(result.processingIndicatorLifecycle).toBe("active-run");
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

  test("queue mode forces queued acknowledgment and clisbot-managed settlement while busy", async () => {
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
            snapshot: "queued mode final",
            fullSnapshot: "queued mode final",
            initialSnapshot: "",
          }),
        }),
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

    expect(posted[0]).toContain("Queued: 1 ahead.");
    expect(posted.at(-1)).toContain("queued mode final");
    expect(reconciled).toEqual([]);
  });

  test("explicit steer command injects a steering message into the active run", async () => {
    const posted: string[] = [];
    const submitted: string[] = [];

    const result = await processChannelInteraction({
      agentService: {
        hasActiveRun: () => true,
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
    expect(posted).toEqual([]);
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
      text: "/queue-list",
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
      text: "/queue-clear",
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

    expect(posted[0]).toContain("Started loop for 3 iterations.");
    expect(enqueued).toEqual([
      "wrapped:/codereview",
      "wrapped:/codereview",
      "wrapped:/codereview",
    ]);
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
        observeRun: async (_target: AgentSessionTarget, observer: any) => {
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
  });

  test("watch registers a polling observer", async () => {
    let observedMode = "";
    let observedInterval = 0;

    await processChannelInteraction({
      agentService: {
        observeRun: async (_target: AgentSessionTarget, observer: any) => {
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
});
