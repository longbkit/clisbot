import { expect, test } from "vitest";
import { ChatUpdateRequestSchema } from "./rpc-schemas.js";
const request = { type: "chat.update.request", requestId: "r", chatId: "g" };
test("chat settings patch is narrow and cannot smuggle participants or internal rule limits", () => {
  expect(
    ChatUpdateRequestSchema.parse({ ...request, patch: { title: " Name ", requireMention: true } })
      .patch,
  ).toEqual({ title: " Name ", requireMention: true });
  for (const patch of [
    {},
    { botIds: ["b"] },
    { hops: { max: 0 } },
    { requireMention: "yes" },
    { title: "x".repeat(257) },
  ])
    expect(ChatUpdateRequestSchema.safeParse({ ...request, patch }).success).toBe(false);
});
