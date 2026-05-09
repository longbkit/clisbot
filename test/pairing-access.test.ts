import { describe, expect, test } from "bun:test";
import {
  isSlackSenderAllowed,
  isTelegramSenderAllowed,
  isZaloBotSenderAllowed,
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
      isSlackSenderAllowed({
        allowFrom: ["slack:U123", "U999"],
        userId: "u123",
      }),
    ).toBe(true);
    expect(
      isSlackSenderAllowed({
        allowFrom: ["U999"],
        userId: "U123",
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
      isTelegramSenderAllowed({
        allowFrom: ["123456"],
        userId: "123456",
        username: "alice",
      }),
    ).toBe(true);
    expect(
      isTelegramSenderAllowed({
        allowFrom: ["@alice"],
        userId: "999999",
        username: "Alice",
      }),
    ).toBe(true);
    expect(
      isTelegramSenderAllowed({
        allowFrom: ["@bob"],
        userId: "999999",
        username: "Alice",
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
      isZaloBotSenderAllowed({
        allowFrom: ["123456"],
        userId: "123456",
        username: "alice",
      }),
    ).toBe(true);
    expect(
      isZaloBotSenderAllowed({
        allowFrom: ["@alice"],
        userId: "999999",
        username: "Alice",
      }),
    ).toBe(true);
    expect(
      isZaloBotSenderAllowed({
        allowFrom: ["@bob"],
        userId: "999999",
        username: "Alice",
      }),
    ).toBe(false);
  });

  test("does not accept legacy generic aliases for Zalo Bot allowlist entries", () => {
    expect(
      isZaloBotSenderAllowed({
        allowFrom: ["zalo:@alice"],
        userId: "999999",
        username: "Alice",
      }),
    ).toBe(false);
    expect(
      isZaloBotSenderAllowed({
        allowFrom: ["user:123456"],
        userId: "123456",
      }),
    ).toBe(false);
  });
});
