import { afterEach, beforeEach } from "bun:test";
import type { ChannelInteractionIdentity, ChannelInteractionRoute } from "../../src/channels/message/interaction-processing.ts";
import type { AgentSessionTarget } from "../../src/agents/runtime/agent-service.ts";
import { setRenderedCliName } from "../../src/control/commands/cli-name.ts";

export function registerCliNameIsolation() {
  let previousCliName: string | undefined;

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    delete process.env.CLISBOT_CLI_NAME;
    setRenderedCliName();
  });

  afterEach(() => {
    process.env.CLISBOT_CLI_NAME = previousCliName;
    setRenderedCliName(previousCliName);
  });
}

export function createRoute(
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

export function createTarget(): AgentSessionTarget {
  return {
    agentId: "default",
    sessionKey: "agent:default:slack:channel:c123:thread:1.2",
  };
}

export function createIdentity(
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

export function renderCapturedPrompt(prompt: string | (() => string)) {
  return typeof prompt === "function" ? prompt() : prompt;
}

export function createTelegramTopicIdentity(
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

export function createTelegramTopicTarget(): AgentSessionTarget {
  return {
    agentId: "default",
    sessionKey: "agent:default:telegram:group:-1001:topic:4",
  };
}
