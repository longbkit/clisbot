import { describe, expect, test } from "bun:test";
import { parseAgentCommand } from "../src/agents/commands.ts";
import {
  resolveTelegramUnroutedGuidanceMode,
  resolveTelegramUnroutedGuidanceModeForEvent,
} from "../src/channels/telegram/feedback.ts";

describe("telegram feedback helpers", () => {
  test("recognizes the shared onboarding slash commands", () => {
    expect(resolveTelegramUnroutedGuidanceMode(parseAgentCommand("/start"))).toBe("start");
    expect(resolveTelegramUnroutedGuidanceMode(parseAgentCommand("/status"))).toBe("status");
    expect(resolveTelegramUnroutedGuidanceMode(parseAgentCommand("/help"))).toBe("help");
    expect(resolveTelegramUnroutedGuidanceMode(parseAgentCommand("/whoami"))).toBe("whoami");
    expect(resolveTelegramUnroutedGuidanceMode(parseAgentCommand("/streaming status"))).toBeNull();
  });

  test("guides unrouted shared Telegram mentions even without a slash command", () => {
    expect(
      resolveTelegramUnroutedGuidanceModeForEvent({
        conversationKind: "group",
        rawText: "@mybot kiểm tra giúp",
        botUsername: "mybot",
        slashCommand: null,
        isBotOriginated: false,
      }),
    ).toBe("start");
  });

  test("keeps Telegram native slash onboarding working without an explicit mention", () => {
    expect(
      resolveTelegramUnroutedGuidanceModeForEvent({
        conversationKind: "topic",
        rawText: "/status",
        botUsername: "mybot",
        slashCommand: parseAgentCommand("/status", { botUsername: "mybot" }),
        isBotOriginated: false,
      }),
    ).toBe("status");
  });

  test("drops foreign mentions, plain shared messages, and bot-originated updates", () => {
    expect(
      resolveTelegramUnroutedGuidanceModeForEvent({
        conversationKind: "group",
        rawText: "/status@otherbot",
        botUsername: "mybot",
        slashCommand: parseAgentCommand("/status@otherbot", { botUsername: "mybot" }),
        isBotOriginated: false,
      }),
    ).toBeNull();
    expect(
      resolveTelegramUnroutedGuidanceModeForEvent({
        conversationKind: "group",
        rawText: "plain message",
        botUsername: "mybot",
        slashCommand: null,
        isBotOriginated: false,
      }),
    ).toBeNull();
    expect(
      resolveTelegramUnroutedGuidanceModeForEvent({
        conversationKind: "group",
        rawText: "@mybot hi",
        botUsername: "mybot",
        slashCommand: null,
        isBotOriginated: true,
      }),
    ).toBeNull();
  });
});
