import { describe, expect, test } from "bun:test";
import {
  processChannelInteraction,
  type ChannelInteractionIdentity,
  type ChannelInteractionRoute,
} from "../src/channels/interaction-processing.ts";
import type { AgentSessionTarget } from "../src/agents/agent-service.ts";

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
  test("blocks transcript requests when sensitive commands are disabled", async () => {
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
      route: createRoute(),
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
    expect(posted[0]).toContain("Privilege commands are not allowed");
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
  });

  test("allows transcript requests when privilege commands are enabled", async () => {
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
      route: createRoute({
        privilegeCommands: {
          enabled: true,
          allowUsers: [],
        },
      }),
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
      route: createRoute({
        privilegeCommands: {
          enabled: true,
          allowUsers: [],
        },
      }),
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
      senderId: "U999",
      text: "/transcript",
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

    expect(transcriptCalls).toBe(0);
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
  });

  test("renders status with operator privilege commands for routed conversations", async () => {
    const posted: string[] = [];

    await processChannelInteraction({
      agentService: {
        getConversationFollowUpState: async () => ({
          lastBotReplyAt: Date.now(),
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
    expect(posted[0]).toContain("muxbot status");
    expect(posted[0]).toContain("Operator commands:");
    expect(posted[0]).toContain("bun run src/main.ts channels privilege enable slack-channel C123");
    expect(posted[0]).toContain("bun run src/main.ts channels privilege allow-user slack-channel C123 U123");
  });
});
