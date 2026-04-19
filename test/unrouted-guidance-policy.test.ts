import { describe, expect, test } from "bun:test";
import { shouldGuideUnroutedConversation } from "../src/channels/unrouted-guidance-policy.ts";

describe("unrouted guidance policy", () => {
  test("keeps Slack-style shared surfaces mention-gated when standalone commands are unsupported", () => {
    expect(
      shouldGuideUnroutedConversation({
        conversationKind: "channel",
        explicitlyAddressed: false,
        isGuidanceCommand: true,
        allowCommandOnlyGuidance: false,
        isBotOriginated: false,
      }),
    ).toBe(false);
    expect(
      shouldGuideUnroutedConversation({
        conversationKind: "channel",
        explicitlyAddressed: true,
        isGuidanceCommand: false,
        allowCommandOnlyGuidance: false,
        isBotOriginated: false,
      }),
    ).toBe(true);
  });

  test("allows Telegram-style shared surfaces to guide on explicit mentions or native slash onboarding", () => {
    expect(
      shouldGuideUnroutedConversation({
        conversationKind: "topic",
        explicitlyAddressed: true,
        isGuidanceCommand: false,
        allowCommandOnlyGuidance: true,
        isBotOriginated: false,
      }),
    ).toBe(true);
    expect(
      shouldGuideUnroutedConversation({
        conversationKind: "group",
        explicitlyAddressed: false,
        isGuidanceCommand: true,
        allowCommandOnlyGuidance: true,
        isBotOriginated: false,
      }),
    ).toBe(true);
  });

  test("only guides unrouted direct messages for actual onboarding commands", () => {
    expect(
      shouldGuideUnroutedConversation({
        conversationKind: "dm",
        explicitlyAddressed: true,
        isGuidanceCommand: false,
        allowCommandOnlyGuidance: true,
        isBotOriginated: false,
      }),
    ).toBe(false);
    expect(
      shouldGuideUnroutedConversation({
        conversationKind: "dm",
        explicitlyAddressed: false,
        isGuidanceCommand: true,
        allowCommandOnlyGuidance: true,
        isBotOriginated: false,
      }),
    ).toBe(true);
  });

  test("never guides bot-originated traffic", () => {
    expect(
      shouldGuideUnroutedConversation({
        conversationKind: "group",
        explicitlyAddressed: true,
        isGuidanceCommand: true,
        allowCommandOnlyGuidance: true,
        isBotOriginated: true,
      }),
    ).toBe(false);
  });
});
