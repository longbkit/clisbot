import { expect, it } from "vitest";
import { channelTestMessage, channelTestPreview, CHANNEL_TEST_MESSAGE } from "./test-message.js";

it("previews the exact fixed text-only target, including Telegram General's wire placement", () => {
  const input = {
    channel: "telegram" as const,
    accountId: "support",
    conversationId: "-123",
    threadId: "1",
  };
  expect(channelTestMessage(input)).toEqual({
    ...input,
    threadId: null,
    requestedThreadId: "1",
    text: CHANNEL_TEST_MESSAGE,
    replyToMessageId: null,
    attachments: [],
  });
  expect(channelTestMessage({ ...input, threadId: "42" }).threadId).toBe("42");
  expect(channelTestMessage({ ...input, channel: "slack", threadId: "1" }).threadId).toBe("1");
});

it("binds a preview to its configured Connection, revision and exact destination", () => {
  const input = {
    channel: "slack" as const,
    accountId: "support",
    conversationId: "C123",
    revisionId: "revision-a",
    connectionId: "connection-a",
  };
  const preview = channelTestPreview(input);
  expect(channelTestPreview(input).previewId).toBe(preview.previewId);
  for (const change of [
    { revisionId: "revision-b" },
    { connectionId: "connection-b" },
    { conversationId: "C456" },
    { threadId: "1" },
    { accountId: "other" },
  ]) {
    expect(channelTestPreview({ ...input, ...change }).previewId).not.toBe(preview.previewId);
  }
});
