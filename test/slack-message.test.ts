import { describe, expect, test } from "bun:test";
import {
  canUseImplicitSlackFollowUp,
  getSlackEventSkipReason,
  hasBotMention,
  isBotOriginatedSlackEvent,
  isImplicitBotThreadReply,
  normalizeSlackMessageEvent,
  stripBotMention,
} from "../src/channels/slack/message.ts";

describe("slack message helpers", () => {
  test("allows bot_message events through subtype skip detection", () => {
    expect(
      getSlackEventSkipReason({
        subtype: "bot_message",
        bot_id: "B123",
      }),
    ).toBeNull();
  });

  test("normalizes message_replied events into the nested reply message", () => {
    expect(
      normalizeSlackMessageEvent({
        type: "message",
        subtype: "message_replied",
        channel: "C123",
        channel_type: "channel",
        message: {
          type: "message",
          user: "U123",
          text: "thread follow-up",
          ts: "111.222",
          thread_ts: "100.200",
          parent_user_id: "U_PARENT",
        },
      }),
    ).toMatchObject({
      type: "message",
      channel: "C123",
      channel_type: "channel",
      user: "U123",
      text: "thread follow-up",
      ts: "111.222",
      thread_ts: "100.200",
      parent_user_id: "U_PARENT",
      subtype: undefined,
    });
  });

  test("detects bot-originated events without a user id", () => {
    expect(
      isBotOriginatedSlackEvent({
        subtype: "bot_message",
        bot_id: "B123",
      }),
    ).toBe(true);
    expect(
      isBotOriginatedSlackEvent({
        user: "U123",
        bot_id: "B123",
      }),
    ).toBe(false);
  });

  test("treats replies to the bot inside a thread as implicit mentions", () => {
    expect(
      isImplicitBotThreadReply(
        {
          parent_user_id: "U_BOT",
          thread_ts: "123.456",
        },
        "U_BOT",
      ),
    ).toBe(true);
    expect(
      isImplicitBotThreadReply(
        {
          parent_user_id: "U_OTHER",
          thread_ts: "123.456",
        },
        "U_BOT",
      ),
    ).toBe(false);
  });

  test("allows implicit follow-up in threaded non-dm Slack conversations", () => {
    expect(
      canUseImplicitSlackFollowUp({
        conversationKind: "channel",
        event: {
          thread_ts: "123.456",
        },
      }),
    ).toBe(true);
    expect(
      canUseImplicitSlackFollowUp({
        conversationKind: "group",
        event: {
          thread_ts: "123.456",
        },
      }),
    ).toBe(true);
    expect(
      canUseImplicitSlackFollowUp({
        conversationKind: "dm",
        event: {
          thread_ts: "123.456",
        },
      }),
    ).toBe(false);
  });

  test("strips only the configured bot mention and preserves plain text", () => {
    expect(hasBotMention("<@U_BOT> reply with pong", "U_BOT")).toBe(true);
    expect(stripBotMention("<@U_BOT> reply with pong", "U_BOT")).toBe("reply with pong");
    expect(stripBotMention("reply with pong", "U_BOT")).toBe("reply with pong");
  });
});
