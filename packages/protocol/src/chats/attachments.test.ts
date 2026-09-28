import { describe, expect, test } from "vitest";
import { ChatCreateRequestSchema, ChatMessageSendRequestSchema } from "./rpc-schemas.js";
import { ChatMessagePayloadSchema } from "./types.js";
const files = {
  images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
  attachments: [{ type: "text", mimeType: "text/plain", text: "reference" }],
};
describe("chat attachment wire compatibility", () => {
  test("retains existing composer attachment shapes in send, first message and transcript", () => {
    expect(
      ChatMessageSendRequestSchema.parse({
        type: "chat.message.send.request",
        requestId: "r",
        chatId: "c",
        text: "",
        ...files,
      }),
    ).toMatchObject(files);
    expect(
      ChatCreateRequestSchema.parse({
        type: "chat.create.request",
        requestId: "r",
        botIds: ["b"],
        firstMessage: { text: "", ...files },
      }).firstMessage,
    ).toMatchObject(files);
    expect(
      ChatMessagePayloadSchema.parse({
        id: "m",
        seq: 1,
        at: "now",
        sender: { kind: "user" },
        text: "",
        hop: 0,
        ...files,
      }),
    ).toMatchObject(files);
  });
  test("rejects invalid structured attachments instead of silently discarding them", () => {
    expect(
      ChatMessageSendRequestSchema.safeParse({
        type: "chat.message.send.request",
        requestId: "r",
        chatId: "c",
        text: "",
        attachments: [{ type: "uploaded_file", path: "/private" }],
      }).success,
    ).toBe(false);
  });
});
