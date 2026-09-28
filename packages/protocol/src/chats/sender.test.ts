import { describe, expect, test } from "vitest";
import { z } from "zod";
import { SessionActorSchema } from "../session-authorship.js";
import { ChatMessageSenderSchema } from "./types.js";
import { chatUserSender, normalizeChatSender } from "./sender.js";

const actor = {
  kind: "user" as const,
  id: "account-long",
  displayName: "Long",
  avatarUrl: "https://hub.test/avatar",
  hubOrigin: "https://hub.test",
  organizationId: "org",
  memberId: "member",
  connectionId: "connection",
};

describe("Chat sender identity", () => {
  test("preserves the full timeline actor directly on a user sender", () => {
    expect(ChatMessageSenderSchema.parse(chatUserSender(actor))).toEqual(actor);
    expect(chatUserSender({ kind: "user", id: "owner" })).toEqual({ kind: "user", id: "owner" });
    expect(chatUserSender(undefined)).toEqual({ kind: "user" });
  });

  test("accepts old nested senders and normalizes without mutating the source", () => {
    const legacy = { kind: "user" as const, actor };
    expect(normalizeChatSender(ChatMessageSenderSchema.parse(legacy))).toEqual(actor);
    expect(legacy.actor).toEqual(actor);
  });

  test("does not combine a flat identity with a different legacy actor scope", () => {
    expect(normalizeChatSender({ kind: "user", id: "owner", actor })).toEqual({
      kind: "user",
      id: "owner",
    });
  });

  test("bot, system and unknown-user senders keep their meaning", () => {
    for (const sender of [
      { kind: "bot", botId: "bot_a" },
      { kind: "system" },
      { kind: "user" },
    ] as const) {
      expect(normalizeChatSender(ChatMessageSenderSchema.parse(sender))).toEqual(sender);
    }
  });

  test("older clients can still parse flat user senders", () => {
    const oldSchema = z.object({ kind: z.literal("user"), actor: SessionActorSchema.optional() });
    expect(oldSchema.parse(chatUserSender(actor))).toEqual({ kind: "user" });
  });
});
