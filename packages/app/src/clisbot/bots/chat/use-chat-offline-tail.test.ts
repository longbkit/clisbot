import { expect, it } from "vitest";
import { offlineChatTranscript } from "./use-chat-offline-tail";

it("shows a placeholder per image the offline tail left on the Host", () => {
  const sender = { kind: "user" as const };
  const transcript = offlineChatTranscript(
    {
      chat: {
        id: "chat-1",
        title: null,
        participants: [],
        rules: {},
        createdAt: "now",
        updatedAt: "now",
        lastMessageAt: null,
        archivedAt: null,
      },
      messages: [
        { id: "a", seq: 1, at: "now", sender, text: "look", offlineImageCount: 2 },
        { id: "b", seq: 2, at: "now", sender, text: "plain" },
        { id: "c", seq: 3, at: "now", sender, text: "", offlineImageCount: 1 },
      ],
      hasOlder: true,
    },
    "[Image]",
  );

  expect(transcript).toEqual({
    messages: [
      { id: "a", seq: 1, at: "now", sender, text: "look\n\n[Image] [Image]" },
      { id: "b", seq: 2, at: "now", sender, text: "plain" },
      { id: "c", seq: 3, at: "now", sender, text: "[Image]" },
    ],
    hasOlder: true,
  });
});
