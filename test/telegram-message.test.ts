import { describe, expect, test } from "bun:test";
import {
  hasForeignTelegramMention,
  hasTelegramBotMention,
  resolveTelegramTopicName,
} from "../src/channels/telegram/message.ts";

describe("telegram message helpers", () => {
  test("detects direct mentions for the current bot username", () => {
    expect(hasTelegramBotMention("@MyBot please check", "mybot")).toBe(true);
    expect(hasTelegramBotMention("hello @otherbot", "mybot")).toBe(false);
  });

  test("treats mentions for someone else as foreign mentions", () => {
    expect(hasForeignTelegramMention("@otherbot please check", "mybot")).toBe(true);
    expect(hasForeignTelegramMention("/status@otherbot", "mybot")).toBe(true);
    expect(hasForeignTelegramMention("@mybot please check", "mybot")).toBe(false);
    expect(hasForeignTelegramMention("@mybot please check @otherbot", "mybot")).toBe(false);
    expect(hasForeignTelegramMention("plain follow-up", "mybot")).toBe(false);
  });

  test("resolves topic names from topic creation metadata", () => {
    expect(resolveTelegramTopicName({
      message_id: 1,
      chat: {
        id: -1001,
        type: "supergroup",
      },
      reply_to_message: {
        forum_topic_created: {
          name: "clisbot-streaming",
        },
      },
    })).toBe("clisbot-streaming");
  });
});
