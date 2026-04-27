import { describe, expect, test } from "bun:test";
import { buildMentionOnlyFollowUpPrompt } from "../src/channels/mention-follow-up.ts";

describe("mention-only follow-up prompt", () => {
  test("uses the short context-driven fallback for mention-only messages", () => {
    const expected =
      "Mentioned clisbot only. Use the above messages context to answer the latest unresolved request.";

    expect(
      buildMentionOnlyFollowUpPrompt({
        conversationKind: "channel",
        threaded: true,
      }),
    ).toBe(expected);
    expect(
      buildMentionOnlyFollowUpPrompt({
        conversationKind: "dm",
        threaded: false,
      }),
    ).toBe(expected);
    expect(
      buildMentionOnlyFollowUpPrompt({
        conversationKind: "channel",
        threaded: false,
      }),
    ).toBe(expected);
  });
});
