import { describe, expect, test } from "bun:test";
import {
  isChannelSenderAllowed,
  normalizeAllowEntry,
  normalizeApprovedPairingId,
} from "../src/channels/pairing/access.ts";

describe("pairing access helpers", () => {
  test("normalizes approved pairing ids through explicit channel contracts", () => {
    expect(normalizeApprovedPairingId("slack", "slack:u123")).toBe("U123");
    expect(normalizeApprovedPairingId("telegram", "telegram:123456")).toBe("123456");
    expect(normalizeApprovedPairingId("zalo-bot", "user-123")).toBe("user-123");
    expect(normalizeApprovedPairingId("zalo-bot", "aaa741c34d8fa4d1fd9e")).toBe(
      "aaa741c34d8fa4d1fd9e",
    );
    expect(normalizeApprovedPairingId("zalo-bot", "@alice")).toBe("");
  });

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

  test("normalizes Telegram provider ids only", () => {
    expect(normalizeAllowEntry("telegram", "123456")).toBe("123456");
    expect(normalizeAllowEntry("telegram", "@Alice")).toBe("");
    expect(normalizeAllowEntry("telegram", "alice")).toBe("");
    expect(normalizeAllowEntry("telegram", "tg:@Alice")).toBe("");
  });

  test("matches Telegram by provider id only", () => {
    expect(
      isChannelSenderAllowed({
        channel: "telegram",
        allowFrom: ["123456"],
        subject: {
          userId: "123456",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "telegram",
        allowFrom: ["@alice"],
        subject: {
          userId: "123456",
        },
      }),
    ).toBe(false);
    expect(
      isChannelSenderAllowed({
        channel: "telegram",
        allowFrom: ["999999"],
        subject: {
          userId: "123456",
        },
      }),
    ).toBe(false);
  });

  test("normalizes Zalo Bot provider ids only", () => {
    expect(normalizeAllowEntry("zalo-bot", "123456")).toBe("123456");
    expect(normalizeAllowEntry("zalo-bot", "aaa741c34d8fa4d1fd9e")).toBe(
      "aaa741c34d8fa4d1fd9e",
    );
    expect(normalizeAllowEntry("zalo-bot", "user-123")).toBe("user-123");
    expect(normalizeAllowEntry("zalo-bot", "zalo-bot:user-123")).toBe("user-123");
    expect(normalizeAllowEntry("zalo-bot", "@Alice")).toBe("");
    expect(normalizeAllowEntry("zalo-bot", "alice")).toBe("alice");
    expect(normalizeAllowEntry("zalo-bot", "zalo-bot:@Alice")).toBe("");
  });

  test("matches Zalo Bot by provider id only", () => {
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["123456"],
        subject: {
          userId: "123456",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["aaa741c34d8fa4d1fd9e"],
        subject: {
          userId: "aaa741c34d8fa4d1fd9e",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["zalo-bot:user-123"],
        subject: {
          userId: "user-123",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["user-123"],
        subject: {
          userId: "user-123",
        },
      }),
    ).toBe(true);
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["@alice"],
        subject: {
          userId: "@alice",
        },
      }),
    ).toBe(false);
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["@alice"],
        subject: {
          userId: "alice",
        },
      }),
    ).toBe(false);
    expect(
      isChannelSenderAllowed({
        channel: "zalo-bot",
        allowFrom: ["999999"],
        subject: {
          userId: "alice",
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
          userId: "alice",
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
