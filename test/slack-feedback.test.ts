import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isSlackCommandLikeMessage,
  renderSlackMentionRequiredMessage,
  renderSlackRouteChoiceMessage,
  sendSlackGuidanceOnce,
  shouldGuideUnroutedSlackEvent,
  shouldSendSlackMentionRequiredGuidance,
} from "../src/channels/slack/feedback.ts";
import { ProcessedEventsStore } from "../src/channels/processed-events-store.ts";

describe("slack feedback helpers", () => {
  let previousCliName: string | undefined;

  beforeEach(() => {
    previousCliName = process.env.CLISBOT_CLI_NAME;
    delete process.env.CLISBOT_CLI_NAME;
  });

  afterEach(() => {
    process.env.CLISBOT_CLI_NAME = previousCliName;
  });

  test("treats mapped slash-style control commands as command-like", () => {
    expect(
      isSlackCommandLikeMessage({
        text: "\\status",
        botUsername: "clisbot",
        commandPrefixes: {
          slash: ["::", "\\"],
          bash: ["!"],
        },
      }),
    ).toBe(true);
  });

  test("renders unrouted channel guidance with concrete add-route commands", () => {
    const text = renderSlackRouteChoiceMessage({
      channelId: "C123",
      botLabel: "clisbot",
    });

    expect(text).toContain("this Slack channel is not configured yet");
    expect(text).toContain("`clisbot routes add --channel slack group:C123 --bot default`");
    expect(text).toContain(
      "`clisbot routes set-agent --channel slack group:C123 --bot default --agent <id>`",
    );
    expect(text).toContain("mention this bot (clisbot)");
    expect(text).toContain("`\\start`");
    expect(text).toContain("`\\mention`");
    expect(text).not.toContain("@clisbot");
  });

  test("renders mention-required guidance with concrete examples", () => {
    const text = renderSlackMentionRequiredMessage("clisbot");

    expect(text).toContain("requires a bot mention");
    expect(text).toContain("mention this bot (clisbot)");
    expect(text).toContain("`\\status`");
    expect(text).toContain("`\\mention`");
    expect(text).not.toContain("@clisbot");
  });

  test("mention-required guidance stays silent in shared channels and groups", () => {
    expect(
      shouldSendSlackMentionRequiredGuidance({
        conversationKind: "channel",
        isCommandLike: true,
      }),
    ).toBe(false);
    expect(
      shouldSendSlackMentionRequiredGuidance({
        conversationKind: "group",
        isCommandLike: true,
      }),
    ).toBe(false);
    expect(
      shouldSendSlackMentionRequiredGuidance({
        conversationKind: "dm",
        isCommandLike: true,
      }),
    ).toBe(true);
    expect(
      shouldSendSlackMentionRequiredGuidance({
        conversationKind: "dm",
        isCommandLike: false,
      }),
    ).toBe(false);
  });

  test("unrouted shared-channel guidance requires mention and drops bot-originated events", () => {
    expect(
      shouldGuideUnroutedSlackEvent({
        conversationKind: "channel",
        isCommandLike: true,
        wasMentioned: false,
        isBotOriginated: false,
      }),
    ).toBe(false);
    expect(
      shouldGuideUnroutedSlackEvent({
        conversationKind: "channel",
        isCommandLike: true,
        wasMentioned: true,
        isBotOriginated: false,
      }),
    ).toBe(true);
    expect(
      shouldGuideUnroutedSlackEvent({
        conversationKind: "group",
        isCommandLike: true,
        wasMentioned: false,
        isBotOriginated: false,
      }),
    ).toBe(false);
    expect(
      shouldGuideUnroutedSlackEvent({
        conversationKind: "dm",
        isCommandLike: true,
        wasMentioned: false,
        isBotOriginated: false,
      }),
    ).toBe(true);
    expect(
      shouldGuideUnroutedSlackEvent({
        conversationKind: "channel",
        isCommandLike: true,
        wasMentioned: true,
        isBotOriginated: true,
      }),
    ).toBe(false);
  });

  test("guidance posts only once per processed event id", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-slack-feedback-"));

    try {
      const store = new ProcessedEventsStore(join(tempDir, "processed-events.json"));
      let sentCount = 0;

      await sendSlackGuidanceOnce({
        eventId: "E123",
        processedEventsStore: store,
        send: async () => {
          sentCount += 1;
        },
      });
      await sendSlackGuidanceOnce({
        eventId: "E123",
        processedEventsStore: store,
        send: async () => {
          sentCount += 1;
        },
      });

      expect(sentCount).toBe(1);
      expect(await store.getStatus("E123")).toBe("completed");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("guidance clears processing state when delivery fails", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clisbot-slack-feedback-"));

    try {
      const store = new ProcessedEventsStore(join(tempDir, "processed-events.json"));

      await expect(
        sendSlackGuidanceOnce({
          eventId: "E124",
          processedEventsStore: store,
          send: async () => {
            throw new Error("slack down");
          },
        }),
      ).rejects.toThrow("slack down");
      expect(await store.getStatus("E124")).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
