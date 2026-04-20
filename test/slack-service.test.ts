import { describe, expect, test } from "bun:test";
import { SlackSocketService } from "../src/channels/slack/service.ts";

describe("SlackSocketService allowBots enforcement", () => {
  test("drops routed bot-originated messages when allowBots is false", async () => {
    const completed: string[] = [];

    await (SlackSocketService.prototype as any).handleInboundMessage.call(
      {
        shouldDropMismatchedSlackEvent: () => false,
        processedEventsStore: {
          getStatus: async () => null,
          markCompleted: async (eventId: string) => {
            completed.push(eventId);
          },
        },
        markMessageSeen: () => false,
        botUserId: "U_SELF",
      },
      {
        body: {
          event_id: "evt-1",
        },
        event: {
          channel: "C123",
          subtype: "bot_message",
          bot_id: "B_OTHER",
          ts: "111.222",
          text: "hello from another bot",
        },
        conversationKind: "channel",
        route: {
          allowBots: false,
        },
        wasMentioned: false,
      },
    );

    expect(completed).toEqual(["evt-1"]);
  });
});
