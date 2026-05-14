import { describe, expect, test } from "bun:test";
import {
  isChannelSenderAllowed,
  normalizeAllowEntry,
} from "../src/channels/pairing/access.ts";

describe("pairing access helpers", () => {
  test("normalizes Slack allowFrom entries", () => {
    expect(normalizeAllowEntry("slack", "u123")).toBe("U123");
    expect(normalizeAllowEntry("slack", "slack:U123")).toBe("U123");
    expect(normalizeAllowEntry("slack", "user:U123")).toBe("U123");
  });

  test("matches Slack user ids against config and store allowlists", () => {
    expect(
      isChannelSenderAllowed({
        channel: "slack",
        allowFrom: ["slack:U123", "U999"],
        subject: {
          userId: "u123",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "slack",
        allowFrom: ["U999"],
        subject: {
          userId: "U123",
        },
      }),
    ).toBe(false);
  });

  test("normalizes Telegram ids and usernames", () => {
    expect(normalizeAllowEntry("telegram", "123456")).toBe("123456");
    expect(normalizeAllowEntry("telegram", "@Alice")).toBe("@alice");
    expect(normalizeAllowEntry("telegram", "alice")).toBe("@alice");
    expect(normalizeAllowEntry("telegram", "tg:@Alice")).toBe("@alice");
  });

  test("matches Telegram by id or username", () => {
    expect(
      isChannelSenderAllowed({
        channel: "telegram",
        allowFrom: ["123456"],
        subject: {
          userId: "123456",
          username: "alice",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "telegram",
        allowFrom: ["@alice"],
        subject: {
          userId: "999999",
          username: "Alice",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "telegram",
        allowFrom: ["@bob"],
        subject: {
          userId: "999999",
          username: "Alice",
        },
      }),
    ).toBe(false);
  });

  test("normalizes Zalo Bot ids and handles", () => {
    expect(normalizeAllowEntry("zalo-bot", "123456")).toBe("123456");
    expect(normalizeAllowEntry("zalo-bot", "@Alice")).toBe("@alice");
    expect(normalizeAllowEntry("zalo-bot", "alice")).toBe("@alice");
    expect(normalizeAllowEntry("zalo-bot", "zalo-bot:@Alice")).toBe("@alice");
  });

  test("matches Zalo Bot by id or handle", () => {
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["123456"],
        subject: {
          userId: "123456",
          username: "alice",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["@alice"],
        subject: {
          userId: "999999",
          username: "Alice",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["@bob"],
        subject: {
          userId: "999999",
          username: "Alice",
        },
      }),
    ).toBe(false);
  });

  test("does not accept legacy generic aliases for Zalo Bot allowlist entries", () => {
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["zalo:@alice"],
        subject: {
          userId: "999999",
          username: "Alice",
        },
      }),
    ).toBe(false);
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["user:123456"],
        subject: {
          userId: "123456",
        },
      }),
    ).toBe(false);
  });
});
